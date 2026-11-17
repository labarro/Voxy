param(
    [switch]$OptIn,
    [switch]$AllowSkip,
    [Parameter(ValueFromRemainingArguments=$true)][string[]]$CargoArgs
)
# Trustworthy native test runner. Exit codes: 0 ok, 1 failure, 2 opt-in tests skipped (env missing) without -AllowSkip.
$ErrorActionPreference='Stop'

# Switches may arrive as plain strings when forwarded through array splatting.
$extra=@()
foreach($a in @($CargoArgs)) {
    if ($a -ieq '-OptIn') { $OptIn=$true } elseif ($a -ieq '-AllowSkip') { $AllowSkip=$true } elseif ($null -ne $a) { $extra+=$a }
}

$cargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
if (!(Test-Path -LiteralPath $cargo)) { Write-Host 'cargo.exe not found; install Rust MSVC with rustup.'; exit 1 }
$env:PATH=[Environment]::GetEnvironmentVariable('Path','User')+';'+$env:PATH
$cmake=Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages/Kitware.CMake_Microsoft.Winget.Source_8wekyb3d8bbwe/cmake-4.4.4-windows-x86_64/bin'
if (Test-Path -LiteralPath $cmake) { $env:PATH=$cmake+';'+$env:PATH }

$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeRoot=Join-Path $repoRoot 'native'
$logDir=Join-Path $repoRoot '.test-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$prefix= if ($OptIn) { 'native-test-optin' } else { 'native-test' }
$logPath=Join-Path $logDir "$prefix-$stamp.log"
$jsonPath=Join-Path $logDir "$prefix-$stamp.json"
Set-Content -LiteralPath $logPath -Value '' -Encoding UTF8
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'native-test-manifest.json') -Raw | ConvertFrom-Json

