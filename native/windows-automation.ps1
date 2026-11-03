param([switch]$InitializeOnly)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$references = @('System.dll', 'System.Core.dll', [System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location)
if ($PSVersionTable.PSEdition -eq 'Core') { $references = @((Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll').FullName) + @([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location) }
Add-Type -ReferencedAssemblies $references -Path (Join-Path $PSScriptRoot 'windows-automation.cs')
if ($InitializeOnly) { Write-Output 'PASS: foreground/held-key API and offline speech helper compiled without opening the microphone.'; exit 0 }
$helper = New-Object LibertyAutomation
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
