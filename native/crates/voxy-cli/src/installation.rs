//! Coordinated shutdown used by the installer and uninstaller.
//!
//! Only Voxy 2.0 processes whose executable lives inside the given installation
//! folder are considered: never the stable 1.4.1 (`Voxy.exe`), another folder,
//! another user's processes or this helper itself.
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

const NAMES: [&str; 3] = ["voxy-desktop.exe", "voxy-world.exe", "voxy-core.exe"];

#[derive(Debug, Clone)]
pub struct Running {
    pub pid: u32,
    pub name: String,
    pub path: PathBuf,
}

fn normalized(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\").to_lowercase();
    text.trim_end_matches('\\').to_owned()
}
/// True when `executable` is directly inside `folder` (case-insensitive).
pub fn belongs_to(folder: &Path, executable: &Path) -> bool {
    executable
        .parent()
        .is_some_and(|parent| normalized(parent) == normalized(folder))
}

#[cfg(windows)]
pub fn running_in(folder: &Path) -> Result<Vec<Running>> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
                TH32CS_SNAPPROCESS,
            },
            Threading::{
                OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
                QueryFullProcessImageNameW,
            },
        },
    };
    let own = std::process::id();
    let mut found = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        anyhow::ensure!(
            snapshot != INVALID_HANDLE_VALUE,
            "Lista de processos indisponível"
        );
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snapshot, &mut entry) != 0;
        while ok {
            let length = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(0);
            let name = String::from_utf16_lossy(&entry.szExeFile[..length]).to_lowercase();
            if entry.th32ProcessID != own && NAMES.contains(&name.as_str()) {
                let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
                if !handle.is_null() {
                    let mut buffer = [0u16; 1024];
                    let mut size = buffer.len() as u32;
                    if QueryFullProcessImageNameW(
                        handle,
                        PROCESS_NAME_WIN32,
                        buffer.as_mut_ptr(),
                        &mut size,
                    ) != 0
                    {
                        let path =
                            PathBuf::from(String::from_utf16_lossy(&buffer[..size as usize]));
                        if belongs_to(folder, &path) {
                            found.push(Running {
                                pid: entry.th32ProcessID,
                                name: name.clone(),
                                path,
                            });
                        }
                    }
                    CloseHandle(handle);
                }
            }
            ok = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    Ok(found)
}
#[cfg(not(windows))]
pub fn running_in(_: &Path) -> Result<Vec<Running>> {
    Ok(Vec::new())
}

#[cfg(windows)]
fn terminate(pid: u32) {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, TerminateProcess,
            WaitForSingleObject,
        },
    };
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, 0, pid);
        if !handle.is_null() {
            TerminateProcess(handle, 1);
            WaitForSingleObject(handle, 5000);
            CloseHandle(handle);
        }
    }
}
#[cfg(not(windows))]
fn terminate(_: u32) {}

/// Stops the processes of one installation. The interface and 3D previews hold no
/// pending state and are closed first (so none of them restarts the core); the
/// core then receives an authenticated IPC shutdown that ends the call cleanly.
/// Anything from this folder still alive after the grace period is terminated.
pub async fn stop(folder: &Path) -> Result<Vec<Running>> {
    for process in running_in(folder)?
        .iter()
        .filter(|p| p.name != "voxy-core.exe")
    {
        terminate(process.pid);
    }
    let cores: Vec<_> = running_in(folder)?
        .into_iter()
        .filter(|p| p.name == "voxy-core.exe")
        .collect();
    if !cores.is_empty()
        && let Ok(directory) = voxy_core::data_directory()
        && let Ok(endpoint) = voxy_core::ipc::read_endpoint(&directory)
        && cores.iter().any(|core| core.pid == endpoint.pid)
        && let Ok(Ok((_reader, mut writer, _state))) = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            voxy_core::ipc::connect(&directory),
        )
        .await
    {
        let _ = voxy_core::ipc::write_frame(&mut writer, &voxy_core::ipc::Request::Shutdown).await;
        for _ in 0..40 {
            if !running_in(folder)?
                .iter()
                .any(|p| p.name == "voxy-core.exe")
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    }
    for process in running_in(folder)? {
        terminate(process.pid);
    }
    running_in(folder).context("Lista de processos indisponível")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_executables_directly_in_the_installation_folder_match() {
        let folder = Path::new(r"C:\Users\a\AppData\Local\Programs\VoxyNativeExperimental");
        assert!(belongs_to(
            folder,
            Path::new(r"c:\users\a\appdata\local\programs\voxynativeexperimental\voxy-core.exe")
        ));
        assert!(belongs_to(
            Path::new(r"C:\X\Voxy\"),
            Path::new(r"C:\X\Voxy\voxy-desktop.exe")
        ));
        assert!(!belongs_to(
            folder,
            Path::new(r"C:\Users\a\Downloads\voxy-native-experimental-2.0.0-win-x64\voxy-core.exe")
        ));
        assert!(!belongs_to(
            folder,
            Path::new(r"C:\Users\a\AppData\Local\Programs\VoxyNativeExperimental2\voxy-core.exe")
        ));
        assert!(!belongs_to(
            folder,
            Path::new(
                r"C:\Users\a\AppData\Local\Programs\VoxyNativeExperimental\sub\voxy-core.exe"
            )
        ));
    }
}
