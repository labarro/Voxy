//! Fixed-step authoritative Rotação 7 rules and physics from src/shared/pool.ts.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
pub const HALF_X: f64 = 1.25;
pub const HALF_Z: f64 = 2.3;
pub const RADIUS: f64 = 0.09;
pub const POCKET: f64 = 0.21;
pub const STEP: f64 = 1.0 / 120.0;
pub const CONTACT: f64 = 0.65;
fn pockets() -> [(f64, f64); 6] {
    [
        (-HALF_X, -HALF_Z),
        (-HALF_X, 0.0),
        (-HALF_X, HALF_Z),
        (HALF_X, -HALF_Z),
        (HALF_X, 0.0),
        (HALF_X, HALF_Z),
    ]
}
fn distance(x: f64, z: f64) -> f64 {
    x.hypot(z)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ball {
    pub id: usize,
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub sunk: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Waiting,
    Aiming,
    Preparing,
    Rolling,
    Placing,
    Finished,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aim {
    pub actor: String,
    pub angle: f64,
    pub power: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shot {
    pub actor: String,
    pub angle: f64,
    pub power: f64,
    pub started: f64,
    pub sequence: u64,
    pub x: f64,
    pub z: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct State {
    pub players: Vec<String>,
    pub scores: [u8; 2],
    pub turn: usize,
    pub phase: Phase,
    pub clock: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aim: Option<Aim>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shot: Option<Shot>,
    pub balls: Vec<Ball>,
    pub revision: u64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner: Option<String>,
}
impl Default for State {
    fn default() -> Self {
        let mut balls = vec![Ball {
            id: 0,
            x: 0.0,
            z: 1.25,
            vx: 0.0,
            vz: 0.0,
            sunk: false,
        }];
        for i in 0..7 {
            let row = if i < 1 {
                0
            } else if i < 3 {
                1
            } else if i < 6 {
                2
            } else {
                3
            };
            let col = i - [0, 1, 3, 6][row];
            balls.push(Ball {
                id: i + 1,
                x: (col as f64 - row as f64 / 2.0) * 0.185,
                z: -1.0 - row as f64 * 0.165,
                vx: 0.0,
                vz: 0.0,
                sunk: false,
            });
        }
        Self {
            players: vec![],
            scores: [0, 0],
            turn: 0,
            phase: Phase::Waiting,
            clock: 0.0,
            aim: None,
            shot: None,
            balls,
            revision: 0,
            message: "Entre na mesa. Dois jogadores iniciam a partida.".into(),
            winner: None,
        }
    }
}
#[derive(Default)]
pub struct PoolGame {
    state: State,
    first: Option<usize>,
    target: usize,
    potted: Vec<usize>,
    steps: u32,
}
impl PoolGame {
    pub fn state(&self) -> &State {
        &self.state
    }
    pub fn aim(&mut self, id: &str, angle: f64, power: f64) -> Result<()> {
        ensure!(
            self.state.phase == Phase::Aiming
                && self
                    .state
                    .players
                    .get(self.state.turn)
                    .is_some_and(|p| p == id),
            "Aguarde sua vez para mirar."
        );
        ensure!(
            angle.is_finite() && power.is_finite() && (0.05..=1.0).contains(&power),
            "Mira inválida."
        );
        self.state.aim = Some(Aim {
            actor: id.into(),
            angle,
            power,
        });
        Ok(())
    }
    pub fn place(&mut self, id: &str, x: f64, z: f64, revision: u64) -> Result<()> {
        let s = &mut self.state;
        ensure!(
            s.phase == Phase::Placing
                && s.players.get(s.turn).is_some_and(|p| p == id)
                && revision == s.revision,
            "Aguarde a reposição da branca."
        );
        ensure!(
            (x + z).is_finite()
                && x.abs() <= HALF_X - RADIUS
                && z.abs() <= HALF_Z - RADIUS
                && !pockets()
                    .iter()
                    .any(|(px, pz)| distance(x - px, z - pz) < POCKET)
                && !s
                    .balls
                    .iter()
                    .any(|b| b.id != 0 && !b.sunk && distance(x - b.x, z - b.z) < RADIUS * 2.05),
            "Escolha um espaço livre no feltro."
        );
        s.balls[0] = Ball {
            id: 0,
            x,
            z,
            vx: 0.0,
            vz: 0.0,
            sunk: false,
        };
        s.phase = Phase::Aiming;
        s.revision += 1;
        s.message = "Branca posicionada. Mire no feltro e prepare sua tacada.".into();
        Ok(())
    }
    pub fn restart(&mut self, id: &str) -> Result<()> {
        ensure!(
            self.state.phase == Phase::Finished && self.state.players.iter().any(|p| p == id),
            "A partida ainda não terminou."
        );
        let players = self.state.players.clone();
        let revision = self.state.revision + 1;
        self.state = State::default();
        for player in players {
            self.join(&player)?;
        }
        self.state.revision = revision;
        Ok(())
    }
    pub fn join(&mut self, id: &str) -> Result<()> {
        ensure!(!id.is_empty() && id.len() <= 128, "Identidade inválida.");
        if self.state.phase == Phase::Finished && self.state.players.len() < 2 {
            let previous = self.state.players.clone();
            let revision = self.state.revision + 1;
            self.state = State::default();
            self.state.players = previous;
            self.state.revision = revision;
        }
        if self.state.players.iter().any(|p| p == id) {
            return Ok(());
        }
        ensure!(
            self.state.players.len() < 2,
            "A mesa já tem dois jogadores."
        );
        self.state.players.push(id.into());
        self.state.phase = if self.state.players.len() == 2 {
            Phase::Aiming
        } else {
            Phase::Waiting
        };
        self.state.message = if self.state.phase == Phase::Aiming {
            "Acerte primeiro a menor bola. Cada bola vale um ponto."
        } else {
            "Aguardando o segundo jogador."
        }
        .into();
        self.state.revision += 1;
        Ok(())
    }
    pub fn leave(&mut self, id: &str) {
        if !self.state.players.iter().any(|p| p == id) {
            return;
        }
        let remaining: Vec<_> = self
            .state
            .players
            .iter()
            .filter(|p| p.as_str() != id)
            .cloned()
            .collect();
        let revision = self.state.revision + 1;
        if self.state.players.len() == 2 && self.state.phase != Phase::Waiting {
            self.state.scores = [
                self.state.scores[self
                    .state
                    .players
                    .iter()
                    .position(|p| p == &remaining[0])
                    .unwrap()],
                0,
            ];
            self.state.players = remaining;
            self.state.phase = Phase::Finished;
            self.state.winner = self.state.players.first().cloned();
            self.state.revision = revision;
            self.state.message =
                "Vitória por abandono. Uma nova entrada inicia outra partida.".into();
            for b in &mut self.state.balls {
                b.vx = 0.0;
                b.vz = 0.0;
            }
            return;
        }
        self.state = State::default();
        self.state.revision = revision;
        self.state.players = remaining;
        self.state.message =
            "Jogador saiu. Aguardando um novo adversário; placar reiniciado.".into();
    }
    pub fn shoot(&mut self, id: &str, angle: f64, power: f64, revision: u64) -> Result<()> {
        let s = &mut self.state;
        ensure!(
            s.phase == Phase::Aiming
                && s.players.get(s.turn).is_some_and(|p| p == id)
                && revision == s.revision,
            "Aguarde sua vez e o estado atual da mesa."
        );
        ensure!(
            angle.is_finite() && power.is_finite() && (0.05..=1.0).contains(&power),
            "Tacada inválida."
        );
        self.first = None;
        self.potted.clear();
        self.steps = 0;
        self.target = s
            .balls
            .iter()
            .filter(|b| b.id != 0 && !b.sunk)
            .map(|b| b.id)
            .min()
            .unwrap_or(usize::MAX);
        s.aim = Some(Aim {
            actor: id.into(),
            angle,
            power,
        });
        s.shot = Some(Shot {
            actor: id.into(),
            angle,
            power,
            started: s.clock,
            sequence: s.revision + 1,
            x: s.balls[0].x,
            z: s.balls[0].z,
        });
        s.phase = Phase::Preparing;
        s.revision += 1;
        s.message = "Preparando a tacada…".into();
        Ok(())
    }
    pub fn step(&mut self) -> bool {
        self.state.clock += STEP;
        if self.state.phase == Phase::Preparing {
            let shot = self.state.shot.as_ref().unwrap();
            if self.state.clock - shot.started >= CONTACT {
                self.state.balls[0].vx = shot.angle.sin() * shot.power * 8.0;
                self.state.balls[0].vz = -shot.angle.cos() * shot.power * 8.0;
                self.state.phase = Phase::Rolling;
                self.state.message = "Bolas em movimento…".into();
            }
            self.state.revision += 1;
            return true;
        }
        if self.state.phase != Phase::Rolling {
            return false;
        }
        for b in &mut self.state.balls {
            if b.sunk {
                continue;
            }
            b.x += b.vx * STEP;
            b.z += b.vz * STEP;
            if pockets()
                .iter()
                .any(|(x, z)| distance(b.x - x, b.z - z) < POCKET)
            {
                b.sunk = true;
                b.vx = 0.0;
                b.vz = 0.0;
                self.potted.push(b.id);
                continue;
            }
            for (position, velocity, limit) in [
                (&mut b.x, &mut b.vx, HALF_X - RADIUS),
                (&mut b.z, &mut b.vz, HALF_Z - RADIUS),
            ] {
                if position.abs() > limit {
                    *position = position.signum() * limit;
                    *velocity *= -0.86;
                }
            }
            let speed = distance(b.vx, b.vz);
            let friction = (1.0 - (0.72 * STEP) / if speed == 0.0 { 1.0 } else { speed }).max(0.0);
            b.vx *= friction;
            b.vz *= friction;
            if speed < 0.025 {
                b.vx = 0.0;
                b.vz = 0.0;
            }
        }
        for i in 0..self.state.balls.len() {
            for j in i + 1..self.state.balls.len() {
                let (left, right) = self.state.balls.split_at_mut(j);
                let a = &mut left[i];
                let b = &mut right[0];
                if a.sunk || b.sunk {
                    continue;
                }
                let dx = b.x - a.x;
                let dz = b.z - a.z;
                let d = distance(dx, dz);
                if d >= RADIUS * 2.0 || d < 1e-8 {
                    continue;
                }
                let nx = dx / d;
                let nz = dz / d;
                let overlap = (RADIUS * 2.0 - d) / 2.0;
                a.x -= nx * overlap;
                a.z -= nz * overlap;
                b.x += nx * overlap;
                b.z += nz * overlap;
                let impulse = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
                if impulse <= 0.0 {
                    continue;
                }
                if a.id == 0 && self.first.is_none() {
                    self.first = Some(b.id);
                }
                a.vx -= impulse * nx * 0.98;
                a.vz -= impulse * nz * 0.98;
                b.vx += impulse * nx * 0.98;
                b.vz += impulse * nz * 0.98;
            }
        }
        self.steps += 1;
        if self.steps >= 2400
            || self
                .state
                .balls
                .iter()
                .all(|b| b.sunk || (b.vx == 0.0 && b.vz == 0.0))
        {
            self.finish_shot();
        }
        self.state.revision += 1;
        true
    }
    fn finish_shot(&mut self) {
        let foul = self.first != Some(self.target) || self.potted.contains(&0);
        for b in &mut self.state.balls {
            b.vx = 0.0;
            b.vz = 0.0;
        }
        if foul {
            for id in self.potted.clone() {
                self.respot(id);
            }
            self.state.message =
                "Falta: branca encaçapada ou primeiro contato incorreto. Vez do adversário.".into();
        } else {
            self.state.scores[self.state.turn] += self.potted.len() as u8;
            self.state.message = if !self.potted.is_empty() {
                "Bola encaçapada! Continue jogando."
            } else {
                "Nenhuma bola encaçapada. Troca de turno."
            }
            .into();
        }
        if foul || self.potted.is_empty() {
            self.state.turn = 1 - self.state.turn;
        }
        self.state.phase = if foul { Phase::Placing } else { Phase::Aiming };
        self.state.aim = None;
        if foul {
            self.state
                .message
                .push_str(" Reposicione a branca em um espaço livre.");
        }
        if self.state.balls[1..].iter().all(|b| b.sunk) {
            self.state.phase = Phase::Finished;
            self.state.winner = self
                .state
                .players
                .get(if self.state.scores[0] > self.state.scores[1] {
                    0
                } else {
                    1
                })
                .cloned();
            self.state.message = "Fim de partida. Vence quem fez mais pontos.".into();
        }
    }
    fn respot(&mut self, id: usize) {
        let mut z = 1.8;
        while z >= -1.8 {
            let mut x = -0.9;
            while x <= 0.9 {
                if self
                    .state
                    .balls
                    .iter()
                    .all(|b| b.id == id || b.sunk || distance(x - b.x, z - b.z) > 0.19)
                {
                    self.state.balls[id] = Ball {
                        id,
                        x,
                        z,
                        vx: 0.0,
                        vz: 0.0,
                        sunk: false,
                    };
                    return;
                }
                x += 0.22;
            }
            z -= 0.22;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    fn compare(actual: &Value, expected: &Value, path: &str) {
        match (actual, expected) {
            (Value::Number(a), Value::Number(b)) => {
                let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
                assert!((a - b).abs() <= 1e-7, "{path}: {a} != {b}");
            }
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len(), "{path}");
                for (i, (a, b)) in a.iter().zip(b).enumerate() {
                    compare(a, b, &format!("{path}[{i}]"));
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                assert_eq!(
                    a.keys().collect::<Vec<_>>(),
                    b.keys().collect::<Vec<_>>(),
                    "{path}"
                );
                for (key, a) in a {
                    compare(a, &b[key], &format!("{path}.{key}"));
                }
            }
            _ => assert_eq!(actual, expected, "{path}"),
        }
    }
    #[test]
    fn typescript_physics_and_rule_oracle_matches() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../../evidence/native-2.0/functional/pool-fixtures.json"
        ))
        .unwrap();
        for scenario in fixtures["scenarios"].as_array().unwrap() {
            let mut game = PoolGame::default();
            for (i, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
                let context = format!("{} step {i} {}", scenario["name"], step["op"]);
                let id = step["id"].as_str().unwrap_or("");
                let number = |key: &str| step[key].as_f64().unwrap();
                let revision = step["revision"].as_u64().unwrap_or(game.state.revision);
                let result: Result<Value> = match step["op"].as_str().unwrap() {
                    "join" => game.join(id).map(|_| Value::Null),
                    "leave" => {
                        game.leave(id);
                        Ok(Value::Null)
                    }
                    "aim" => game
                        .aim(id, number("angle"), number("power"))
                        .map(|_| Value::Null),
                    "shoot" => game
                        .shoot(id, number("angle"), number("power"), revision)
                        .map(|_| Value::Null),
                    "place" => game
                        .place(id, number("x"), number("z"), revision)
                        .map(|_| Value::Null),
                    "restart" => game.restart(id).map(|_| Value::Null),
                    "steps" => {
                        let mut last = false;
                        for _ in 0..step["count"].as_u64().unwrap() {
                            last = game.step();
                        }
                        Ok(Value::Bool(last))
                    }
                    "fixture" => {
                        let mut state = serde_json::to_value(&game.state).unwrap();
                        for (key, value) in step["patch"].as_object().unwrap() {
                            state[key] = value.clone();
                        }
                        game.state = serde_json::from_value(state).unwrap();
                        Ok(Value::Null)
                    }
                    _ => panic!("unknown operation"),
                };
                match result {
                    Ok(value) => {
                        assert!(
                            step["error"].is_null(),
                            "{context}: missing expected error {}",
                            step["error"]
                        );
                        assert_eq!(value, step["result"], "{context}");
                    }
                    Err(error) => assert_eq!(
                        error.to_string(),
                        step["error"].as_str().unwrap_or("NO ERROR"),
                        "{context}"
                    ),
                }
                compare(
                    &serde_json::to_value(game.state()).unwrap(),
                    &step["state"],
                    &context,
                );
            }
        }
    }
}
