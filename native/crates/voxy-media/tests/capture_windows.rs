#![cfg(windows)]
//! Opt-in real WGC capture of a window created by this test. No desktop pixels/files.
use anyhow::{Context, Result, ensure};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use voxy_media::{
    CaptureOptions, CaptureSource, MediaRuntime, ScreenCapture, enumerate_cameras,
    enumerate_sources,
};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::*,
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::*,
    },
    core::w,
};

struct Fixture {
    source: CaptureSource,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Fixture {
    fn new() -> Result<Self> {
        let (sender, receiver) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let ending = stop.clone();
        let thread = std::thread::spawn(move || unsafe {
            unsafe extern "system" fn procedure(
                hwnd: HWND,
                message: u32,
                wparam: WPARAM,
                lparam: LPARAM,
            ) -> LRESULT {
                unsafe {
                    if message == WM_PAINT {
                        let mut paint = PAINTSTRUCT::default();
                        let dc = BeginPaint(hwnd, &mut paint);
                        static PAINT_NUMBER: std::sync::atomic::AtomicU32 =
                            std::sync::atomic::AtomicU32::new(0);
                        let blue_delta = PAINT_NUMBER.fetch_add(1, Ordering::Relaxed) % 2;
                        let brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(
                            0x0033aaee + (blue_delta << 16),
                        ));
                        FillRect(dc, &paint.rcPaint, brush);
                        let _ = DeleteObject(brush.into());
                        let _ = EndPaint(hwnd, &paint);
                        LRESULT(0)
                    } else {
                        DefWindowProcW(hwnd, message, wparam, lparam)
                    }
                }
            }
            let instance = GetModuleHandleW(None).expect("Test executable module");
            let class = WNDCLASSW {
                lpfnWndProc: Some(procedure),
                hInstance: instance.into(),
                lpszClassName: w!("VoxyOwnedCaptureFixture"),
                ..Default::default()
            };
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                Default::default(),
                w!("VoxyOwnedCaptureFixture"),
                w!("Voxy native capture test — own fixture"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                100,
                100,
                400,
                300,
                None,
                None,
                Some(instance.into()),
                None,
            )
            .expect("Test fixture window");
            sender.send(hwnd.0 as usize).unwrap();
            let mut painted = std::time::Instant::now();
            while !ending.load(Ordering::Acquire) {
                if painted.elapsed() > Duration::from_millis(50) {
                    let _ = InvalidateRect(Some(hwnd), None, false);
                    painted = std::time::Instant::now();
                }
                let mut message = MSG::default();
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            let _ = DestroyWindow(hwnd);
            let _ = UnregisterClassW(w!("VoxyOwnedCaptureFixture"), Some(instance.into()));
        });
        let handle = receiver.recv_timeout(Duration::from_secs(5))?;
        Ok(Self {
            source: CaptureSource::Window {
                handle,
                process_id: std::process::id(),
                title: "owned fixture".into(),
            },
            stop,
            thread: Some(thread),
        })
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn capture_owned_cycle() -> Result<()> {
    let runtime = MediaRuntime::new()?;
    let fixture = Fixture::new()?;
    let listed = enumerate_sources()?;
    let CaptureSource::Window { handle, .. } = fixture.source else {
        unreachable!()
    };
    ensure!(
        listed
            .iter()
            .any(|source| matches!(source,CaptureSource::Window{handle:h,..} if *h==handle)),
        "Owned source missing from selector"
    );
    let mut frames = 0;
    let mut size = (0, 0);
    for cycle in 0..3 {
        let mut capture =
            ScreenCapture::start(&runtime, &fixture.source, CaptureOptions::default())?;
        let frame = capture
            .next_frame(Duration::from_secs(5))?
            .context("Fixture produced no new frame")?;
        size = (frame.width, frame.height);
        ensure!(
            frame.pixels.len() == frame.width as usize * frame.height as usize * 4,
            "Incorrect frame stride"
        );
        let fixture_pixels = frame
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| {
                p[0].abs_diff(0x33) < 4 && p[1].abs_diff(0xaa) < 4 && p[2].abs_diff(0xee) < 4
            })
            .count();
        ensure!(
            fixture_pixels > 1000,
            "Captured frame did not contain the fixture's painted content"
        );
        let newer = capture
            .next_frame(Duration::from_secs(5))?
            .context("Fixture produced no new frame")?;
        ensure!(
            newer.timestamp_us >= frame.timestamp_us,
            "Frame timestamp regressed"
        );
        frames += 2;
        if cycle == 0 {
            unsafe {
                SetWindowPos(
                    HWND(handle as *mut _),
                    None,
                    0,
                    0,
                    480,
                    360,
                    SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
                )?;
            }
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            loop {
                ensure!(
                    std::time::Instant::now() < deadline,
                    "Capture failed to recover after source resized"
                );
                if let Some(resized) = capture.next_frame(Duration::from_millis(500))?
                    && resized.width > frame.width
                    && resized.height > frame.height
                {
                    frames += 1;
                    break;
                }
            }
        }
        drop(capture);
    }
    let camera_count = enumerate_cameras(&runtime)?.len();
    let source = fixture.source.clone();
    drop(fixture);
    ensure!(
        ScreenCapture::start(&runtime, &source, CaptureOptions::default()).is_err(),
        "Closed source reopened"
    );
    println!(
        "wgc: {frames} real BGRA frames from owned fixture, size={}x{}, 3 capture/release cycles, camera metadata count={camera_count}, camera never activated, no system audio, no desktop pixels saved",
        size.0, size.1
    );
    Ok(())
}

#[test]
#[ignore = "opens an owned test window and uses real Windows Graphics Capture/D3D11; no webcam frames or desktop capture"]
fn wgc_captures_owned_window_and_releases_session() -> Result<()> {
    // Exercise MTA initialization/shutdown and Media Foundation twice on one thread.
    capture_owned_cycle()?;
    capture_owned_cycle()
}
