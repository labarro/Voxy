//! Inline chat images and profile media.
//!
//! Images arrive through the host's authenticated chunked transfer (one at a
//! time), are verified by SHA-256 and kept in a local cache named by hash. Each
//! image is decoded once into a bounded thumbnail (same limits as validation);
//! views reuse that handle, so scrolling or redrawing never decodes again.
use crate::{App, Msg};
use iced::{
    Element, Length, Task,
    widget::{Space, button, column, container, image, row, text},
};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::Arc,
};
use voxy_core::images::{ImageMetadata, ProfileImage};

/// Longest side of the cached display thumbnail.
const THUMB_SIDE: u32 = 640;
/// Inline display box; the image keeps its aspect ratio inside it.
const MAX_INLINE_W: f32 = 400.0;
const MAX_INLINE_H: f32 = 320.0;
/// Local cache budget; oldest files are removed first.
const CACHE_BUDGET: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Loaded {
    pub thumb: image::Handle,
    /// Square centre crop with a baked, anti-aliased circular alpha mask, so
    /// avatars are round with any renderer (tiny-skia does not clip images).
    pub round: image::Handle,
}

#[derive(Default)]
pub struct MediaCache {
    ready: HashMap<String, Loaded>,
    failed: HashMap<String, String>,
    loading: HashSet<String>,
    queue: VecDeque<ImageMetadata>,
    /// Open the zoom view when this image finishes downloading.
    pub open_after: Option<String>,
}

fn valid_hash(sha: &str) -> bool {
    sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit())
}
pub fn cache_path(sha: &str) -> Option<PathBuf> {
    valid_hash(sha)
        .then(|| voxy_core::data_directory().ok())
        .flatten()
        .map(|d| d.join("image-cache").join(format!("{sha}.img")))
}
/// Local copy of the user's own profile media (the source for every server).
pub fn own_media_path(kind: ProfileImage) -> Option<PathBuf> {
    voxy_core::data_directory().ok().map(|d| {
        d.join("profile-media")
            .join(format!("{}.img", kind.as_str()))
    })
}

fn decode(bytes: &[u8]) -> Result<Loaded, String> {
    let (width, height, rgba) =
        voxy_core::images::thumbnail(bytes, THUMB_SIDE).map_err(|e| e.to_string())?;
    let round = round_avatar(width, height, &rgba);
    Ok(Loaded {
        thumb: image::Handle::from_rgba(width, height, rgba),
        round,
    })
}
/// Centre-crops to a square and applies a circular alpha mask (1 px soft edge).
pub fn round_avatar(width: u32, height: u32, rgba: &[u8]) -> image::Handle {
    let side = width.min(height).max(1);
    let (x0, y0) = ((width - side) / 2, (height - side) / 2);
    let radius = side as f32 / 2.0;
    let mut out = vec![0u8; (side * side * 4) as usize];
    for y in 0..side {
        for x in 0..side {
            let source = (((y0 + y) * width + (x0 + x)) * 4) as usize;
            let target = ((y * side + x) * 4) as usize;
            let dx = x as f32 + 0.5 - radius;
            let dy = y as f32 + 0.5 - radius;
            let coverage = (radius - (dx * dx + dy * dy).sqrt() + 0.5).clamp(0.0, 1.0);
            out[target..target + 3].copy_from_slice(&rgba[source..source + 3]);
            out[target + 3] = (f32::from(rgba[source + 3]) * coverage).round() as u8;
        }
    }
    image::Handle::from_rgba(side, side, out)
}
fn load_from_disk(meta: ImageMetadata, path: PathBuf) -> Task<Msg> {
    let sha = meta.sha256.clone();
    Task::perform(
        async move {
            tokio::task::spawn_blocking(move || {
                let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                if voxy_core::images::sha256(&bytes) != meta.sha256 {
                    let _ = std::fs::remove_file(&path);
                    return Err("Cache corrompido; baixando novamente".to_owned());
                }
                decode(&bytes)
            })
            .await
            .map_err(|e| e.to_string())?
        },
        move |result| Msg::MediaLoaded(sha.clone(), result),
    )
}

