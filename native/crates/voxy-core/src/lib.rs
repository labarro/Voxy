pub mod game_service;
pub mod identity;
pub mod images;
pub mod ipc;
pub mod links;
pub mod log;
pub mod migration;
pub mod model;
pub mod room;
pub mod session;
pub mod store;
pub mod update;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const APP_ID: &str = "dev.voxy.native.experimental";
pub const MAX_PARTICIPANTS: usize = 10;

/// Experimental data never defaults to the legacy Electron userData directory.
pub fn data_directory() -> anyhow::Result<std::path::PathBuf> {
    let path =
        if let Some(path) = std::env::var_os("VOXY_NATIVE_DATA_DIR") {
            std::path::PathBuf::from(path)
        } else {
            std::path::PathBuf::from(std::env::var_os("APPDATA").ok_or_else(|| {
                anyhow::anyhow!("APPDATA indisponível; defina VOXY_NATIVE_DATA_DIR")
            })?)
            .join("voxy-native-experimental")
        };
    validate_experimental_path(&path)
}

pub fn validate_experimental_path(path: &std::path::Path) -> anyhow::Result<std::path::PathBuf> {
    use std::path::{Component, PathBuf};
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    anyhow::ensure!(
        !absolute
            .components()
            .any(|c| matches!(c, Component::ParentDir)),
        "Use um caminho absoluto sem segmentos .. para os dados experimentais"
    );
    let mut ancestor = absolute.as_path();
    let mut missing = Vec::new();
    while !ancestor.exists() {
        missing.push(
            ancestor
                .file_name()
                .ok_or_else(|| anyhow::anyhow!("Pasta inválida"))?
                .to_owned(),
        );
        ancestor = ancestor
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Pasta inválida"))?;
    }
    let mut resolved: PathBuf = ancestor.canonicalize()?;
    for name in missing.into_iter().rev() {
        resolved.push(name);
    }
    anyhow::ensure!(
        resolved.file_name().is_some()
            && !resolved.components().any(|component| match component {
                Component::Normal(name) => {
                    let name = name.to_string_lossy();
                    name.eq_ignore_ascii_case("voxy-desktop")
                        || name.eq_ignore_ascii_case("voxy-desktop-development")
                }
                _ => false,
            }),
        "A pasta de dados da versão 1.x e suas subpastas não podem ser usadas pelo aplicativo nativo"
    );
    Ok(resolved)
}
#[cfg(test)]
mod boundary_tests {
    #[test]
    fn legacy_paths_and_descendants_are_rejected_case_insensitively() {
        let root = tempfile::tempdir().unwrap();
        assert!(
            super::validate_experimental_path(&root.path().join("voxy-desktop").join("nested"))
                .is_err()
        );
        assert!(super::validate_experimental_path(&root.path().join("VOXY-DESKTOP")).is_err());
        assert!(super::validate_experimental_path(&root.path().join("native-test")).is_ok());
    }
}
