$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../native/session-registry.ps1')
$first = Resolve-SessionRegistry @() @(@{ appId = 'YandexMusic.exe'; identity = 'proxy-1' })
$id = $first[0].id
if (-not $id.StartsWith('native:')) { throw 'Missing source ID' }
for ($i = 2; $i -le 20; $i++) {
    $first = Resolve-SessionRegistry $first @(@{ appId = 'YandexMusic.exe'; identity = ('proxy-' + $i) })
    if ($first[0].id -ne $id) { throw 'A refreshed COM wrapper disconnected the selected Yandex player' }
}
$closed = Resolve-SessionRegistry $first @()
$reopened = Resolve-SessionRegistry $closed @(@{ appId = 'YandexMusic.exe'; identity = 'new-instance' })
if ($reopened[0].id -eq $id) { throw 'A closed source must not silently select a new instance' }
$multiple = Resolve-SessionRegistry @() @(@{ appId = 'chrome.exe'; identity = 'one' }, @{ appId = 'chrome.exe'; identity = 'two' })
$surviving = Resolve-SessionRegistry $multiple @(@{ appId = 'chrome.exe'; identity = 'two' })
if ($surviving[0].id -ne $multiple[1].id) { throw 'Exact duplicate-session identity was lost' }
$unknown = Resolve-SessionRegistry $multiple @(@{ appId = 'chrome.exe'; identity = 'unknown' })
if ($unknown[0].id -eq $multiple[0].id -or $unknown[0].id -eq $multiple[1].id) { throw 'An ambiguous session inherited another source ID' }
$other = Resolve-SessionRegistry $first @(@{ appId = 'Spotify.exe'; identity = 'proxy-20' })
if ($other[0].id -eq $id) { throw 'An unrelated app inherited the selected player' }
Write-Output 'PASS: stable logical sources across 20 COM wrappers, disappearance/reopen, duplicate identities and no cross-app selection.'
. (Join-Path $PSScriptRoot '../native/media-sources.ps1')
# Exercise the real source list and selection functions with regenerated WinRT
# wrappers. The fake identity function is confined to this test process.
function Get-SessionIdentity($Session) { return $Session.TestIdentity }
$script:FakeGeneration = 0
function New-TestSession([string]$Identity) {
    $item = [pscustomobject]@{ SourceAppUserModelId = 'YandexMusic.exe'; TestIdentity = $Identity }
    $item | Add-Member ScriptMethod GetPlaybackInfo { return [pscustomobject]@{ PlaybackStatus = 'Playing' } }
    return $item
}
$manager = [pscustomobject]@{}
$manager | Add-Member ScriptMethod GetSessions { $script:FakeGeneration++; return @(New-TestSession ('wrapper-' + $script:FakeGeneration)) }
$manager | Add-Member ScriptMethod GetCurrentSession { return (New-TestSession 'different-current-proxy') }
$sources = Update-SessionSources
$script:SelectedSourceId = $sources[0].id
for ($i = 0; $i -lt 20; $i++) {
    $sources = Update-SessionSources
    $selected = Get-SelectedSession $sources
    if ($null -eq $selected -or $sources[0].id -ne $script:SelectedSourceId -or (Get-SessionId $selected) -ne $script:SelectedSourceId -or -not $sources[0].current) { throw 'Manual Yandex selection disconnected across a Windows poll.' }
}
Write-Output 'PASS: real native source/selection pipeline retains manual Yandex selection across 20 refreshed proxies.'
