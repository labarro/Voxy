//! Explicit per-user experimental integration. Never registers the stable voxy://
//! scheme or Voxy's stable startup value; no registry writes occur on module load.
use anyhow::{Context, Result, ensure};
use std::path::Path;
use voxy_core::model::Profile;
const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "VoxyNativeExperimental";
const PROTOCOL: &str = r"Software\Classes\voxy-native";
const COMMAND: &str = r"Software\Classes\voxy-native\shell\open\command";
const ICON: &str = r"Software\Classes\voxy-native\DefaultIcon";
const OWNER: &str = "VoxyNativeOwner";
const APP_ID: &str = "dev.voxy.native.experimental";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WindowsSettings {
    pub launch_at_login: bool,
    pub start_minimized: bool,
    pub register_experimental_protocol: bool,
}
impl WindowsSettings {
    pub fn from_profile(profile: &Profile) -> Self {
        let enabled = |name: &str| {
            profile
                .retained
                .get(name)
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        };
        Self {
            launch_at_login: enabled("launchAtLogin"),
            start_minimized: enabled("startMinimized"),
            register_experimental_protocol: enabled("nativeProtocolRegistered"),
        }
    }
    pub fn store_in_profile(&self, profile: &mut Profile) {
        for (name, value) in [
            ("launchAtLogin", self.launch_at_login),
            ("startMinimized", self.start_minimized),
            (
                "nativeProtocolRegistered",
                self.register_experimental_protocol,
            ),
        ] {
            profile.retained.insert(name.into(), value.into());
        }
    }
}
#[derive(Debug, Clone)]
struct Mutation {
    key: &'static str,
    name: &'static str,
    value: Option<String>,
}
trait Registry {
    fn read(&self, key: &str, name: &str) -> Result<Option<String>>;
    fn write(&mut self, key: &str, name: &str, value: Option<&str>) -> Result<()>;
}
fn registration_plan(executable: &Path, settings: WindowsSettings) -> Result<Vec<Mutation>> {
    ensure!(
        executable.is_absolute()
            && executable
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("voxy-desktop.exe")),
        "Integração exige o executável experimental voxy-desktop.exe"
    );
    let executable = executable
        .to_str()
        .context("Caminho do executável inválido")?;
    ensure!(
        !executable.contains(['"', '\0', '\r', '\n']) && !executable.ends_with('\\'),
        "Caminho não pode ser registrado com segurança"
    );
    let quoted = format!("\"{executable}\"");
    let startup = if settings.start_minimized {
        format!("{quoted} --start-minimized")
    } else {
        quoted.clone()
    };
    let protocol = settings.register_experimental_protocol;
    Ok(vec![
        Mutation {
            key: RUN,
            name: RUN_NAME,
            value: settings.launch_at_login.then_some(startup),
        },
        Mutation {
            key: PROTOCOL,
            name: "",
            value: protocol.then_some("URL:Voxy Native Experimental".into()),
        },
        Mutation {
            key: PROTOCOL,
            name: "URL Protocol",
            value: protocol.then_some(String::new()),
        },
        Mutation {
            key: PROTOCOL,
            name: OWNER,
            value: protocol.then_some(APP_ID.into()),
        },
        Mutation {
            key: ICON,
            name: "",
            value: protocol.then_some(format!("{quoted},0")),
        },
        Mutation {
            key: COMMAND,
            name: "",
            value: protocol.then_some(format!("{quoted} --protocol \"%1\"")),
        },
    ])
}
fn apply_plan(registry: &mut impl Registry, plan: &[Mutation]) -> Result<()> {
    let owner = registry.read(PROTOCOL, OWNER)?;
    if owner.as_deref() != Some(APP_ID) {
        ensure!(
            owner.is_none()
                && registry.read(PROTOCOL, "")?.is_none()
                && registry.read(COMMAND, "")?.is_none(),
            "Protocolo experimental pertence a outro aplicativo; registro preservado"
        );
    }
    // Snapshot only our named values. Never recursively delete registry trees.
    let mut previous = Vec::new();
    for mutation in plan {
        previous.push(registry.read(mutation.key, mutation.name)?);
    }
    for (index, mutation) in plan.iter().enumerate() {
        if previous[index] == mutation.value {
            continue;
        }
        if let Err(error) = registry.write(mutation.key, mutation.name, mutation.value.as_deref()) {
            let mut rollback_failed = false;
            for rollback in (0..=index).rev() {
                if registry
                    .write(
                        plan[rollback].key,
                        plan[rollback].name,
                        previous[rollback].as_deref(),
                    )
                    .is_err()
                {
                    rollback_failed = true;
                }
            }
            anyhow::bail!(
                "Falha na integração Windows: {error}. Restauração das preferências do registro: {}",
                if rollback_failed {
                    "incompleta; reveja configurações"
                } else {
                    "concluída"
                }
            );
        }
    }
    Ok(())
}
/// Call only from an explicit Save action. Profile persistence should follow a
/// successful registry update, preserving the old preferences on failure.
pub fn apply_settings(settings: WindowsSettings) -> Result<()> {
    #[cfg(windows)]
    {
        let executable = std::env::current_exe()?.canonicalize()?;
        apply_plan(
            &mut win32::CurrentUserRegistry,
            &registration_plan(&executable, settings)?,
        )
    }
    #[cfg(not(windows))]
    {
        let _ = settings;
        anyhow::bail!("Integração disponível somente no Windows")
    }
}
/// Accept one standalone protocol argument only. The session subsequently checks
/// the signed invitation; parsing never starts a connection or trusts its bytes.
pub fn protocol_invite_from_args(args: &[String]) -> Result<Option<String>> {
    if !args.iter().any(|arg| arg == "--protocol") {
        return Ok(None);
    }
    ensure!(
        args.len() == 2 && args[0] == "--protocol",
        "Argumentos do protocolo inválidos"
    );
    let payload = args[1]
        .strip_prefix("voxy-native://join/")
        .context("Protocolo experimental inválido")?;
    ensure!(
        !payload.is_empty()
            && payload.len() <= 12_000
            && payload
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte)),
        "Convite experimental inválido"
    );
    Ok(Some(format!("voxy://join/{payload}")))
}
#[cfg(windows)]
mod win32 {
    use super::*;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::*,
    };
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    fn checked(status: u32) -> Result<()> {
        ensure!(
            status == ERROR_SUCCESS,
            "Operação de registro recusada (Windows {status})"
        );
        Ok(())
    }
    pub(super) struct CurrentUserRegistry;
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }
    impl Registry for CurrentUserRegistry {
        fn read(&self, key: &str, name: &str) -> Result<Option<String>> {
            let key = wide(key);
            let name = wide(name);
            let mut size = 0u32;
            let status = unsafe {
                RegGetValueW(
                    HKEY_CURRENT_USER,
                    key.as_ptr(),
                    name.as_ptr(),
                    RRF_RT_REG_SZ,
                    null_mut(),
                    null_mut(),
                    &mut size,
                )
            };
            if [ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND].contains(&status) {
                return Ok(None);
            }
            checked(status)?;
            ensure!(
                size <= 65_536 && size.is_multiple_of(2),
                "Valor de registro excede o limite"
            );
            let mut bytes = vec![0u8; size as usize];
            checked(unsafe {
                RegGetValueW(
                    HKEY_CURRENT_USER,
                    key.as_ptr(),
                    name.as_ptr(),
                    RRF_RT_REG_SZ,
                    null_mut(),
                    bytes.as_mut_ptr().cast(),
                    &mut size,
                )
            })?;
            ensure!(
                size as usize <= bytes.len() && size.is_multiple_of(2),
                "Valor de registro alterado durante leitura"
            );
            let mut utf16: Vec<u16> = bytes[..size as usize]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect();
            if utf16.last() == Some(&0) {
                utf16.pop();
            }
            ensure!(!utf16.contains(&0), "Valor de registro inválido");
            Ok(Some(String::from_utf16(&utf16)?))
        }
        fn write(&mut self, key: &str, name: &str, value: Option<&str>) -> Result<()> {
            let key = wide(key);
            let name = wide(name);
            let mut handle = null_mut();
            if let Some(value) = value {
                checked(unsafe {
                    RegCreateKeyExW(
                        HKEY_CURRENT_USER,
                        key.as_ptr(),
                        0,
                        null(),
                        REG_OPTION_NON_VOLATILE,
                        KEY_SET_VALUE,
                        null(),
                        &mut handle,
                        null_mut(),
                    )
                })?;
                let handle = Key(handle);
                let value = wide(value);
                checked(unsafe {
                    RegSetValueExW(
                        handle.0,
                        name.as_ptr(),
                        0,
                        REG_SZ,
                        value.as_ptr().cast(),
                        (value.len() * 2) as u32,
                    )
                })
            } else {
                let status = unsafe {
                    RegOpenKeyExW(
                        HKEY_CURRENT_USER,
                        key.as_ptr(),
                        0,
                        KEY_SET_VALUE,
                        &mut handle,
                    )
                };
                if [ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND].contains(&status) {
                    return Ok(());
                }
                checked(status)?;
                let handle = Key(handle);
                let status = unsafe { RegDeleteValueW(handle.0, name.as_ptr()) };
                if status == ERROR_FILE_NOT_FOUND {
                    return Ok(());
                }
                checked(status)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    #[derive(Default)]
    struct MemoryRegistry {
        values: BTreeMap<(String, String), String>,
        writes: usize,
        fail_once: Option<usize>,
    }
    impl Registry for MemoryRegistry {
        fn read(&self, key: &str, name: &str) -> Result<Option<String>> {
            Ok(self.values.get(&(key.into(), name.into())).cloned())
        }
        fn write(&mut self, key: &str, name: &str, value: Option<&str>) -> Result<()> {
            self.writes += 1;
            if self.fail_once == Some(self.writes) {
                self.fail_once = None;
                anyhow::bail!("injected write failure")
            }
            if let Some(value) = value {
                self.values.insert((key.into(), name.into()), value.into());
            } else {
                self.values.remove(&(key.into(), name.into()));
            }
            Ok(())
        }
    }
    #[test]
    fn experimental_registration_quotes_paths_and_preserves_stable_values() {
        let settings = WindowsSettings {
            launch_at_login: true,
            start_minimized: true,
            register_experimental_protocol: true,
        };
        let exe = Path::new(r"C:\Program Files\Voxy Native\voxy-desktop.exe");
        let plan = registration_plan(exe, settings).unwrap();
        let mut registry = MemoryRegistry::default();
        registry
            .values
            .insert((RUN.into(), "Voxy".into()), "stable startup".into());
        registry.values.insert(
            (r"Software\Classes\voxy".into(), "".into()),
            "stable protocol".into(),
        );
        apply_plan(&mut registry, &plan).unwrap();
        assert_eq!(
            registry.read(RUN, RUN_NAME).unwrap().unwrap(),
            r#""C:\Program Files\Voxy Native\voxy-desktop.exe" --start-minimized"#
        );
        assert_eq!(
            registry.read(COMMAND, "").unwrap().unwrap(),
            r#""C:\Program Files\Voxy Native\voxy-desktop.exe" --protocol "%1""#
        );
        apply_plan(
            &mut registry,
            &registration_plan(exe, WindowsSettings::default()).unwrap(),
        )
        .unwrap();
        assert_eq!(
            registry.read(RUN, "Voxy").unwrap(),
            Some("stable startup".into())
        );
        assert_eq!(
            registry.read(r"Software\Classes\voxy", "").unwrap(),
            Some("stable protocol".into())
        );
        assert!(registry.read(COMMAND, "").unwrap().is_none());
    }
    #[test]
    fn failed_registration_rolls_back_and_foreign_owner_is_not_modified() {
        let plan = registration_plan(
            Path::new(r"C:\Voxy\voxy-desktop.exe"),
            WindowsSettings {
                launch_at_login: true,
                start_minimized: false,
                register_experimental_protocol: true,
            },
        )
        .unwrap();
        let mut registry = MemoryRegistry {
            fail_once: Some(4),
            ..Default::default()
        };
        assert!(apply_plan(&mut registry, &plan).is_err());
        assert!(registry.values.is_empty());
        registry
            .values
            .insert((PROTOCOL.into(), OWNER.into()), "foreign".into());
        let before = registry.values.clone();
        assert!(apply_plan(&mut registry, &plan).is_err());
        assert_eq!(registry.values, before);
    }
    #[test]
    fn protocol_activation_cannot_inject_arguments_or_replace_stable_scheme() {
        assert_eq!(
            protocol_invite_from_args(&[
                "--protocol".into(),
                "voxy-native://join/abc_123-DEF".into()
            ])
            .unwrap(),
            Some("voxy://join/abc_123-DEF".into())
        );
        for args in [
            vec!["--protocol", "voxy://join/abc"],
            vec![
                "--protocol",
                "voxy-native://join/abc\" --smoke-dir C:\\temp",
            ],
            vec!["--protocol", "voxy-native://join/abc", "--start-minimized"],
        ] {
            assert!(
                protocol_invite_from_args(&args.into_iter().map(String::from).collect::<Vec<_>>())
                    .is_err()
            );
        }
        assert!(
            registration_plan(Path::new(r"C:\Voxy\Voxy.exe"), WindowsSettings::default()).is_err()
        );
        assert!(
            registration_plan(
                Path::new(r#"C:\Voxy"bad\voxy-desktop.exe"#),
                WindowsSettings::default()
            )
            .is_err()
        );
    }
}
