$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../native/windows-media.ps1') -InitializeOnly
foreach ($case in @(
    @('YandexMusic.exe', 'yandex', 'app'), @('SpotifyAB.SpotifyMusic!Spotify', 'spotify', 'app'),
    @('SoundCloud.exe', 'soundcloud', 'app'), @('chrome.exe', 'browser', 'browser'),
    @('msedge.exe', 'browser', 'browser'), @('firefox.exe', 'browser', 'browser'),
    @('YandexBrowser.exe', 'browser', 'browser')
)) {
    $source = Get-SourceDescriptor $case[0]
    if ($source.provider -ne $case[1] -or $source.kind -ne $case[2]) { throw ('Incorrect source classification: ' + $case[0]) }
}
if ($null -ne (Get-SourceDescriptor 'UnrelatedApplication.exe')) { throw 'An unrelated application must not become a music source.' }
$managerIdentity = Get-SessionId $manager
if ($managerIdentity -ne (Get-SessionId $manager)) { throw 'WinRT session identity must stay stable.' }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStreamReference, Windows.Storage.Streams, ContentType=WindowsRuntime]
$temporary = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString() + '.bin')
try {
    # A real WinRT thumbnail with an unhelpful file extension / MIME type.
    $png = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=')
    [IO.File]::WriteAllBytes($temporary, $png)
    $file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($temporary)) ([Windows.Storage.StorageFile])
    $reference = [Windows.Storage.Streams.RandomAccessStreamReference]::CreateFromFile($file)
    $properties = [pscustomobject]@{ Title = 'Track'; Artist = 'Artist'; AlbumTitle = 'Album'; Thumbnail = $reference }
    $info = [pscustomobject]@{ PlaybackStatus = 'Playing'; PlaybackRate = $null; AutoRepeatMode = $null; IsShuffleActive = $null; Controls = [pscustomobject]@{ IsPlayPauseToggleEnabled = $true; IsNextEnabled = $true } }
    $timeline = [pscustomobject]@{ StartTime = [TimeSpan]::Zero; EndTime = [TimeSpan]::FromSeconds(258); Position = [TimeSpan]::FromSeconds(84); LastUpdatedTime = [DateTime]::UtcNow }
    $state = ConvertTo-PlayerState $properties $info $timeline 'YandexMusic.exe'
    if (-not $state.connected -or $state.title -ne 'Track') { throw 'Thumbnail read erased track metadata.' }
    if ($state.artwork -ne ('data:image/png;base64,' + [Convert]::ToBase64String($png))) { throw ('Real WinRT artwork did not round-trip as PNG: ' + $script:ArtworkError) }
    if ($state.position -lt 84 -or $state.duration -ne 258 -or -not $state.capabilities.playPause) { throw 'Timeline or transport was lost.' }
    if ($state.sampledAt -le 0 -or $state.sampleSequence -le 0 -or -not $state.sampleOrigin) { throw 'Timeline observation identity is missing.' }
    $sequence = $state.sampleSequence
    $info.PlaybackRate = 2
    $timeline.LastUpdatedTime = [DateTimeOffset]::UtcNow.AddSeconds(-5)
    $fast = ConvertTo-PlayerState $properties $info $timeline 'YandexMusic.exe'
    if ([Math]::Abs($fast.position - 94) -gt .5 -or $fast.playbackRate -ne 2 -or $fast.sampleSequence -le $sequence) { throw 'Playback-rate or timestamp projection is incorrect.' }
    $failed = [pscustomobject]@{}
    $failed | Add-Member ScriptMethod OpenReadAsync { throw 'Thumbnail temporarily unavailable.' }
    $properties.Title = 'Next track'; $properties.Thumbnail = $failed
    $state = ConvertTo-PlayerState $properties $info $null 'YandexMusic.exe'
    if (-not $state.connected -or $state.title -ne 'Next track' -or $null -ne $state.artwork) { throw 'Failed thumbnail broke metadata or reused another track cover.' }
    $properties.Thumbnail = $reference
    $state = ConvertTo-PlayerState $properties $info $null 'YandexMusic.exe'
    if (-not $state.artwork) { throw 'A thumbnail was not retried after its initial failure.' }
    Write-Output 'PASS: real WinRT cover bytes, MIME detection, timeline conversion, thumbnail failure isolation and retry.'
} finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
