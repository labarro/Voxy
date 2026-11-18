use crate::{CaptureFrame, CaptureOptions, frame_bytes};
use anyhow::{Context, Result, ensure};
use std::{
    marker::PhantomData,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use windows::{
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::{
            Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
            IDirect3D11CaptureFramePoolStatics2, IGraphicsCaptureSessionStatics,
        },
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
    },
    Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::*,
            Dxgi::{DXGI_ERROR_WAS_STILL_DRAWING, IDXGIDevice},
            Gdi::*,
        },
        Media::MediaFoundation::*,
        System::{
            Com::CoTaskMemFree,
            WinRT::{
                Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
                Graphics::Capture::IGraphicsCaptureItemInterop,
                RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize,
            },
        },
        UI::WindowsAndMessaging::*,
    },
    core::{Interface, PWSTR},
};

struct Apartment(PhantomData<Rc<()>>);
impl Apartment {
    fn new() -> Result<Self> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
            .context("A captura exige thread MTA dedicada")?;
        Ok(Self(PhantomData))
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() }
    }
}

/// Initialize once on a dedicated media thread and keep alive until every capture
/// and Media Foundation operation on that thread has finished.
pub struct MediaRuntime {
    _apartment: Apartment,
}
impl MediaRuntime {
    pub fn new() -> Result<Self> {
        Ok(Self {
            _apartment: Apartment::new()?,
        })
    }
}

#[derive(Clone, Debug)]
pub enum CaptureSource {
    Window {
        handle: usize,
        process_id: u32,
        title: String,
    },
    Monitor {
        handle: usize,
        width: u32,
        height: u32,
    },
}

pub fn enumerate_sources() -> Result<Vec<CaptureSource>> {
    let mut sources = Vec::<CaptureSource>::new();
    unsafe extern "system" fn window(hwnd: HWND, parameter: LPARAM) -> windows::core::BOOL {
        // LPARAM points to the stack-owned Vec for the synchronous enumeration only.
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return true.into();
            }
            // Tool windows and DWM-cloaked windows (suspended UWP, other desktops)
            // are not user-pickable surfaces.
            let extended = windows::Win32::UI::WindowsAndMessaging::GetWindowLongW(
                hwnd,
                windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
            ) as u32;
            if extended & windows::Win32::UI::WindowsAndMessaging::WS_EX_TOOLWINDOW.0 != 0 {
                return true.into();
            }
            let mut cloaked = 0u32;
            if windows::Win32::Graphics::Dwm::DwmGetWindowAttribute(
                hwnd,
                windows::Win32::Graphics::Dwm::DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut _,
                4,
            )
            .is_ok()
                && cloaked != 0
            {
                return true.into();
            }
            let mut title = [0u16; 512];
            let length = GetWindowTextW(hwnd, &mut title);
            if length > 0 {
                let mut process_id = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut process_id));
                let sources = &mut *(parameter.0 as *mut Vec<CaptureSource>);
                if sources.len() < 256 {
                    sources.push(CaptureSource::Window {
                        handle: hwnd.0 as usize,
                        process_id,
                        title: String::from_utf16_lossy(&title[..length as usize]),
                    });
                }
            }
            true.into()
        }
    }
    unsafe extern "system" fn monitor(
        handle: HMONITOR,
        _: HDC,
        rect: *mut RECT,
        parameter: LPARAM,
    ) -> windows::core::BOOL {
        unsafe {
            let sources = &mut *(parameter.0 as *mut Vec<CaptureSource>);
            let rect = *rect;
            if sources.len() < 272 {
                sources.push(CaptureSource::Monitor {
                    handle: handle.0 as usize,
                    width: (rect.right - rect.left).max(0) as u32,
                    height: (rect.bottom - rect.top).max(0) as u32,
                });
            }
            true.into()
        }
    }
    unsafe {
        EnumWindows(Some(window), LPARAM(&mut sources as *mut _ as isize))?;
        EnumDisplayMonitors(
            None,
            None,
            Some(monitor),
            LPARAM(&mut sources as *mut _ as isize),
        )
        .ok()?;
    }
    Ok(sources)
}

