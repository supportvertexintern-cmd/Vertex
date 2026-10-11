# Backup encryption key (Phase 11). One random 256-bit key, stored as a
# DPAPI blob that only this Windows account on this PC can unwrap. The
# backup and restore scripts read it through a pipe; it's never written in
# plain text or passed on a command line.
#
#   powershell -File backup-key.ps1 init     # create it (no-op if present)
#   powershell -File backup-key.ps1 get      # print it, for piping into gpg only
#   powershell -File backup-key.ps1 escrow   # show it once, to store offline
#
# Without the key the backups can't be read. After `init`, run `escrow` and
# put the value in a password manager: a Windows reinstall or a new PC
# can't unwrap the DPAPI blob.
param([Parameter(Mandatory = $true)][ValidateSet("init", "get", "escrow")][string]$Action)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$KeyDir = if ($env:VERTEX_BACKUP_KEY_DIR) { $env:VERTEX_BACKUP_KEY_DIR } else { "D:\VertexData\backup-keys" }
$KeyFile = Join-Path $KeyDir "vertex-backup.key.dpapi"
$Entropy = [Text.Encoding]::UTF8.GetBytes("vertex-backup/v1")

function Restrict-ToOwner([string]$Path) {
    # Only this account, SYSTEM and Administrators; nothing inherited.
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $Path /inheritance:r /grant:r "${me}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed on $Path" }
}

function Read-Key {
    if (-not (Test-Path $KeyFile)) { throw "No backup key at $KeyFile; run: backup-key.ps1 init" }
    $blob = [IO.File]::ReadAllBytes($KeyFile)
    $raw = [Security.Cryptography.ProtectedData]::Unprotect($blob, $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Convert]::ToBase64String($raw)
}

switch ($Action) {
    "init" {
        if (Test-Path $KeyFile) { Write-Output "Backup key already exists: $KeyFile"; break }
        New-Item -ItemType Directory -Force $KeyDir | Out-Null
        Restrict-ToOwner $KeyDir
        $raw = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($raw)
        $blob = [Security.Cryptography.ProtectedData]::Protect($raw, $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes($KeyFile, $blob)
        Write-Output "Created backup key: $KeyFile (DPAPI, this account only). Next: run 'escrow' and store the value offline."
    }
    "get" {
        # No newline: gpg takes the whole first line as the passphrase.
        [Console]::Out.Write((Read-Key))
    }
    "escrow" {
        Write-Output "Store this value in a password manager (it decrypts every Vertex backup):"
        Write-Output (Read-Key)
    }
}