impl MediaCache {
    pub fn get(&self, sha: &str) -> Option<&Loaded> {
        self.ready.get(sha)
    }
    pub fn failure(&self, sha: &str) -> Option<&str> {
        self.failed.get(sha).map(String::as_str)
    }
    /// Ensures an image becomes available: from the local cache when present,
    /// otherwise queued for download from the host.
    pub fn request(&mut self, meta: &ImageMetadata) -> Option<Task<Msg>> {
        let sha = &meta.sha256;
        if !valid_hash(sha)
            || self.ready.contains_key(sha)
            || self.failed.contains_key(sha)
            || self.loading.contains(sha)
            || self.queue.iter().any(|q| &q.sha256 == sha)
        {
            return None;
        }
        if let Some(path) = cache_path(sha).filter(|p| p.is_file()) {
            self.loading.insert(sha.clone());
            return Some(load_from_disk(meta.clone(), path));
        }
        self.queue.push_back(meta.clone());
        None
    }
    pub fn prioritize(&mut self, meta: &ImageMetadata) {
        self.queue.retain(|q| q.sha256 != meta.sha256);
        self.failed.remove(&meta.sha256);
        self.queue.push_front(meta.clone());
    }
    pub fn next_download(&mut self) -> Option<ImageMetadata> {
        let next = self.queue.pop_front()?;
        self.loading.insert(next.sha256.clone());
        Some(next)
    }
    pub fn download_failed(&mut self, sha: &str, error: String) {
        self.loading.remove(sha);
        self.failed.insert(sha.to_owned(), error);
    }
    /// Verified bytes (downloaded or just uploaded): keep on disk and decode once.
    pub fn store(&mut self, sha: String, bytes: Arc<[u8]>) -> Task<Msg> {
        self.loading.insert(sha.clone());
        let key = sha.clone();
        Task::perform(
            async move {
                tokio::task::spawn_blocking(move || {
                    if let Some(path) = cache_path(&sha) {
                        if let Some(parent) = path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::write(&path, &bytes);
                    }
                    decode(&bytes)
                })
                .await
                .map_err(|e| e.to_string())?
            },
            move |result| Msg::MediaLoaded(key.clone(), result),
        )
    }
    pub fn loaded(&mut self, sha: String, result: Result<Loaded, String>) {
        self.loading.remove(&sha);
        match result {
            Ok(loaded) => {
                self.failed.remove(&sha);
                self.ready.insert(sha, loaded);
            }
            Err(error) => {
                self.failed.insert(sha, error);
            }
        }
    }
    pub fn retry(&mut self, meta: &ImageMetadata) {
        self.failed.remove(&meta.sha256);
    }
}

