# Registers the Phase 11 backup schedule in Windows Task Scheduler.
#
#   powershell -ExecutionPolicy Bypass -File deploy\backup\install-schedule.ps1
#
# Owner's decision (2026-10-11): vertex-main every 6 hours, staging weekly,
# dev never (rebuildable test data). Plus a monthly restore drill of main.
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

# Every 6 hours, from the next quarter-day boundary.
$now = Get-Date
$next = $now.Date.AddHours([math]::Ceiling(($now.Hour + 1) / 6) * 6)
$every6h = New-ScheduledTaskTrigger -Once -At $next -RepetitionInterval (New-TimeSpan -Hours 6)
Register-VertexTask "Backup vertex-main" `
    "bash deploy/backup/backup.sh vertex-main .env.main >> $($Logs -replace '\\','/')/backup-vertex-main.log 2>&1" $every6h 1

$weekly = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "03:30"
Register-VertexTask "Backup vertex-staging" `
    "bash deploy/backup/backup.sh vertex-staging .env.staging >> $($Logs -replace '\\','/')/backup-vertex-staging.log 2>&1" $weekly 1

# First Sunday-ish of each month: Task Scheduler's monthly trigger needs
# CIM, so a 4-weekly trigger stands in (13 drills a year).
$monthly = New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek Sunday -At "04:00"
Register-VertexTask "Restore drill vertex-main" `
    "bash deploy/backup/restore-drill.sh vertex-main >> $($Logs -replace '\\','/')/restore-drill-vertex-main.log 2>&1" $monthly 1