# Runs cargo through cmd so stderr is merged by cmd (no PowerShell ErrorRecords), streams the output
# live, appends the raw output to the main log and returns @{Code; Lines}.
function Invoke-CargoLogged([string[]]$CargoArguments) {
    $tmp=Join-Path $logDir ("tmp-"+[guid]::NewGuid().ToString('N')+'.log')
    $quoted=($CargoArguments | ForEach-Object { if ($_ -match '[\s"&|<>^%]') { '"'+($_ -replace '"','""')+'"' } else { $_ } }) -join ' '
    $cmdLine='""'+$cargo+'" '+$quoted+' > "'+$tmp+'" 2>&1"'
    Write-Host ('> cargo '+$quoted)
    $p=Start-Process -FilePath $env:ComSpec -ArgumentList @('/c',$cmdLine) -NoNewWindow -PassThru
    $null=$p.Handle
    $fs=$null; $reader=$null
    try {
        while ($true) {
            $done=$p.HasExited
            if ($null -eq $fs -and (Test-Path -LiteralPath $tmp)) {
                $fs=New-Object IO.FileStream($tmp,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
                $reader=New-Object IO.StreamReader($fs,[Text.Encoding]::UTF8)
            }
            if ($null -ne $reader) { $chunk=$reader.ReadToEnd(); if ($chunk.Length -gt 0) { Write-Host -NoNewline $chunk } }
            if ($done) { break }
            Start-Sleep -Milliseconds 200
        }
    } finally { if ($reader) { $reader.Dispose() }; if ($fs) { $fs.Dispose() } }
    $p.WaitForExit()
    $code=$p.ExitCode
    $text= if (Test-Path -LiteralPath $tmp) { [IO.File]::ReadAllText($tmp) } else { '' }
    Add-Content -LiteralPath $logPath -Value ("===== cargo "+$quoted+" (exit $code) =====") -Encoding UTF8
    Add-Content -LiteralPath $logPath -Value $text -Encoding UTF8
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    return @{ Code=$code; Lines=@($text -split "`r?`n") }
}

function ConvertTo-SuiteKey([string]$Target,[string]$ExePath) {
    $pkg=$null
    if ($ExePath -match 'build[\\/]([^\\/]+)[\\/]') { $pkg=$Matches[1] }
    else { $pkg=([IO.Path]::GetFileNameWithoutExtension($ExePath) -replace '-[0-9a-f]{16}$','') -replace '_','-' }
    if ($Target -match '^unittests\s+src[\\/]lib\.rs$') { return "$pkg/lib" }
    if ($Target -match '^unittests\s+src[\\/]main\.rs$') { return "$pkg/bin" }
    if ($Target -match '^unittests\s+src[\\/]bin[\\/](.+)\.rs$') { return "$pkg/bin:$($Matches[1])" }
    if ($Target -match '^tests[\\/](.+)\.rs$') { return "$pkg/tests/$($Matches[1])" }
    return "$pkg/$Target"
}

function Read-TestOutput([string[]]$Lines) {
    $suites=New-Object System.Collections.ArrayList
    $headers=0; $cur=$null
    foreach($line in $Lines) {
        if ($line -match '^\s+Running (.+?) \((.+)\)\s*$') {
            $headers++
            $cur=[ordered]@{ Suite=(ConvertTo-SuiteKey $Matches[1] $Matches[2]); Passed=0; Failed=0; Ignored=0; Filtered=0; HasSummary=$false; OkLines=0; FailedNames=@(); IgnoredTests=@() }
            [void]$suites.Add($cur)
        } elseif ($null -ne $cur -and $line -match '^test (.+?) \.\.\. (ok|FAILED|ignored)(?:, (.*))?\s*$') {
            switch ($Matches[2]) {
                'ok' { $cur.OkLines++ }
                'FAILED' { $cur.FailedNames+=$Matches[1] }
                'ignored' { $cur.IgnoredTests+=[pscustomobject]@{ Suite=$cur.Suite; Name=$Matches[1]; Reason=$(if ($Matches[3]) { $Matches[3].Trim() } else { '(no reason given)' }) } }
            }
        } elseif ($null -ne $cur -and $line -match '^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out') {
            $cur.Passed=[int]$Matches[2]; $cur.Failed=[int]$Matches[3]; $cur.Ignored=[int]$Matches[4]; $cur.Filtered=[int]$Matches[6]; $cur.HasSummary=$true
        }
    }
    return @{ Suites=$suites; Headers=$headers }
}

$result=[ordered]@{ mode=$(if ($OptIn) { 'optin' } else { 'default' }); log=$logPath; exitCode=0; problems=@(); suites=@(); ignored=@(); optIn=@() }
$problems=New-Object System.Collections.ArrayList
$exit=0

Push-Location $nativeRoot
try {
    if (-not $OptIn) {
        Write-Host 'Doc-tests are excluded on purpose (--lib --bins --tests): no crate has doc examples.'
        $run=Invoke-CargoLogged (@('test','--locked','--workspace','--lib','--bins','--tests','--no-fail-fast')+$extra)
        $parsed=Read-TestOutput $run.Lines
        $suites=@($parsed.Suites)
        if ($run.Code -ne 0) { [void]$problems.Add("cargo exited with code $($run.Code)") }
        $summaries=@($suites | Where-Object { $_.HasSummary }).Count
        if ($parsed.Headers -ne $summaries) { [void]$problems.Add("Running headers ($($parsed.Headers)) disagree with parsed summaries ($summaries)") }
        foreach($s in $suites) {
            if ($s.Failed -gt 0 -or $s.FailedNames.Count -gt 0) { [void]$problems.Add("FAILED tests in $($s.Suite): $($s.FailedNames -join ', ')") }
            if ($s.HasSummary -and $s.OkLines -ne $s.Passed) { [void]$problems.Add("$($s.Suite): $($s.OkLines) 'ok' lines but summary says $($s.Passed) passed") }
        }
        $byKey=@{}
        foreach($s in $suites) { $byKey[$s.Suite]=$s }
        foreach($req in @($manifest.required)) {
            $s=$byKey[$req.suite]
            if ($null -eq $s) { [void]$problems.Add("required suite missing: $($req.suite)") }
            elseif ($s.Passed -lt [int]$req.minPassed) { [void]$problems.Add("required suite $($req.suite): $($s.Passed) passed < minimum $($req.minPassed)") }
        }
        $known=@{}
        foreach($req in @($manifest.required)) { $known[$req.suite]=$true }
        foreach($e in @($manifest.allowEmpty)) { $known[$e.suite]=$true }
        foreach($s in $suites) {
            if (($s.Passed + $s.Failed) -eq 0 -and -not $known.ContainsKey($s.Suite)) { [void]$problems.Add("unknown suite executed zero tests: $($s.Suite)") }
        }
        $table=@(); $ign=@()
        foreach($s in $suites) {
            $min=($manifest.required | Where-Object { $_.suite -eq $s.Suite } | Select-Object -First 1)
            $table+=[pscustomobject]@{ Suite=$s.Suite; Passed=$s.Passed; Failed=$s.Failed; Ignored=$s.Ignored; Filtered=$s.Filtered; Min=$(if ($min) { $min.minPassed } else { '-' }) }
            $ign+=$s.IgnoredTests
        }
        $result.suites=$table; $result.ignored=$ign
        Write-Host ''; Write-Host '=== Suites ==='
        $table | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
        Write-Host "Total passed: $(($table | Measure-Object Passed -Sum).Sum)  failed: $(($table | Measure-Object Failed -Sum).Sum)  ignored: $(($table | Measure-Object Ignored -Sum).Sum)  (ignored tests are NOT counted as passed)"
        if ($ign.Count -gt 0) {
            Write-Host ''; Write-Host "=== Ignored tests ($($ign.Count)) - opt-in, run with: scripts/native.ps1 e2e ==="
            foreach($i in $ign) { Write-Host ("  {0} :: {1}`n      reason: {2}" -f $i.Suite,$i.Name,$i.Reason) }
        }
    } else {
        $outcomes=@()
        foreach($t in @($manifest.optIn)) {
            $label="$($t.package)/$($t.target)::$($t.name)"
            $missing=@($t.requiredEnv | Where-Object { $_ -and [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($_)) })
            if ($missing.Count -gt 0) {
                Write-Host "SKIPPED $label (env missing: $($missing -join ', '))"
                $outcomes+=[pscustomobject]@{ Test=$label; Status='SKIPPED'; Detail="env missing: $($missing -join ', ')" }
                continue
            }
            $targetArgs= if ($t.target -eq 'lib') { @('--lib') } else { @('--test',$t.target) }
            $run=Invoke-CargoLogged (@('test','--locked','-p',$t.package)+$targetArgs+@('--','--ignored','--exact',$t.name))
            $parsed=Read-TestOutput $run.Lines
            $suite=@($parsed.Suites | Where-Object { $_.HasSummary })
            $status='PASSED'; $detail='1 passed'
            if ($run.Code -ne 0) { $status='FAILED'; $detail="cargo exit code $($run.Code)" }
            elseif ($suite.Count -ne 1) { $status='FAILED'; $detail="expected one test result, parsed $($suite.Count)" }
            elseif ($suite[0].Passed -ne 1 -or $suite[0].Failed -ne 0 -or $suite[0].OkLines -ne 1) { $status='FAILED'; $detail="expected exactly 1 passed, got $($suite[0].Passed) passed / $($suite[0].Failed) failed / $($suite[0].Filtered) filtered out (filter error?)" }
            Write-Host "$status $label ($detail)"
            $outcomes+=[pscustomobject]@{ Test=$label; Status=$status; Detail=$detail }
        }
        $result.optIn=$outcomes
        $failed=@($outcomes | Where-Object { $_.Status -eq 'FAILED' })
        $skipped=@($outcomes | Where-Object { $_.Status -eq 'SKIPPED' })
        foreach($f in $failed) { [void]$problems.Add("opt-in failed: $($f.Test) - $($f.Detail)") }
        Write-Host ''; Write-Host '=== Opt-in results ==='
        $outcomes | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
        if ($skipped.Count -gt 0 -and -not $AllowSkip -and $failed.Count -eq 0) { $exit=2 }
    }
} finally { Pop-Location }

if ($problems.Count -gt 0) { $exit=1 }
$result.problems=@($problems); $result.exitCode=$exit
if ($problems.Count -gt 0) { Write-Host '=== PROBLEMS ==='; foreach($p in $problems) { Write-Host "  - $p" } }
Write-Host ''
Write-Host ("Result: "+$(if ($exit -eq 0) { 'OK' } elseif ($exit -eq 2) { 'INCOMPLETE (opt-in tests skipped; use -AllowSkip to accept)' } else { 'FAILED' })+" (exit $exit)")
Write-Host "Log:  $logPath"
Write-Host "JSON: $jsonPath"
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
exit $exit
