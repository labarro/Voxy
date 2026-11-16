use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Stage {
    #[default]
    Idle,
    Resolving,
    Authenticating,
    Connecting,
    Connected,
    Recovering,
    Failed,
}
#[derive(Debug, Default)]
pub struct Session {
    generation: u64,
    pub stage: Stage,
    voice_intent: bool,
}
impl Session {
    pub fn begin(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.stage = Stage::Resolving;
        self.generation
    }
    pub fn transition(&mut self, generation: u64, next: Stage) -> bool {
        if generation != self.generation {
            return false;
        }
        let allowed = matches!(
            (self.stage, next),
            (Stage::Resolving, Stage::Authenticating)
                | (Stage::Authenticating, Stage::Connecting)
                | (Stage::Connecting, Stage::Connected)
                | (Stage::Connected, Stage::Recovering)
                | (Stage::Recovering, Stage::Connecting)
        ) || next == Stage::Failed;
        if allowed {
            self.stage = next;
        }
        allowed
    }
    pub fn set_voice_intent(&mut self, value: bool) {
        self.voice_intent = value
    }
    pub fn wants_voice(&self) -> bool {
        self.voice_intent
    }
    pub fn cancel(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.stage = Stage::Idle;
        self.voice_intent = false
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn late_generation_cannot_revive_cancelled_call() {
        let mut s = Session::default();
        let first = s.begin();
        s.cancel();
        let second = s.begin();
        assert!(!s.transition(first, Stage::Connected));
        assert!(!s.transition(second, Stage::Connected));
        assert!(s.transition(second, Stage::Authenticating));
        assert!(s.transition(second, Stage::Connecting));
        assert!(s.transition(second, Stage::Connected));
    }
}
