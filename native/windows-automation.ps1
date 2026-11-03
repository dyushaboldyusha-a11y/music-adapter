param([switch]$InitializeOnly, [string]$VoiceRoot = '', [string]$RecognizeWave = '', [string]$ExpectedCommand = '', [string]$CheckSamples = '')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$references = @('System.dll', 'System.Core.dll', 'System.Runtime.Serialization.dll', 'System.Xml.dll')
if ($PSVersionTable.PSEdition -eq 'Core') { $references = @((Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll').FullName) }
Add-Type -ReferencedAssemblies $references -Path @((Join-Path $PSScriptRoot 'voice-catalog.cs'), (Join-Path $PSScriptRoot 'offline-speech.cs'), (Join-Path $PSScriptRoot 'windows-automation.cs'))
if (-not $VoiceRoot) {
    $VoiceRoot = Join-Path $PSScriptRoot 'voice'
    if (-not (Test-Path -LiteralPath $VoiceRoot)) { $VoiceRoot = Join-Path $PSScriptRoot '../artifacts/voice-runtime' }
}
if ($InitializeOnly -or $RecognizeWave -or $CheckSamples) {
    if ($RecognizeWave) { $RecognizeWave = [IO.Path]::GetFullPath($RecognizeWave) }
    if ($CheckSamples) { $CheckSamples = [IO.Path]::GetFullPath($CheckSamples) }
    [LibertyOfflineSpeech]::Initialize([IO.Path]::GetFullPath($VoiceRoot))
    if ($CheckSamples) {
        $aliases = [LibertyVoiceCatalog]::CheckAliases()
        Write-Output "PASS: $aliases command aliases and negative phrase mappings"
        $samples = [IO.File]::ReadAllText((Join-Path $CheckSamples 'samples.json')) | ConvertFrom-Json
        if ($samples.Count -lt 10) { throw 'Missing voice samples' }
        $failures = @()
        foreach ($sample in $samples) {
            $result = [LibertyOfflineSpeech]::Recognize([IO.File]::ReadAllBytes((Join-Path $CheckSamples $sample.file)))
            $command = [LibertyAutomation]::Command($result.Text)
            if (($sample.command -eq 'none' -and $command) -or ($sample.command -ne 'none' -and ($command -ne $sample.command -or $result.Confidence -lt 0.45))) { $failures += "Recognition failed: $($sample.file), heard: $($result.Text), command: $command, $($result.Diagnostics)"; continue }
            Write-Output "PASS: bundled RU/EN recognition $($sample.file): '$($result.Text)' -> '$command'"
        }
        if ($failures.Count) { throw ($failures -join "`n") }
    } elseif ($RecognizeWave) {
        $result = [LibertyOfflineSpeech]::Recognize([IO.File]::ReadAllBytes($RecognizeWave))
        $command = [LibertyAutomation]::Command($result.Text)
        if ($ExpectedCommand -and (($ExpectedCommand -eq 'none' -and $command) -or ($ExpectedCommand -ne 'none' -and $command -ne $ExpectedCommand))) { throw "Unexpected recognition: $($result.Text), command: $command, $($result.Diagnostics)" }
        @{ heard = $result.Text; command = $command; confidence = $result.Confidence; diagnostics = $result.Diagnostics } | ConvertTo-Json -Compress
    } else { Write-Output 'PASS: bundled RU/EN models and native engine load without SAPI or opening a microphone.' }
    exit 0
}
$helper = [LibertyAutomation]::new([IO.Path]::GetFullPath($VoiceRoot))
$previous = ''
$helper.Probe()
$helper.StartInput()
$delay = 200
try {
    while (-not $helper.InputClosed) {
        $line = ''
        while ($helper.Lines.TryDequeue([ref]$line)) {
            $request = $null
            try {
                $request = $line | ConvertFrom-Json
                switch ($request.command) {
                    'configure' {
                        $value = $request.value
                        $helper.Configure(($value.monitor -eq $true), ($value.voice -eq $true), [int[]]@($value.keys), [string]$value.microphone)
                        $delay = if ($value.voice -eq $true) { 30 } else { 100 }
                    }
                    'probe' { $helper.Probe() }
                    'test' {
                        if ($request.value -isnot [bool]) { throw 'Invalid microphone test mode' }
                        $helper.Test($request.value)
                        $delay = 30
                    }
                    default { throw 'Unknown automation command' }
                }
                @{ type = 'result'; id = $request.id; ok = $true } | ConvertTo-Json -Compress
            } catch { @{ type = 'result'; id = $request.id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
        }
        $helper.Tick()
        $microphones = @(@{ id = 'default'; name = 'Системный микрофон (по умолчанию)' })
        for ($i = 0; $i -lt $helper.Microphones.Length; $i++) { $microphones += @{ id = [string]$i; name = $helper.Microphones[$i] } }
        $state = @{ foreground = $helper.Foreground; listening = $helper.Listening; session = $helper.Session; language = $helper.Language; error = $helper.Error; command = ''; phase = $helper.Phase; test = $helper.TestMode; heard = $helper.Heard; level = [Math]::Round($helper.Level, 2); peak = $helper.Peak; microphones = $microphones; speechAvailable = $helper.SpeechAvailable }
        $key = $state | ConvertTo-Json -Depth 5 -Compress
        if ($key -ne $previous) { @{ type = 'state'; state = $state } | ConvertTo-Json -Depth 6 -Compress; $previous = $key }
        $command = ''
        while ($helper.Commands.TryDequeue([ref]$command)) {
            $state.command = $command
            @{ type = 'state'; state = $state } | ConvertTo-Json -Depth 6 -Compress
        }
        Start-Sleep -Milliseconds $delay
    }
} finally { $helper.Dispose() }
