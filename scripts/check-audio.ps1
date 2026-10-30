$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '../native/windows-audio.ps1'
$tokens = $null; $errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
. $scriptPath -InitializeOnly
if (-not [LibertyAudio.Output]::Matches('Spotify.exe', 'spotify.exe', '')) { throw 'Executable matching failed.' }
if ([LibertyAudio.Output]::Matches('Spotify.exe', 'SpotifyHelper.exe', '')) { throw 'A different app must not match.' }
if (-not [LibertyAudio.Output]::Matches('Yandex.Music', 'Yandex Music.exe', '')) { throw 'Known Win32 shell identity matching failed.' }
if ([LibertyAudio.Output]::Matches('Yandex.Music', 'Yandex.exe', '')) { throw 'Music must never control Yandex Browser.' }
if ([LibertyAudio.Output]::Matches('Music.Package!App', 'Music.exe', 'Other.Package!App')) { throw 'Package identity must match exactly.' }
if (-not [LibertyAudio.Output]::Matches('Music.Package!App', 'Music.exe', 'Music.Package!App')) { throw 'AUMID matching failed.' }
if ([LibertyAudio.Output]::Matches('', 'Spotify.exe', '')) { throw 'An empty source must not control system audio.' }
if ($env:OS -eq 'Windows_NT') {
    $output = [LibertyAudio.Output]::new()
    try {
        $output.Target('Liberty-Nonexistent-Audio-Session.exe')
        $state = $output.Read()
        if ($state.available -or $null -ne $state.volume) { throw 'An unavailable app must not expose volume controls.' }
        $peak = [float]0; $available = $output.Peak([ref]$peak)
        if ([float]::IsNaN($peak) -or $peak -lt 0 -or $peak -gt 1) { throw 'Invalid output peak.' }
        $rejected = $false
        try { $output.Volume([float]0.25) } catch { $rejected = $true }
        if (-not $rejected) { throw 'A missing app must never fall back to master volume.' }
        Write-Output ('PASS: Windows Core Audio COM interfaces; output meter available: ' + $available)
    } finally { $output.Dispose() }
}
Write-Output 'PASS: audio bridge compilation, syntax, exact executable/AUMID matching and no system-volume fallback.'
