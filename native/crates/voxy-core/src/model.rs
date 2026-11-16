use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: Uuid,
    pub name: String,
    pub avatar: String,
    pub theme: Theme,
    pub input: String,
    pub output: String,
    pub input_volume: f32,
    pub voice_threshold: f32,
    pub voice_detection: bool,
    pub ptt_enabled: bool,
    pub ptt_key: String,
    pub low_resource_mode: bool,
    /// Preserve legacy appearance/preferences not interpreted by this increment.
    #[serde(flatten)]
    pub retained: std::collections::BTreeMap<String, serde_json::Value>,
}
impl Default for Profile {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4(),
            name: "Você".into(),
            avatar: "V".into(),
            theme: Theme::Voxy,
            input: String::new(),
            output: String::new(),
            input_volume: 1.0,
            voice_threshold: -45.0,
            voice_detection: false,
            ptt_enabled: false,
            ptt_key: "Mouse4".into(),
            low_resource_mode: false,
            retained: Default::default(),
        }
    }
}
impl Profile {
    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(!self.id.is_nil(), "Identificador inválido");
        anyhow::ensure!(
            !self.name.trim().is_empty() && self.name.chars().count() <= 60,
            "Nome deve ter de 1 a 60 caracteres"
        );
        anyhow::ensure!(
            self.input_volume.is_finite() && (0.0..=2.0).contains(&self.input_volume),
            "Ganho inválido"
        );
        anyhow::ensure!(
            self.voice_threshold.is_finite() && (-100.0..=0.0).contains(&self.voice_threshold),
            "Sensibilidade inválida"
        );
        anyhow::ensure!(self.avatar.len() <= 44_000, "Avatar excede o limite");
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Voxy,
    Ocean,
    Forest,
    Kuromi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Community {
    pub id: Uuid,
    pub name: String,
    pub owner: Uuid,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    Text,
    Voice,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub kind: ChannelKind,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author: Uuid,
    pub name: String,
    pub text: String,
    pub time: i64,
    pub edited_at: Option<i64>,
}

pub fn validate_text(value: &str, max: usize) -> anyhow::Result<()> {
    anyhow::ensure!(
        !value.trim().is_empty() && value.chars().count() <= max && !value.contains('\0'),
        "Texto vazio ou acima do limite de {max} caracteres"
    );
    Ok(())
}
