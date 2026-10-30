$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '../native/install-update.ps1'
$tokens = $null; $errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$directory = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $directory
$target = Join-Path $directory 'Liberty Волна.exe'
$update = Join-Path $directory 'Downloaded update.exe'
$status = Join-Path $directory 'result.json'
try {
    [IO.File]::WriteAllText($target, 'old app')
    [IO.File]::WriteAllText($update, 'new app')
    $hash = (Get-FileHash $update -Algorithm SHA256).Hash
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -TargetPath $target -UpdatePath $update -ExpectedSha256 $hash -WaitPid 0 -StatusPath $status -NoRelaunch
    if ($LASTEXITCODE -ne 0 -or [IO.File]::ReadAllText($target) -ne 'new app' -or (Test-Path $update)) { throw 'Verified update did not replace the same executable.' }
    [IO.File]::WriteAllText($update, 'bad file')
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -TargetPath $target -UpdatePath $update -ExpectedSha256 $hash -WaitPid 0 -StatusPath $status -NoRelaunch
    if ($LASTEXITCODE -eq 0 -or [IO.File]::ReadAllText($target) -ne 'new app') { throw 'A checksum failure changed the existing application.' }
    $hash = (Get-FileHash $update -Algorithm SHA256).Hash
    $lock = [IO.File]::Open($target, 'Open', 'Read', 'None')
    try {
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -TargetPath $target -UpdatePath $update -ExpectedSha256 $hash -WaitPid 0 -StatusPath $status -NoRelaunch -LockWaitSeconds 1
        if ($LASTEXITCODE -eq 0) { throw 'An application in use must not be replaced.' }
    } finally { $lock.Dispose() }
    if ([IO.File]::ReadAllText($target) -ne 'new app' -or (Get-ChildItem $directory -Filter '*.pending.exe').Count -ne 0) { throw 'A locked executable was changed or temporary data leaked.' }
    Write-Output 'PASS: in-place update, Unicode/space-safe paths, checksum failure, locked-file protection and temporary-file cleanup.'
    exit 0
} finally { Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue }
