//! Notification policy independent of Windows and GUI. Persisted inbox/read state
//! belongs to the host; this bounded tracker suppresses repeated shell alerts.
use std::collections::{BTreeSet, VecDeque};
use uuid::Uuid;
use voxy_core::{
    model::Profile,
    room::{Notification, Snapshot},
};
pub(crate) struct Alert {
    pub id: Uuid,
    pub title: String,
    pub body: String,
    pub sound: bool,
}
#[derive(Default)]
pub(crate) struct Tracker {
    rooms: VecDeque<Uuid>,
    seen: BTreeSet<(Uuid, Uuid)>,
    order: VecDeque<(Uuid, Uuid)>,
    last_alert: Option<i64>,
}
impl Tracker {
    pub(crate) fn observe(
        &mut self,
        snapshot: &Snapshot,
        profile: &Profile,
        now: i64,
        detached: bool,
    ) -> Option<Alert> {
        let room = snapshot.server.id;
        let first = !self.rooms.contains(&room);
        if first {
            self.rooms.push_back(room);
            if self.rooms.len() > 64 {
                self.rooms.pop_front();
            }
        }
        let mut candidate = None;
        // Newest first in host snapshot: at most one shell notification per batch.
        for note in &snapshot.notifications {
            let key = (room, note.id);
            if !self.seen.insert(key) {
                continue;
            }
            self.order.push_back(key);
            if !first && detached && candidate.is_none() && should_alert(profile, room, note, now) {
                candidate = Some(note);
            }
        }
        while self.order.len() > 500 {
            if let Some(key) = self.order.pop_front() {
                self.seen.remove(&key);
            }
        }
        let note = candidate?;
        if self
            .last_alert
            .is_some_and(|last| now.saturating_sub(last) < 2000)
        {
            return None;
        }
        self.last_alert = Some(now);
        let sender = snapshot
            .members
            .iter()
            .find(|member| member.id == note.sender)
            .map(|member| member.name.as_str())
            .unwrap_or("Um participante");
        let (title, body) = match note.kind.as_str() {
            "mention" => (
                "Voxy — menção",
                format!("{sender} mencionou você em {}.", snapshot.server.name),
            ),
            "reply" => (
                "Voxy — resposta",
                format!(
                    "{sender} respondeu à sua mensagem em {}.",
                    snapshot.server.name
                ),
            ),
            "direct" => (
                "Voxy — mensagem privada",
                format!("Você recebeu uma mensagem privada de {sender}."),
            ),
            "friend-request" => (
                "Voxy — amizade",
                format!("{sender} enviou uma solicitação de amizade."),
            ),
            "friend-accepted" => (
                "Voxy — amizade",
                format!("{sender} aceitou sua solicitação de amizade."),
            ),
            _ => return None,
        };
        Some(Alert {
            id: note.id,
            title: title.into(),
            body: truncate_utf16(&body, 250),
            sound: profile
                .retained
                .get("notifications")
                .and_then(|prefs| prefs.get("sounds"))
                .and_then(|value| value.as_bool())
                .unwrap_or(true),
        })
    }
}
fn truncate_utf16(value: &str, limit: usize) -> String {
    let mut units = 0;
    value
        .chars()
        .take_while(|character| {
            units += character.len_utf16();
            units <= limit
        })
        .collect()
}
fn should_alert(profile: &Profile, room: Uuid, note: &Notification, now: i64) -> bool {
    if note.read
        || profile
            .retained
            .get("presence")
            .and_then(|value| value.as_str())
            == Some("busy")
    {
        return false;
    }
    let Some(prefs) = profile.retained.get("notifications") else {
        return true;
    };
    if prefs.get("native").and_then(|value| value.as_bool()) == Some(false)
        || prefs
            .get("dndUntil")
            .and_then(|value| value.as_i64())
            .is_some_and(|until| until > now)
        || prefs
            .get("types")
            .and_then(|value| value.get(&note.kind))
            .and_then(|value| value.as_bool())
            == Some(false)
    {
        return false;
    }
    let matches_list = |field: &str, target: Uuid| {
        prefs
            .get(field)
            .and_then(|value| value.as_array())
            .is_some_and(|items| {
                items.iter().filter_map(|value| value.as_str()).any(|item| {
                    item == target.to_string() || item == format!("native:{room}:{target}")
                })
            })
    };
    !matches_list("mutedServers", room)
        && !note
            .channel
            .is_some_and(|channel| matches_list("mutedChannels", channel))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_snapshot_never_replays_history_and_live_alerts_are_deduplicated() {
        let profile = Profile::default();
        let room = Uuid::new_v4();
        let mut snapshot:Snapshot=serde_json::from_value(serde_json::json!({"server":{"id":room,"name":"Fixture host","owner":profile.id},"channels":[],"members":[],"messages":[]})).unwrap();
        let note = |id| Notification {
            id,
            kind: "direct".into(),
            sender: Uuid::new_v4(),
            message: None,
            channel: None,
            time: 1,
            read: false,
        };
        snapshot.notifications.push(note(Uuid::new_v4()));
        let mut tracker = Tracker::default();
        assert!(tracker.observe(&snapshot, &profile, 10_000, true).is_none());
        let live = Uuid::new_v4();
        snapshot.notifications.insert(0, note(live));
        let alert = tracker.observe(&snapshot, &profile, 12_001, true).unwrap();
        assert_eq!(alert.id, live);
        assert!(alert.sound);
        assert!(tracker.observe(&snapshot, &profile, 15_000, true).is_none());
        snapshot.notifications.insert(0, note(Uuid::new_v4()));
        assert!(
            tracker
                .observe(&snapshot, &profile, 18_000, false)
                .is_none()
        );
        assert!(tracker.observe(&snapshot, &profile, 21_000, true).is_none());
        // Alert delivery does not mark the persistent inbox as read.
        assert!(snapshot.notifications.iter().all(|note| !note.read));
        for _ in 0..600 {
            snapshot.notifications.insert(0, note(Uuid::new_v4()));
        }
        tracker.observe(&snapshot, &profile, 24_000, true);
        assert!(tracker.seen.len() <= 500 && tracker.order.len() <= 500);
    }
    #[test]
    fn dnd_busy_read_types_and_muted_scopes_suppress_without_modifying_inbox() {
        let room = Uuid::new_v4();
        let channel = Uuid::new_v4();
        let mut profile = Profile::default();
        let mut note = Notification {
            id: Uuid::new_v4(),
            kind: "direct".into(),
            sender: Uuid::new_v4(),
            message: None,
            channel: Some(channel),
            time: 1,
            read: false,
        };
        assert!(should_alert(&profile, room, &note, 100));
        for prefs in [
            serde_json::json!({"native":false}),
            serde_json::json!({"dndUntil":101}),
            serde_json::json!({"types":{"direct":false}}),
            serde_json::json!({"mutedServers":[room]}),
            serde_json::json!({"mutedChannels":[format!("native:{room}:{channel}")]}),
        ] {
            profile.retained.insert("notifications".into(), prefs);
            assert!(!should_alert(&profile, room, &note, 100));
        }
        profile.retained.clear();
        profile.retained.insert("presence".into(), "busy".into());
        assert!(!should_alert(&profile, room, &note, 100));
        profile.retained.clear();
        note.read = true;
        assert!(!should_alert(&profile, room, &note, 100));
        assert!(
            truncate_utf16(&"😀".repeat(200), 255)
                .encode_utf16()
                .count()
                <= 255
        );
    }
}
