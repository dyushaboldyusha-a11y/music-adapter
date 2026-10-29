$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../native/windows-media.ps1') -InitializeOnly
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
    if ($state.artwork -ne ('data:image/png;base64,' + [Convert]::ToBase64String($png))) { throw 'Real WinRT artwork did not round-trip as PNG.' }
    if ($state.position -lt 84 -or $state.duration -ne 258 -or -not $state.capabilities.playPause) { throw 'Timeline or transport was lost.' }
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
