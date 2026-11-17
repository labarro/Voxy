//! Paulista rules ported from src/shared/truco.ts. Only viewer-specific `view` is serializable.
use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize};

pub const RANKS: [&str; 10] = ["4", "5", "6", "7", "Q", "J", "K", "A", "2", "3"];
pub const SUITS: [&str; 4] = ["d", "s", "h", "c"];
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Rank {
    #[serde(rename = "4")]
    Four,
    #[serde(rename = "5")]
    Five,
    #[serde(rename = "6")]
    Six,
    #[serde(rename = "7")]
    Seven,
    Q,
    J,
    K,
    A,
    #[serde(rename = "2")]
    Two,
    #[serde(rename = "3")]
    Three,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Suit {
    D,
    S,
    H,
    C,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Card {
    pub rank: Rank,
    pub suit: Suit,
}
pub fn manilha(vira: Card) -> Rank {
    rank_from((vira.rank as usize + 1) % 10)
}
pub fn card_strength(card: Card, vira: Card) -> i32 {
    if card.rank == manilha(vira) {
        10 + card.suit as i32
    } else {
        card.rank as i32
    }
}
fn rank_from(i: usize) -> Rank {
    [
        Rank::Four,
        Rank::Five,
        Rank::Six,
        Rank::Seven,
        Rank::Q,
        Rank::J,
        Rank::K,
        Rank::A,
        Rank::Two,
        Rank::Three,
    ][i]
}
/// Outer None means unresolved; Some(None) means three tied tricks.
pub fn hand_winner(tricks: &[Option<usize>]) -> Option<Option<usize>> {
    if tricks.len() == 2 {
        let (a, b) = (tricks[0], tricks[1]);
        if a.is_some() && (b == a || b.is_none()) {
            return Some(a);
        }
        if a.is_none() && b.is_some() {
            return Some(b);
        }
    }
    if tricks.len() == 3 {
        let (a, b, c) = (tricks[0], tricks[1], tricks[2]);
        if a.is_none() && b.is_none() {
            return Some(c);
        }
        if c.is_none() {
            return Some(a.or(b));
        }
        return Some(c);
    }
    None
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Waiting,
    Dealing,
    Playing,
    Responding,
    Eleven,
    TrickResult,
    HandResult,
    Finished,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Play {
    pub seat: usize,
    pub card: Option<Card>,
    pub covered: bool,
    pub at: i64,
    pub sequence: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pending {
    pub team: usize,
    pub by: usize,
    pub requested: u8,
    pub previous: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Animation {
    #[serde(rename = "type")]
    pub kind: String,
    pub actor: usize,
    pub at: i64,
    pub sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<u8>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub kind: String,
    pub revision: u64,
    pub clock: i64,
    pub action_at: i64,
    pub phase: Phase,
    pub dealer: usize,
    pub mano: usize,
    pub turn: usize,
    pub hand_number: u32,
    pub trick: usize,
    pub value: u8,
    pub scores: [u16; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vira: Option<Card>,
    pub played: Vec<Vec<Play>>,
    pub trick_winners: Vec<Option<usize>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending: Option<Pending>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eleven: Option<usize>,
    pub eleven_votes: Vec<usize>,
    pub iron: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_raise_team: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner: Option<usize>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animation: Option<Animation>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            kind: "truco".into(),
            revision: 0,
            clock: 0,
            action_at: 0,
            phase: Phase::Waiting,
            dealer: 3,
            mano: 0,
            turn: 0,
            hand_number: 0,
            trick: 0,
            value: 1,
            scores: [0, 0],
            vira: None,
            played: vec![vec![]],
            trick_winners: vec![],
            pending: None,
            eleven: None,
            eleven_votes: vec![],
            iron: false,
            last_raise_team: None,
            winner: None,
            message: "Quatro assentos, duas duplas. Parceiros ficam frente a frente.".into(),
            animation: None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reconnecting {
    pub id: String,
    pub until: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    #[serde(flatten)]
    pub state: State,
    pub players: [Option<String>; 4],
    pub paused: bool,
    pub reconnecting: Vec<Reconnecting>,
    pub hand: Vec<Option<Card>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partner_hand: Option<Vec<Option<Card>>>,
    pub counts: [usize; 4],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Action {
    Play {
        index: usize,
        #[serde(default)]
        covered: bool,
    },
    Raise,
    Accept,
    Fold,
    Eleven {
        accept: bool,
    },
    Restart,
}

// No Serialize or Debug implementation: a host object contains all secret hands.
pub struct TrucoGame {
    players: [Option<String>; 4],
    missing: Vec<Reconnecting>,
    paused_at: Option<i64>,
    hands: [Vec<Card>; 4],
    state: State,
    until: i64,
    locked: bool,
    sequence: u64,
    resume_turn: usize,
    next_lead: usize,
    random_index: Box<dyn FnMut(usize) -> usize + Send>,
}
impl Default for TrucoGame {
    fn default() -> Self {
        use rand::Rng;
        Self::with_random(|max| rand::thread_rng().gen_range(0..max))
    }
}
impl TrucoGame {
    pub fn with_random(random: impl FnMut(usize) -> usize + Send + 'static) -> Self {
        Self {
            players: Default::default(),
            missing: vec![],
            paused_at: None,
            hands: Default::default(),
            state: State::default(),
            until: 0,
            locked: false,
            sequence: 0,
            resume_turn: 0,
            next_lead: 0,
            random_index: Box::new(random),
        }
    }
    pub fn phase(&self) -> Phase {
        self.state.phase
    }
    pub fn revision(&self) -> u64 {
        self.state.revision
    }
    pub fn has_players(&self) -> bool {
        self.players.iter().any(Option::is_some)
    }
    pub fn action_deadline(&self) -> i64 {
        self.state.action_at
    }
    fn index(&self, id: &str) -> Result<usize> {
        self.players
            .iter()
            .position(|p| p.as_deref() == Some(id))
            .ok_or_else(|| anyhow::anyhow!("Você não participa desta partida."))
    }
    fn full(&self) -> bool {
        self.players.iter().all(Option::is_some)
    }
    fn event(&mut self, kind: &str, actor: usize, value: Option<u8>) {
        self.sequence += 1;
        self.state.animation = Some(Animation {
            kind: kind.into(),
            actor,
            at: self.state.clock,
            sequence: self.sequence,
            value,
        });
    }
    pub fn join(&mut self, id: &str, now: i64, seat: Option<usize>) -> Result<()> {
        ensure!(!id.is_empty() && id.len() <= 128, "Identidade inválida.");
        ensure!(
            matches!(self.phase(), Phase::Waiting | Phase::Finished) || self.index(id).is_ok(),
            "Partida em andamento. Aguarde uma nova partida."
        );
        if self.index(id).is_err() {
            let seat = seat
                .or_else(|| self.players.iter().position(Option::is_none))
                .unwrap_or(4);
            ensure!(seat < 4 && self.players[seat].is_none(), "Assento ocupado.");
            self.players[seat] = Some(id.into());
        }
        self.state.clock = now;
        self.state.revision += 1;
        if self.full() && self.phase() == Phase::Waiting {
            self.deal(now)?;
        }
        Ok(())
    }
    pub fn leave(&mut self, id: &str) -> Result<()> {
        let seat = self.index(id)?;
        if !matches!(self.phase(), Phase::Waiting | Phase::Finished) {
            self.finish(1 - seat % 2, "Vitória por abandono da dupla adversária.");
        }
        self.players[seat] = None;
        self.missing.retain(|r| r.id != id);
        self.state.revision += 1;
        Ok(())
    }
    pub fn sync(&mut self, online: &std::collections::BTreeSet<String>, now: i64) -> Result<bool> {
        let was = self.paused_at;
        for id in self.players.iter().flatten() {
            if online.contains(id) {
                self.missing.retain(|r| r.id != *id);
            } else if !self.missing.iter().any(|r| r.id == *id) {
                self.missing.push(Reconnecting {
                    id: id.clone(),
                    until: now + 60_000,
                });
            }
        }
        let mut resumed = 0;
        if !self.missing.is_empty() {
            if self.paused_at.is_none() {
                self.paused_at = Some(now);
            }
        } else if let Some(paused) = self.paused_at.take() {
            resumed = now - paused;
        }
        if resumed != 0 {
            self.until += resumed;
            self.state.action_at += resumed;
            for play in self.state.played.iter_mut().flatten() {
                play.at += resumed;
            }
            if let Some(animation) = &mut self.state.animation {
                animation.at += resumed;
            }
            self.state.revision += 1;
        }
        if was != self.paused_at {
            self.state.revision += 1;
        }
        let expired: Vec<_> = self
            .missing
            .iter()
            .filter(|r| now >= r.until)
            .map(|r| r.id.clone())
            .collect();
        for id in expired {
            if self.index(&id).is_ok() {
                self.leave(&id)?;
            }
        }
        self.advance(now)
    }
    fn deal(&mut self, now: i64) -> Result<()> {
        let mut deck: Vec<Card> = (0..10)
            .flat_map(|rank| {
                [Suit::D, Suit::S, Suit::H, Suit::C].map(move |suit| Card {
                    rank: rank_from(rank),
                    suit,
                })
            })
            .collect();
        for i in (1..deck.len()).rev() {
            let j = (self.random_index)(i + 1);
            ensure!(j <= i, "Embaralhamento inválido.");
            deck.swap(i, j);
        }
        self.hands = Default::default();
        self.state.mano = (self.state.dealer + 1) % 4;
        self.state.turn = self.state.mano;
        for _ in 0..3 {
            for i in 0..4 {
                self.hands[(self.state.mano + i) % 4].push(deck.pop().unwrap());
            }
        }
        self.state.vira = deck.pop();
        self.locked = false;
        let s = &mut self.state;
        s.action_at = 0;
        s.hand_number += 1;
        s.trick = 0;
        s.played = vec![vec![]];
        s.trick_winners.clear();
        s.value = 1;
        s.pending = None;
        s.last_raise_team = None;
        s.eleven_votes.clear();
        s.iron = s.scores == [11, 11];
        s.eleven = if s.iron {
            None
        } else {
            s.scores.iter().position(|score| *score == 11)
        };
        s.clock = now;
        s.phase = Phase::Dealing;
        s.message = "Embaralhando e distribuindo as cartas.".into();
        self.until = now + 3400;
        let dealer = s.dealer;
        self.event("deal", dealer, None);
        self.state.revision += 1;
        Ok(())
    }
    pub fn advance(&mut self, now: i64) -> Result<bool> {
        self.state.clock = now;
        if self.paused_at.is_some() {
            return Ok(false);
        }
        if self.locked && now >= self.state.action_at {
            self.locked = false;
            self.state.revision += 1;
            return Ok(true);
        }
        if now < self.until {
            return Ok(false);
        }
        match self.phase() {
            Phase::Dealing => {
                let s = &mut self.state;
                s.phase = if s.eleven.is_some() {
                    Phase::Eleven
                } else {
                    Phase::Playing
                };
                if s.iron {
                    s.value = 3;
                }
                s.message = if s.iron {
                    "Mão de ferro: cartas no escuro, sem pedidos. Vale 3."
                } else if s.eleven.is_some() {
                    "Mão de onze: a dupla decide se joga por 3 ou corre por 1."
                } else {
                    "Jogue sua carta ou peça truco."
                }
                .into();
                s.revision += 1;
                Ok(true)
            }
            Phase::TrickResult => {
                let s = &mut self.state;
                s.trick += 1;
                s.played.push(vec![]);
                s.turn = self.next_lead;
                s.phase = Phase::Playing;
                s.message = "Nova vaza.".into();
                s.revision += 1;
                Ok(true)
            }
            Phase::HandResult => {
                self.state.dealer = (self.state.dealer + 1) % 4;
                self.deal(now)?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }
    pub fn act(&mut self, id: &str, action: Action, revision: u64, now: i64) -> Result<()> {
        let seat = self.index(id)?;
        self.state.clock = now;
        ensure!(
            self.paused_at.is_none(),
            "Aguardando a reconexão dos participantes."
        );
        ensure!(
            revision == self.state.revision,
            "A mesa mudou. Use o estado atual."
        );
        if matches!(action, Action::Restart) {
            ensure!(
                self.phase() == Phase::Finished && self.full(),
                "Reúna quatro participantes para reiniciar."
            );
            let revision = self.state.revision;
            self.state = State::default();
            self.state.revision = revision + 1;
            self.deal(now)?;
            return Ok(());
        }
        if let Action::Eleven { accept } = action {
            ensure!(
                self.phase() == Phase::Eleven && Some(seat % 2) == self.state.eleven,
                "Esta decisão pertence à dupla com onze."
            );
            if !accept {
                self.award(1 - self.state.eleven.unwrap(), 1, "A dupla de onze correu.");
                self.event("fold", seat, None);
                return Ok(());
            }
            ensure!(
                !self.state.eleven_votes.contains(&seat),
                "Sua decisão já foi registrada."
            );
            self.state.eleven_votes.push(seat);
            if self.state.eleven_votes.len() == 2 {
                self.state.value = 3;
                self.state.phase = Phase::Playing;
                self.state.message = "Mão de onze aceita: vale 3, sem aumentos.".into();
            }
            self.state.revision += 1;
            return Ok(());
        }
        if self.phase() == Phase::Responding {
            let pending = self.state.pending.clone().unwrap();
            ensure!(seat % 2 != pending.team, "A outra dupla precisa responder.");
            match action {
                Action::Fold => {
                    self.award(pending.team, pending.previous, "A dupla adversária correu.");
                    self.event("fold", seat, None);
                    return Ok(());
                }
                Action::Accept => {
                    let s = &mut self.state;
                    s.value = pending.requested;
                    s.pending = None;
                    s.phase = Phase::Playing;
                    s.turn = self.resume_turn;
                    s.message = "Pedido aceito. Continue a vaza.".into();
                    self.event("accept", seat, Some(pending.requested));
                    self.state.revision += 1;
                    return Ok(());
                }
                Action::Raise => {
                    let next = next_value(pending.requested)
                        .ok_or_else(|| anyhow::anyhow!("Doze é o limite."))?;
                    self.state.value = pending.requested;
                    self.state.pending = Some(Pending {
                        team: seat % 2,
                        by: seat,
                        previous: self.state.value,
                        requested: next,
                    });
                    self.state.last_raise_team = Some(seat % 2);
                    self.state.message = format!("Pedido de {next}! A outra dupla responde.");
                    self.event("raise", seat, Some(next));
                    self.state.revision += 1;
                    return Ok(());
                }
                _ => bail!("Responda ao pedido antes de jogar."),
            }
        }
        ensure!(
            now >= self.state.action_at,
            "Aguarde a carta chegar à mesa."
        );
        ensure!(
            self.phase() == Phase::Playing && self.state.turn == seat,
            "Aguarde sua vez e a animação da mesa."
        );
        if matches!(action, Action::Raise) {
            ensure!(
                self.state.eleven.is_none() && !self.state.iron,
                "Não há pedidos na mão especial."
            );
            ensure!(
                self.state.last_raise_team != Some(seat % 2),
                "A outra dupla deve fazer o próximo aumento."
            );
            let next =
                next_value(self.state.value).ok_or_else(|| anyhow::anyhow!("Doze é o limite."))?;
            self.resume_turn = self.state.turn;
            self.state.pending = Some(Pending {
                team: seat % 2,
                by: seat,
                previous: self.state.value,
                requested: next,
            });
            self.state.last_raise_team = Some(seat % 2);
            self.state.phase = Phase::Responding;
            self.state.message = if next == 3 {
                "Truco!".into()
            } else {
                format!("{next}!")
            };
            self.event("raise", seat, Some(next));
            self.state.revision += 1;
            return Ok(());
        }
        let Action::Play { index, covered } = action else {
            bail!("Ação indisponível nesta fase.");
        };
        ensure!(index < self.hands[seat].len(), "Carta inválida.");
        ensure!(
            !covered || (self.state.trick != 0 && !self.state.iron),
            "Carta coberta somente a partir da segunda vaza, fora da mão de ferro."
        );
        let card = self.hands[seat].remove(index);
        self.sequence += 1;
        self.state.played[self.state.trick].push(Play {
            seat,
            card: if covered { None } else { Some(card) },
            covered,
            at: now,
            sequence: self.sequence,
        });
        self.event("play", seat, None);
        self.state.action_at = now + 550;
        self.locked = true;
        self.state.turn = (seat + 1) % 4;
        self.state.message = "Carta na mesa.".into();
        if self.state.played[self.state.trick].len() == 4 {
            self.resolve_trick(now);
        }
        self.state.revision += 1;
        Ok(())
    }
    fn resolve_trick(&mut self, now: i64) {
        let plays = &self.state.played[self.state.trick];
        let vira = self.state.vira.unwrap();
        let max = plays
            .iter()
            .map(|p| p.card.map(|c| card_strength(c, vira)).unwrap_or(-1))
            .max()
            .unwrap();
        let winners: Vec<_> = plays
            .iter()
            .filter(|p| p.card.map(|c| card_strength(c, vira)).unwrap_or(-1) == max)
            .collect();
        let team = if max < 0 || winners.iter().any(|p| p.seat % 2 != winners[0].seat % 2) {
            None
        } else {
            Some(winners[0].seat % 2)
        };
        self.next_lead = if team.is_none() {
            if self.state.trick == 0 {
                self.state.mano
            } else {
                self.next_lead
            }
        } else {
            winners[0].seat
        };
        self.state.trick_winners.push(team);
        match hand_winner(&self.state.trick_winners) {
            Some(Some(result)) => self.award(result, self.state.value, "Mão vencida."),
            Some(None) => {
                self.state.phase = Phase::HandResult;
                self.state.message = "Três empates: ninguém pontua. Nova mão.".into();
                self.until = now + 2500;
            }
            None => {
                self.state.phase = Phase::TrickResult;
                self.state.message = team
                    .map(|t| format!("Vaza da dupla {}.", t + 1))
                    .unwrap_or_else(|| "Vaza empatada.".into());
                self.until = now + 1600;
            }
        }
    }
    fn award(&mut self, team: usize, value: u8, message: &str) {
        self.state.scores[team] += value as u16;
        self.state.pending = None;
        self.state.message = format!("{message} Dupla {}: +{value}.", team + 1);
        self.state.phase = Phase::HandResult;
        self.until = self.state.clock + 2800;
        self.event("win", team, None);
        self.state.revision += 1;
        if self.state.scores[team] >= 12 {
            self.finish(
                team,
                &format!("Partida encerrada. Dupla vencedora: {}.", team + 1),
            );
        }
    }
    fn finish(&mut self, team: usize, message: &str) {
        self.state.phase = Phase::Finished;
        self.state.winner = Some(team);
        self.state.pending = None;
        self.state.message = message.into();
        self.event("win", team, None);
        self.state.revision += 1;
    }
    pub fn view(&self, viewer: Option<&str>) -> View {
        let index = viewer.and_then(|v| self.index(v).ok());
        let visible = index.is_some() && !self.state.iron;
        let hand = index
            .map(|i| {
                self.hands[i]
                    .iter()
                    .map(|c| if visible { Some(*c) } else { None })
                    .collect()
            })
            .unwrap_or_default();
        let partner_hand = index
            .filter(|i| self.state.eleven == Some(i % 2) && !self.state.iron)
            .map(|i| self.hands[(i + 2) % 4].iter().copied().map(Some).collect());
        let mut state = self.state.clone();
        state.clock = self.paused_at.unwrap_or(state.clock);
        View {
            state,
            players: self.players.clone(),
            paused: self.paused_at.is_some(),
            reconnecting: self.missing.clone(),
            hand,
            partner_hand,
            counts: std::array::from_fn(|i| self.hands[i].len()),
        }
    }
}
fn next_value(value: u8) -> Option<u8> {
    match value {
        1 => Some(3),
        3 => Some(6),
        6 => Some(9),
        9 => Some(12),
        _ => None,
    }
}
