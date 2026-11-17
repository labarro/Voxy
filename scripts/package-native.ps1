param([switch]$SkipBuild,[switch]$SkipInstaller,[string]$NsisPath,[string]$MsvcRuntimeDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$nativePackageRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativePackageId='dev.voxy.native.experimental'
$package=Get-Content -Raw -Encoding utf8 (Join-Path $nativePackageRoot 'package.json') | ConvertFrom-Json
# Windows PowerShell 5 cannot deserialize the npm lockfile's empty packages[""] key.
$lockReader="const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));process.stdout.write(JSON.stringify({version:p.version,rootVersion:p.packages[''].version}));"
$lockJson=$lockReader | & node - (Join-Path $nativePackageRoot 'package-lock.json')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao ler as versoes do lockfile npm.' }
$lock=$lockJson | ConvertFrom-Json
$version=[string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Versão inválida.' }
if ($version -ne [string]$lock.version -or $version -ne [string]$lock.rootVersion -or [string]$package.build.directories.output -ne "release/$version") { throw 'README/notas/versões/pasta de saída precisam estar sincronizados antes de empacotar.' }
$cargoVersion=[regex]::Match((Get-Content -Raw -Encoding utf8 (Join-Path $nativePackageRoot 'native/Cargo.toml')),'(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
if ($cargoVersion -ne $version) { throw 'Workspace Rust e pacote raiz usam versões diferentes.' }
$releases=Get-Content -Raw -Encoding utf8 (Join-Path $nativePackageRoot 'src/shared/releases.json') | ConvertFrom-Json
$releaseEntry=$releases.PSObject.Properties[$version]
if (!$releaseEntry) { throw 'A versão não possui notas locais.' }
foreach ($field in 'date','title','items','features','improvements','fixes') { if (!$releaseEntry.Value.PSObject.Properties[$field]) { throw "Notas incompletas: $field" } }
if (!$SkipBuild) { & (Join-Path $PSScriptRoot 'native.ps1') build; if ($LASTEXITCODE -ne 0) { throw 'Build nativo falhou.' } }
$output=[IO.Path]::GetFullPath((Join-Path $nativePackageRoot "release/$version/native-experimental"))
$releaseParent=[IO.Path]::GetFullPath((Join-Path $nativePackageRoot "release/$version"))
if (![string]::Equals([IO.Path]::GetDirectoryName($output),$releaseParent,[StringComparison]::OrdinalIgnoreCase)) { throw 'Destino fora do workspace de release.' }
$outputMarker=Join-Path $output '.voxy-native-build-owner'
function Assert-NativePlainPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        if (((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Caminho redirecionado recusado: $Path" }
    }
}
foreach ($path in @((Join-Path $nativePackageRoot 'release'),$releaseParent,$output,$outputMarker)) { Assert-NativePlainPath $path }
foreach ($name in @('packaged-probes.json','artifacts.json',"Voxy-Portable-$version-x64.zip","Voxy-Setup-$version-x64.exe","SHA256SUMS.txt")) { Assert-NativePlainPath (Join-Path $output $name) }
if (Test-Path -LiteralPath $output) {
    $existing=@(Get-ChildItem -LiteralPath $output -Force)
    if ($existing.Count -gt 0 -and (!(Test-Path -LiteralPath $outputMarker) -or (Get-Content -Raw -Encoding utf8 $outputMarker) -ne $nativePackageId)) { throw 'Destino não vazio pertence a outro conjunto; nenhum arquivo será substituído.' }
}
New-Item -ItemType Directory -Path $output -Force | Out-Null
[IO.File]::WriteAllText($outputMarker,$nativePackageId,(New-Object Text.UTF8Encoding($false)))
$stage=Join-Path $output ('staging-'+[guid]::NewGuid().ToString('N'))
$payload=Join-Path $stage 'portable'
New-Item -ItemType Directory -Path $payload -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $payload '.voxy-native-package-owner'),$nativePackageId,(New-Object Text.UTF8Encoding($false)))
function Write-NativeUtf8([string]$Path,[string]$Value) { [IO.File]::WriteAllText($Path,$Value,(New-Object Text.UTF8Encoding($false))) }
function Assert-Amd64Pe([string]$Path) {
    $stream=[IO.File]::OpenRead($Path); $reader=New-Object IO.BinaryReader($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw "Executável sem cabeçalho DOS: $Path" }
        $stream.Position=0x3c; $offset=$reader.ReadUInt32()
        if ($offset -gt $stream.Length-26) { throw 'Cabeçalho PE truncado.' }
        $stream.Position=$offset
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw "Executável não é Windows AMD64: $Path" }
        $stream.Position=$offset+24
        if ($reader.ReadUInt16() -ne 0x20b) { throw 'Executável não é PE32+.' }
    } finally { $reader.Dispose(); $stream.Dispose() }
}
$binaryRoot=Join-Path $nativePackageRoot 'native/target/release'
foreach ($binary in 'voxy-desktop.exe','voxy-core.exe','voxy-world.exe') {
    $source=Join-Path $binaryRoot $binary
    Assert-Amd64Pe $source
    Copy-Item -LiteralPath $source -Destination (Join-Path $payload $binary)
}
# These release executables import VCRUNTIME140.dll. Ship the official app-local
# redistributable instead of relying on development tools installed on this PC.
if (!$MsvcRuntimeDirectory) {
    $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (!(Test-Path -LiteralPath $vswhere)) { throw 'Localize o redistribuivel MSVC x64 oficial com -MsvcRuntimeDirectory.' }
    $runtimeCandidates=@(& $vswhere -latest -products '*' -find 'VC/Redist/MSVC/**/x64/Microsoft.VC143.CRT/vcruntime140.dll')
    $runtimeFile=$runtimeCandidates | Where-Object { $_ -notmatch '\\onecore\\' } | Sort-Object -Descending | Select-Object -First 1
    if (!$runtimeFile) { throw 'Redistribuivel MSVC x64 ausente; adicione o componente oficial do Visual Studio.' }
    $MsvcRuntimeDirectory=Split-Path -Parent $runtimeFile
}
$runtimeFile=Join-Path $MsvcRuntimeDirectory 'vcruntime140.dll'
Assert-Amd64Pe $runtimeFile
$runtimeSignature=Get-AuthenticodeSignature -LiteralPath $runtimeFile
if ($runtimeSignature.Status -ne 'Valid' -or $runtimeSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') { throw 'Runtime MSVC sem assinatura Microsoft valida; pacote recusado.' }
Copy-Item -LiteralPath $runtimeFile -Destination (Join-Path $payload 'vcruntime140.dll')
$worldSource=Join-Path $nativePackageRoot 'native/world-assets'
$worldPayload=Join-Path $payload 'world-assets'
New-Item -ItemType Directory -Path $worldPayload | Out-Null
foreach ($asset in Get-ChildItem -LiteralPath $worldSource -File) {
    if ($asset.Extension -notin '.json','.bin','.png','.txt') { throw "Tipo inesperado nos assets: $($asset.Name)" }
    Copy-Item -LiteralPath $asset.FullName -Destination (Join-Path $worldPayload $asset.Name)
}
Copy-Item -LiteralPath (Join-Path $nativePackageRoot 'native/EXPERIMENTAL-PACKAGE.md') -Destination (Join-Path $payload 'README-native-experimental.md')
Copy-Item -LiteralPath (Join-Path $nativePackageRoot 'native/PUBLIC-TESTING.md') -Destination (Join-Path $payload 'PUBLIC-TESTING.md')
$licenseRoot=Join-Path $payload 'licenses'
New-Item -ItemType Directory -Path $licenseRoot | Out-Null
Write-NativeUtf8 (Join-Path $licenseRoot 'Microsoft-VC-Runtime.txt') "Microsoft Visual C++ Runtime app-local redistribution.`r`nSource: Visual Studio VC/Redist/MSVC x64 Microsoft.VC143.CRT/vcruntime140.dll; original Microsoft Authenticode signature verified.`r`nVersion: $((Get-Item -LiteralPath $runtimeFile).VersionInfo.FileVersion)`r`nDistributable code and terms: https://learn.microsoft.com/visualstudio/releases/2022/redistribution`r`nDeployment: https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files`r`nThis component retains its Microsoft license and signature; it is not covered by the Voxy MIT license.`r`nUCRT and Windows multimedia/graphics APIs are operating-system prerequisites; Windows N may require its official Media Feature Pack.`r`n"
$cargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
$metadataText=& $cargo metadata --locked --format-version 1 --manifest-path (Join-Path $nativePackageRoot 'native/Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel inventariar as licencas Rust travadas.' }
$metadata=$metadataText | ConvertFrom-Json
$licenseInventory=@()
foreach ($dependency in $metadata.packages | Where-Object { $_.source } | Sort-Object name,version) {
    $dependencyRoot=Split-Path -Parent $dependency.manifest_path
    $licenseFiles=@(Get-ChildItem -LiteralPath $dependencyRoot -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE)([._-]|$)' })
    if ($dependency.license_file) { $licenseFiles+=Get-Item -LiteralPath (Join-Path $dependencyRoot $dependency.license_file) }
    $destination=Join-Path $licenseRoot ($dependency.name+'-'+$dependency.version)
    if ($licenseFiles.Count) {
        New-Item -ItemType Directory -Path $destination | Out-Null
        foreach ($licenseFile in $licenseFiles | Sort-Object FullName -Unique) { Copy-Item -LiteralPath $licenseFile.FullName -Destination (Join-Path $destination $licenseFile.Name) }
    }
    $licenseInventory+=[ordered]@{name=$dependency.name;version=$dependency.version;license=$dependency.license;source=$dependency.source;noticeFiles=@($licenseFiles | Select-Object -ExpandProperty Name -Unique)}
}
Write-NativeUtf8 (Join-Path $licenseRoot 'rust-dependencies.json') ($licenseInventory | ConvertTo-Json -Depth 8)
Write-NativeUtf8 (Join-Path $licenseRoot 'REVIEW-STATUS.txt') "Local experimental build. Includes available notices from the locked Rust dependency sources, including target-only and development dependencies. This inventory is not a completed distribution license review. Voxy author copyright/license notice remains pending; see world-assets/NOTICE-Voxy.txt. Asset attribution is in world-assets/LICENSE-furniture.txt.`r`n"
Write-NativeUtf8 (Join-Path $payload 'DISTRIBUTION-NOTICE.txt') "Voxy $version - beta para homologação`r`nAppId: $nativePackageId`r`nSem assinatura Authenticode. Não substitui nem atualiza a versão estável 1.4.1.`r`nInstalação paralela: LOCALAPPDATA/Programs/VoxyNativeExperimental. Dados experimentais e dados 1.4.1 preservados.`r`nProtocolo voxy-native:// somente quando habilitado nas preferências. Nenhum registro voxy:// pelo instalador.`r`nREADME e world-assets/NOTICE-Voxy.txt registram limitações e atribuições. Instalação/desinstalação ainda exigem ensaio em VM.`r`n"
$probeRoot=Join-Path $output ('verification-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probeRoot | Out-Null
Write-NativeUtf8 (Join-Path $probeRoot '.voxy-probe-owner') $nativePackageId
$previousNativeDirectory=[Environment]::GetEnvironmentVariable('VOXY_NATIVE_DATA_DIR','Process')
$probeSucceeded=$false
function Invoke-NativePackageProbe([string]$Binary,[string[]]$ProbeArgs,[string]$Name) {
    $stdout=Join-Path $probeRoot ($Name+'.stdout.json');$stderr=Join-Path $probeRoot ($Name+'.stderr.txt')
    $process=New-Object Diagnostics.Process
    $process.StartInfo.FileName=Join-Path $payload $Binary
    # Probe arguments are fixed internal switches, never user-controlled paths.
    $process.StartInfo.Arguments=$ProbeArgs -join ' '
    $process.StartInfo.UseShellExecute=$false
    $process.StartInfo.CreateNoWindow=$true
    $process.StartInfo.RedirectStandardOutput=$true
    $process.StartInfo.RedirectStandardError=$true
    try {
        if (!$process.Start()) { throw "Falha ao iniciar probe: $Name" }
        $readOutput=$process.StandardOutput.ReadToEndAsync()
        $readError=$process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit(15000)) { $process.Kill();$process.WaitForExit();throw "Processo de verificação excedeu 15s: $Name" }
        Write-NativeUtf8 $stdout ($readOutput.GetAwaiter().GetResult())
        Write-NativeUtf8 $stderr ($readError.GetAwaiter().GetResult())
        if ($process.ExitCode -ne 0) { throw "Processo empacotado falhou: $Name. Consulte o stderr privado em $probeRoot" }
    } finally { $process.Dispose() }
    Get-Content -Raw -Encoding utf8 $stdout | ConvertFrom-Json
}
try {
    [Environment]::SetEnvironmentVariable('VOXY_NATIVE_DATA_DIR',(Join-Path $probeRoot 'isolated-native-data'),'Process')
    $status=Invoke-NativePackageProbe 'voxy-core.exe' @('status') 'core-status'
    if ($status.version -ne $version -or $status.appId -ne $nativePackageId -or $status.guiLoaded -or $status.worldLoaded -or $status.microphoneOpen) { throw 'O core empacotado não confirmou a identidade/isolamento esperados.' }
    $sceneResults=@()
    foreach ($preset in 'lounge','cinema','rooftop','avatar-default-rest') { $sceneResults+=Invoke-NativePackageProbe 'voxy-world.exe' @('--preset',$preset,'--validate') ('world-'+$preset) }
    $probeReport=[ordered]@{version=$version;appId=$nativePackageId;coreStatus=$status;scenes=$sceneResults;runtimeMicrosoftSignatureVerified=$true;runtimeSha256=(Get-FileHash -LiteralPath (Join-Path $payload 'vcruntime140.dll')).Hash.ToLowerInvariant();installerInstalled=$false;devicesPhysicallyHomologated=$false}
    Write-NativeUtf8 (Join-Path $output 'packaged-probes.json') ($probeReport | ConvertTo-Json -Depth 12)
    $probeSucceeded=$true
} finally {
    [Environment]::SetEnvironmentVariable('VOXY_NATIVE_DATA_DIR',$previousNativeDirectory,'Process')
    # Delete only this invocation's positively identified private probe directory.
    $resolvedProbe=[IO.Path]::GetFullPath($probeRoot)
    if (![string]::Equals([IO.Path]::GetDirectoryName($resolvedProbe),$output,[StringComparison]::OrdinalIgnoreCase) -or (Get-Content -Raw -Encoding utf8 (Join-Path $resolvedProbe '.voxy-probe-owner')) -ne $nativePackageId) { throw 'Recusada limpeza de diretório de verificação sem identidade.' }
    if ($probeSucceeded) { Remove-Item -LiteralPath $resolvedProbe -Recurse -Force }
}
$files=@(Get-ChildItem -LiteralPath $payload -Recurse -File | Sort-Object FullName)
$entries=@($files | ForEach-Object { [ordered]@{path=$_.FullName.Substring($payload.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
$manifest=[ordered]@{format=1;kind='voxy-native-experimental-local';version=$version;appId=$nativePackageId;signed=$false;published=$false;files=$entries}
Write-NativeUtf8 (Join-Path $payload 'integrity-manifest.json') ($manifest | ConvertTo-Json -Depth 12)
$checksums=@(Get-ChildItem -LiteralPath $payload -Recurse -File | Sort-Object FullName | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_.FullName.Substring($payload.Length+1).Replace('\','/') })
Write-NativeUtf8 (Join-Path $payload 'SHA256SUMS.txt') (($checksums -join "`r`n")+"`r`n")
function Escape-Nsis([string]$Value) { $Value.Replace('$','$$').Replace('"','$\"') }
$installLines=New-Object 'Collections.Generic.List[string]';$uninstallLines=New-Object 'Collections.Generic.List[string]';$validateLines=New-Object 'Collections.Generic.List[string]'
$directories=@(Get-ChildItem -LiteralPath $payload -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending)
foreach ($directory in $directories) { $validateLines.Add('!insertmacro AssertPlainPath "$INSTDIR\'+(Escape-Nsis $directory.FullName.Substring($payload.Length+1))+'"') }
foreach ($file in Get-ChildItem -LiteralPath $payload -Recurse -File | Sort-Object FullName) {
    $relative=$file.FullName.Substring($payload.Length+1)
    $relativeDirectory=[IO.Path]::GetDirectoryName($relative)
    $destination=if ($relativeDirectory) { '$INSTDIR\'+(Escape-Nsis $relativeDirectory) } else { '$INSTDIR' }
    $installLines.Add('SetOutPath "'+$destination+'"')
    $installLines.Add('File "/oname='+(Escape-Nsis $file.Name)+'" "'+(Escape-Nsis $file.FullName)+'"')
    $uninstallLines.Add('Delete "$INSTDIR\'+(Escape-Nsis $relative)+'"')
    $validateLines.Add('!insertmacro AssertPlainPath "$INSTDIR\'+(Escape-Nsis $relative)+'"')
}
foreach ($directory in $directories) { $uninstallLines.Add('RMDir "$INSTDIR\'+(Escape-Nsis $directory.FullName.Substring($payload.Length+1))+'"') }
Write-NativeUtf8 (Join-Path $stage 'install-files.nsh') ($installLines -join "`r`n")
Write-NativeUtf8 (Join-Path $stage 'uninstall-files.nsh') ($uninstallLines -join "`r`n")
Write-NativeUtf8 (Join-Path $stage 'validate-files.nsh') ($validateLines -join "`r`n")
$zip=Join-Path $output "Voxy-Portable-$version-x64.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$pendingZip=Join-Path $stage 'portable.pending.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($payload,$pendingZip,[IO.Compression.CompressionLevel]::Optimal,$false)
Move-Item -LiteralPath $pendingZip -Destination $zip -Force
$artifacts=@([ordered]@{file=[IO.Path]::GetFileName($zip);bytes=(Get-Item -LiteralPath $zip).Length;sha256=(Get-FileHash -LiteralPath $zip).Hash.ToLowerInvariant()})
if (!$SkipInstaller) {
    if (!$NsisPath) { $nsisCache=Join-Path $env:LOCALAPPDATA 'electron-builder/Cache/nsis-3.0.4.1';$NsisPath=Get-ChildItem -LiteralPath $nsisCache -Recurse -File -Filter makensis.exe | Sort-Object FullName | Select-Object -First 1 -ExpandProperty FullName }
    if (!$NsisPath -or !(Test-Path -LiteralPath $NsisPath)) { throw 'makensis não encontrado. Informe -NsisPath ou prepare somente o ZIP com -SkipInstaller.' }
    $installer=Join-Path $output "Voxy-Setup-$version-x64.exe"
    # Windows numeric version: x.y.z plus the prerelease number (2.0.0-beta.1 -> 2.0.0.1).
    $core,$pre=$version.Split('-',2); $build=if ($pre -match '(\d+)$') { $Matches[1] } else { '0' }
    $icon=Join-Path $nativePackageRoot 'native/crates/voxy-desktop/assets/voxy.ico'
    & $NsisPath '/V2' "/DVOXY_VERSION=$version" "/DVOXY_NUMERIC_VERSION=$core.$build" "/DVOXY_ICON=$icon" "/DVOXY_PAYLOAD=$stage" "/DVOXY_OUTPUT=$installer" (Join-Path $nativePackageRoot 'native/installer.nsi')
    if ($LASTEXITCODE -ne 0) { throw 'NSIS experimental não compilou.' }
    $artifacts+=[ordered]@{file=[IO.Path]::GetFileName($installer);bytes=(Get-Item -LiteralPath $installer).Length;sha256=(Get-FileHash -LiteralPath $installer).Hash.ToLowerInvariant()}
}
Write-NativeUtf8 (Join-Path $output 'artifacts.json') ([ordered]@{version=$version;appId=$nativePackageId;experimental=$true;signed=$false;published=$false;payload=$payload;artifacts=$artifacts} | ConvertTo-Json -Depth 8)
# Release checksums for the published files (sha256sum format).
Write-NativeUtf8 (Join-Path $output 'SHA256SUMS.txt') ((($artifacts | ForEach-Object { $_.sha256+'  '+$_.file }) -join "`n")+"`n")
Write-Output "Pacote nativo experimental preparado localmente em $output. Nenhuma instalação, assinatura, publicação ou atualização estável foi executada."
