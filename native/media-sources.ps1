$script:SessionsById = @{}
$script:SelectedSourceId = $null

function Get-SourceDescriptor([string]$AppId) {
    if ($AppId -match '(?i)(yandex.*music|music.*yandex)') { return @{ provider = 'yandex'; kind = 'app'; name = 'Yandex Music'; browser = '' } }
    if ($AppId -match '(?i)spotify') { return @{ provider = 'spotify'; kind = 'app'; name = 'Spotify'; browser = '' } }
    if ($AppId -match '(?i)(soundcloud|soundnode|soundcleod)') { return @{ provider = 'soundcloud'; kind = 'app'; name = 'SoundCloud'; browser = '' } }
    $browsers = [ordered]@{ 'msedge' = 'Edge'; 'firefox' = 'Firefox'; 'brave' = 'Brave'; 'vivaldi' = 'Vivaldi'; 'opera' = 'Opera'; '(yandex.*browser|yabrowser|^yandex([.]exe)?$)' = 'Yandex Browser'; '(chrome|chromium)' = 'Chrome' }
    foreach ($pattern in $browsers.Keys) {
        if ($AppId -match ('(?i)' + $pattern)) { return @{ provider = 'browser'; kind = 'browser'; name = $browsers[$pattern]; browser = $browsers[$pattern] } }
    }
    return $null
}

function Get-SessionId($Session) {
    $pointer = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($Session)
    try {
        $hash = [Security.Cryptography.SHA256]::Create()
        try { return 'native:' + ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Session.SourceAppUserModelId + ':' + $pointer.ToInt64()))).Replace('-', '').Substring(0, 24)).ToLowerInvariant() }
        finally { $hash.Dispose() }
    } finally { $null = [Runtime.InteropServices.Marshal]::Release($pointer) }
}

function Update-SessionSources {
    $next = @{}
    $summaries = [Collections.Generic.List[object]]::new()
    $currentId = $null
    try { $current = $manager.GetCurrentSession(); if ($null -ne $current) { $currentId = Get-SessionId $current } } catch {}
    foreach ($session in $manager.GetSessions()) {
        try {
            $description = Get-SourceDescriptor $session.SourceAppUserModelId
            if ($null -eq $description) { continue }
            $id = Get-SessionId $session
            $playing = $false
            try { $playing = $session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } catch {}
            $description.id = $id
            $description.appId = [string]$session.SourceAppUserModelId
            $description.playing = $playing
            $description.current = $id -eq $currentId
            $next[$id] = $session
            $summaries.Add($description)
        } catch { [Console]::Error.WriteLine($_.Exception.Message) }
    }
    $script:SessionsById = $next
    return ,$summaries.ToArray()
}

function Get-SelectedSession($Sources) {
    if ($script:SelectedSourceId) {
        if ($script:SessionsById.ContainsKey($script:SelectedSourceId)) { return $script:SessionsById[$script:SelectedSourceId] }
        return $null
    }
    $source = $Sources | Where-Object { $_.playing -and $_.current } | Select-Object -First 1
    if ($null -eq $source) { $source = $Sources | Where-Object { $_.playing } | Select-Object -First 1 }
    if ($null -eq $source) { $source = $Sources | Select-Object -First 1 }
    if ($null -ne $source) { return $script:SessionsById[$source.id] }
    return $null
}
