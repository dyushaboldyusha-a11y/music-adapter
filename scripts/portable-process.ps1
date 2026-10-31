param([Parameter(Mandatory=$true)][string]$SpecPath, [switch]$Cleanup)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$spec = Get-Content -LiteralPath $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
$all = @(Get-CimInstance Win32_Process)
if ($Cleanup) {
    # Kill only these test launchers, their descendants and their installer.
    $ids = [Collections.Generic.HashSet[uint32]]::new()
    $order = [Collections.Generic.List[uint32]]::new()
    foreach ($item in $all) {
        if (($item.ExecutablePath -and $spec.paths -icontains $item.ExecutablePath) -or ($item.Name -ieq 'powershell.exe' -and $item.CommandLine -and $item.CommandLine.Contains((Join-Path $spec.profile 'updates/install-update.ps1')))) {
            if ($ids.Add([uint32]$item.ProcessId)) { $order.Add([uint32]$item.ProcessId) }
        }
    }
    do {
        $added = $false
        foreach ($item in $all) { if ($ids.Contains([uint32]$item.ParentProcessId) -and $ids.Add([uint32]$item.ProcessId)) { $order.Add([uint32]$item.ProcessId); $added = $true } }
    } while ($added)
    for ($index = $order.Count - 1; $index -ge 0; $index--) { Stop-Process -Id $order[$index] -Force -ErrorAction SilentlyContinue }
    return
}
$wrappers = @($all | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $spec.target })
foreach ($wrapper in $wrappers) {
    foreach ($item in $all | Where-Object { $_.ParentProcessId -eq $wrapper.ProcessId -and $_.Name -ieq 'Liberty Wave.exe' -and $_.CommandLine -notmatch '--type=' }) {
        try {
            $process = Get-Process -Id $item.ProcessId -ErrorAction Stop
            $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($item.ExecutablePath).ProductVersion
            if ($process.MainWindowHandle -eq [IntPtr]::Zero -or $process.MainWindowTitle -notlike '*Liberty Wave*' -or -not $version.StartsWith('0.6.2')) { continue }
            @{ wrapperPid = [int]$wrapper.ProcessId; mainPid = [int]$item.ProcessId; productVersion = $version; windowTitle = $process.MainWindowTitle; windowHandle = $process.MainWindowHandle.ToInt64() } | ConvertTo-Json -Compress
            return
        } catch { }
    }
}
[Console]::Out.WriteLine('null')
