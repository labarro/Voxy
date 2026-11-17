//! Authoritative chess.js wrapper parity using cozy-chess 0.3.4 (MIT) for legal moves.
//! cozy-chess caps its halfmove clock at 100: Voxy keeps an independent clock for the
//! existing claim-at-100 / automatic-at-150 policy, never its automatic draw status.
use crate::truco::Reconnecting;
use anyhow::{Result, bail, ensure};
use cozy_chess::{Board, Color, Move, Piece, util};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveInput {
    pub from: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promotion: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Action {
    Move {
        from: String,
        to: String,
        #[serde(default)]
        promotion: Option<String>,
    },
    Resign,
    Offer,
    Accept,
    Decline,
    Claim {
        #[serde(default)]
        r#move: Option<MoveInput>,
    },
    Restart,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Waiting,
    Playing,
    Finished,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastMove {
    pub actor: usize,
    pub at: i64,
    pub sequence: u64,
    pub before: String,
    pub after: String,
    pub from: String,
    pub to: String,
    pub piece: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promotion: Option<String>,
    pub flags: String,
    pub san: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub kind: String,
    pub revision: u64,
    pub clock: i64,
    pub action_at: i64,
    pub players: [Option<String>; 2],
    pub paused: bool,
    pub reconnecting: Vec<Reconnecting>,
    pub phase: Phase,
    pub fen: String,
    pub turn: usize,
    pub check: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner: Option<usize>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offer: Option<usize>,
    pub claim: bool,
    pub claim_moves: Vec<MoveInput>,
    pub moves: Vec<MoveInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last: Option<LastMove>,
}
pub struct ChessGame {
    board: Board,
    halfmoves: u32,
    fullmoves: u32,
    positions: BTreeMap<String, u32>,
    players: [Option<String>; 2],
    missing: Vec<Reconnecting>,
    paused_at: Option<i64>,
    last: Option<LastMove>,
    locked: bool,
    revision: u64,
    clock: i64,
    action_at: i64,
    phase: Phase,
    winner: Option<usize>,
    message: String,
    offer: Option<usize>,
}
impl Default for ChessGame {
    fn default() -> Self {
        Self::new(None).expect("valid start position")
    }
}
impl ChessGame {
    pub fn new(fen: Option<&str>) -> Result<Self> {
        let mut board = Board::default();
        let (mut halfmoves, mut fullmoves) = (0, 1);
        if let Some(fen) = fen {
            let mut fields: Vec<String> = fen.split_whitespace().map(str::to_string).collect();
            ensure!(fields.len() == 6, "FEN inválido");
            halfmoves = fields[4].parse()?;
            fullmoves = fields[5].parse()?;
            fields[4] = halfmoves.min(100).to_string();
            fields[5] = fullmoves.min(u16::MAX as u32).to_string();
            board = fields
                .join(" ")
                .parse()
                .map_err(|e| anyhow::anyhow!("FEN inválido: {e}"))?;
        }
        let mut game = Self {
            board,
            halfmoves,
            fullmoves,
            positions: Default::default(),
            players: Default::default(),
            missing: vec![],
            paused_at: None,
            last: None,
            locked: false,
            revision: 0,
            clock: 0,
            action_at: 0,
            phase: Phase::Waiting,
            winner: None,
            message: "Dois lugares. As brancas começam.".into(),
            offer: None,
        };
        game.record();
        Ok(game)
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn has_players(&self) -> bool {
        self.players.iter().any(Option::is_some)
    }
    pub fn action_deadline(&self) -> i64 {
        self.action_at
    }
    pub fn phase(&self) -> Phase {
        self.phase
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
    fn turn(&self) -> usize {
        if self.board.side_to_move() == Color::White {
            0
        } else {
            1
        }
    }
    fn legal(board: &Board) -> Vec<Move> {
        let mut moves = vec![];
        board.generate_moves(|batch| {
            moves.extend(batch);
            false
        });
        moves
    }
    fn fen_of(board: &Board, halfmoves: u32, fullmoves: u32) -> String {
        let mut fields: Vec<String> = board
            .to_string()
            .split_whitespace()
            .map(str::to_string)
            .collect();
        // chess.js emits the EP target only when an actual legal EP capture exists.
        if !Self::legal(board).iter().any(|m| {
            board.piece_on(m.from) == Some(Piece::Pawn)
                && m.from.file() != m.to.file()
                && board.piece_on(m.to).is_none()
        }) {
            fields[3] = "-".into();
        }
        fields[4] = halfmoves.to_string();
        fields[5] = fullmoves.to_string();
        fields.join(" ")
    }
    fn fen(&self) -> String {
        Self::fen_of(&self.board, self.halfmoves, self.fullmoves)
    }
    fn key(fen: &str) -> String {
        fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
    }
    fn record(&mut self) {
        *self.positions.entry(Self::key(&self.fen())).or_default() += 1;
    }
    pub fn join(&mut self, id: &str, now: i64, seat: Option<usize>) -> Result<()> {
        ensure!(!id.is_empty() && id.len() <= 128, "Identidade inválida.");
        ensure!(
            self.phase != Phase::Playing || self.index(id).is_ok(),
            "Partida em andamento."
        );
        if self.index(id).is_err() {
            let seat = seat
                .or_else(|| self.players.iter().position(Option::is_none))
                .unwrap_or(2);
            ensure!(seat < 2 && self.players[seat].is_none(), "Assento ocupado.");
            self.players[seat] = Some(id.into());
        }
        self.clock = now;
        if self.phase == Phase::Waiting && self.full() {
            self.phase = Phase::Playing;
            self.message = "Brancas jogam.".into();
        }
        self.revision += 1;
        Ok(())
    }
    pub fn leave(&mut self, id: &str) -> Result<()> {
        let seat = self.index(id)?;
        if self.phase == Phase::Playing {
            self.finish(Some(1 - seat), "Vitória por abandono.");
        }
        self.players[seat] = None;
        self.missing.retain(|r| r.id != id);
        self.revision += 1;
        Ok(())
    }
    pub fn sync(&mut self, online: &BTreeSet<String>, now: i64) -> Result<()> {
        let old = self.paused_at;
        for id in self.players.iter().flatten() {
            if online.contains(id) {
                self.missing.retain(|r| r.id != *id);
            } else if !self.missing.iter().any(|r| r.id == *id) {
                self.missing.push(Reconnecting {
                    id: id.clone(),
                    until: now + 60000,
                });
            }
        }
        let mut resumed = 0;
        if !self.missing.is_empty() {
            if self.paused_at.is_none() {
                self.paused_at = Some(now);
            }
        } else if let Some(old) = self.paused_at.take() {
            resumed = now - old;
        }
        self.clock = now;
        if resumed != 0 {
            self.action_at += resumed;
            if let Some(last) = &mut self.last {
                last.at += resumed;
            }
        }
        if old != self.paused_at {
            self.revision += 1;
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
        if self.paused_at.is_none() && self.locked && now >= self.action_at {
            self.locked = false;
            self.revision += 1;
        }
        Ok(())
    }
    fn finish(&mut self, winner: Option<usize>, message: &str) {
        self.phase = Phase::Finished;
        self.winner = winner;
        self.message = message.into();
        self.offer = None;
        self.revision += 1;
    }
    fn claims(&self) -> bool {
        self.positions
            .get(&Self::key(&self.fen()))
            .copied()
            .unwrap_or(0)
            >= 3
            || self.halfmoves >= 100
    }
    fn parse_move(&self, input: &MoveInput) -> Result<Move> {
        let promotion = input.promotion.as_deref().unwrap_or("");
        ensure!(
            promotion.is_empty() || ["q", "r", "b", "n"].contains(&promotion),
            "Movimento ilegal. Confira a peça, o destino e a promoção."
        );
        let mv = util::parse_uci_move(
            &self.board,
            &format!("{}{}{promotion}", input.from, input.to),
        )
        .map_err(|_| {
            anyhow::anyhow!("Movimento ilegal. Confira a peça, o destino e a promoção.")
        })?;
        ensure!(
            self.board.is_legal(mv),
            "Movimento ilegal. Confira a peça, o destino e a promoção."
        );
        Ok(mv)
    }
    fn capture(&self, mv: Move) -> Option<Piece> {
        let piece = self.board.piece_on(mv.from)?;
        if self.board.color_on(mv.to) == Some(!self.board.side_to_move()) {
            return self.board.piece_on(mv.to);
        }
        if piece == Piece::Pawn && mv.from.file() != mv.to.file() {
            return Some(Piece::Pawn);
        }
        None
    }
    fn candidate(&self, mv: Move) -> (Board, u32, u32) {
        let half =
            if self.board.piece_on(mv.from) == Some(Piece::Pawn) || self.capture(mv).is_some() {
                0
            } else {
                self.halfmoves + 1
            };
        let full = self.fullmoves + u32::from(self.board.side_to_move() == Color::Black);
        let mut board = self.board.clone();
        board.play(mv);
        (board, half, full)
    }
    fn candidate_claim(&self, mv: Move) -> bool {
        let (board, half, full) = self.candidate(mv);
        half >= 100
            || self
                .positions
                .get(&Self::key(&Self::fen_of(&board, half, full)))
                .copied()
                .unwrap_or(0)
                + 1
                >= 3
    }
    fn insufficient(&self) -> bool {
        let all = self.board.occupied().len();
        let bishops = self.board.pieces(Piece::Bishop);
        let knights = self.board.pieces(Piece::Knight).len();
        if all == 2 || (all == 3 && (bishops.len() == 1 || knights == 1)) {
            return true;
        }
        if all == bishops.len() + 2 {
            let mut colors = bishops
                .iter()
                .map(|s| (s.file() as usize + s.rank() as usize) % 2);
            if let Some(first) = colors.next() {
                return colors.all(|c| c == first);
            }
        }
        false
    }
    pub fn act(&mut self, id: &str, action: Action, revision: u64, now: i64) -> Result<()> {
        let seat = self.index(id)?;
        self.clock = now;
        ensure!(
            revision == self.revision,
            "O tabuleiro mudou. Use o estado atual."
        );
        ensure!(self.paused_at.is_none(), "Aguardando reconexão.");
        if matches!(action, Action::Restart) {
            ensure!(
                self.phase == Phase::Finished && self.full(),
                "Reúna dois jogadores para reiniciar."
            );
            self.board = Board::default();
            self.halfmoves = 0;
            self.fullmoves = 1;
            self.positions.clear();
            self.record();
            self.last = None;
            self.winner = None;
            self.offer = None;
            self.action_at = 0;
            self.locked = false;
            self.phase = Phase::Playing;
            self.message = "Nova partida. Brancas jogam.".into();
            self.revision += 1;
            return Ok(());
        }
        ensure!(self.phase == Phase::Playing, "Não há partida em andamento.");
        if matches!(action, Action::Resign) {
            self.finish(Some(1 - seat), "Vitória por desistência.");
            return Ok(());
        }
        if matches!(action, Action::Accept | Action::Decline) {
            ensure!(
                self.offer.is_some() && self.offer != Some(seat),
                "Não há proposta adversária."
            );
            if matches!(action, Action::Accept) {
                self.finish(None, "Empate por acordo.");
            } else {
                self.offer = None;
                self.revision += 1;
            }
            return Ok(());
        }
        if matches!(action, Action::Offer) {
            ensure!(
                self.last.as_ref().map(|m| m.actor) == Some(seat)
                    && self.turn() != seat
                    && self.offer.is_none(),
                "Ofereça empate após o seu lance."
            );
            self.offer = Some(seat);
            self.revision += 1;
            return Ok(());
        }
        ensure!(self.turn() == seat, "Aguarde sua vez.");
        ensure!(now >= self.action_at, "Aguarde a peça chegar ao destino.");
        if let Action::Claim { r#move } = action {
            let valid = if let Some(input) = r#move {
                let mv = self.parse_move(&input)?;
                self.candidate_claim(mv)
            } else {
                self.claims()
            };
            ensure!(valid, "Ainda não há repetição tripla ou cinquenta lances.");
            self.finish(
                None,
                "Empate reivindicado por repetição tripla ou cinquenta lances.",
            );
            return Ok(());
        }
        let Action::Move {
            from,
            to,
            promotion,
        } = action
        else {
            bail!("Ação indisponível.");
        };
        let input = MoveInput {
            from,
            to,
            promotion,
        };
        let mv = self.parse_move(&input)?;
        let piece = self.board.piece_on(mv.from).unwrap();
        let capture = self.capture(mv);
        let castle =
            piece == Piece::King && self.board.color_on(mv.to) == Some(self.board.side_to_move());
        let ep = piece == Piece::Pawn
            && mv.from.file() != mv.to.file()
            && self.board.piece_on(mv.to).is_none();
        let mut flags = if castle {
            if mv.to.file() > mv.from.file() {
                "k"
            } else {
                "q"
            }
        } else if ep {
            "e"
        } else if capture.is_some() {
            "c"
        } else if piece == Piece::Pawn && (mv.to.rank() as i32 - mv.from.rank() as i32).abs() == 2 {
            "b"
        } else {
            "n"
        }
        .to_string();
        if mv.promotion.is_some() {
            flags.push('p');
        }
        let san = util::display_san_move(&self.board, mv).to_string();
        let before = self.fen();
        let (board, half, full) = self.candidate(mv);
        let after = Self::fen_of(&board, half, full);
        let sequence = self.last.as_ref().map(|m| m.sequence).unwrap_or(0) + 1;
        self.last = Some(LastMove {
            actor: seat,
            at: now,
            sequence,
            before,
            after,
            from: input.from,
            to: input.to,
            piece: piece.to_string(),
            color: if self.turn() == 0 { "w" } else { "b" }.into(),
            captured: capture.map(|p| p.to_string()),
            promotion: input.promotion,
            flags,
            san,
        });
        self.board = board;
        self.halfmoves = half;
        self.fullmoves = full;
        self.action_at = now + 850;
        self.locked = true;
        self.offer = None;
        self.record();
        self.revision += 1;
        let no_moves = Self::legal(&self.board).is_empty();
        let check = !self.board.checkers().is_empty();
        if no_moves && check {
            self.finish(Some(seat), "Xeque-mate.");
        } else if no_moves {
            self.finish(None, "Empate por afogamento.");
        } else if self.insufficient() {
            self.finish(None, "Empate por material insuficiente.");
        } else if self
            .positions
            .get(&Self::key(&self.fen()))
            .copied()
            .unwrap_or(0)
            >= 5
        {
            self.finish(None, "Empate automático por cinco repetições.");
        } else if self.halfmoves >= 150 {
            self.finish(None, "Empate automático por setenta e cinco lances.");
        } else {
            self.message = if check {
                "Xeque."
            } else if self.turn() == 0 {
                "Brancas jogam."
            } else {
                "Pretas jogam."
            }
            .into();
        }
        Ok(())
    }
    fn input(&self, mv: Move) -> MoveInput {
        let uci = util::display_uci_move(&self.board, mv).to_string();
        MoveInput {
            from: uci[..2].into(),
            to: uci[2..4].into(),
            promotion: mv.promotion.map(|p| p.to_string()),
        }
    }
    pub fn view(&self, viewer: Option<&str>) -> View {
        let own = viewer.and_then(|v| self.index(v).ok());
        let can = own == Some(self.turn()) && self.phase == Phase::Playing;
        let legal = if can {
            Self::legal(&self.board)
        } else {
            vec![]
        };
        let moves = legal.iter().map(|m| self.input(*m)).collect();
        let claim_moves = legal
            .iter()
            .filter(|m| self.candidate_claim(**m))
            .map(|m| self.input(*m))
            .collect();
        View {
            kind: "chess".into(),
            revision: self.revision,
            clock: self.paused_at.unwrap_or(self.clock),
            action_at: self.action_at,
            players: self.players.clone(),
            paused: self.paused_at.is_some(),
            reconnecting: self.missing.clone(),
            phase: self.phase,
            fen: self.fen(),
            turn: self.turn(),
            check: !self.board.checkers().is_empty(),
            winner: self.winner,
            message: self.message.clone(),
            offer: self.offer,
            claim: can && self.claims(),
            claim_moves,
            moves,
            last: self.last.clone(),
        }
    }
}
