$ErrorActionPreference = 'Stop'
$bridge = Join-Path $PSScriptRoot '../native/windows-media.ps1'
$tokens = $null
$errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($bridge, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$info = [Diagnostics.ProcessStartInfo]::new()
$info.FileName = 'powershell.exe'
$info.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Resolve-Path $bridge).Path + '"'
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardInput = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
$process = [Diagnostics.Process]::Start($info)
try {
    $line = $process.StandardOutput.ReadLineAsync()
    if (-not $line.Wait(20000)) { throw 'Bridge did not publish a media state.' }
    $state = ConvertFrom-Json $line.Result
    if ($state.type -ne 'state' -or $state.state.error) { throw ('Windows integration failed: ' + $line.Result) }
    $process.StandardInput.WriteLine('{"id":1,"command":"invalid-command"}')
    $found = $false
    for ($i = 0; $i -lt 8; $i++) {
        $line = $process.StandardOutput.ReadLineAsync()
        if (-not $line.Wait(5000)) { throw 'No command response.' }
        $response = ConvertFrom-Json $line.Result
        if ($response.type -eq 'result' -and $response.id -eq 1) {
            if ($response.ok) { throw 'Invalid command unexpectedly succeeded.' }
            $found = $true; break
        }
    }
    if (-not $found) { throw 'Command response missing.' }
    Write-Output 'PASS: Windows WinRT initialization, state publishing and bridge command protocol.'
} finally {
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(5000)) { $process.Kill() }
    $process.Dispose()
}