/// Removes the oldest cached files beyond the budget. Runs off the UI thread.
pub fn prune_cache() {
    let Some(dir) = voxy_core::data_directory()
        .ok()
        .map(|d| d.join("image-cache"))
    else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((meta.modified().ok()?, meta.len(), e.path()))
        })
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    let mut used = 0;
    for (_, size, path) in files {
        used += size;
        if used > CACHE_BUDGET {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn inline_size(meta: &ImageMetadata) -> (f32, f32) {
    let (w, h) = (meta.width.max(1) as f32, meta.height.max(1) as f32);
    let scale = (MAX_INLINE_W / w).min(MAX_INLINE_H / h).min(1.0);
    ((w * scale).max(48.0), (h * scale).max(48.0))
}

/// One attachment inside a chat or DM message.
pub fn attachment<'a>(app: &'a App, meta: &'a ImageMetadata) -> Element<'a, Msg> {
    use crate::{design::Tone, icons::Icon, ui};
    let m = app.palette();
    let (width, height) = inline_size(meta);
    if let Some(loaded) = app.media.get(&meta.sha256) {
        let picture = button(
            image(loaded.thumb.clone())
                .width(width)
                .height(height)
                .content_fit(iced::ContentFit::Contain)
                .border_radius(8.0),
        )
        .padding(0)
        .style(|_, _| button::Style::default())
        .on_press(Msg::OpenImage(meta.clone()));
        let actions = row![
            ui::icon_button(
                m,
                Icon::Maximize,
                "Ampliar",
                Some(Msg::OpenImage(meta.clone())),
                Tone::Ghost,
                26.0
            ),
            ui::icon_button(
                m,
                Icon::Download,
                "Baixar imagem",
                Some(Msg::SaveImage(meta.clone())),
                Tone::Ghost,
                26.0
            ),
            ui::icon_button(
                m,
                Icon::Copy,
                "Copiar imagem",
                Some(Msg::CopyImage(meta.clone())),
                Tone::Ghost,
                26.0
            ),
            text(meta.name.clone()).size(11).color(m.faint),
        ]
        .spacing(2)
        .align_y(iced::Center);
        return column![picture, actions].spacing(2).into();
    }
    let body: Element<'a, Msg> = if let Some(error) = app.media.failure(&meta.sha256) {
        column![
            ui::icon(Icon::Image, 20.0, m.danger),
            text("Não foi possível carregar a imagem")
                .size(12)
                .color(m.muted),
            text(error.to_owned()).size(11).color(m.faint),
            ui::action(
                m,
                Some(Icon::RefreshCw),
                "Tentar novamente",
                Some(Msg::RetryImage(meta.clone())),
                Tone::Secondary
            )
            .padding([4, 10]),
        ]
        .spacing(6)
        .align_x(iced::Center)
        .into()
    } else {
        let progress = app
            .image_transfer
            .as_ref()
            .and_then(|t| t.download_progress())
            .filter(|(id, _, _)| *id == meta.id)
            .map(|(_, done, total)| {
                format!(
                    "Carregando imagem… {}%",
                    done * 100 / (total.max(1) as usize)
                )
            })
            .unwrap_or_else(|| "Carregando imagem…".into());
        column![
            ui::icon(Icon::Image, 20.0, m.muted),
            text(progress).size(12).color(m.muted),
        ]
        .spacing(6)
        .align_x(iced::Center)
        .into()
    };
    container(body)
        .width(width)
        .height(height)
        .center(Length::Fill)
        .style(move |_| m.surface(m.panel))
        .into()
}

/// Settings › Perfil: photo and banner, applied locally at once and synced to
/// every server this profile connects to.
pub fn profile_editor(app: &App) -> Element<'_, Msg> {
    use crate::{design::Tone, icons::Icon, ui};
    let m = app.palette();
    let tint = ui::person_color(&app.profile.name);
    let has = |kind: ProfileImage| app.own_media.contains_key(&kind);
    column![
        container(banner(app, app.profile.id, 96.0, iced::Color { a: 0.55, ..tint }))
            .width(Length::Fill)
            .clip(true)
            .style(move |_| container::Style {
                border: iced::Border { radius: 12.0.into(), ..Default::default() },
                ..Default::default()
            }),
        row![
            ui::avatar(m, &app.profile.name, 64.0, ui::Ring::default()),
            column![
                row![
                    ui::action(m, Some(Icon::Image), if has(ProfileImage::Avatar) { "Trocar foto" } else { "Escolher foto" }, Some(Msg::PickProfileMedia(ProfileImage::Avatar)), Tone::Secondary),
                    ui::action(m, Some(Icon::Trash2), "Remover foto", has(ProfileImage::Avatar).then_some(Msg::ClearProfileMedia(ProfileImage::Avatar)), Tone::Ghost),
                ]
                .spacing(8),
                row![
                    ui::action(m, Some(Icon::Image), if has(ProfileImage::Banner) { "Trocar banner" } else { "Escolher banner" }, Some(Msg::PickProfileMedia(ProfileImage::Banner)), Tone::Secondary),
                    ui::action(m, Some(Icon::Trash2), "Remover banner", has(ProfileImage::Banner).then_some(Msg::ClearProfileMedia(ProfileImage::Banner)), Tone::Ghost),
                ]
                .spacing(8),
            ]
            .spacing(8),
        ]
        .spacing(18)
        .align_y(iced::Center),
        text("PNG ou JPEG até 3 MiB e 4096 px. A alteração aparece aqui na hora e é enviada ao servidor ao conectar; os outros participantes recebem pelo host.")
            .size(12)
            .color(m.muted),
    ]
    .spacing(12)
    .into()
}

/// Profile photo/banner thumbnail of a member, when present and loaded.
pub fn member_media(app: &App, member: uuid::Uuid, kind: ProfileImage) -> Option<image::Handle> {
    if member == app.profile.id
        && let Some(handle) = app.own_media.get(&kind)
    {
        return Some(handle.thumb.clone());
    }
    let snapshot = app.remote.snapshot.as_ref()?;
    let entry = snapshot.members.iter().find(|m| m.id == member)?;
    let meta = match kind {
        ProfileImage::Avatar => entry.avatar.as_ref(),
        ProfileImage::Banner => entry.banner.as_ref(),
    }?;
    app.media.get(&meta.sha256).map(|l| l.thumb.clone())
}

/// Banner strip for profile cards: the member's banner or the tinted default.
pub fn banner<'a>(
    app: &'a App,
    member: uuid::Uuid,
    height: f32,
    tint: iced::Color,
) -> Element<'a, Msg> {
    match member_media(app, member, ProfileImage::Banner) {
        Some(handle) => image(handle)
            .width(Length::Fill)
            .height(height)
            .content_fit(iced::ContentFit::Cover)
            .into(),
        None => container(Space::new().height(height))
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(tint.into()),
                ..Default::default()
            })
            .into(),
    }
}

#[cfg(windows)]
pub fn save_dialog(name: &str) -> anyhow::Result<Option<PathBuf>> {
    use windows_sys::Win32::UI::Controls::Dialogs::*;
    let mut path: Vec<u16> = name
        .encode_utf16()
        .take(200)
        .chain(std::iter::repeat_n(
            0,
            32768 - 200.min(name.encode_utf16().count()),
        ))
        .collect();
    path.truncate(32768);
    let filter: Vec<u16> = "Imagens\0*.png;*.jpg;*.jpeg\0\0".encode_utf16().collect();
    let mut options = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: filter.as_ptr(),
        lpstrFile: path.as_mut_ptr(),
        nMaxFile: path.len() as u32,
        Flags: OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER,
        ..Default::default()
    };
    if unsafe { GetSaveFileNameW(&mut options) } == 0 {
        anyhow::ensure!(
            unsafe { CommDlgExtendedError() } == 0,
            "Falha ao escolher o destino"
        );
        return Ok(None);
    }
    let length = path.iter().position(|c| *c == 0).unwrap_or(0);
    Ok(Some(PathBuf::from(String::from_utf16(&path[..length])?)))
}
#[cfg(not(windows))]
pub fn save_dialog(_: &str) -> anyhow::Result<Option<PathBuf>> {
    Ok(None)
}

/// Places the image on the Windows clipboard as a 32-bit DIB.
#[cfg(windows)]
pub fn copy_to_clipboard(bytes: &[u8]) -> anyhow::Result<()> {
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::{
        DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
        Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
    };
    const CF_DIB: u32 = 8;
    let (width, height, rgba) = voxy_core::images::thumbnail(bytes, 4096)?;
    let header = 40usize;
    let size = header + rgba.len();
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, size);
        anyhow::ensure!(!memory.is_null(), "Memória indisponível");
        let target = GlobalLock(memory) as *mut u8;
        if target.is_null() {
            GlobalFree(memory);
            anyhow::bail!("Memória indisponível");
        }
        let mut info = [0u8; 40];
        info[0..4].copy_from_slice(&40u32.to_le_bytes());
        info[4..8].copy_from_slice(&(width as i32).to_le_bytes());
        // Positive height: bottom-up rows.
        info[8..12].copy_from_slice(&(height as i32).to_le_bytes());
        info[12..14].copy_from_slice(&1u16.to_le_bytes());
        info[14..16].copy_from_slice(&32u16.to_le_bytes());
        info[20..24].copy_from_slice(&(rgba.len() as u32).to_le_bytes());
        std::ptr::copy_nonoverlapping(info.as_ptr(), target, header);
        let row = width as usize * 4;
        for y in 0..height as usize {
            let source = &rgba[(height as usize - 1 - y) * row..][..row];
            let destination = target.add(header + y * row);
            for (x, px) in source.as_chunks::<4>().0.iter().enumerate() {
                // RGBA -> BGRA
                *destination.add(x * 4) = px[2];
                *destination.add(x * 4 + 1) = px[1];
                *destination.add(x * 4 + 2) = px[0];
                *destination.add(x * 4 + 3) = px[3];
            }
        }
        GlobalUnlock(memory);
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            GlobalFree(memory);
            anyhow::bail!("Área de transferência ocupada");
        }
        EmptyClipboard();
        // On success the clipboard owns the memory.
        if SetClipboardData(CF_DIB, memory).is_null() {
            GlobalFree(memory);
            CloseClipboard();
            anyhow::bail!("Não foi possível copiar a imagem");
        }
        CloseClipboard();
    }
    Ok(())
}
#[cfg(not(windows))]
pub fn copy_to_clipboard(_: &[u8]) -> anyhow::Result<()> {
    anyhow::bail!("Indisponível")
}

#[cfg(test)]
mod tests {
    #[test]
    fn avatar_thumbnail_is_a_centred_circle() {
        // 6x4 opaque image: cropped to 4x4, corners transparent, centre opaque.
        let rgba = vec![200u8; 6 * 4 * 4];
        let handle = super::round_avatar(6, 4, &rgba);
        let iced::advanced::image::Handle::Rgba {
            width,
            height,
            pixels,
            ..
        } = handle
        else {
            panic!("expected RGBA handle");
        };
        assert_eq!((width, height), (4, 4));
        let alpha = |x: usize, y: usize| pixels[(y * 4 + x) * 4 + 3];
        assert!(alpha(0, 0) < 80 && alpha(3, 3) < 80, "corners must be cut");
        assert_eq!(alpha(1, 1), 200);
        assert_eq!(alpha(2, 2), 200);
    }
}
