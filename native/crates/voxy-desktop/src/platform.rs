/// Apply per-window Windows 11 Acrylic. Failure keeps the opaque fallback;
/// never changes system transparency or privacy settings.
pub fn set_backdrop(window: &dyn iced::window::Window, reduced: bool) -> bool {
    #[cfg(windows)]
    {
        use iced::window::raw_window_handle::RawWindowHandle;
        use windows_sys::Win32::{
            Graphics::Dwm::{DwmExtendFrameIntoClientArea, DwmSetWindowAttribute},
            UI::Controls::MARGINS,
        };
        let Ok(handle) = window.window_handle() else {
            return false;
        };
        let RawWindowHandle::Win32(handle) = handle.as_raw() else {
            return false;
        };
        let hwnd = handle.hwnd.get() as *mut std::ffi::c_void;
        let backdrop = if reduced { 1_i32 } else { 3_i32 };
        let dark = 1_i32;
        let rounded = 2_i32;
        // Attributes are optional on unsupported Windows versions. No fallback to undocumented APIs.
        unsafe {
            let _ = DwmSetWindowAttribute(hwnd, 20, &dark as *const _ as *const _, 4);
            let _ = DwmSetWindowAttribute(hwnd, 33, &rounded as *const _ as *const _, 4);
            let result = DwmSetWindowAttribute(hwnd, 38, &backdrop as *const _ as *const _, 4);
            let margins = MARGINS {
                cxLeftWidth: -1,
                cxRightWidth: -1,
                cyTopHeight: -1,
                cyBottomHeight: -1,
            };
            if !reduced {
                let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
            }
            result >= 0
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (window, reduced);
        false
    }
}
pub fn open_link(raw: &str) -> anyhow::Result<()> {
    let url = voxy_core::links::external_url(raw)?;
    #[cfg(windows)]
    {
        let url: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        anyhow::ensure!(
            (result as isize) > 32,
            "Não foi possível abrir o navegador padrão"
        );
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        anyhow::bail!("Abertura externa disponível apenas no Windows")
    }
}
pub fn time_label(milliseconds: i64) -> String {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{FILETIME, SYSTEMTIME},
            System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime},
        };
        let ticks = (milliseconds.max(0) as u64)
            .saturating_mul(10000)
            .saturating_add(116444736000000000);
        let time = FILETIME {
            dwLowDateTime: ticks as u32,
            dwHighDateTime: (ticks >> 32) as u32,
        };
        let mut utc: SYSTEMTIME = unsafe { std::mem::zeroed() };
        let mut local: SYSTEMTIME = unsafe { std::mem::zeroed() };
        if unsafe { FileTimeToSystemTime(&time, &mut utc) } != 0
            && unsafe { SystemTimeToTzSpecificLocalTime(std::ptr::null(), &utc, &mut local) } != 0
        {
            return format!("{:02}:{:02}", local.wHour, local.wMinute);
        }
    }
    "--:--".into()
}
