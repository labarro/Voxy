# Tray reopen / stale-core handoff test with real processes and an isolated data folder.
# 1. A core from another installation (e.g. the installed Beta 2) owns the data folder.
# 2. The interface under test starts: it must shut that core down and start its own sibling core.
# 3. Close by X (WM_CLOSE) several times and reopen through the tray's own callback message:
#    the reopened interface must be this build (path + version), with one UI and one core.
param(
    [Parameter(Mandatory=$true)][string]$Binaries,
    [string]$ForeignCore = (Join-Path $env:LOCALAPPDATA 'Programs\VoxyNativeExperimental\voxy-core.exe'),
    [int]$Cycles = 5,
    [Parameter(Mandatory=$true)][string]$Evidence
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class TrayTest {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static IntPtr Find(uint pid, string classPrefix, bool visible) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid) return true;
      var s = new StringBuilder(256); GetClassName(h, s, 256);
      if ((classPrefix == null || s.ToString().StartsWith(classPrefix)) && (!visible || IsWindowVisible(h))) { found = h; return false; }
      return true; }, IntPtr.Zero);
    return found;
  }
}
'@
$bin = (Resolve-Path $Binaries).Path
$data = Join-Path ([IO.Path]::GetTempPath()) ("voxy-tray-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $data, $Evidence | Out-Null
$env:VOXY_NATIVE_DATA_DIR = $data
$checks = New-Object System.Collections.Generic.List[object]
function Check([string]$name, [bool]$ok, $detail) { $checks.Add([ordered]@{name=$name;passed=$ok;detail=$detail}); Write-Host ("{0} {1} {2}" -f ($(if($ok){'PASS'}else{'FAIL'}), $name, ($detail | ConvertTo-Json -Compress))) }
function Endpoint { $p = Join-Path $data 'session.json'; if (Test-Path $p) { Get-Content $p -Raw | ConvertFrom-Json } }
function Ours([string]$name) { @(Get-CimInstance Win32_Process -Filter "Name='$name'" | Where-Object { $_.ExecutablePath -and $_.CommandLine -ne $null -and (Split-Path $_.ExecutablePath) -ieq $bin }) }
function WaitFor([scriptblock]$cond, [int]$seconds) { $t=[Diagnostics.Stopwatch]::StartNew(); while ($t.Elapsed.TotalSeconds -lt $seconds) { $v = & $cond; if ($v) { return $v }; Start-Sleep -Milliseconds 200 }; return $null }
$started = @()
# Leftovers of an interrupted run from this same folder would be mistaken for the processes under test.
foreach ($p in @(Ours 'voxy-desktop.exe') + @(Ours 'voxy-core.exe')) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
try {
    # 1. Foreign core (other installation) owns the folder.
    $foreign = $null
    if (Test-Path $ForeignCore) {
        $foreign = Start-Process $ForeignCore -ArgumentList 'serve' -PassThru -WindowStyle Hidden
        $started += $foreign
        $ep = WaitFor { $e = Endpoint; if ($e -and $e.pid -eq $foreign.Id) { $e } } 15
        Check 'núcleo de outra instalação ativo na pasta de dados' ($null -ne $ep) @{pid=$foreign.Id; exe=$ForeignCore; version=$(if($ep){$ep.version}else{$null})}
    }
    # 2. Interface under test hands off to its own core.
    $ui = Start-Process (Join-Path $bin 'voxy-desktop.exe') -PassThru
    $started += $ui
    $ep = WaitFor { $e = Endpoint; if ($e -and $e.executable -and ((Split-Path $e.executable) -ieq $bin)) { $e } } 30
    Check 'interface usa o núcleo da mesma instalação e versão' ($null -ne $ep) @{executable=$(if($ep){$ep.executable}); version=$(if($ep){$ep.version})}
    if ($foreign) { $gone = WaitFor { if (-not (Get-Process -Id $foreign.Id -ErrorAction SilentlyContinue)) { $true } } 15; Check 'núcleo antigo encerrado de forma coordenada' ([bool]$gone) @{pid=$foreign.Id} }
    $core = @(Ours 'voxy-core.exe') | Where-Object { $_.ProcessId -eq $ep.pid } | Select-Object -First 1
    $tray = WaitFor { $h = [TrayTest]::Find([uint32]$core.ProcessId, 'VoxyNativeSessionTray-', $false); if ($h -ne [IntPtr]::Zero) { $h } } 10
    Check 'bandeja criada pelo núcleo desta instalação' ($null -ne $tray) @{corePid=$core.ProcessId}
    $log = Join-Path $data 'logs\core.log'
    Check 'ícone adicionado à área de notificação (log do núcleo)' ((Test-Path $log) -and ((Get-Content $log -Raw) -match 'tray icon added')) @{log=$log}
    for ($i = 1; $i -le $Cycles; $i++) {
        $uiProc = @(WaitFor { $p = @(Ours 'voxy-desktop.exe'); if ($p.Count -ge 1) { ,$p } } 20)
        $win = WaitFor { $h = [TrayTest]::Find([uint32]$uiProc[0].ProcessId, $null, $true); if ($h -ne [IntPtr]::Zero) { $h } } 20
        [void][TrayTest]::PostMessage($win, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)   # WM_CLOSE (X)
        $closed = WaitFor { if (@(Ours 'voxy-desktop.exe').Count -eq 0) { $true } } 15
        $coreAlive = [bool](Get-Process -Id $core.ProcessId -ErrorAction SilentlyContinue)
        Check "ciclo ${i}: fechar pelo X mantém o núcleo na bandeja" ([bool]$closed -and $coreAlive) @{corePid=$core.ProcessId}
        # The tray callback (WM_APP+41, NIN_SELECT) is what a click on the icon sends.
        [void][TrayTest]::PostMessage($tray, 0x8000 + 41, [IntPtr]::Zero, [IntPtr]0x400)
        $reopened = @(WaitFor { $p = @(Ours 'voxy-desktop.exe'); if ($p.Count -ge 1) { ,$p } } 20)
        Start-Sleep -Milliseconds 800
        $uis = @(Ours 'voxy-desktop.exe'); $cores = @(Ours 'voxy-core.exe')
        $foreignUi = @(Get-CimInstance Win32_Process -Filter "Name='voxy-desktop.exe'" | Where-Object { $_.ExecutablePath -and (Split-Path $_.ExecutablePath) -ine $bin -and $_.CommandLine -notmatch 'smoke' } | Where-Object { $_.ParentProcessId -eq $core.ProcessId })
        $ver = if ($reopened) { (Get-Item $reopened[0].ExecutablePath).VersionInfo.ProductVersion }
        Check "ciclo ${i}: reabrir pela bandeja abre esta versão, sem duplicar" ($reopened -and $uis.Count -eq 1 -and $cores.Count -eq 1 -and $foreignUi.Count -eq 0) @{path=$(if($reopened){$reopened[0].ExecutablePath}); version=$ver; ui=$uis.Count; core=$cores.Count}
    }
} finally {
    foreach ($p in @(Ours 'voxy-desktop.exe') + @(Ours 'voxy-core.exe')) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($p in $started) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    $report = [ordered]@{scenario='tray-reopen'; binaries=$bin; foreignCore=$ForeignCore; passed=(@($checks | Where-Object { -not $_.passed }).Count -eq 0); checks=$checks; dataFolder='temporária, removida'}
    $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $Evidence 'tray-reopen.json')
    if (Test-Path (Join-Path $data 'logs')) { Copy-Item (Join-Path $data 'logs') (Join-Path $Evidence 'logs') -Recurse -Force }
    Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
    Remove-Item Env:VOXY_NATIVE_DATA_DIR
}
if (-not $report.passed) { exit 1 }
