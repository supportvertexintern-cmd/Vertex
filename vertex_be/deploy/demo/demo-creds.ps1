# Demo database connection strings (docs/demo-site.md), stored like the
# backup credentials: a DPAPI blob only this Windows account on this PC can
# unwrap. Never in Git, env files or a command line.
#
#   powershell -File demo-creds.ps1 set owner   # prompts for Neon's connection string (direct, not -pooler)
#   powershell -File demo-creds.ps1 get owner   # prints it, for setup-demo-db.sh only
#   powershell -File demo-creds.ps1 status
#
# owner  the Neon database owner: schema setup and role provisioning only.
# web    vertex_web's string, written by setup-demo-db.sh, sent to Vercel.
param(
    [Parameter(Mandatory = $true)][ValidateSet("set", "get", "status")][string]$Action,
    [ValidateSet("owner", "web")][string]$Name = "owner"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$KeyDir = if ($env:VERTEX_DEMO_KEY_DIR) { $env:VERTEX_DEMO_KEY_DIR } else { "D:\VertexData\demo-keys" }
$Entropy = [Text.Encoding]::UTF8.GetBytes("vertex-demo/v1")
function File-For([string]$n) { Join-Path $KeyDir "demo-$n.dpapi" }

switch ($Action) {
    "set" {
        New-Item -ItemType Directory -Force $KeyDir | Out-Null
        if ([Console]::IsInputRedirected) {
            $value = [Console]::In.ReadLine()
        } else {
            $s = Read-Host "Connection string ($Name)" -AsSecureString
            $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
        }
        if (-not ($value -match '^postgres(ql)?://')) { throw "Expected a postgresql:// connection string" }
        $blob = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value), $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes((File-For $Name), $blob)
        Write-Output "Stored the $Name connection string: $(File-For $Name) (DPAPI, this account only)"
    }
    "get" {
        $f = File-For $Name
        if (-not (Test-Path $f)) { throw "No $Name connection string at $f; run: demo-creds.ps1 set $Name" }
        $raw = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($f), $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [Console]::Out.Write([Text.Encoding]::UTF8.GetString($raw))
    }
    "status" {
        foreach ($n in "owner", "web") { Write-Output "${n}: $(if (Test-Path (File-For $n)) { 'stored' } else { 'missing' })" }
    }
}
