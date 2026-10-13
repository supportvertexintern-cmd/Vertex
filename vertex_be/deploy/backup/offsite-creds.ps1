# Off-site backup credentials (E5), stored like the backup key: a DPAPI blob
# only this Windows account on this PC can unwrap, in the ACL-restricted key
# folder. Never in Git, env files or a command line.
#
#   powershell -File offsite-creds.ps1 set writer   # prompts; or pipe two lines: key id, secret
#   powershell -File offsite-creds.ps1 set admin
#   powershell -File offsite-creds.ps1 get writer   # prints "id<LF>secret", for offsite.py only
#   powershell -File offsite-creds.ps1 status
#
# writer  used by every backup: may only PUT objects (no read, list or delete).
# admin   used by the weekly prune and the off-site restore test: list, read
#         and delete. Keep its secret also in the password manager.
param(
    [Parameter(Mandatory = $true)][ValidateSet("set", "get", "status")][string]$Action,
    [ValidateSet("writer", "admin")][string]$Role = "writer"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$KeyDir = if ($env:VERTEX_BACKUP_KEY_DIR) { $env:VERTEX_BACKUP_KEY_DIR } else { "D:\VertexData\backup-keys" }
$Entropy = [Text.Encoding]::UTF8.GetBytes("vertex-offsite/v1")
function File-For([string]$r) { Join-Path $KeyDir "offsite-$r.dpapi" }

switch ($Action) {
    "set" {
        New-Item -ItemType Directory -Force $KeyDir | Out-Null
        if ([Console]::IsInputRedirected) {
            $id = [Console]::In.ReadLine(); $secret = [Console]::In.ReadLine()
        } else {
            $id = Read-Host "Access key ID ($Role)"
            $s = Read-Host "Secret access key ($Role)" -AsSecureString
            $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
        }
        if (-not $id -or -not $secret) { throw "Both the key ID and the secret are required" }
        $raw = [Text.Encoding]::UTF8.GetBytes("$id`n$secret")
        $blob = [Security.Cryptography.ProtectedData]::Protect($raw, $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes((File-For $Role), $blob)
        Write-Output "Stored the $Role credentials: $(File-For $Role) (DPAPI, this account only)"
    }
    "get" {
        $f = File-For $Role
        if (-not (Test-Path $f)) { throw "No $Role credentials at $f; run: offsite-creds.ps1 set $Role" }
        $raw = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($f), $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [Console]::Out.Write([Text.Encoding]::UTF8.GetString($raw))
    }
    "status" {
        foreach ($r in "writer", "admin") { Write-Output "${r}: $(if (Test-Path (File-For $r)) { 'stored' } else { 'missing' })" }
    }
}
