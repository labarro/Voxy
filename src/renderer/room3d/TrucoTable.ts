import * as T from "three";
import { GAME_TABLES, tableSeat } from "../../shared/gameTables";
import { type TrucoView, manilha } from "../../shared/truco";
import { Resources } from "./resources";
import { CardDeck } from "./CardDeck";
export class TrucoTable {
  private r = new Resources();
  readonly group = new T.Group();
  private cards = new T.Group();
  private deck: CardDeck;
  private signature = "";
  private badge: T.Sprite;
  private board: T.Sprite;
  private boardCanvas = document.createElement("canvas");
  private boardTexture: T.CanvasTexture;
  private handCards: T.Mesh[] = [];
  private played: {
    mesh: T.Mesh;
    seat: number;
    trick: number;
    order: number;
    at: number;
  }[] = [];
  private fans: { group: T.Group; seat: number }[] = [];
  constructor(scene: T.Scene) {
    const r = this.r,
      t = GAME_TABLES.truco;
    this.group.position.set(t.x, 0, t.z);
    scene.add(this.group);
    r.box(this.group, 0, 0.73, 0, 1.64, 0.13, 1.64, "#51392c", 0.1);
    r.box(this.group, 0, 0.803, 0, 1.43, 0.018, 1.43, "#24605e", 0.07);
    for (const x of [-0.61, 0.61])
      for (const z of [-0.61, 0.61]) {
        r.box(this.group, x, 0.34, z, 0.085, 0.68, 0.085, "#352b25", 0.025);
        r.box(this.group, x, 0.1, z, 0.09, 0.09, 0.09, "#b39964", 0.01);
      }
    r.box(this.group, 0, 0.39, 0, 1.23, 0.07, 0.07, "#51392c");
    r.box(this.group, 0, 0.39, 0, 0.07, 0.07, 1.23, "#51392c");
    this.deck = new CardDeck(r);
    this.group.add(this.cards);
    for (let i = 0; i < 8; i++) {
      const card = this.deck.mesh();
      card.rotation.x = -Math.PI / 2;
      card.position.set(0.47, 0.824 + i * 0.003, -0.4);
      this.group.add(card);
    }
    this.badge = r.label("TRUCO!", "#f9d588", 512, 112);
    this.badge.position.set(0, 1.7, 0);
    this.badge.visible = false;
    this.group.add(this.badge);
    this.boardCanvas.width = 512;
    this.boardCanvas.height = 160;
    this.boardTexture = r.keep(new T.CanvasTexture(this.boardCanvas));
    this.boardTexture.colorSpace = T.SRGBColorSpace;
    r.box(this.group, 0, 0.9, -0.64, 0.025, 0.18, 0.025, "#b39964", 0);
    this.board = new T.Sprite(
      r.keep(
        new T.SpriteMaterial({ map: this.boardTexture, depthWrite: false }),
      ),
    );
    this.board.position.set(0, 1.04, -0.64);
    this.board.scale.set(0.7, 0.22, 1);
    this.group.add(this.board);
  }
  private rebuild(s: TrucoView, self: string) {
    this.cards.clear();
    this.handCards = [];
    this.played = [];
    this.fans = [];
    const own = s.players.indexOf(self);
    for (let seat = 0; seat < 4; seat++) {
      if (!s.players[seat]) continue;
      const fan = new T.Group();
      fan.userData.seat = seat;
      this.cards.add(fan);
      this.fans.push({ group: fan, seat });
      const visible =
        seat === own
          ? s.hand
          : own >= 0 && seat === (own + 2) % 4
            ? s.partnerHand
            : undefined;
      for (let i = 0; i < s.counts[seat]; i++) {
        const card = this.deck.mesh(visible?.[i]);
        card.position.set(
          (i - (s.counts[seat] - 1) / 2) * 0.13,
          0.025 * Math.abs(i - 1),
          0.006 * i,
        );
        card.rotation.z = (i - (s.counts[seat] - 1) / 2) * -0.13;
        fan.add(card);
        if (seat === own) {
          card.userData.cardIndex = i;
          this.handCards.push(card);
        }
      }
    }
    if (s.vira) {
      const vira = this.deck.mesh(s.vira);
      vira.rotation.x = -Math.PI / 2;
      vira.position.set(0.4, 0.826, -0.02);
      this.cards.add(vira);
    }
    s.played.forEach((trick, trickIndex) =>
      trick.forEach((play, order) => {
        const card = this.deck.mesh(play.card);
        card.userData.playSequence = play.sequence;
        this.cards.add(card);
        this.played.push({
          mesh: card,
          seat: play.seat,
          trick: trickIndex,
          order,
          at: play.at,
        });
      }),
    );
    const c = this.boardCanvas.getContext("2d")!;
    c.clearRect(0, 0, 512, 160);
    c.fillStyle = "#172c30";
    c.beginPath();
    c.roundRect(0, 0, 512, 160, 18);
    c.fill();
    c.textAlign = "center";
    c.fillStyle = "#edddb2";
    c.font = "600 26px system-ui";
    c.fillText(`Dupla 1   ${s.scores[0]} : ${s.scores[1]}   Dupla 2`, 256, 43);
    c.font = "22px system-ui";
    c.fillText(
      s.vira
        ? `Manilhas: ${manilha(s.vira)} · Mão vale ${s.value}`
        : "Truco Paulista · quatro lugares",
      256,
      85,
    );
    c.fillStyle = "#c0dbd7";
    c.font = "20px system-ui";
    c.fillText(
      s.paused
        ? "Aguardando reconexão"
        : s.phase === "waiting"
          ? `${s.players.filter(Boolean).length}/4 participantes`
          : `Vaza ${s.trick + 1} · Assento ${s.turn + 1}`,
      256,
      127,
    );
    this.boardTexture.needsUpdate = true;
  }
  update(
    s: TrucoView | undefined,
    self: string,
    clock: number,
    hand: (seat: number, index: number) => T.Vector3 | undefined,
  ) {
    if (!s) return;
    const signature = JSON.stringify([s.revision, s.hand, s.partnerHand]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(s, self);
    }
    const t = GAME_TABLES.truco;
    for (const fan of this.fans) {
      const seat = tableSeat("truco", fan.seat),
        anchor = hand(fan.seat, 0) ?? new T.Vector3(seat.x, 1, seat.z);
      fan.group.position.copy(anchor).sub(this.group.position);
      fan.group.rotation.set(-0.4, seat.yaw + Math.PI, 0, "YXZ");
      if (s.partnerHand && fan.seat === (s.players.indexOf(self) + 2) % 4)
        fan.group.rotation.set(-Math.PI / 2, 0, 0);
      if (s.phase === "dealing" && s.animation) {
        const age = (clock - s.animation.at) / 1000;
        fan.group.updateWorldMatrix(true, false);
        for (let i = 0; i < fan.group.children.length; i++) {
          const card = fan.group.children[i],
            progress = T.MathUtils.clamp(
              (age - 0.4 - (((fan.seat - s.mano + 4) % 4) + i * 4) * 0.22) /
                0.32,
              0,
              1,
            );
          const source = fan.group.worldToLocal(
              hand(s.dealer, 1) ?? new T.Vector3(t.x + 0.47, 0.85, t.z - 0.4),
            ),
            target = new T.Vector3(
              (i - (s.counts[fan.seat] - 1) / 2) * 0.13,
              0.025 * Math.abs(i - 1),
              0.006 * i,
            );
          card.visible = progress > 0;
          card.position.lerpVectors(source, target, progress);
          card.position.y += Math.sin(progress * Math.PI) * 0.14;
        }
      }
    }
    for (const play of this.played) {
      const progress = T.MathUtils.clamp((clock - play.at) / 550, 0, 1),
        end = new T.Vector3(
          (play.seat - 1.5) * 0.255,
          0.83 + play.trick * 0.004,
          (play.trick - 1) * 0.34,
        ),
        anchor = hand(play.seat, 1) ?? new T.Vector3(t.x, 1.02, t.z);
      const start = anchor.clone().sub(this.group.position);
      play.mesh.position.lerpVectors(start, end, progress);
      play.mesh.position.y += Math.sin(progress * Math.PI) * 0.18;
      play.mesh.rotation.set(
        T.MathUtils.lerp(-0.4, -Math.PI / 2, progress),
        0,
        (play.seat - 1.5) * 0.06 * progress,
      );
    }
    const a = s.animation,
      age = a ? (clock - a.at) / 1000 : 10;
    this.badge.visible = !!a && a.type === "raise" && age < 2;
    this.badge.scale.setScalar(
      1 + Math.sin(Math.min(1, age / 0.2) * Math.PI) * 0.08,
    );
    if (a?.type === "raise" && this.badge.userData.value !== a.value) {
      this.badge.material.dispose();
      this.badge.removeFromParent();
      this.badge = this.r.label(
        a.value === 3 ? "TRUCO!" : `${a.value}!`,
        "#f9d588",
        512,
        112,
      );
      this.badge.userData.value = a.value;
      this.badge.position.set(0, 1.7, 0);
      this.group.add(this.badge);
    }
  }
  pick(ray: T.Raycaster) {
    return ray.intersectObjects(this.handCards, false)[0]?.object.userData
      .cardIndex as number | undefined;
  }
  dispose() {
    this.r.dispose();
    this.group.removeFromParent();
  }
}
