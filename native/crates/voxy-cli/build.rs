//! Windows resources for voxy-core.exe (tray icon and version metadata).
fn main() {
    #[cfg(windows)]
    voxy_resources(
        "../voxy-desktop/assets/voxy.ico",
        "Voxy - sessão em segundo plano",
    );
}
include!("../../windows-resources.rs");
