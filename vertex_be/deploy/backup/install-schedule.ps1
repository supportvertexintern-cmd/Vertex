# Registers the Phase 11 backup schedule in Windows Task Scheduler.
#
#   powershell -ExecutionPolicy Bypass -File deploy\backup\install-schedule.ps1
#
# Owner's decision (2026-11-06): only dev is backed up, daily, with a monthly
# restore drill. The main and staging stacks were removed on purpose; their
# last backups stay in D:\VertexDataackups and nothing here touches them.
#
# Tasks run as this Windows account, "only when logged on" (like the
# GitHub Actions runner): the backup key is DPAPI-protected for this
# account, and Docker Desktop runs in its session. A run missed while the
# PC was off or logged out starts as soon as possible afterwards. Output
# goes to D:\VertexData\backups\logs\. Re-running this script replaces the
# tasks.
$ErrorActionPreference = "Stop"

$Bash = "C:\Program Files\Git\bin\bash.exe"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path   # vertex_be
$Logs = "D:\VertexData\backups\logs"
$LogsPosix = $Logs -replace '\\', '/'
New-Item -ItemType Directory -Force $Logs | Out-Null
$Me = [Security.Principal.WindowsIdentity]::GetCurrent().Name

function Register-VertexTask([string]$Name, [string]$Command, $Trigger, [int]$Hours) {
    $repoPosix = $Repo -replace '\\', '/'
    $inner = "cd '$repoPosix' && $Command"
    $action = New-ScheduledTaskAction -Execute $Bash -Argument "-lc `"$inner`""
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours $Hours) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $Me -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Name -TaskPath "\Vertex\" -Action $action -Trigger $Trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
    Write-Output "registered \Vertex\$Name"
}

# The stacks that no longer exist. Only the tasks go: their backups stay.
foreach ($old in "Backup vertex-main", "Backup vertex-staging", "Restore drill vertex-main", "Off-site restore drill vertex-main") {
    if (Get-ScheduledTask -TaskName $old -TaskPath "\Vertex\" -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $old -TaskPath "\Vertex\" -Confirm:$false
        Write-Output "removed \Vertex\$old"
    }
}

$daily = New-ScheduledTaskTrigger -Daily -At "03:30"
Register-VertexTask "Backup vertex-dev" `
    "bash deploy/backup/backup.sh vertex-dev .env.dev >> $LogsPosix/backup-vertex-dev.log 2>&1" $daily 1

# First Sunday-ish of each month: Task Scheduler's monthly trigger needs
# CIM, so a 4-weekly trigger stands in (13 drills a year).
$monthly = New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek Sunday -At "04:00"
Register-VertexTask "Restore drill vertex-dev" `
    "bash deploy/backup/restore-drill.sh vertex-dev >> $LogsPosix/restore-drill-vertex-dev.log 2>&1" $monthly 1

$now = Get-Date

# E5: hourly health check (stale backups, stale off-site copy, overdue
# drill → alert email + audit row).
$hourly = New-ScheduledTaskTrigger -Once -At $now.Date.AddHours($now.Hour + 1) -RepetitionInterval (New-TimeSpan -Hours 1)
Register-VertexTask "Backup health check" `
    "bash deploy/backup/backup-health.sh >> $LogsPosix/backup-health.log 2>&1" $hourly 1

# E5 off-site tasks, once the bucket is configured (backup-recovery.md §9):
# weekly prune with the admin credential.
$OffsiteConf = if ($env:OFFSITE_CONF) { $env:OFFSITE_CONF } else { "D:\VertexData\backup-keys\offsite.conf" }
if (Test-Path $OffsiteConf) {
    $weeklyPrune = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At "04:30"
    Register-VertexTask "Off-site prune" `
        "python deploy/backup/offsite.py prune vertex-dev --apply >> $LogsPosix/offsite-prune.log 2>&1" $weeklyPrune 1
} else {
    Write-Output "off-site not configured ($OffsiteConf): off-site tasks not registered"
}
