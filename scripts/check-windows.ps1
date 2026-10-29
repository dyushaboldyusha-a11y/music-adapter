$ErrorActionPreference = 'Stop'
$bridge = Join-Path $PSScriptRoot '../native/windows-media.ps1'
$tokens = $null
$errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($bridge, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
# Exercise the actual Node.js client used by Electron, rather than a second
# PowerShell process wrapper with a different console/pipe encoding.
& node (Join-Path $PSScriptRoot 'check-windows.cjs')
exit $LASTEXITCODE
