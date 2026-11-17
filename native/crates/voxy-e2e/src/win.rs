//! Windows input/clipboard/process helpers. Mouse input is posted to the target
//! window's message queue so the user's real cursor and focus are not moved.
use anyhow::{Context, Result, bail};
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME, HWND, LPARAM, RECT},
    System::{
        DataExchange::{
            CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
        },
        Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
        ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX},
        Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    },
    UI::{
        HiDpi::GetDpiForWindow,
        WindowsAndMessaging::{
            EnumWindows, GW_OWNER, GetClientRect, GetWindow, GetWindowThreadProcessId,
            IsWindowVisible, PostMessageW, SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos, WM_CLOSE,
        },
    },
};

pub fn window_of(pid: u32) -> Option<HWND> {
    struct Search {
        pid: u32,
        found: Option<HWND>,
        area: i64,
    }
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> i32 {
        unsafe {
            let search = &mut *(data as *mut Search);
            let mut owner = 0;
            GetWindowThreadProcessId(hwnd, &mut owner);
            if owner == search.pid
                && IsWindowVisible(hwnd) != 0
                && GetWindow(hwnd, GW_OWNER).is_null()
            {
                let mut rect: RECT = std::mem::zeroed();
                GetClientRect(hwnd, &mut rect);
                let area = (rect.right - rect.left) as i64 * (rect.bottom - rect.top) as i64;
                if area > search.area {
                    search.area = area;
                    search.found = Some(hwnd);
                }
            }
            1
        }
    }
    let mut search = Search {
        pid,
        found: None,
        area: 0,
    };
    unsafe { EnumWindows(Some(visit), &mut search as *mut _ as LPARAM) };
    search.found
}
pub fn scale(hwnd: HWND) -> f32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 { 1.0 } else { dpi as f32 / 96.0 }
}
/// Logical client size (Iced coordinates).
pub fn client_size(hwnd: HWND) -> (f32, f32) {
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    unsafe { GetClientRect(hwnd, &mut rect) };
    let s = scale(hwnd);
    (
        (rect.right - rect.left) as f32 / s,
        (rect.bottom - rect.top) as f32 / s,
    )
}
pub fn place(hwnd: HWND, x: i32, y: i32, w: i32, h: i32) {
    let s = scale(hwnd);
    let (w, h) = ((w as f32 * s) as i32, (h as f32 * s) as i32);
    unsafe {
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            x,
            y,
            w,
            h,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
}
/// Physical OS mouse input at logical Iced coordinates.
///
/// Posted window messages cannot drive Iced: winit's TrackMouseEvent makes
/// Windows post WM_MOUSELEAVE while the real cursor is elsewhere, and Iced
/// evaluates a whole event batch with the final (unavailable) cursor. So the
/// window is raised (topmost, without activation), the real cursor is moved over
/// the target, a SendInput click is issued, and cursor/z-order are restored.
pub fn click(hwnd: HWND, x: f32, y: f32) -> Result<()> {
    use windows_sys::Win32::{
        Foundation::POINT,
        Graphics::Gdi::ClientToScreen,
        UI::{
            Input::KeyboardAndMouse::{
                INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN,
                MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_VIRTUALDESK, MOUSEINPUT,
                SendInput,
            },
            WindowsAndMessaging::{
                GetCursorPos, GetSystemMetrics, HWND_NOTOPMOST, HWND_TOPMOST, SM_CXVIRTUALSCREEN,
                SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_NOMOVE, SWP_NOSIZE,
                SetCursorPos,
            },
        },
    };
    let s = scale(hwnd);
    let mut point = POINT {
        x: (x * s).round() as i32,
        y: (y * s).round() as i32,
    };
    unsafe {
        ClientToScreen(hwnd, &mut point);
        let mut previous = POINT { x: 0, y: 0 };
        GetCursorPos(&mut previous);
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
        std::thread::sleep(std::time::Duration::from_millis(60));
        // Absolute move + press + release in one SendInput call: inserted into the
        // input stream contiguously, so concurrent human mouse motion cannot split it.
        let (left, top) = (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
        );
        let (width, height) = (
            GetSystemMetrics(SM_CXVIRTUALSCREEN).max(2),
            GetSystemMetrics(SM_CYVIRTUALSCREEN).max(2),
        );
        let dx = ((point.x - left) as i64 * 65535 / (width - 1) as i64) as i32;
        let dy = ((point.y - top) as i64 * 65535 / (height - 1) as i64) as i32;
        let event = |flags, dx, dy| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let absolute = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
        let inputs = [
            event(absolute, dx, dy),
            event(MOUSEEVENTF_LEFTDOWN, 0, 0),
            event(MOUSEEVENTF_LEFTUP, 0, 0),
        ];
        let sent = SendInput(3, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) - 1;
        std::thread::sleep(std::time::Duration::from_millis(120));
        SetWindowPos(
            hwnd,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
        SetCursorPos(previous.x, previous.y);
        if sent != 2 {
            bail!("SendInput bloqueado (sessão bloqueada ou UIPI)");
        }
    }
    Ok(())
}
pub fn close(hwnd: HWND) {
    unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
}

const CF_UNICODETEXT: u32 = 13;
fn open_clipboard() -> Result<()> {
    for _ in 0..50 {
        if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    bail!("Área de transferência ocupada")
}
pub fn clipboard_text() -> Result<Option<String>> {
    open_clipboard()?;
    let result = unsafe {
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            None
        } else {
            let pointer = GlobalLock(handle) as *const u16;
            if pointer.is_null() {
                None
            } else {
                let mut length = 0;
                while *pointer.add(length) != 0 && length < 1 << 20 {
                    length += 1;
                }
                let text = String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length));
                GlobalUnlock(handle);
                Some(text)
            }
        }
    };
    unsafe { CloseClipboard() };
    Ok(result)
}
pub fn set_clipboard_text(text: &str) -> Result<()> {
    let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    open_clipboard()?;
    unsafe {
        EmptyClipboard();
        let memory = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
        if !memory.is_null() {
            let pointer = GlobalLock(memory) as *mut u16;
            std::ptr::copy_nonoverlapping(wide.as_ptr(), pointer, wide.len());
            GlobalUnlock(memory);
            SetClipboardData(CF_UNICODETEXT, memory);
        }
        CloseClipboard();
    }
    Ok(())
}

