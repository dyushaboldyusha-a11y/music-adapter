# Keep logical player IDs stable even when WinRT returns a new COM wrapper.
# A missing source loses its ID; an unrelated or ambiguous player never inherits it.
function Resolve-SessionRegistry([object[]]$Previous, [object[]]$Current) {
    $next = [Collections.Generic.List[object]]::new()
    $used = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($record in $Current) {
        $entry = $record.Clone(); $entry.Remove('id'); $next.Add($entry)
    }
    foreach ($entry in $next) {
        $matches = @($Previous | Where-Object { $_.appId -ieq $entry.appId -and $_.identity -eq $entry.identity -and -not $used.Contains([string]$_.id) })
        if ($matches.Count -eq 1) { $entry.id = $matches[0].id; $null = $used.Add([string]$entry.id) }
    }
    foreach ($entry in $next) {
        if ($entry.id) { continue }
        $remaining = @($next | Where-Object { $_.appId -ieq $entry.appId -and -not $_.id })
        $previousRemaining = @($Previous | Where-Object { $_.appId -ieq $entry.appId -and -not $used.Contains([string]$_.id) })
        if ($remaining.Count -eq 1 -and $previousRemaining.Count -eq 1) { $entry.id = $previousRemaining[0].id; $null = $used.Add([string]$entry.id) }
    }
    foreach ($entry in $next) { if (-not $entry.id) { $entry.id = 'native:' + [Guid]::NewGuid().ToString('N') } }
    return ,$next.ToArray()
}
