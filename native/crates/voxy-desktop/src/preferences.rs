//! Translate the existing JSON shortcut preference without losing modifiers.
use anyhow::{Result, ensure};
use voxy_core::model::Profile;
pub fn shortcut_text(profile: &Profile, field: &str) -> String {
    let Some(value) = profile.retained.get(field).filter(|v| !v.is_null()) else {
        return String::new();
    };
    let mut parts = vec![];
    for (field, label) in [("ctrl", "Control"), ("alt", "Alt"), ("shift", "Shift")] {
        if value.get(field).and_then(|v| v.as_bool()) == Some(true) {
            parts.push(label);
        }
    }
    if let Some(key) = value.get("key").and_then(|v| v.as_str()) {
        parts.push(key);
    }
    parts.join("+")
}
fn shortcut(value: &str) -> Result<serde_json::Value> {
    if value.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    voxy_voice::control::KeyChord::parse(value)?;
    let parts: Vec<_> = value.split('+').collect();
    let key = parts.last().unwrap();
    ensure!(
        !["Control", "Alt", "Shift", "Meta"]
            .iter()
            .any(|prefix| key.starts_with(prefix)),
        "Atalho exige tecla além do modificador"
    );
    ensure!(
        parts[..parts.len() - 1]
            .iter()
            .all(|part| ["Control", "Alt", "Shift"].contains(part)),
        "Use modificadores Control, Alt e Shift antes da tecla"
    );
    Ok(
        serde_json::json!({"key":key,"ctrl":parts.contains(&"Control"),"alt":parts.contains(&"Alt"),"shift":parts.contains(&"Shift")}),
    )
}
pub fn write_shortcuts(profile: &mut Profile, mute: &str, deafen: &str) -> Result<()> {
    let mute = shortcut(mute)?;
    let deafen = shortcut(deafen)?;
    let mut physical = vec![];
    if profile.ptt_enabled {
        physical.push(
            voxy_voice::control::virtual_key(&profile.ptt_key)
                .ok_or_else(|| anyhow::anyhow!("Tecla PTT inválida"))?,
        );
    }
    for value in [&mute, &deafen] {
        if let Some(key) = value.get("key").and_then(|v| v.as_str()) {
            let key = voxy_voice::control::virtual_key(key).unwrap();
            ensure!(
                !physical.contains(&key),
                "PTT, mute e deafen devem usar teclas físicas diferentes"
            );
            physical.push(key);
        }
    }
    profile.retained.insert("muteShortcut".into(), mute);
    profile.retained.insert("deafenShortcut".into(), deafen);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcut_draft_roundtrips_legacy_and_rejects_collisions_before_save() {
        let mut p = Profile::default();
        write_shortcuts(&mut p, "Control+Shift+KeyM", "Alt+Mouse5").unwrap();
        assert_eq!(shortcut_text(&p, "muteShortcut"), "Control+Shift+KeyM");
        assert_eq!(shortcut_text(&p, "deafenShortcut"), "Alt+Mouse5");
        let before = p.clone();
        assert!(write_shortcuts(&mut p, "KeyM", "Control+KeyM").is_err());
        assert_eq!(p, before);
        assert!(write_shortcuts(&mut p, "Shift", "").is_err());
        p.ptt_enabled = true;
        p.ptt_key = "Mouse5".into();
        assert!(write_shortcuts(&mut p, "KeyM", "Alt+Mouse5").is_err());
    }
}
