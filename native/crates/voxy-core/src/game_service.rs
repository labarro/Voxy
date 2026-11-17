//! Volatile game authority per voice channel, authenticated by RoomHost.
//! Snapshots are always constructed per viewer, never cached as a shared room state.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use uuid::Uuid;
use voxy_games::{chess, pool, truco};
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameKind {
    Truco,
    Chess,
    Pool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GameCommand {
    Join {
        game: GameKind,
        seat: Option<usize>,
    },
    Leave {
        game: GameKind,
    },
    Truco {
        revision: u64,
        action: truco::Action,
    },
    Chess {
        revision: u64,
        action: chess::Action,
    },
    PoolAim {
        angle: f64,
        power: f64,
    },
    PoolShoot {
        angle: f64,
        power: f64,
        revision: u64,
    },
    PoolPlace {
        x: f64,
        z: f64,
        revision: u64,
    },
    PoolRestart,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameView {
    pub channel: Uuid,
    pub truco: truco::View,
    pub chess: chess::View,
    pub pool: pool::State,
}
struct Arena {
    truco: truco::TrucoGame,
    chess: chess::ChessGame,
    pool: pool::PoolGame,
    last_tick: i64,
    pool_remainder: i64,
}
impl Arena {
    fn new(now: i64) -> Self {
        Self {
            truco: Default::default(),
            chess: Default::default(),
            pool: Default::default(),
            last_tick: now,
            pool_remainder: 0,
        }
    }
    fn occupied(&self) -> bool {
        self.truco.has_players()
            || self.chess.has_players()
            || !self.pool.state().players.is_empty()
    }
    fn revision(&self) -> (u64, u64, u64) {
        (
            self.truco.revision(),
            self.chess.revision(),
            self.pool.state().revision,
        )
    }
    fn leave(&mut self, id: &str) {
        let _ = self.truco.leave(id);
        let _ = self.chess.leave(id);
        self.pool.leave(id);
    }
}
#[derive(Default)]
pub struct GameService {
    arenas: BTreeMap<Uuid, Arena>,
    receipts: BTreeMap<(Uuid, Uuid), serde_json::Value>,
    receipt_order: VecDeque<(Uuid, Uuid)>,
}
impl GameService {
    pub fn has_games(&self) -> bool {
        !self.arenas.is_empty()
    }
    pub fn needs_fast_tick(&self) -> bool {
        self.arenas.values().any(|arena| {
            matches!(
                arena.pool.state().phase,
                pool::Phase::Preparing | pool::Phase::Rolling
            ) || matches!(
                arena.truco.phase(),
                truco::Phase::Dealing | truco::Phase::TrickResult | truco::Phase::HandResult
            ) || arena.truco.action_deadline() > arena.last_tick
                || arena.chess.action_deadline() > arena.last_tick
        })
    }
    pub fn handle(
        &mut self,
        channel: Uuid,
        actor: Uuid,
        id: Uuid,
        command: GameCommand,
        now: i64,
    ) -> Result<serde_json::Value> {
        if let Some(previous) = self.receipts.get(&(actor, id)) {
            return Ok(previous.clone());
        }
        if !self.arenas.contains_key(&channel) {
            ensure!(
                matches!(command, GameCommand::Join { .. }),
                "Mesa ainda não iniciada"
            );
            ensure!(self.arenas.len() < 32, "Limite de mesas simultâneas");
            self.arenas.insert(channel, Arena::new(now));
        }
        let arena = self.arenas.get_mut(&channel).unwrap();
        let actor_id = actor.to_string();
        let result = (|| -> Result<()> {
            match command {
                GameCommand::Join { game, seat } => match game {
                    GameKind::Truco => arena.truco.join(&actor_id, now, seat)?,
                    GameKind::Chess => arena.chess.join(&actor_id, now, seat)?,
                    GameKind::Pool => {
                        ensure!(
                            seat.is_none(),
                            "Sinuca ocupa os assentos por ordem de entrada"
                        );
                        arena.pool.join(&actor_id)?;
                    }
                },
                GameCommand::Leave { game } => match game {
                    GameKind::Truco => arena.truco.leave(&actor_id)?,
                    GameKind::Chess => arena.chess.leave(&actor_id)?,
                    GameKind::Pool => arena.pool.leave(&actor_id),
                },
                GameCommand::Truco { revision, action } => {
                    arena.truco.act(&actor_id, action, revision, now)?
                }
                GameCommand::Chess { revision, action } => {
                    arena.chess.act(&actor_id, action, revision, now)?
                }
                GameCommand::PoolAim { angle, power } => arena.pool.aim(&actor_id, angle, power)?,
                GameCommand::PoolShoot {
                    angle,
                    power,
                    revision,
                } => {
                    arena.pool.shoot(&actor_id, angle, power, revision)?;
                    arena.last_tick = now;
                    arena.pool_remainder = 0;
                }
                GameCommand::PoolPlace { x, z, revision } => {
                    arena.pool.place(&actor_id, x, z, revision)?
                }
                GameCommand::PoolRestart => arena.pool.restart(&actor_id)?,
            };
            Ok(())
        })();
        if let Err(error) = result {
            if !arena.occupied() {
                self.arenas.remove(&channel);
            }
            return Err(error);
        }
        let (truco, chess, pool) = arena.revision();
        let value = serde_json::json!({"channel":channel,"truco_revision":truco,"chess_revision":chess,"pool_revision":pool});
        self.receipts.insert((actor, id), value.clone());
        self.receipt_order.push_back((actor, id));
        while self.receipt_order.len() > 1024 {
            if let Some(key) = self.receipt_order.pop_front() {
                self.receipts.remove(&key);
            }
        }
        if !arena.occupied() {
            self.arenas.remove(&channel);
        }
        Ok(value)
    }
    pub fn leave_channel(&mut self, channel: Uuid, actor: Uuid) {
        if let Some(arena) = self.arenas.get_mut(&channel) {
            arena.leave(&actor.to_string());
            if !arena.occupied() {
                self.arenas.remove(&channel);
            }
        }
    }
    pub fn advance(&mut self, online: &BTreeMap<Uuid, BTreeSet<String>>, now: i64) -> Result<bool> {
        let mut changed = false;
        for (channel, arena) in &mut self.arenas {
            let before = arena.revision();
            let empty = BTreeSet::new();
            let present = online.get(channel).unwrap_or(&empty);
            arena.truco.sync(present, now)?;
            arena.chess.sync(present, now)?;
            // Pool's established policy is immediate forfeit on disconnect, unlike reserved turn-based seats.
            for id in arena.pool.state().players.clone() {
                if !present.contains(&id) {
                    arena.pool.leave(&id);
                }
            }
            // Bound catch-up after stalls to twelve fixed steps; no unbounded work in network actor.
            let elapsed = (now - arena.last_tick).clamp(0, 100);
            if matches!(
                arena.pool.state().phase,
                pool::Phase::Preparing | pool::Phase::Rolling
            ) {
                arena.pool_remainder += elapsed * 120;
                let steps = (arena.pool_remainder / 1000) as usize;
                arena.pool_remainder %= 1000;
                for _ in 0..steps {
                    arena.pool.step();
                }
            } else {
                arena.pool_remainder = 0;
            }
            arena.last_tick = now;
            changed |= before != arena.revision();
        }
        self.arenas.retain(|_, arena| arena.occupied());
        Ok(changed)
    }
    pub fn views(&self, channel: Option<Uuid>, actor: Option<Uuid>) -> Result<Vec<GameView>> {
        let Some((channel, actor)) = channel.zip(actor) else {
            return Ok(vec![]);
        };
        Ok(self
            .arenas
            .get(&channel)
            .map(|arena| GameView {
                channel,
                truco: arena.truco.view(Some(&actor.to_string())),
                chess: arena.chess.view(Some(&actor.to_string())),
                pool: arena.pool.state().clone(),
            })
            .into_iter()
            .collect())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_joins_cannot_exhaust_arenas_and_fractional_steps_are_preserved() {
        let actor = Uuid::new_v4();
        let mut service = GameService::default();
        for _ in 0..40 {
            assert!(
                service
                    .handle(
                        Uuid::new_v4(),
                        actor,
                        Uuid::new_v4(),
                        GameCommand::Join {
                            game: GameKind::Truco,
                            seat: Some(99)
                        },
                        0
                    )
                    .is_err()
            );
        }
        assert!(!service.has_games());
        let channel = Uuid::new_v4();
        let peer = Uuid::new_v4();
        let prepare = || {
            let mut service = GameService::default();
            for actor in [actor, peer] {
                service
                    .handle(
                        channel,
                        actor,
                        Uuid::new_v4(),
                        GameCommand::Join {
                            game: GameKind::Pool,
                            seat: None,
                        },
                        0,
                    )
                    .unwrap();
            }
            service
                .handle(
                    channel,
                    actor,
                    Uuid::new_v4(),
                    GameCommand::PoolShoot {
                        angle: 0.0,
                        power: 1.0,
                        revision: 2,
                    },
                    0,
                )
                .unwrap();
            service
        };
        let online = BTreeMap::from([(
            channel,
            BTreeSet::from([actor.to_string(), peer.to_string()]),
        )]);
        let (mut regular, mut irregular) = (prepare(), prepare());
        regular.advance(&online, 100).unwrap();
        for now in [7, 20, 53, 58, 100] {
            irregular.advance(&online, now).unwrap();
        }
        assert!(
            (regular.views(Some(channel), Some(actor)).unwrap()[0]
                .pool
                .clock
                - 12.0 * pool::STEP)
                .abs()
                < 1e-12
        );
        assert_eq!(
            serde_json::to_value(&regular.views(Some(channel), Some(actor)).unwrap()[0].pool)
                .unwrap(),
            serde_json::to_value(&irregular.views(Some(channel), Some(actor)).unwrap()[0].pool)
                .unwrap()
        );
        let mut stalled = prepare();
        stalled.advance(&online, 10_000).unwrap();
        assert_eq!(
            stalled.views(Some(channel), Some(actor)).unwrap()[0]
                .pool
                .revision,
            regular.views(Some(channel), Some(actor)).unwrap()[0]
                .pool
                .revision
        );
    }
}
