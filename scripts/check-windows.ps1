$ErrorActionPreference = 'Stop'
$bridge = Join-Path $PSScriptRoot '../native/windows-media.ps1'
$tokens = $null
$errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($bridge, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-audio.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node (Join-Path $PSScriptRoot 'check-audio-bridge.cjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-native-state.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-install-update.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Exercise the actual Node.js client used by Electron, rather than a second
# PowerShell process wrapper with a different console/pipe encoding.
& node (Join-Path $PSScriptRoot 'check-windows.cjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node (Join-Path $PSScriptRoot 'check-installer-handshake.cjs')
exit $LASTEXITCODE
