$script:ArtKey = ''
$script:Artwork = $null
$script:ArtworkError = $null

function Read-Artwork($Properties, [string]$Key) {
    if ($script:ArtKey -eq $Key -and $script:Artwork) { return $script:Artwork }
    $script:Artwork = $null
    $script:ArtworkError = $null
    $stream = $null
    $reader = $null
    $memory = $null
    try {
        if ($null -eq $Properties.Thumbnail) { return $null }
        $stream = Await-WinRT ($Properties.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        # PowerShell cannot directly project this COM interface. Use the .NET
        # WinRT stream adapter through reflection, as for IAsyncOperation above.
        $adapter = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IRandomAccessStream'
        } | Select-Object -First 1
        if ($null -eq $adapter) { throw 'Windows Runtime stream adapter is unavailable.' }
        $reader = $adapter.Invoke($null, @($stream))
        $memory = [IO.MemoryStream]::new()
        $buffer = [byte[]]::new(65536)
        while ($true) {
            $read = $reader.ReadAsync($buffer, 0, $buffer.Length)
            if (-not $read.Wait(3500)) { throw 'Thumbnail read timed out.' }
            $count = $read.Result
            if ($count -eq 0) { break }
            if ($memory.Length + $count -gt 8000000) { throw 'Thumbnail exceeds 8 MB.' }
            $memory.Write($buffer, 0, $count)
        }
        $bytes = $memory.ToArray()
        $loaded = $bytes.Length
        # Some media clients supply an empty or generic ContentType. Detect the
        # image itself instead of rejecting a valid thumbnail on its MIME label.
        $mime = ''
        if ($loaded -ge 8 -and $bytes[0] -eq 137 -and $bytes[1] -eq 80 -and $bytes[2] -eq 78) { $mime = 'image/png' }
        elseif ($loaded -ge 3 -and $bytes[0] -eq 255 -and $bytes[1] -eq 216) { $mime = 'image/jpeg' }
        elseif ($loaded -ge 6 -and [Text.Encoding]::ASCII.GetString($bytes, 0, 3) -eq 'GIF') { $mime = 'image/gif' }
        elseif ($loaded -ge 2 -and $bytes[0] -eq 66 -and $bytes[1] -eq 77) { $mime = 'image/bmp' }
        elseif ($loaded -ge 12 -and [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($bytes, 8, 4) -eq 'WEBP') { $mime = 'image/webp' }
        if ($mime) {
            $script:Artwork = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
            $script:ArtKey = $Key
        }
    } catch {
        # Thumbnail failures must not erase the track metadata or transport.
        $script:ArtKey = ''
        $script:ArtworkError = $_.Exception.Message
    } finally {
        # WinRT projections do not always expose Dispose as a public method.
        # Even a failed cleanup must never escape and disconnect the player.
        try { if ($null -ne $reader) { ([IDisposable]$reader).Dispose() } } catch {}
        try { if ($null -ne $memory) { $memory.Dispose() } } catch {}
        try { if ($null -ne $stream) { ([IDisposable]$stream).Dispose() } } catch {}
    }
    return $script:Artwork
}

function ConvertTo-PlayerState($Properties, $Info, $Timeline, [string]$Source) {
    $controls = $Info.Controls
    $playing = $null -ne $Info -and $Info.PlaybackStatus.ToString() -eq 'Playing'
    $duration = 0.0
    $position = 0.0
    try {
        if ($null -ne $Timeline) {
            $start = [double]$Timeline.StartTime.TotalSeconds
            $duration = [Math]::Max(0, [double]$Timeline.EndTime.TotalSeconds - $start)
            $position = [double]$Timeline.Position.TotalSeconds - $start
            if ($playing -and $Timeline.LastUpdatedTime.Year -gt 2000) {
                $updated = [DateTimeOffset]$Timeline.LastUpdatedTime
                $delta = ([DateTimeOffset]::UtcNow - $updated).TotalSeconds
                $rate = if ($null -ne $Info.PlaybackRate) { [double]$Info.PlaybackRate } else { 1.0 }
                $position += [Math]::Max(0, $delta) * $rate
            }
        }
    } catch {
        # Not every client exposes a complete timeline. Keep the cover and title.
    }
    $repeat = 'none'
    if ($null -ne $Info.AutoRepeatMode) {
        $repeat = switch ($Info.AutoRepeatMode.ToString()) { 'Track' { 'track' } 'List' { 'list' } default { 'none' } }
    }
    $key = $Source + '|' + $Properties.Title + '|' + $Properties.Artist + '|' + $Properties.AlbumTitle
    return @{
        connected = $true
        title = $Properties.Title
        artist = $Properties.Artist
        album = $Properties.AlbumTitle
        artwork = (Read-Artwork $Properties $key)
        playing = $playing
        position = [Math]::Max(0, [Math]::Min($duration, $position))
        duration = $duration
        shuffle = ($Info.IsShuffleActive -eq $true)
        repeat = $repeat
        capabilities = @{
            playPause = [bool]($controls.IsPlayPauseToggleEnabled -or ($playing -and $controls.IsPauseEnabled) -or (-not $playing -and $controls.IsPlayEnabled))
            next = [bool]$controls.IsNextEnabled
            previous = [bool]$controls.IsPreviousEnabled
            seek = [bool]($controls.IsPlaybackPositionEnabled -and $duration -gt 0)
            shuffle = [bool]$controls.IsShuffleEnabled
            repeat = [bool]$controls.IsRepeatEnabled
        }
    }
}
