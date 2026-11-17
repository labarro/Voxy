//! Dynamic test window for screen-share E2E: a borderless 1280x720 popup (so the
//! WGC capture equals the client area) with a known 8x8 checkerboard in rows 0-6
//! and, in row 7, a moving white block plus a frame counter. Synthetic content only.
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{
        BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, InvalidateRect,
        PAINTSTRUCT, SetBkMode, SetTextColor, TRANSPARENT, TextOutW,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, KillTimer, MSG,
            PostQuitMessage, RegisterClassW, SetTimer, TranslateMessage, WM_DESTROY, WM_PAINT,
            WM_TIMER, WNDCLASSW, WS_POPUP, WS_VISIBLE,
        },
    },
};

pub const TITLE: &str = "Voxy E2E Padrao";
pub const WIDTH: i32 = 1280;
pub const HEIGHT: i32 = 720;
static TICK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Expected luminance class of signature cell (gx, gy) for rows 0..7.
pub fn bright(gx: usize, gy: usize) -> bool {
    (gx + gy).is_multiple_of(2)
}

unsafe extern "system" fn procedure(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match message {
            WM_TIMER => {
                TICK.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                InvalidateRect(hwnd, std::ptr::null(), 0);
                0
            }
            WM_PAINT => {
                let mut paint: PAINTSTRUCT = std::mem::zeroed();
                let dc = BeginPaint(hwnd, &mut paint);
                let (cw, ch) = (WIDTH / 8, HEIGHT / 8);
                let light = CreateSolidBrush(0x00E6E6E6);
                let dark = CreateSolidBrush(0x00282828);
                let white = CreateSolidBrush(0x00FFFFFF);
                for gy in 0..8 {
                    for gx in 0..8 {
                        let rect = RECT {
                            left: gx * cw,
                            top: gy * ch,
                            right: (gx + 1) * cw,
                            bottom: (gy + 1) * ch,
                        };
                        let brush = if gy == 7 {
                            dark
                        } else if bright(gx as usize, gy as usize) {
                            light
                        } else {
                            dark
                        };
                        FillRect(dc, &rect, brush);
                    }
                }
                // Moving block: one cell width, sweeps row 7 every ~2.6 s at 30 Hz.
                let tick = TICK.load(std::sync::atomic::Ordering::Relaxed);
                let position = (tick % 80) as i32 * (WIDTH - cw) / 79;
                let block = RECT {
                    left: position,
                    top: 7 * ch,
                    right: position + cw,
                    bottom: HEIGHT,
                };
                FillRect(dc, &block, white);
                SetBkMode(dc, TRANSPARENT as i32);
                SetTextColor(dc, 0x0000FF00);
                let label: Vec<u16> = format!("Voxy E2E quadro {tick}").encode_utf16().collect();
                TextOutW(dc, 8, 7 * ch + 8, label.as_ptr(), label.len() as i32);
                DeleteObject(light);
                DeleteObject(dark);
                DeleteObject(white);
                EndPaint(hwnd, &paint);
                0
            }
            WM_DESTROY => {
                KillTimer(hwnd, 1);
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }
}

pub fn run(x: i32, y: i32) -> anyhow::Result<()> {
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let instance = GetModuleHandleW(std::ptr::null());
        let class: Vec<u16> = "VoxyE2EPattern\0".encode_utf16().collect();
        let title: Vec<u16> = format!("{TITLE}\0").encode_utf16().collect();
        let mut window: WNDCLASSW = std::mem::zeroed();
        window.lpfnWndProc = Some(procedure);
        window.hInstance = instance;
        window.lpszClassName = class.as_ptr();
        RegisterClassW(&window);
        let hwnd = CreateWindowExW(
            0,
            class.as_ptr(),
            title.as_ptr(),
            WS_POPUP | WS_VISIBLE,
            x,
            y,
            WIDTH,
            HEIGHT,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        anyhow::ensure!(!hwnd.is_null(), "Janela de padrão não criada");
        SetTimer(hwnd, 1, 33, None);
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    Ok(())
}
