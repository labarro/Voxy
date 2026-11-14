import * as T from "three";
import { Resources } from "./resources";
import { chessPiece } from "./ChessPieces";
import { GAME_TABLES } from "../../shared/gameTables";
import {
  chessSquare,
  chessTravel,
  CHESS_SQUARE,
} from "../../shared/chessMotion";
import type { ChessView } from "../../shared/chess";
type Piece = { square: string; type: string; color: string; group: T.Group };
function readFen(fen: string) {
  return fen
    .split(" ")[0]
    .split("/")
    .flatMap((row, rank) => {
      let file = 0;
      const out: { square: string; type: string; color: string }[] = [];
      for (const char of row) {
        if (/\d/.test(char)) file += Number(char);
        else {
          out.push({
            square: String.fromCharCode(97 + file) + (8 - rank),
            type: char.toLowerCase(),
            color: char === char.toUpperCase() ? "w" : "b",
          });
          file++;
        }
      }
      return out;
    });
}
export class ChessTable {
  private r = new Resources();
  readonly group = new T.Group();
  private pieces: Piece[] = [];
  private signature = "";
  private highlights = new T.Group();
  private selected?: string;
  private templates = new Map<string, T.Group>();
  constructor(scene: T.Scene) {
    const r = this.r,
      t = GAME_TABLES.chess;
    scene.add(this.group);
    this.group.position.set(t.x, 0, t.z);
    for (const color of ["w", "b"])
      for (const type of ["p", "r", "n", "b", "q", "k"]) {
        const model = chessPiece(r, type, color);
        r.batch(model);
        this.templates.set(color + type, model);
      }
    r.box(this.group, 0, 0.75, 0, 1.05, 0.12, 1.05, "#584331", 0.06);
    r.cylinder(this.group, 0, 0.36, 0, 0.11, 0.15, 0.7, "#352c25");
    r.box(this.group, 0, 0.035, 0, 0.65, 0.06, 0.65, "#352c25", 0.08);
    r.box(this.group, 0, 0.819, 0, 0.64, 0.018, 0.64, "#b69b68", 0.01);
    for (let file = 0; file < 8; file++)
      for (let rank = 0; rank < 8; rank++)
        r.box(
          this.group,
          (file - 3.5) * CHESS_SQUARE,
          0.831,
          (rank - 3.5) * CHESS_SQUARE,
          CHESS_SQUARE,
          0.005,
          CHESS_SQUARE,
          (file + rank) % 2 ? "#c9bd9e" : "#3b514b",
          0,
        );
    r.batch(this.group);
    this.group.add(this.highlights);
    const title = r.label("Xadrez", "#e4d7ad", 256, 64);
    title.position.set(0.3, 0.9, -0.4);
    title.scale.set(0.35, 0.0875, 1);
    this.group.add(title);
  }
  select(square: string | undefined) {
    this.selected = square;
  }
  update(s: ChessView | undefined, clock: number) {
    if (!s) return;
    const last = s.last,
      age = last ? (clock - last.at) / 1000 : 10,
      animated = !!last && age < 0.85,
      fen = animated ? last.before : s.fen,
      signature = fen;
    if (signature !== this.signature) {
      this.signature = signature;
      for (const p of this.pieces) p.group.removeFromParent();
      this.pieces = readFen(fen).map((p) => {
        const group = this.templates.get(p.color + p.type)!.clone(true);
        this.group.add(group);
        return { ...p, group };
      });
    }
    for (const p of this.pieces) {
      const target = chessSquare(p.square);
      p.group.position.set(
        target.x - this.group.position.x,
        0.835,
        target.z - this.group.position.z,
      );
      p.group.rotation.set(0, p.color === "w" ? 0 : Math.PI, 0);
      p.group.visible = true;
      if (animated && last) {
        const travel = chessTravel(last, clock);
        if (p.square === last.from) {
          p.group.position.set(
            travel.x - this.group.position.x,
            travel.y - 0.829 + 0.835,
            travel.z - this.group.position.z,
          );
        }
        if (
          last.captured &&
          (p.square === last.to ||
            (last.flags.includes("e") &&
              p.square === last.to[0] + last.from[1])) &&
          travel.p > 0.66
        ) {
          p.group.position.y -= Math.min(0.19, (travel.p - 0.66) * 0.55);
          p.group.visible = travel.p < 0.95;
        }
        if (last.flags.includes("k") || last.flags.includes("q")) {
          const rank = last.from[1],
            rookFrom = last.flags.includes("k") ? "h" + rank : "a" + rank,
            rookTo = last.flags.includes("k") ? "f" + rank : "d" + rank;
          if (p.square === rookFrom) {
            const to = chessSquare(rookTo);
            p.group.position.x =
              T.MathUtils.lerp(target.x, to.x, travel.p) -
              this.group.position.x;
          }
        }
      }
    }
    const markSig = JSON.stringify([s.revision, this.selected]);
    if (this.highlights.userData.signature !== markSig) {
      this.highlights.userData.signature = markSig;
      for (const child of this.highlights.children) {
        (child as T.Mesh).geometry.dispose();
      }
      this.highlights.clear();
      for (const square of [
        this.selected,
        ...s.moves.filter((m) => m.from === this.selected).map((m) => m.to),
      ].filter(Boolean) as string[]) {
        const p = chessSquare(square),
          mesh = new T.Mesh(
            new T.RingGeometry(0.018, 0.025, 20),
            this.r.material(square === this.selected ? "#edcb75" : "#82d9ad"),
          );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(
          p.x - this.group.position.x,
          0.84,
          p.z - this.group.position.z,
        );
        this.highlights.add(mesh);
      }
    }
  }
  pick(ray: T.Raycaster) {
    const point = ray.ray.intersectPlane(
      new T.Plane(new T.Vector3(0, 1, 0), -0.84),
      new T.Vector3(),
    );
    if (!point) return;
    const file = Math.floor((point.x - GAME_TABLES.chess.x) / CHESS_SQUARE + 4),
      rank = 7 - Math.floor((point.z - GAME_TABLES.chess.z) / CHESS_SQUARE + 4);
    return file >= 0 && file < 8 && rank >= 0 && rank < 8
      ? String.fromCharCode(97 + file) + (rank + 1)
      : undefined;
  }
  dispose() {
    this.r.dispose();
    for (const child of this.highlights.children)
      (child as T.Mesh).geometry.dispose();
    this.group.removeFromParent();
  }
}