/// (working set bytes, private bytes, total CPU seconds)
pub fn resources(pid: u32) -> Result<(u64, u64, f64)> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            bail!("Processo {pid} indisponível");
        }
        let mut counters: PROCESS_MEMORY_COUNTERS_EX = std::mem::zeroed();
        counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        let ok = GetProcessMemoryInfo(handle, &mut counters as *mut _ as *mut _, counters.cb);
        let (mut a, mut b, mut kernel, mut user): (FILETIME, FILETIME, FILETIME, FILETIME) = (
            std::mem::zeroed(),
            std::mem::zeroed(),
            std::mem::zeroed(),
            std::mem::zeroed(),
        );
        let times = GetProcessTimes(handle, &mut a, &mut b, &mut kernel, &mut user);
        CloseHandle(handle);
        if ok == 0 || times == 0 {
            bail!("Contadores indisponíveis");
        }
        let seconds =
            |t: FILETIME| ((t.dwHighDateTime as u64) << 32 | t.dwLowDateTime as u64) as f64 / 1e7;
        Ok((
            counters.WorkingSetSize as u64,
            counters.PrivateUsage as u64,
            seconds(kernel) + seconds(user),
        ))
    }
}
pub fn alive(pid: u32) -> bool {
    resources(pid).is_ok()
}
pub fn kill(pid: u32) -> Result<()> {
    let status = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .context("taskkill")?;
    let _ = status;
    Ok(())
}
