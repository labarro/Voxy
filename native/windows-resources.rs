// Shared by the desktop and core build scripts. The icon is resource id 1 (the
// tray loads it by that id). Windows numeric versions cannot carry a SemVer
// suffix: "2.0.0-beta.1" becomes 2.0.0.1 numerically, with the full string in
// the text fields.
#[cfg(windows)]
const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    </application>
  </compatibility>
</assembly>
"#;
#[cfg(windows)]
fn voxy_resources(icon: &str, description: &str) {
    println!("cargo:rerun-if-changed={icon}");
    let version = std::env::var("CARGO_PKG_VERSION").unwrap_or_default();
    let (core, pre) = version.split_once('-').unwrap_or((version.as_str(), ""));
    let mut parts = core.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    let (major, minor, patch) = (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    );
    let build = pre
        .rsplit('.')
        .next()
        .and_then(|p| p.parse::<u64>().ok())
        .unwrap_or(0);
    let numeric = (major << 48) | (minor << 32) | (patch << 16) | build;
    let mut res = winresource::WindowsResource::new();
    // Every Voxy executable runs as the invoking user: no elevation, no UAC
    // installer-detection heuristics, declared Windows 10/11 compatibility.
    res.set_manifest(MANIFEST);
    res.set_icon_with_id(icon, "1")
        .set("ProductName", "Voxy")
        .set("FileDescription", description)
        .set("CompanyName", "Voxy")
        .set("LegalCopyright", "Voxy · MIT")
        .set("ProductVersion", &version)
        .set("FileVersion", &version)
        .set_version_info(winresource::VersionInfo::FILEVERSION, numeric)
        .set_version_info(winresource::VersionInfo::PRODUCTVERSION, numeric);
    if let Err(error) = res.compile() {
        panic!("Falha ao embutir recursos do Windows: {error}");
    }
}
