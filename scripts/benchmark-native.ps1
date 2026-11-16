param([string]$OutputDirectory='evidence/native-2.0')
$ErrorActionPreference='Stop'
$nativeWorkspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nativeOutput=Join-Path $nativeWorkspace $OutputDirectory
New-Item -ItemType Directory -Force -Path $nativeOutput | Out-Null
$nativeRoot=Join-Path $nativeWorkspace ('.local/native-benchmark-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
New-Item -ItemType Directory -Force -Path $nativeRoot | Out-Null
$nativeLogicalCpus=[Environment]::ProcessorCount
$nativeRuns=@()
function Measure-Native([string]$Name,[string]$Executable,[string[]]$Arguments,[bool]$WaitForFrame) {
    $nativeData=Join-Path $nativeRoot $Name
    New-Item -ItemType Directory -Force -Path $nativeData | Out-Null
    $env:VOXY_NATIVE_DATA_DIR=$nativeData
    $nativeReady=Join-Path $nativeData 'ready.json'
    $nativeArguments=@($Arguments)
    if ($WaitForFrame) { $nativeArguments+=@('--ready-file',('"'+$nativeReady+'"')) }
    $nativeClock=[Diagnostics.Stopwatch]::StartNew()
    $nativeLog=Join-Path $nativeData 'stdout.txt'
    $nativeProcess=Start-Process -FilePath $Executable -ArgumentList $nativeArguments -WorkingDirectory $nativeWorkspace -WindowStyle Hidden -RedirectStandardOutput $nativeLog -RedirectStandardError (Join-Path $nativeData 'stderr.txt') -PassThru
    try {
        if ($WaitForFrame) {
            while (!(Test-Path -LiteralPath $nativeReady)) {
                if ($nativeProcess.HasExited) { throw "O aplicativo encerrou antes do primeiro frame: $Name" }
                if ($nativeClock.Elapsed.TotalSeconds -gt 20) { throw "Primeiro frame excedeu o prazo: $Name" }
                Start-Sleep -Milliseconds 10
            }
        } else { Start-Sleep -Milliseconds 300 }
        $nativeStartup=$nativeClock.Elapsed.TotalMilliseconds
        $nativeReadiness=if($WaitForFrame){Get-Content -LiteralPath $nativeReady -Raw | ConvertFrom-Json}else{$null}
        Start-Sleep -Seconds 2
        $nativeSamples=@()
        for($nativeIndex=0;$nativeIndex -lt 6;$nativeIndex++) {
            $nativeTree=@([int]$nativeProcess.Id)
            $nativeInventory=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId
            do { $nativePrevious=$nativeTree.Count; foreach($nativeEntry in $nativeInventory) { if($nativeTree -contains [int]$nativeEntry.ParentProcessId -and $nativeTree -notcontains [int]$nativeEntry.ProcessId){$nativeTree+=[int]$nativeEntry.ProcessId} } } while ($nativeTree.Count -ne $nativePrevious)
            $nativeProcesses=@($nativeTree | ForEach-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue})
            $nativeCpuBefore=($nativeProcesses | ForEach-Object {$_.TotalProcessorTime.TotalSeconds} | Measure-Object -Sum).Sum
            $nativeTick=[Diagnostics.Stopwatch]::StartNew();Start-Sleep -Seconds 1
            $nativeProcesses=@($nativeTree | ForEach-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue})
            if(!$nativeProcesses.Count){throw "Processo encerrou antes da coleta: $Name"}
            $nativeCpuAfter=($nativeProcesses | ForEach-Object {$_.TotalProcessorTime.TotalSeconds} | Measure-Object -Sum).Sum
            $nativeSamples+=[pscustomobject]@{workingSetMiB=($nativeProcesses | Measure-Object WorkingSet64 -Sum).Sum/1MB;privateMiB=($nativeProcesses | Measure-Object PrivateMemorySize64 -Sum).Sum/1MB;cpuMachinePercent=100*($nativeCpuAfter-$nativeCpuBefore)/$nativeTick.Elapsed.TotalSeconds/$nativeLogicalCpus;processes=$nativeProcesses.Count;handles=($nativeProcesses | Measure-Object HandleCount -Sum).Sum}
        }
        return [pscustomobject]@{scenario=$Name;startupMs=$nativeStartup;readiness=$nativeReadiness;samples=$nativeSamples;binaryBytes=(Get-Item -LiteralPath $Executable).Length}
    } finally {
        $nativeProcess.Refresh()
        if(!$nativeProcess.HasExited){Stop-Process -Id $nativeProcess.Id -ErrorAction SilentlyContinue}
    }
}
$nativeDesktop=Join-Path $nativeWorkspace 'native/target/release/voxy-desktop.exe'
$nativeCore=Join-Path $nativeWorkspace 'native/target/release/voxy-core.exe'
$nativeRuns+=Measure-Native 'core-idle' $nativeCore @('hold','30') $false
$nativeRuns+=Measure-Native 'home' $nativeDesktop @() $true
$nativeRuns+=Measure-Native 'home-minimized' $nativeDesktop @('--start-minimized') $true
$nativeResult=[pscustomobject]@{measuredAt=[DateTime]::UtcNow.ToString('o');version='2.0.0';build='release';logicalCpus=$nativeLogicalCpus;method='Six samples, full process tree; CPU normalized to machine capacity. UI startup ends after renderer screenshot readiness. Core startup is a fixed 300ms wait, not a readiness metric.';scope='Idle core and Home only; no call, microphone, peer, media, world, emulator or installer. Compare features only when parity is achieved.';runs=$nativeRuns}
[IO.File]::WriteAllText((Join-Path $nativeOutput 'resources-native.json'),($nativeResult | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$nativeRuns | ForEach-Object {[pscustomobject]@{scenario=$_.scenario;startupMs=$_.startupMs;workingSetMeanMiB=($_.samples|Measure-Object workingSetMiB -Average).Average;privateMeanMiB=($_.samples|Measure-Object privateMiB -Average).Average;cpuMachineMeanPercent=($_.samples|Measure-Object cpuMachinePercent -Average).Average;binaryBytes=$_.binaryBytes}}
