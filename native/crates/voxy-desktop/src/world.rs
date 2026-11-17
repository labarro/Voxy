//! Own the optional renderer process; its lifetime never owns the voice service.
use anyhow::{Context, Result, ensure};
#[derive(Debug)]
pub struct WorldProcess {
    child: std::process::Child,
    ready: std::path::PathBuf,
    log: std::path::PathBuf,
}
impl WorldProcess {
    pub fn start(preset: &str) -> Result<Self> {
        ensure!(
            ["lounge", "cinema", "rooftop", "avatar-default-rest"].contains(&preset),
            "Ambiente desconhecido"
        );
        let executable = std::env::current_exe()?
            .parent()
            .context("Pasta do aplicativo indisponível")?
            .join("voxy-world.exe");
        ensure!(
            executable.is_file(),
            "Renderer indisponível; execute o build nativo completo"
        );
        let mut command = std::process::Command::new(executable);
        let data = voxy_core::data_directory()?;
        let id = uuid::Uuid::new_v4();
        let ready = data.join(format!("world-ready-{id}.json"));
        let log = data.join(format!("world-error-{id}.txt"));
        command
            .args(["--preset", preset, "--ready-file"])
            .arg(&ready)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::fs::File::create(&log)?);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut owner = Self {
            child: command
                .spawn()
                .context("Não foi possível abrir o mundo nativo")?,
            ready,
            log,
        };
        let start = std::time::Instant::now();
        loop {
            if std::fs::read(&owner.ready)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .is_some_and(|value| value["rendered"] == true)
            {
                return Ok(owner);
            }
            if owner.child.try_wait()?.is_some() {
                let message = std::fs::read_to_string(&owner.log).unwrap_or_default();
                anyhow::bail!(
                    "O mundo encerrou antes do primeiro frame: {}",
                    message.chars().take(2048).collect::<String>()
                );
            }
            ensure!(
                start.elapsed() < std::time::Duration::from_secs(15),
                "O mundo não confirmou o primeiro frame em 15 s"
            );
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }
}
impl Drop for WorldProcess {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.ready);
        let _ = std::fs::remove_file(&self.log);
    }
}
