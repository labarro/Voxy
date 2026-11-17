//! Test automation channel, enabled only by `VOXY_TEST_AUTOMATION=<directory>`.
//!
//! Iced 0.14 exposes no UI Automation tree, so the external E2E driver clicks
//! visible labels by posting real mouse window messages to this window (winit →
//! Iced hit-testing → the same `Msg` a human click produces). This module only
//! (1) exports visible text with layout bounds plus the session-confirmed state
//! and (2) applies the few inputs posted messages cannot express reliably:
//! typed text and pick-list choices, which are applied as the same edit
//! messages the widgets emit. Nothing here talks to the session directly.
use iced::{
    Rectangle,
    advanced::widget::{Id, Operation, operation::Outcome},
};
use std::path::{Path, PathBuf};

pub fn directory() -> Option<PathBuf> {
    std::env::var_os("VOXY_TEST_AUTOMATION")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Label {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}
#[derive(Default)]
pub struct Texts(Vec<Label>);
impl Operation<Vec<Label>> for Texts {
    fn traverse(&mut self, operate: &mut dyn FnMut(&mut dyn Operation<Vec<Label>>)) {
        operate(self)
    }
    fn container(&mut self, id: Option<&Id>, bounds: Rectangle) {
        if let Some(id) = id
            && self.0.len() < 2_000
        {
            self.0.push(Label {
                text: format!("#{id:?}"),
                x: bounds.x,
                y: bounds.y,
                w: bounds.width,
                h: bounds.height,
            });
        }
    }
    fn text(&mut self, _id: Option<&Id>, bounds: Rectangle, text: &str) {
        if self.0.len() < 2_000 && !text.trim().is_empty() {
            self.0.push(Label {
                text: text.chars().take(160).collect(),
                x: bounds.x,
                y: bounds.y,
                w: bounds.width,
                h: bounds.height,
            });
        }
    }
    fn finish(&self) -> Outcome<Vec<Label>> {
        Outcome::Some(self.0.clone())
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Command {
    /// Text typed into a field; applied as that field's on_input message.
    Type {
        field: String,
        value: String,
    },
    /// Pick-list choice; applied as that list's on_select message.
    Select {
        field: String,
        value: String,
    },
    Screenshot {
        name: String,
    },
}
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Envelope {
    pub seq: u64,
    #[serde(flatten)]
    pub command: Command,
}

/// Reads commands newer than `after`. Bounded file size and count.
pub fn pending(directory: &Path, after: u64) -> Vec<Envelope> {
    let path = directory.join("commands.jsonl");
    let Ok(metadata) = std::fs::metadata(&path) else {
        return vec![];
    };
    if metadata.len() > 1_000_000 {
        return vec![];
    }
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str::<Envelope>(line).ok())
        .filter(|envelope| envelope.seq > after)
        .take(16)
        .collect()
}

pub fn write_json(directory: &Path, name: &str, value: &serde_json::Value) {
    let path = directory.join(name);
    let temporary = path.with_extension("tmp");
    if std::fs::write(&temporary, value.to_string()).is_ok() {
        let _ = std::fs::rename(temporary, path);
    }
}

pub fn write_png(path: &Path, shot: &iced::window::Screenshot) -> anyhow::Result<()> {
    // Written to a temporary name and renamed, so readers never see a partial PNG.
    let temporary = path.with_extension("png.tmp");
    write_png_file(&temporary, shot)?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}
fn write_png_file(path: &Path, shot: &iced::window::Screenshot) -> anyhow::Result<()> {
    let file = std::fs::File::create(path)?;
    let mut encoder = png::Encoder::new(
        std::io::BufWriter::new(file),
        shot.size.width,
        shot.size.height,
    );
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(&shot.rgba)?;
    Ok(())
}

/// Screenshot names are restricted to a safe file stem inside the test directory.
pub fn safe_name(name: &str) -> Option<String> {
    (!name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
    .then(|| name.to_owned())
}
