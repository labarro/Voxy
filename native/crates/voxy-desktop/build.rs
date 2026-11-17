//! Windows resources: application icon and version metadata.
fn main() {
    #[cfg(windows)]
    voxy_resources("../voxy-desktop/assets/voxy.ico", "Voxy");
}
include!("../../windows-resources.rs");
