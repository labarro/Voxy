//! Windows resources for voxy-world.exe: icon, version and asInvoker manifest.
fn main() {
    #[cfg(windows)]
    voxy_resources("../voxy-desktop/assets/voxy.ico", "Voxy - ambientes");
}
include!("../../windows-resources.rs");
