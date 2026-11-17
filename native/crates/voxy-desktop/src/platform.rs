/// Windows 11 frame integration for the opaque, undecorated window: dark mode
/// and rounded corners only. The frame is intentionally NOT extended into the
/// client area and no system backdrop is requested: with a translucent client
/// that made DWM draw the native caption buttons behind the custom ones
/// (duplicated controls) and let partially redrawn pixels accumulate alpha.
pub fn set_backdrop(window: &dyn iced::window::Window, reduced: bool) -> bool {
    #[cfg(windows)]
    {
        use iced::window::raw_window_handle::RawWindowHandle;
        use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
        let Ok(handle) = window.window_handle() else {
            return false;
        };
        let RawWindowHandle::Win32(handle) = handle.as_raw() else {
            return false;
        };
        let hwnd = handle.hwnd.get() as *mut std::ffi::c_void;
        let dark = 1_i32;
        // DWMWCP_ROUND, or DONOTROUND in reduced mode.
        let rounded = if reduced { 1_i32 } else { 2_i32 };
        // DWMSBT_NONE: no Mica/Acrylic behind an opaque client.
        let backdrop = 1_i32;
        unsafe {
            let a = DwmSetWindowAttribute(hwnd, 20, &dark as *const _ as *const _, 4);
            let _ = DwmSetWindowAttribute(hwnd, 33, &rounded as *const _ as *const _, 4);
            let _ = DwmSetWindowAttribute(hwnd, 38, &backdrop as *const _ as *const _, 4);
            a >= 0
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
/// Local hour of day (0–23), for greetings. Falls back to 12.
pub fn local_hour() -> u32 {
    time_label(voxy_core::store::now_ms())
        .split(':')
        .next()
        .and_then(|h| h.parse().ok())
        .unwrap_or(12)
}
