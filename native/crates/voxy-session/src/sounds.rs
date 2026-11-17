//! Interface sounds driven only by confirmed session state.
//!
//! The observer diffs consecutive published `State`s (host-confirmed membership,
//! controls and media) and the push-to-talk key, so a sound always follows a real
//! transition, never a pending request. Works with the UI closed. In a call the
//! cue is mixed by the call worker; otherwise the output device opens briefly.
use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::watch;
use uuid::Uuid;
use voxy_core::{ipc::State, model::Profile, store::Store};
use voxy_voice::{
    control::VoiceControl,
    cues::{self, Cue, Group},
};

#[derive(Debug, Clone, PartialEq)]
pub struct SoundPrefs {
    pub enabled: bool,
    pub volume: f32,
    pub call: bool,
    pub controls: bool,
    pub media: bool,
    pub social: bool,
}
impl SoundPrefs {
    pub fn from_profile(profile: &Profile) -> Self {
        let s = profile.retained.get("sounds");
        let flag = |key: &str| {
            s.and_then(|s| s.get(key))
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
        };
        Self {
            enabled: flag("enabled"),
            volume: s
                .and_then(|s| s.get("volume"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.6)
                .clamp(0.0, 1.0) as f32,
            call: flag("call"),
            controls: flag("controls"),
            media: flag("media"),
            social: flag("social"),
        }
    }
    pub fn allows(&self, cue: Cue) -> bool {
        self.enabled
            && self.volume > 0.0
            && match cue.group() {
                Group::Call => self.call,
                Group::Controls => self.controls,
                Group::Media => self.media,
                Group::Social => self.social,
            }
    }
}
/// Do Not Disturb, busy presence and disabled notification sounds silence
/// social cues only; call feedback for the user's own actions stays audible.
fn social_quiet(profile: &Profile, now: i64) -> bool {
    let notifications = profile.retained.get("notifications");
    profile.retained.get("presence").and_then(|v| v.as_str()) == Some("busy")
        || notifications
            .and_then(|n| n.get("dndUntil"))
            .and_then(|v| v.as_i64())
            .is_some_and(|until| until > now)
        || notifications
            .and_then(|n| n.get("sounds"))
            .and_then(|v| v.as_bool())
            == Some(false)
}

/// Pure transition logic, unit-tested without devices.
#[derive(Default)]
pub struct Transitions {
    previous: Option<Digest>,
    seen: BTreeSet<(Uuid, Uuid)>,
    rooms: BTreeSet<Uuid>,
}
/// The few fields transitions depend on; avoids cloning the whole state.
#[derive(Clone, PartialEq)]
struct Digest {
    call: Option<Uuid>,
    peers: BTreeSet<Uuid>,
    muted: bool,
    deafened: bool,
    screen: bool,
    camera: bool,
}
impl Digest {
    fn of(state: &State, me: Uuid) -> Self {
        let call = in_call(state, me);
        Self {
            call,
            peers: call.map(|c| peers(state, me, c)).unwrap_or_default(),
            muted: state.muted,
            deafened: state.deafened,
            screen: state.screen.is_some(),
            camera: state.camera.is_some(),
        }
    }
}
fn in_call(state: &State, me: Uuid) -> Option<Uuid> {
    let channel = state.voice?;
    let confirmed = state
        .snapshot
        .as_ref()?
        .members
        .iter()
        .any(|m| m.id == me && m.voice == Some(channel));
    (state.microphone_ready && confirmed).then_some(channel)
}
fn peers(state: &State, me: Uuid, channel: Uuid) -> BTreeSet<Uuid> {
    state
        .snapshot
        .as_ref()
        .map(|s| {
            s.members
                .iter()
                .filter(|m| m.id != me && m.voice == Some(channel))
                .map(|m| m.id)
                .collect()
        })
        .unwrap_or_default()
}
impl Transitions {
    pub fn observe(&mut self, state: &State, me: Uuid) -> Vec<Cue> {
        let mut cues = Vec::new();
        let now = Digest::of(state, me);
        let now_call = now.call;
        let previous = self.previous.take();
        if let Some(previous) = &previous {
            let was = previous.call;
            match (was, now_call) {
                (None, Some(_)) => cues.push(Cue::Join),
                (Some(_), None) => cues.push(Cue::Leave),
                (Some(a), Some(b)) if a != b => cues.push(Cue::Join),
                (Some(_), Some(_)) => {
                    let (before, after) = (&previous.peers, &now.peers);
                    if after.difference(before).next().is_some() {
                        cues.push(Cue::PeerJoin);
                    } else if before.difference(after).next().is_some() {
                        cues.push(Cue::PeerLeave);
                    }
                }
                (None, None) => {}
            }
            if now_call.is_some() && was.is_some() {
                if previous.deafened != state.deafened {
                    cues.push(if state.deafened {
                        Cue::Deafen
                    } else {
                        Cue::Undeafen
                    });
                } else if previous.muted != state.muted {
                    cues.push(if state.muted { Cue::Mute } else { Cue::Unmute });
                }
                let (screen_a, camera_a) = (previous.screen, previous.camera);
                let (screen_b, camera_b) = (now.screen, now.camera);
                if (!screen_a && screen_b) || (!camera_a && camera_b) {
                    cues.push(Cue::ShareStart);
                } else if (screen_a && !screen_b) || (camera_a && !camera_b) {
                    cues.push(Cue::ShareStop);
                }
            }
        }
        // New unread notifications addressed to this profile (first snapshot of a
        // room only seeds what is already there).
        if let Some(snapshot) = &state.snapshot {
            let room = snapshot.server.id;
            let first = self.rooms.insert(room);
            for note in &snapshot.notifications {
                if self.seen.insert((room, note.id)) && !first && !note.read {
                    cues.push(match note.kind.as_str() {
                        "mention" | "reply" => Cue::Mention,
                        "direct" => Cue::Message,
                        "friend-request" => Cue::FriendRequest,
                        "call" => Cue::Call,
                        _ => Cue::Notification,
                    });
                }
            }
            if self.seen.len() > 2_000 {
                self.seen.clear();
                self.rooms.clear();
            }
        }
        self.previous = Some(now);
        // One social sound per batch.
        let mut social = false;
        cues.retain(|cue| cue.group() != Group::Social || !std::mem::replace(&mut social, true));
        cues
    }
}

pub(crate) fn spawn(
    mut states: watch::Receiver<State>,
    control: Arc<VoiceControl>,
    path: PathBuf,
    me: Uuid,
    detached: Arc<AtomicBool>,
) {
    tokio::task::spawn_local(async move {
        let mut transitions = Transitions::default();
        let mut profile: Option<(Instant, Profile)> = None;
        let mut ptt_down = false;
        let mut poll = tokio::time::interval(Duration::from_millis(25));
        poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            let mut cues = Vec::new();
            let calling;
            tokio::select! {
                changed = states.changed() => {
                    if changed.is_err() { break }
                    let state = states.borrow_and_update();
                    cues = transitions.observe(&state, me);
                    calling = in_call(&state, me).is_some();
                    drop(state);
                    if !calling { ptt_down = false; }
                }
                _ = poll.tick() => {
                    let state = states.borrow();
                    calling = in_call(&state, me).is_some() && !state.muted && !state.deafened;
                    drop(state);
                    let down = calling
                        && control.ptt.load(Ordering::Acquire)
                        && control.pressed.load(Ordering::Acquire);
                    if down != ptt_down {
                        ptt_down = down;
                        if calling { cues.push(if down { Cue::PttOn } else { Cue::PttOff }); }
                    }
                }
            }
            if cues.is_empty() {
                continue;
            }
            if profile
                .as_ref()
                .is_none_or(|(at, _)| at.elapsed() > Duration::from_secs(2))
                && let Ok(loaded) = Store::open(&path.join("voxy.sqlite")).and_then(|s| s.profile())
            {
                profile = Some((Instant::now(), loaded));
            }
            let Some((_, current)) = &profile else {
                continue;
            };
            let prefs = SoundPrefs::from_profile(current);
            let quiet = social_quiet(current, voxy_core::store::now_ms());
            for cue in cues {
                if !prefs.allows(cue) {
                    continue;
                }
                if cue.group() == Group::Social
                    // With the UI closed the shell notification carries the sound.
                    && (quiet || detached.load(Ordering::Acquire))
                {
                    continue;
                }
                let in_call_now = {
                    let state = states.borrow();
                    in_call(&state, me).is_some()
                };
                if in_call_now {
                    control.cues.push(cue, prefs.volume);
                } else {
                    cues::play_detached(&current.output, cue, prefs.volume);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use voxy_core::room::{Member, Snapshot};
    fn member(id: Uuid, voice: Option<Uuid>) -> Member {
        Member {
            public_key: id.to_string(),
            id,
            name: "x".into(),
            voice,
            muted: false,
            deafened: false,
            screen: false,
            camera: false,
            screen_size: None,
            camera_size: None,
            watching: vec![],
        }
    }
    fn state(me: Uuid, others: &[Uuid], voice: Option<Uuid>, ready: bool) -> State {
        let mut snapshot: Snapshot = serde_json::from_value(serde_json::json!({
            "server": {"id": Uuid::nil(), "name": "s", "owner": Uuid::nil()},
            "channels": [], "members": [], "messages": []
        }))
        .unwrap_or_else(|e| panic!("snapshot json {e}"));
        snapshot.members.push(member(me, voice));
        for o in others {
            snapshot.members.push(member(*o, voice));
        }
        State {
            voice,
            microphone_ready: ready,
            snapshot: Some(snapshot),
            ..Default::default()
        }
    }
    #[test]
    fn sounds_follow_confirmed_transitions_only() {
        let (me, a, b, channel) = (
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        );
        let mut t = Transitions::default();
        assert!(t.observe(&state(me, &[], None, false), me).is_empty());
        // Requested but microphone not ready: still pending, no success sound.
        let mut pending = state(me, &[], Some(channel), false);
        pending.snapshot.as_mut().unwrap().members[0].voice = None;
        assert!(t.observe(&pending, me).is_empty());
        assert_eq!(
            t.observe(&state(me, &[a], Some(channel), true), me),
            vec![Cue::Join]
        );
        assert_eq!(
            t.observe(&state(me, &[a, b], Some(channel), true), me),
            vec![Cue::PeerJoin]
        );
        assert_eq!(
            t.observe(&state(me, &[b], Some(channel), true), me),
            vec![Cue::PeerLeave]
        );
        let mut muted = state(me, &[b], Some(channel), true);
        muted.muted = true;
        assert_eq!(t.observe(&muted, me), vec![Cue::Mute]);
        assert!(
            t.observe(&muted, me).is_empty(),
            "no duplicate for unchanged state"
        );
        let mut deaf = muted.clone();
        deaf.deafened = true;
        assert_eq!(t.observe(&deaf, me), vec![Cue::Deafen]);
        assert_eq!(
            t.observe(&state(me, &[b], None, false), me),
            vec![Cue::Leave]
        );
    }
    #[test]
    fn prefs_and_quiet_modes() {
        let mut profile = Profile::default();
        assert!(SoundPrefs::from_profile(&profile).allows(Cue::Mute));
        profile.retained.insert(
            "sounds".into(),
            serde_json::json!({"controls": false, "volume": 0.3}),
        );
        let prefs = SoundPrefs::from_profile(&profile);
        assert!(!prefs.allows(Cue::Mute) && prefs.allows(Cue::Join));
        assert!((prefs.volume - 0.3).abs() < 1e-6);
        profile
            .retained
            .insert("presence".into(), serde_json::json!("busy"));
        assert!(social_quiet(&profile, 0));
    }
}
