//! Local diagnostic log: `<data>/logs/<process>.log`, capped at 1 MiB with one
//! rotated copy. Records lifecycle, errors and panics only; never invites,
//! keys, message text, audio or images.
use std::{
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

const MAX_BYTES: u64 = 1024 * 1024;
static TARGET: OnceLock<Mutex<PathBuf>> = OnceLock::new();

/// Starts logging for this process and installs a panic hook that records the
/// panic location before the default handler runs.
pub fn init(process: &str) {
    let Ok(directory) = crate::data_directory() else {
        return;
    };
    let folder = directory.join("logs");
    if std::fs::create_dir_all(&folder).is_err() {
        return;
    }
    let _ = TARGET.set(Mutex::new(folder.join(format!("{process}.log"))));
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        event(
            "panic",
            &format!(
                "thread={} at {location}: {}",
                thread.name().unwrap_or("?"),
                payload.chars().take(300).collect::<String>()
            ),
        );
        previous(info);
    }));
    let executable = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    event(
        "start",
        &format!(
            "version={} pid={} exe={executable}",
            crate::VERSION,
            std::process::id()
        ),
    );
}

/// Appends one line. Failures are ignored: logging never affects the session.
pub fn event(kind: &str, detail: &str) {
    let Some(target) = TARGET.get() else {
        return;
    };
    let Ok(path) = target.lock() else {
        return;
    };
    if std::fs::metadata(&*path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::rename(&*path, path.with_extension("old.log"));
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&*path)
    {
        let line = detail.replace(['\r', '\n'], " ");
        let _ = writeln!(file, "{} {kind} {line}", crate::store::now_ms());
    }
}