/// Owns capture/D3D resources on its originating MTA thread. Drop closes the pool/session.
pub struct ScreenCapture<'runtime> {
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    item: GraphicsCaptureItem,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    staging: Option<ID3D11Texture2D>,
    staging_size: (u32, u32),
    winrt_device: IDirect3DDevice,
    size: windows::Graphics::SizeInt32,
    closed: Arc<AtomicBool>,
    closed_token: i64,
    interval: Duration,
    delivered: Option<Instant>,
    _runtime: &'runtime MediaRuntime,
}
impl<'runtime> ScreenCapture<'runtime> {
    pub fn start(
        runtime: &'runtime MediaRuntime,
        source: &CaptureSource,
        options: CaptureOptions,
    ) -> Result<Self> {
        options.validate()?;
        if let CaptureSource::Window {
            handle, process_id, ..
        } = source
        {
            let hwnd = HWND(*handle as *mut _);
            ensure!(
                unsafe { IsWindow(Some(hwnd)) }.as_bool(),
                "Janela de captura fechada"
            );
            let mut actual = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut actual));
            }
            ensure!(
                actual == *process_id,
                "A janela selecionada foi substituída"
            );
        }
        // Avoid process-wide cached WinRT factory pointers: this media runtime can
        // be fully torn down and initialized again on the same worker thread.
        let session_factory =
            windows::core::factory::<GraphicsCaptureSession, IGraphicsCaptureSessionStatics>()?;
        let mut supported = false;
        unsafe {
            (session_factory.vtable().IsSupported)(session_factory.as_raw(), &mut supported)
                .ok()?;
        }
        ensure!(
            supported,
            "Windows Graphics Capture indisponível neste sistema"
        );
        let interop: IGraphicsCaptureItemInterop =
            windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        let item: GraphicsCaptureItem = unsafe {
            match source {
                CaptureSource::Window {
                    handle, process_id, ..
                } => {
                    let hwnd = HWND(*handle as *mut _);
                    ensure!(
                        IsWindow(Some(hwnd)).as_bool() && !IsIconic(hwnd).as_bool(),
                        "Janela fechada ou minimizada"
                    );
                    let mut actual = 0;
                    GetWindowThreadProcessId(hwnd, Some(&mut actual));
                    ensure!(
                        actual == *process_id,
                        "A janela selecionada foi substituída"
                    );
                    interop.CreateForWindow(hwnd)?
                }
                CaptureSource::Monitor { handle, .. } => {
                    interop.CreateForMonitor(HMONITOR(*handle as *mut _))?
                }
            }
        };
        let size = item.Size()?;
        frame_bytes(size.Width as u32, size.Height as u32)?;
        let mut device = None;
        let mut context = None;
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                Default::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
        }
        let device = device.context("D3D11 não retornou dispositivo")?;
        let context = context.context("D3D11 não retornou contexto")?;
        let dxgi: IDXGIDevice = device.cast()?;
        let winrt_device: IDirect3DDevice =
            unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
        let pool_factory = windows::core::factory::<
            Direct3D11CaptureFramePool,
            IDirect3D11CaptureFramePoolStatics2,
        >()?;
        let mut pool_pointer = std::ptr::null_mut();
        unsafe {
            (pool_factory.vtable().CreateFreeThreaded)(
                pool_factory.as_raw(),
                winrt_device.as_raw(),
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                2,
                size,
                &mut pool_pointer,
            )
            .ok()?;
        }
        ensure!(!pool_pointer.is_null(), "WinRT não retornou frame pool");
        let pool = unsafe { Direct3D11CaptureFramePool::from_raw(pool_pointer) };
        let session = pool.CreateCaptureSession(&item)?;
        // Preserve the system's capture border. Do not bypass user-visible capture indicators.
        let closed = Arc::new(AtomicBool::new(false));
        let flag = closed.clone();
        let closed_token = item.Closed(&TypedEventHandler::new(move |_, _| {
            flag.store(true, Ordering::Release);
            Ok(())
        }))?;
        if let Err(error) = session.StartCapture() {
            let _ = item.RemoveClosed(closed_token);
            let _ = session.Close();
            let _ = pool.Close();
            return Err(error.into());
        }
        Ok(Self {
            session,
            pool,
            item,
            device,
            context,
            staging: None,
            staging_size: (0, 0),
            winrt_device,
            size,
            closed,
            closed_token,
            interval: Duration::from_secs_f64(1.0 / options.frames_per_second as f64),
            delivered: None,
            _runtime: runtime,
        })
    }

    /// None is a normal idle source/timeout, allowing a player to retain its last frame.
    pub fn next_frame(&mut self, timeout: Duration) -> Result<Option<CaptureFrame>> {
        ensure!(
            !timeout.is_zero() && timeout <= Duration::from_secs(10),
            "Timeout de captura deve estar entre 1 ns e 10 s"
        );
        let deadline = Instant::now() + timeout;
        loop {
            ensure!(
                !self.closed.load(Ordering::Acquire),
                "Fonte de captura encerrada"
            );
            if Instant::now() >= deadline {
                return Ok(None);
            }
            if self
                .delivered
                .is_some_and(|at| at.elapsed() < self.interval)
            {
                std::thread::sleep(Duration::from_millis(2));
                continue;
            }
            let Ok(mut frame) = self.pool.TryGetNextFrame() else {
                std::thread::sleep(Duration::from_millis(2));
                continue;
            };
            // Bounded pool; deliver the latest queued frame rather than building latency.
            if let Ok(latest) = self.pool.TryGetNextFrame() {
                let _ = frame.Close();
                frame = latest;
            }
            let content = frame.ContentSize()?;
            // Minimized or collapsing windows report an empty surface: pause on the
            // last frame instead of ending the share.
            if content.Width <= 0 || content.Height <= 0 {
                let _ = frame.Close();
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
            if content != self.size {
                let _ = frame.Close();
                frame_bytes(content.Width as u32, content.Height as u32)?;
                self.pool.Recreate(
                    &self.winrt_device,
                    DirectXPixelFormat::B8G8R8A8UIntNormalized,
                    2,
                    content,
                )?;
                self.size = content;
                self.staging = None;
                self.staging_size = (0, 0);
                continue;
            }
            let result = (|| -> Result<CaptureFrame> {
                let size = frame.ContentSize()?;
                let length = frame_bytes(size.Width as u32, size.Height as u32)?;
                let texture: ID3D11Texture2D = unsafe {
                    frame
                        .Surface()?
                        .cast::<IDirect3DDxgiInterfaceAccess>()?
                        .GetInterface()?
                };
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                unsafe { texture.GetDesc(&mut desc) };
                ensure!(
                    desc.Width >= size.Width as u32 && desc.Height >= size.Height as u32,
                    "Recurso gráfico menor que o frame"
                );
                if self.staging_size != (desc.Width, desc.Height) {
                    desc.Usage = D3D11_USAGE_STAGING;
                    desc.BindFlags = 0;
                    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
                    desc.MiscFlags = 0;
                    frame_bytes(desc.Width, desc.Height)?;
                    let mut staging = None;
                    unsafe {
                        self.device
                            .CreateTexture2D(&desc, None, Some(&mut staging))?
                    };
                    self.staging = staging;
                    self.staging_size = (desc.Width, desc.Height);
                }
                let staging = self
                    .staging
                    .as_ref()
                    .context("Textura de leitura não criada")?;
                unsafe { self.context.CopyResource(staging, &texture) };
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                loop {
                    match unsafe {
                        self.context.Map(
                            staging,
                            0,
                            D3D11_MAP_READ,
                            D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32,
                            Some(&mut mapped),
                        )
                    } {
                        Ok(()) => break,
                        Err(error) if error.code() == DXGI_ERROR_WAS_STILL_DRAWING => {
                            ensure!(Instant::now() < deadline, "Timeout ao ler frame da GPU");
                            std::thread::sleep(Duration::from_millis(1));
                        }
                        Err(error) => return Err(error.into()),
                    }
                }
                struct Mapped<'a>(&'a ID3D11DeviceContext, &'a ID3D11Texture2D);
                impl Drop for Mapped<'_> {
                    fn drop(&mut self) {
                        unsafe { self.0.Unmap(self.1, 0) }
                    }
                }
                let _mapped = Mapped(&self.context, staging);
                let row = size.Width as usize * 4;
                ensure!(
                    !mapped.pData.is_null() && mapped.RowPitch as usize >= row,
                    "Layout de leitura inválido"
                );
                let mut pixels = vec![0; length];
                for y in 0..size.Height as usize {
                    unsafe {
                        std::ptr::copy_nonoverlapping(
                            (mapped.pData as *const u8).add(y * mapped.RowPitch as usize),
                            pixels.as_mut_ptr().add(y * row),
                            row,
                        )
                    }
                }
                Ok(CaptureFrame {
                    width: size.Width as u32,
                    height: size.Height as u32,
                    timestamp_us: frame.SystemRelativeTime()?.Duration / 10,
                    pixels: pixels.into(),
                })
            })();
            let _ = frame.Close();
            self.delivered = Some(Instant::now());
            return result.map(Some);
        }
    }
}
impl Drop for ScreenCapture<'_> {
    fn drop(&mut self) {
        let _ = self.item.RemoveClosed(self.closed_token);
        let _ = self.session.Close();
        let _ = self.pool.Close();
        unsafe {
            self.context.ClearState();
            self.context.Flush();
        }
        self.staging = None;
    }
}

#[derive(Clone, Debug)]
pub struct CameraInfo {
    pub name: String,
    pub symbolic_link: String,
}

/// Enumerates metadata only; does not activate the camera, request frames or save images.
pub fn enumerate_cameras(_runtime: &MediaRuntime) -> Result<Vec<CameraInfo>> {
    unsafe {
        MFStartup(MF_VERSION, MFSTARTUP_FULL)?;
    }
    struct Foundation;
    impl Drop for Foundation {
        fn drop(&mut self) {
            let _ = unsafe { MFShutdown() };
        }
    }
    let _foundation = Foundation;
    let mut attributes = None;
    unsafe { MFCreateAttributes(&mut attributes, 1)? };
    let attributes = attributes.context("Media Foundation não criou atributos")?;
    unsafe {
        attributes.SetGUID(
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        )?
    };
    let mut pointer = std::ptr::null_mut();
    let mut count = 0;
    unsafe { MFEnumDeviceSources(&attributes, &mut pointer, &mut count)? };
    struct Sources(*mut Option<IMFActivate>, u32);
    impl Drop for Sources {
        fn drop(&mut self) {
            unsafe {
                for index in 0..self.1 as usize {
                    std::ptr::drop_in_place(self.0.add(index));
                }
                CoTaskMemFree(Some(self.0.cast()));
            }
        }
    }
    ensure!(
        count == 0 || !pointer.is_null(),
        "Media Foundation retornou array nulo"
    );
    let sources = Sources(pointer, count);
    ensure!(
        count <= 64 && (count == 0 || !pointer.is_null()),
        "Enumeração de câmeras excede o limite"
    );
    let mut cameras = Vec::new();
    unsafe fn string(source: &IMFActivate, key: &windows::core::GUID) -> Result<String> {
        let mut pointer = PWSTR::null();
        let mut length = 0;
        unsafe { source.GetAllocatedString(key, &mut pointer, &mut length)? };
        struct StringAllocation(PWSTR);
        impl Drop for StringAllocation {
            fn drop(&mut self) {
                unsafe { CoTaskMemFree(Some(self.0.0.cast())) }
            }
        }
        let _allocation = StringAllocation(pointer);
        ensure!(
            length <= 16384 && !pointer.is_null(),
            "Metadado de câmera inválido"
        );
        Ok(String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(pointer.0, length as usize)
        }))
    }
    for index in 0..count as usize {
        if let Some(source) = unsafe { &*sources.0.add(index) } {
            cameras.push(CameraInfo {
                name: unsafe { string(source, &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME)? },
                symbolic_link: unsafe {
                    string(
                        source,
                        &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,
                    )?
                },
            });
        }
    }
    Ok(cameras)
}
