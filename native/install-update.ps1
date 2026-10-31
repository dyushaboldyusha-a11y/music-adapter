param(
    [Parameter(Mandatory=$true)][string]$TargetPath,
    [string]$NewTargetPath = '',
    [Parameter(Mandatory=$true)][string]$UpdatePath,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][int]$WaitPid,
    [Parameter(Mandatory=$true)][string]$StatusPath,
    [string]$ReadyPath = '',
    [string]$ReadyToken = '',
    [switch]$NoRelaunch,
    [ValidateRange(1,60)][int]$LockWaitSeconds = 30
)
$ErrorActionPreference = 'Stop'
function Get-UpdateSha256([string]$FilePath) {
    $stream = [IO.File]::OpenRead($FilePath)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Write-InstallStatus([string]$Phase, [bool]$Ok, [string]$Message = '') {
    $record = @{ ok = $Ok; phase = $Phase; error = $Message; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); oldPath = $TargetPath; newPath = $destination; token = $token; sha256 = $ExpectedSha256 }
    [IO.File]::WriteAllText($StatusPath, (ConvertTo-Json -InputObject $record -Compress), [Text.UTF8Encoding]::new($true))
}
$destination = if ($NewTargetPath) { $NewTargetPath } else { $TargetPath }
$token = if ($ReadyToken) { $ReadyToken } else { [Guid]::NewGuid().ToString('N') }
$pending = $destination + '.' + $token + '.pending.exe'
$backup = $TargetPath + '.' + $token + '.backup.exe'
$replaced = $false
try {
    if ($token -notmatch '^[a-fA-F0-9]{32}$') { throw 'Invalid installer token.' }
    Write-InstallStatus 'preparing' $false
    if (-not [IO.Path]::IsPathRooted($TargetPath) -or -not [IO.Path]::IsPathRooted($destination) -or -not [IO.Path]::IsPathRooted($UpdatePath) -or $TargetPath -eq $UpdatePath -or $destination -eq $UpdatePath) { throw 'Invalid update paths.' }
    if (-not [string]::Equals([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($TargetPath)), [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($destination)), [StringComparison]::OrdinalIgnoreCase)) { throw 'The new executable must stay in the original folder.' }
    if (-not (Test-Path -LiteralPath $TargetPath -PathType Leaf)) { throw 'The previous executable is missing.' }
    if ((Get-UpdateSha256 $UpdatePath) -ne $ExpectedSha256) { throw 'Update checksum mismatch.' }
    if ($destination -ne $TargetPath -and (Test-Path -LiteralPath $destination) -and (Get-UpdateSha256 $destination) -ne $ExpectedSha256) { throw 'A different file already uses the new version name. Move it aside before updating.' }
    Copy-Item -LiteralPath $UpdatePath -Destination $pending
    if ((Get-UpdateSha256 $pending) -ne $ExpectedSha256) { throw 'Staged checksum mismatch.' }
    Write-InstallStatus 'ready' $false
    if ($ReadyPath) {
        if (-not $ReadyToken) { throw 'Missing installer handshake token.' }
        $ready = @{ phase = 'ready'; token = $token; pid = $PID; sha256 = $ExpectedSha256 }
        [IO.File]::WriteAllText($ReadyPath, (ConvertTo-Json -InputObject $ready -Compress), [Text.UTF8Encoding]::new($true))
    }
    # Confirmed staging happens before the application is allowed to close.
    $parentDeadline = [DateTime]::UtcNow.AddSeconds(60)
    while ($WaitPid -gt 0 -and (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) {
        if ([DateTime]::UtcNow -ge $parentDeadline) { throw 'The application did not exit after installer readiness.' }
        Start-Sleep -Milliseconds 100
    }
    Write-InstallStatus 'replacing' $false
    $deadline = [DateTime]::UtcNow.AddSeconds($LockWaitSeconds)
    while ($true) {
        try { Move-Item -LiteralPath $TargetPath -Destination $backup; break }
        catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 300 }
    }
    try {
        if (Test-Path -LiteralPath $destination) {
            if ((Get-UpdateSha256 $destination) -ne $ExpectedSha256) { throw 'The destination changed during installation.' }
            Remove-Item -LiteralPath $pending -Force
        } else { Move-Item -LiteralPath $pending -Destination $destination; $replaced = $true }
    } catch { Move-Item -LiteralPath $backup -Destination $TargetPath; throw }
    if (-not $NoRelaunch) { Start-Process -FilePath $destination -WorkingDirectory (Split-Path -Parent $destination) }
    Write-InstallStatus 'complete' $true
    $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (Test-Path -LiteralPath $backup) {
        try { Remove-Item -LiteralPath $backup -Force -ErrorAction Stop; break }
        catch { if ([DateTime]::UtcNow -ge $cleanupDeadline) { break }; Start-Sleep -Milliseconds 300 }
    }
    Remove-Item -LiteralPath $UpdatePath -Force -ErrorAction SilentlyContinue
} catch {
    $message = $_.Exception.Message
    if (Test-Path -LiteralPath $backup) {
        if ($replaced) { Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue }
        if (-not (Test-Path -LiteralPath $TargetPath)) { Move-Item -LiteralPath $backup -Destination $TargetPath -ErrorAction SilentlyContinue }
    }
    try { Write-InstallStatus 'failed' $false $message } catch { }
    $parentRunning = $WaitPid -gt 0 -and (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)
    if (-not $NoRelaunch -and -not $parentRunning -and (Test-Path -LiteralPath $TargetPath)) {
        try { Start-Process -FilePath $TargetPath -WorkingDirectory (Split-Path -Parent $TargetPath) } catch { }
        if ($env:OS -eq 'Windows_NT') {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show('Не удалось установить обновление Liberty Wave. Предыдущая версия сохранена. Подробности находятся в last-install.json.', 'Liberty Wave')
        }
    }
    exit 1
} finally { Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue }
