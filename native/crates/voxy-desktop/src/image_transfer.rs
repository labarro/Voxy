//! One bounded transfer per UI; bytes never enter room snapshots or external URLs.
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{sync::Arc, time::Instant};
use uuid::Uuid;
use voxy_core::{
    images::{IMAGE_CHUNK_BYTES, ImageMetadata, ImageTarget, MAX_IMAGE_BYTES},
    room::Action,
};
#[derive(Debug, Clone)]
pub struct Picked {
    pub name: String,
    pub bytes: Arc<[u8]>,
}
#[derive(Debug, Clone)]
pub struct Preview {
    pub name: String,
    pub handle: iced::widget::image::Handle,
}
#[derive(Debug)]
enum Mode {
    Upload {
        upload: Uuid,
        bytes: Arc<[u8]>,
        text: String,
        committing: bool,
    },
    Read {
        metadata: ImageMetadata,
        bytes: Vec<u8>,
    },
}
#[derive(Debug)]
pub struct Transfer {
    pub command: voxy_core::room::Command,
    pub sent: Instant,
    mode: Mode,
}
pub enum Step {
    Next(Action),
    Uploaded(String),
    Downloaded(Preview),
}
impl Transfer {
    pub fn upload(picked: Picked, target: ImageTarget, text: String) -> (Self, Action) {
        let upload = Uuid::new_v4();
        let action = Action::ImageBegin {
            upload,
            target,
            name: picked.name,
            total_bytes: picked.bytes.len() as u32,
            sha256: voxy_core::images::sha256(&picked.bytes),
        };
        (
            Self {
                command: voxy_core::room::Command {
                    id: Uuid::new_v4(),
                    action: action.clone(),
                },
                sent: Instant::now(),
                mode: Mode::Upload {
                    upload,
                    bytes: picked.bytes,
                    text,
                    committing: false,
                },
            },
            action,
        )
    }
    pub fn read(metadata: ImageMetadata) -> Self {
        let action = Action::ImageRead {
            id: metadata.id,
            offset: 0,
        };
        Self {
            command: voxy_core::room::Command {
                id: Uuid::new_v4(),
                action,
            },
            sent: Instant::now(),
            mode: Mode::Read {
                metadata,
                bytes: vec![],
            },
        }
    }
    pub fn reply(&mut self, value: &serde_json::Value) -> Result<Step> {
        match &mut self.mode {
            Mode::Upload {
                upload,
                bytes,
                text,
                committing,
            } => {
                if *committing {
                    let metadata: ImageMetadata = serde_json::from_value(value["image"].clone())?;
                    ensure!(
                        metadata.size as usize == bytes.len()
                            && metadata.sha256 == voxy_core::images::sha256(bytes),
                        "Confirmação da imagem divergiu do arquivo enviado"
                    );
                    return Ok(Step::Uploaded(text.clone()));
                }
                let offset = value["received"]
                    .as_u64()
                    .context("Progresso de upload inválido")? as usize;
                ensure!(offset <= bytes.len(), "Progresso excede a imagem");
                let expected = match &self.command.action {
                    Action::ImageBegin { .. } => 0,
                    Action::ImageChunk { offset, .. } => {
                        (*offset as usize + IMAGE_CHUNK_BYTES).min(bytes.len())
                    }
                    _ => anyhow::bail!("Resposta fora da etapa de upload"),
                };
                ensure!(offset == expected, "Progresso de upload fora de ordem");
                if offset == bytes.len() {
                    *committing = true;
                    return Ok(Step::Next(Action::ImageCommit {
                        upload: *upload,
                        text: text.clone(),
                    }));
                }
                let end = (offset + IMAGE_CHUNK_BYTES).min(bytes.len());
                Ok(Step::Next(Action::ImageChunk {
                    upload: *upload,
                    offset: offset as u32,
                    data: STANDARD.encode(&bytes[offset..end]),
                }))
            }
            Mode::Read { metadata, bytes } => {
                let received: ImageMetadata = serde_json::from_value(value["image"].clone())?;
                ensure!(
                    &received == metadata && value["offset"].as_u64() == Some(bytes.len() as u64),
                    "Imagem ou ordem de blocos divergente"
                );
                let data = value["data"].as_str().context("Bloco de imagem ausente")?;
                ensure!(
                    data.len() <= IMAGE_CHUNK_BYTES.div_ceil(3) * 4,
                    "Bloco de imagem excede limite"
                );
                let chunk = STANDARD.decode(data)?;
                ensure!(
                    !chunk.is_empty()
                        && chunk.len() <= IMAGE_CHUNK_BYTES
                        && bytes.len() + chunk.len() <= metadata.size as usize
                        && bytes.len() + chunk.len() <= MAX_IMAGE_BYTES,
                    "Imagem excede limite"
                );
                bytes.extend_from_slice(&chunk);
                if value["done"] == true {
                    ensure!(bytes.len() == metadata.size as usize, "Imagem incompleta");
                    let validated = voxy_core::images::validate_image(
                        &metadata.name,
                        std::mem::take(bytes),
                        &metadata.sha256,
                    )?;
                    return Ok(Step::Downloaded(Preview {
                        name: metadata.name.clone(),
                        handle: iced::widget::image::Handle::from_bytes(validated.bytes),
                    }));
                }
                ensure!(
                    value["next"].as_u64() == Some(bytes.len() as u64),
                    "Cursor da imagem inválido"
                );
                Ok(Step::Next(Action::ImageRead {
                    id: metadata.id,
                    offset: bytes.len() as u32,
                }))
            }
        }
    }
    pub fn cancel(&self) -> Option<Action> {
        match self.mode {
            Mode::Upload { upload, .. } => Some(Action::ImageCancel { upload }),
            Mode::Read { .. } => None,
        }
    }
}
pub fn pick() -> Result<Option<Picked>> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Controls::Dialogs::*;
        let mut path = vec![0u16; 32768];
        let filter: Vec<u16> = "Imagens PNG e JPEG\0*.png;*.jpg;*.jpeg\0\0"
            .encode_utf16()
            .collect();
        let mut options = OPENFILENAMEW {
            lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
            lpstrFilter: filter.as_ptr(),
            lpstrFile: path.as_mut_ptr(),
            nMaxFile: path.len() as u32,
            Flags: OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER,
            ..Default::default()
        };
        if unsafe { GetOpenFileNameW(&mut options) } == 0 {
            ensure!(
                unsafe { CommDlgExtendedError() } == 0,
                "Falha na seleção de imagem"
            );
            return Ok(None);
        }
        let length = path
            .iter()
            .position(|c| *c == 0)
            .context("Caminho de imagem inválido")?;
        let path = std::path::PathBuf::from(String::from_utf16(&path[..length])?);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .context("Nome inválido")?
            .to_string();
        let mut file = std::fs::File::open(&path)?;
        ensure!(
            file.metadata()?.is_file() && file.metadata()?.len() <= MAX_IMAGE_BYTES as u64,
            "Imagem excede 3 MiB"
        );
        use std::io::Read;
        let mut bytes = vec![];
        file.by_ref()
            .take(MAX_IMAGE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        let hash = voxy_core::images::sha256(&bytes);
        let validated = voxy_core::images::validate_image(&name, bytes, &hash)?;
        Ok(Some(Picked {
            name,
            bytes: validated.bytes.into(),
        }))
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("Seleção de imagem disponível no Windows")
    }
}
