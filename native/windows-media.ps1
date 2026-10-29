param([switch]$InitializeOnly)
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
using System.IO;
using System.Text;
using System.Threading;
public static class MusicAdapterInput {
    public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public static volatile bool Closed;
    public static void Start() {
        var thread = new Thread(() => {
            try {
                // Windows PowerShell's console reader can interpret redirected
                // input. Read the original pipe as UTF-8 instead.
                using (var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false), true)) {
                    string line;
                    while ((line = reader.ReadLine()) != null) Lines.Enqueue(line);
                }
            }
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

    function Get-YandexSession {
        # Match only Yandex Music; never fall back to another player's current session.
        $sessions = @($manager.GetSessions())
        $yandexSessions = @($sessions | Where-Object { $_.SourceAppUserModelId -match '(?i)(yandex.*music|music.*yandex)' })
        $playing = $yandexSessions | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
        if ($null -ne $playing) { return $playing }
        return ($yandexSessions | Select-Object -First 1)
    }

    . (Join-Path $PSScriptRoot 'media-state.ps1')

    function Read-State($Session) {
        if ($null -eq $Session) {
            $script:ArtKey = ''; $script:Artwork = $null
            return @{ connected = $false }
        }
        $properties = Await-WinRT ($Session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $info = $null; $timeline = $null
        try { $info = $Session.GetPlaybackInfo() } catch {}
        try { $timeline = $Session.GetTimelineProperties() } catch {}
        return (ConvertTo-PlayerState $properties $info $timeline $Session.SourceAppUserModelId)
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

    if ($InitializeOnly) { return }
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
            catch { [Console]::Error.WriteLine($_.Exception.Message); Send-Message @{ type = 'state'; state = @{ connected = $false; error = 'Media session is temporarily unavailable.' } } }
            $lastPoll = [DateTime]::UtcNow
        }
        Start-Sleep -Milliseconds 40
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    Send-Message @{ type = 'state'; state = @{ connected = $false; error = 'Windows media integration requires Windows 10 1809 or newer and Windows PowerShell 5.1.' } }
    exit 1
}
