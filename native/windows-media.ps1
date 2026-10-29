# Windows PowerShell 5.1 / Windows 10 1809+. No tokens, browser injection or media keys.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

function Send-Message($Message) {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Message -Depth 6 -Compress))
    [Console]::Out.Flush()
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    # Console.In.ReadLineAsync can block synchronously on .NET Framework.
    # Read stdin on a managed background thread; never run PowerShell on that thread.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Threading;
public static class MusicAdapterInput {
    public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public static volatile bool Closed;
    public static void Start() {
        var thread = new Thread(() => {
            try { string line; while ((line = Console.In.ReadLine()) != null) Lines.Enqueue(line); }
            finally { Closed = true; }
        });
        thread.IsBackground = true;
        thread.Start();
    }
}
'@
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType=WindowsRuntime]
    $script:AsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
        $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    if ($null -eq $script:AsTask) { throw 'WinRT task adapter is unavailable.' }

    function Await-WinRT($Operation, [Type]$ResultType) {
        $task = $script:AsTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
        if (-not $task.Wait(3500)) { throw 'Windows media request timed out.' }
        return $task.GetAwaiter().GetResult()
    }

    $manager = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $script:ArtKey = ''
    $script:Artwork = $null

    function Get-YandexSession {
        # Match only Yandex Music; never fall back to another player's current session.
        $sessions = @($manager.GetSessions())
        $matches = @($sessions | Where-Object { $_.SourceAppUserModelId -match '(?i)(yandex.*music|music.*yandex)' })
        $playing = $matches | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
        if ($null -ne $playing) { return $playing }
        return ($matches | Select-Object -First 1)
    }

    function Read-Artwork($Properties, [string]$Key) {
        if ($script:ArtKey -eq $Key) { return $script:Artwork }
        $script:Artwork = $null
        if ($null -ne $Properties.Thumbnail) {
            $stream = $null
            $reader = $null
            try {
                $stream = Await-WinRT ($Properties.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                if ($stream.Size -gt 0 -and $stream.Size -lt 4000000) {
                    $reader = [Windows.Storage.Streams.DataReader]::new($stream)
                    $loaded = Await-WinRT ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
                    $bytes = [byte[]]::new([int]$loaded)
                    $reader.ReadBytes($bytes)
                    $mime = $stream.ContentType
                    if ($mime -notmatch '^image/(png|jpeg|jpg|webp)$') {
                        if ($loaded -ge 8 -and $bytes[0] -eq 137 -and $bytes[1] -eq 80) { $mime = 'image/png' }
                        elseif ($loaded -ge 3 -and $bytes[0] -eq 255 -and $bytes[1] -eq 216) { $mime = 'image/jpeg' }
                        else { $mime = '' }
                    }
                    if ($mime) { $script:Artwork = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes) }
                }
                $script:ArtKey = $Key
            } catch { $script:ArtKey = '' }
            finally {
                if ($null -ne $reader) { $reader.Dispose() }
                if ($null -ne $stream) { $stream.Dispose() }
            }
        }
        return $script:Artwork
    }

    function Read-State($Session) {
        if ($null -eq $Session) {
            $script:ArtKey = ''
            $script:Artwork = $null
            return @{ connected = $false }
        }
        $properties = Await-WinRT ($Session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $info = $Session.GetPlaybackInfo()
        $controls = $info.Controls
        $timeline = $Session.GetTimelineProperties()
        $start = $timeline.StartTime.TotalSeconds
        $duration = [Math]::Max(0, $timeline.EndTime.TotalSeconds - $start)
        $playing = $info.PlaybackStatus.ToString() -eq 'Playing'
        $position = $timeline.Position.TotalSeconds - $start
        if ($playing -and $timeline.LastUpdatedTime.Year -gt 2000) {
            $delta = ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalSeconds
            $rate = if ($null -ne $info.PlaybackRate) { [double]$info.PlaybackRate } else { 1.0 }
            $position += [Math]::Max(0, $delta) * $rate
        }
        $repeat = if ($null -eq $info.AutoRepeatMode) { 'none' } else {
            switch ($info.AutoRepeatMode.ToString()) { 'Track' { 'track' } 'List' { 'list' } default { 'none' } }
        }
        $key = $Session.SourceAppUserModelId + '|' + $properties.Title + '|' + $properties.Artist + '|' + $properties.AlbumTitle
        return @{
            connected = $true
            title = $properties.Title
            artist = $properties.Artist
            album = $properties.AlbumTitle
            artwork = (Read-Artwork $properties $key)
            playing = $playing
            position = [Math]::Max(0, [Math]::Min($duration, $position))
            duration = $duration
            shuffle = ($info.IsShuffleActive -eq $true)
            repeat = $repeat
            capabilities = @{
                playPause = ($controls.IsPlayPauseToggleEnabled -or ($playing -and $controls.IsPauseEnabled) -or (-not $playing -and $controls.IsPlayEnabled))
                next = [bool]$controls.IsNextEnabled
                previous = [bool]$controls.IsPreviousEnabled
                seek = [bool]$controls.IsPlaybackPositionEnabled
                shuffle = [bool]$controls.IsShuffleEnabled
                repeat = [bool]$controls.IsRepeatEnabled
            }
        }
    }

    function Invoke-PlayerCommand($Session, $Request) {
        if ($null -eq $Session) { throw 'Open Yandex Music and start a track first.' }
        $controls = $Session.GetPlaybackInfo().Controls
        $operation = switch ($Request.command) {
            'playPause' {
                $playback = $Session.GetPlaybackInfo()
                if ($controls.IsPlayPauseToggleEnabled) { $Session.TryTogglePlayPauseAsync() }
                elseif ($playback.PlaybackStatus.ToString() -eq 'Playing' -and $controls.IsPauseEnabled) { $Session.TryPauseAsync() }
                elseif ($controls.IsPlayEnabled) { $Session.TryPlayAsync() }
                else { throw 'Playback control is not provided by Yandex Music.' }
            }
            'next' { if (-not $controls.IsNextEnabled) { throw 'Next track is unavailable.' }; $Session.TrySkipNextAsync() }
            'previous' { if (-not $controls.IsPreviousEnabled) { throw 'Previous track is unavailable.' }; $Session.TrySkipPreviousAsync() }
            'seek' {
                if (-not $controls.IsPlaybackPositionEnabled) { throw 'Seeking is not provided by Yandex Music.' }
                $timeline = $Session.GetTimelineProperties()
                $seconds = [Math]::Max(0, [Math]::Min([double]$Request.value, $timeline.EndTime.TotalSeconds - $timeline.StartTime.TotalSeconds))
                $Session.TryChangePlaybackPositionAsync([long](($seconds + $timeline.StartTime.TotalSeconds) * 10000000))
            }
            'shuffle' { if (-not $controls.IsShuffleEnabled) { throw 'Shuffle is not provided by Yandex Music.' }; $Session.TryChangeShuffleActiveAsync([bool]$Request.value) }
            'repeat' {
                if (-not $controls.IsRepeatEnabled) { throw 'Repeat is not provided by Yandex Music.' }
                $mode = switch ($Request.value) { 'track' { 'Track' } 'list' { 'List' } 'none' { 'None' } default { throw 'Invalid repeat mode.' } }
                $Session.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode]::$mode)
            }
            default { throw 'Unsupported command.' }
        }
        if (-not (Await-WinRT $operation ([bool]))) { throw 'Yandex Music rejected the command.' }
    }

    [MusicAdapterInput]::Start()
    $lastPoll = [DateTime]::MinValue
    while ($true) {
        $line = ''
        if ([MusicAdapterInput]::Lines.TryDequeue([ref]$line)) {
            $request = $null
            try {
                $request = ConvertFrom-Json -InputObject $line
                Invoke-PlayerCommand (Get-YandexSession) $request
                Send-Message @{ type = 'result'; id = $request.id; ok = $true }
            } catch { Send-Message @{ type = 'result'; id = $request.id; ok = $false; error = $_.Exception.Message } }
            $lastPoll = [DateTime]::MinValue
        }
        if ([MusicAdapterInput]::Closed -and [MusicAdapterInput]::Lines.IsEmpty) { break }
        if (([DateTime]::UtcNow - $lastPoll).TotalMilliseconds -ge 750) {
            try { Send-Message @{ type = 'state'; state = (Read-State (Get-YandexSession)) } }
            catch { Send-Message @{ type = 'state'; state = @{ connected = $false; error = 'Windows could not read the Yandex Music session. Restart Yandex Music.' } } }
            $lastPoll = [DateTime]::UtcNow
        }
        Start-Sleep -Milliseconds 40
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    Send-Message @{ type = 'state'; state = @{ connected = $false; error = 'Windows media integration requires Windows 10 1809 or newer and Windows PowerShell 5.1.' } }
    exit 1
}
