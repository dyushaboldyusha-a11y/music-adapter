param(
    [Parameter(Mandatory=$true)][string]$TargetPath,
    [Parameter(Mandatory=$true)][string]$UpdatePath,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][int]$WaitPid,
    [Parameter(Mandatory=$true)][string]$StatusPath,
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
$token = [Guid]::NewGuid().ToString('N')
$pending = $TargetPath + '.' + $token + '.pending.exe'
$backup = $TargetPath + '.' + $token + '.backup.exe'
$replaced = $false
try {
    if (-not [IO.Path]::IsPathRooted($TargetPath) -or -not [IO.Path]::IsPathRooted($UpdatePath) -or $TargetPath -eq $UpdatePath) { throw 'Invalid update paths.' }
    if ((Get-UpdateSha256 $UpdatePath) -ne $ExpectedSha256) { throw 'Update checksum mismatch.' }
    # Stage on the same volume as the original file, before changing it.
    Copy-Item -LiteralPath $UpdatePath -Destination $pending
    if ((Get-UpdateSha256 $pending) -ne $ExpectedSha256) { throw 'Staged checksum mismatch.' }
    if ($WaitPid -gt 0) { Wait-Process -Id $WaitPid -Timeout 30 -ErrorAction SilentlyContinue }
    $deadline = [DateTime]::UtcNow.AddSeconds($LockWaitSeconds)
    while ($true) {
        try { Move-Item -LiteralPath $TargetPath -Destination $backup; break }
        catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 300 }
    }
    try { Move-Item -LiteralPath $pending -Destination $TargetPath; $replaced = $true }
    catch { Move-Item -LiteralPath $backup -Destination $TargetPath; throw }
    if (-not $NoRelaunch) { Start-Process -FilePath $TargetPath -WorkingDirectory (Split-Path -Parent $TargetPath) }
    @{ ok = $true; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatusPath -Encoding UTF8 -ErrorAction SilentlyContinue
    $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (Test-Path -LiteralPath $backup) {
        try { Remove-Item -LiteralPath $backup -Force -ErrorAction Stop; break }
        catch { if ([DateTime]::UtcNow -ge $cleanupDeadline) { break }; Start-Sleep -Milliseconds 300 }
    }
    Remove-Item -LiteralPath $UpdatePath -Force -ErrorAction SilentlyContinue
} catch {
    $message = $_.Exception.Message
    if (Test-Path -LiteralPath $backup) {
        if ($replaced) { Remove-Item -LiteralPath $TargetPath -Force -ErrorAction SilentlyContinue }
        if (-not (Test-Path -LiteralPath $TargetPath)) { Move-Item -LiteralPath $backup -Destination $TargetPath -ErrorAction SilentlyContinue }
    }
    @{ ok = $false; error = $message; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatusPath -Encoding UTF8 -ErrorAction SilentlyContinue
    if (-not $NoRelaunch -and (Test-Path -LiteralPath $TargetPath)) {
        if ($WaitPid -gt 0) { Wait-Process -Id $WaitPid -Timeout 30 -ErrorAction SilentlyContinue }
        Start-Process -FilePath $TargetPath -WorkingDirectory (Split-Path -Parent $TargetPath)
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show('Не удалось установить обновление Liberty Wave. Предыдущая версия сохранена. Переместите приложение в папку с доступом на запись и повторите обновление.', 'Liberty Wave')
    }
    exit 1
} finally { Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue }
