//! Native shell notification-area owner. No GUI runtime, helper process or timer.
//! Win32 callbacks emit bounded actions; the session remains the state authority.
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::mpsc;
use voxy_voice::control::VoiceControl;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TrayAction {
    Open,
    OpenNotification(uuid::Uuid),
    ToggleMute,
    ToggleDeafen,
    Exit,
}

pub(crate) struct Tray {
    #[cfg(windows)]
    window: usize,
    #[cfg(windows)]
    thread: Option<std::thread::JoinHandle<()>>,
    overflow: Arc<AtomicBool>,
    #[cfg(windows)]
    notifications: std::sync::mpsc::SyncSender<Balloon>,
}
struct Balloon {
    id: uuid::Uuid,
    title: String,
    body: String,
    sound: bool,
}
impl Tray {
    pub(crate) fn start(
        control: Arc<VoiceControl>,
    ) -> anyhow::Result<Option<(Self, mpsc::Receiver<TrayAction>)>> {
        #[cfg(windows)]
        {
            let (events, receiver) = mpsc::channel(32);
            let (ready, result) = std::sync::mpsc::sync_channel(1);
            let overflow = Arc::new(AtomicBool::new(false));
            let thread_overflow = overflow.clone();
            let (notifications, notification_receiver) = std::sync::mpsc::sync_channel(8);
            let thread = std::thread::Builder::new()
                .name("voxy-tray".into())
                .spawn(move || {
                    if let Err(error) = win32::run(
                        control,
                        events,
                        thread_overflow,
                        notification_receiver,
                        &ready,
                    ) {
                        let _ = ready.send(Err(error.to_string()));
                    }
                })?;
            match result.recv_timeout(std::time::Duration::from_secs(3)) {
                Ok(Ok(window)) => Ok(Some((
                    Self {
                        window,
                        thread: Some(thread),
                        overflow,
                        notifications,
                    },
                    receiver,
                ))),
                Ok(Err(error)) => {
                    let _ = thread.join();
                    anyhow::bail!("{error}")
                }
                Err(_) => anyhow::bail!("Bandeja do Windows não iniciou no prazo"),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = control;
            Ok(None)
        }
    }
    pub(crate) fn take_overflow(&self) -> bool {
        self.overflow.swap(false, Ordering::AcqRel)
    }
    pub(crate) fn notify(
        &self,
        id: uuid::Uuid,
        title: &str,
        body: &str,
        sound: bool,
    ) -> anyhow::Result<()> {
        anyhow::ensure!(
            !title.is_empty()
                && title.encode_utf16().count() <= 63
                && body.encode_utf16().count() <= 255
                && !title.contains('\0')
                && !body.contains('\0'),
            "Notificação excede os limites do Windows"
        );
        #[cfg(windows)]
        {
            self.notifications
                .try_send(Balloon {
                    id,
                    title: title.into(),
                    body: body.into(),
                    sound,
                })
                .map_err(|_| anyhow::anyhow!("Fila de notificações indisponível"))?;
            anyhow::ensure!(
                unsafe {
                    windows_sys::Win32::UI::WindowsAndMessaging::PostMessageW(
                        self.window as _,
                        windows_sys::Win32::UI::WindowsAndMessaging::WM_APP + 43,
                        0,
                        0,
                    )
                } != 0,
                "Bandeja de notificações indisponível"
            );
        }
        #[cfg(not(windows))]
        {
            let _ = (id, sound);
        }
        Ok(())
    }
}
impl Drop for Tray {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            // The owning message thread destroys the HWND and notification icon.
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::PostMessageW(
                    self.window as _,
                    windows_sys::Win32::UI::WindowsAndMessaging::WM_APP + 42,
                    0,
                    0,
                );
            }
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

#[cfg(windows)]
mod win32 {
    use super::*;
    use anyhow::ensure;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{Shell::*, WindowsAndMessaging::*},
    };
    const CALLBACK: u32 = WM_APP + 41;
    const SHUTDOWN: u32 = WM_APP + 42;
    const NOTIFY: u32 = WM_APP + 43;
    // shellapi.h defines NIN_KEYSELECT as NIN_SELECT | NINF_KEY.
    const NIN_KEYSELECT: u32 = NIN_SELECT | NINF_KEY;
    const OPEN: usize = 1;
    const MUTE: usize = 2;
    const DEAFEN: usize = 3;
    const EXIT: usize = 4;
    struct WindowState {
        control: Arc<VoiceControl>,
        events: mpsc::Sender<TrayAction>,
        overflow: Arc<AtomicBool>,
        taskbar_created: u32,
        notifications: std::sync::mpsc::Receiver<Balloon>,
        last_notification: std::cell::Cell<Option<uuid::Uuid>>,
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    fn icon_data(window: HWND) -> NOTIFYICONDATAW {
        let mut data = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: window,
            uID: 1,
            uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP,
            uCallbackMessage: CALLBACK,
            hIcon: unsafe { LoadIconW(null_mut(), IDI_APPLICATION) },
            ..Default::default()
        };
        let tooltip = wide("Voxy — sessão nativa");
        data.szTip[..tooltip.len()].copy_from_slice(&tooltip);
        data
    }
    fn add_icon(window: HWND) -> bool {
        let mut data = icon_data(window);
        if unsafe { Shell_NotifyIconW(NIM_ADD, &data) } == 0 {
            return false;
        }
        data.Anonymous.uVersion = NOTIFYICON_VERSION_4;
        unsafe {
            Shell_NotifyIconW(NIM_SETVERSION, &data);
        }
        true
    }
    fn emit(state: &WindowState, action: TrayAction) {
        if state.events.try_send(action).is_err() {
            // A saturated action queue must never leave a requested mute open.
            state.control.muted.store(true, Ordering::Release);
            state.overflow.store(true, Ordering::Release);
        }
    }
    fn menu(window: HWND, state: &WindowState) {
        unsafe {
            let menu = CreatePopupMenu();
            if menu.is_null() {
                return;
            }
            let entries = [
                (OPEN, "Abrir Voxy", false),
                (
                    MUTE,
                    "Microfone mudo",
                    state.control.muted.load(Ordering::Acquire),
                ),
                (
                    DEAFEN,
                    "Ensurdecer",
                    state.control.deafened.load(Ordering::Acquire),
                ),
                (EXIT, "Encerrar Voxy e chamada", false),
            ];
            for (id, label, checked) in entries {
                AppendMenuW(
                    menu,
                    MF_STRING | if checked { MF_CHECKED } else { 0 },
                    id,
                    wide(label).as_ptr(),
                );
            }
            let mut cursor = POINT::default();
            GetCursorPos(&mut cursor);
            SetForegroundWindow(window);
            let selection = TrackPopupMenu(
                menu,
                TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
                cursor.x,
                cursor.y,
                0,
                window,
                null(),
            );
            DestroyMenu(menu);
            PostMessageW(window, WM_NULL, 0, 0);
            Shell_NotifyIconW(NIM_SETFOCUS, &icon_data(window));
            match selection as usize {
                OPEN => emit(state, TrayAction::Open),
                MUTE => emit(state, TrayAction::ToggleMute),
                DEAFEN => emit(state, TrayAction::ToggleDeafen),
                EXIT => emit(state, TrayAction::Exit),
                _ => {}
            }
        }
    }
    unsafe extern "system" fn window_proc(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        // Safety: the Box stays owned by run() until its message loop terminates.
        // Only this thread reads the pointer; WM_NCDESTROY clears the association.
        unsafe {
            if message == WM_NCCREATE {
                let create = &*(lparam as *const CREATESTRUCTW);
                SetWindowLongPtrW(window, GWLP_USERDATA, create.lpCreateParams as isize);
            }
            let pointer = GetWindowLongPtrW(window, GWLP_USERDATA) as *const WindowState;
            if message == SHUTDOWN || message == WM_CLOSE {
                EndMenu();
                DestroyWindow(window);
                return 0;
            }
            if message == WM_DESTROY {
                Shell_NotifyIconW(NIM_DELETE, &icon_data(window));
                PostQuitMessage(0);
                return 0;
            }
            if message == WM_NCDESTROY {
                SetWindowLongPtrW(window, GWLP_USERDATA, 0);
            }
            if let Some(state) = pointer.as_ref() {
                if message == NOTIFY {
                    let mut notification = None;
                    while let Ok(next) = state.notifications.try_recv() {
                        notification = Some(next);
                    }
                    if let Some(notification) = notification {
                        let mut data = icon_data(window);
                        data.uFlags = NIF_INFO | NIF_REALTIME;
                        let title = wide(&notification.title);
                        let body = wide(&notification.body);
                        data.szInfoTitle[..title.len()].copy_from_slice(&title);
                        data.szInfo[..body.len()].copy_from_slice(&body);
                        data.dwInfoFlags = NIIF_INFO
                            | NIIF_RESPECT_QUIET_TIME
                            | if notification.sound { 0 } else { NIIF_NOSOUND };
                        if Shell_NotifyIconW(NIM_MODIFY, &data) != 0 {
                            state.last_notification.set(Some(notification.id));
                        }
                    }
                    return 0;
                }
                if message == state.taskbar_created {
                    add_icon(window);
                    return 0;
                }
                if message == CALLBACK {
                    match (lparam as u32) & 0xffff {
                        NIN_BALLOONUSERCLICK => match state.last_notification.take() {
                            Some(id) => emit(state, TrayAction::OpenNotification(id)),
                            None => emit(state, TrayAction::Open),
                        },
                        WM_CONTEXTMENU | WM_RBUTTONUP => menu(window, state),
                        NIN_SELECT | NIN_KEYSELECT | WM_LBUTTONDBLCLK => {
                            emit(state, TrayAction::Open)
                        }
                        _ => {}
                    }
                    return 0;
                }
            }
            DefWindowProcW(window, message, wparam, lparam)
        }
    }
    pub(super) fn run(
        control: Arc<VoiceControl>,
        events: mpsc::Sender<TrayAction>,
        overflow: Arc<AtomicBool>,
        notifications: std::sync::mpsc::Receiver<Balloon>,
        ready: &std::sync::mpsc::SyncSender<Result<usize, String>>,
    ) -> anyhow::Result<()> {
        unsafe {
            let instance = GetModuleHandleW(null());
            let class_name = wide(&format!("VoxyNativeSessionTray-{}", std::process::id()));
            let class = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                lpszClassName: class_name.as_ptr(),
                ..Default::default()
            };
            ensure!(
                RegisterClassW(&class) != 0,
                "Falha ao registrar janela da bandeja"
            );
            let state = Box::new(WindowState {
                control,
                events,
                overflow,
                taskbar_created: RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()),
                notifications,
                last_notification: std::cell::Cell::new(None),
            });
            let window = CreateWindowExW(
                0,
                class_name.as_ptr(),
                wide("Voxy native session").as_ptr(),
                0,
                0,
                0,
                0,
                0,
                null_mut(),
                null_mut(),
                instance,
                (&*state as *const WindowState).cast(),
            );
            if window.is_null() {
                UnregisterClassW(class_name.as_ptr(), instance);
                anyhow::bail!("Falha ao criar janela da bandeja");
            }
            if !add_icon(window) {
                DestroyWindow(window);
                UnregisterClassW(class_name.as_ptr(), instance);
                anyhow::bail!("Área de notificação do Windows indisponível");
            }
            if ready.send(Ok(window as usize)).is_err() {
                DestroyWindow(window);
            }
            let mut message = MSG::default();
            loop {
                let status = GetMessageW(&mut message, null_mut(), 0, 0);
                if status <= 0 {
                    break;
                }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            if IsWindow(window) != 0 {
                DestroyWindow(window);
            }
            UnregisterClassW(class_name.as_ptr(), instance);
            drop(state);
            Ok(())
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn overflowing_tray_actions_fail_closed_instead_of_losing_a_mute() {
            let control = Arc::new(VoiceControl::default());
            let (events, _receiver) = mpsc::channel(1);
            events.try_send(TrayAction::Open).unwrap();
            let state = WindowState {
                control: control.clone(),
                events,
                overflow: Arc::new(AtomicBool::new(false)),
                taskbar_created: 0,
                notifications: std::sync::mpsc::channel().1,
                last_notification: std::cell::Cell::new(None),
            };
            emit(&state, TrayAction::ToggleMute);
            assert!(control.muted.load(Ordering::Acquire));
            assert!(state.overflow.load(Ordering::Acquire));
        }
        #[test]
        #[ignore = "Requires an interactive Windows shell; verifies API lifecycle only, not human tray interaction"]
        fn shell_icon_thread_registers_and_destroys_twice() {
            for _ in 0..2 {
                let (tray, mut events) = Tray::start(Arc::new(VoiceControl::default()))
                    .unwrap()
                    .unwrap();
                assert!(events.try_recv().is_err());
                let now = std::time::Instant::now();
                drop(tray);
                assert!(now.elapsed() < std::time::Duration::from_secs(2));
            }
        }
    }
}
