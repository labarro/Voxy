import * as T from "three";
import { Resources } from "./resources";
import { cardId, type Card } from "../../shared/truco";

/** Original vector-painted deck. Only authorized cards ever request a face. */
export class CardDeck {
  private faces = new Map<string, T.MeshStandardMaterial>();
  private back: T.MeshStandardMaterial;
  private geometry: T.BoxGeometry;
  private edge: T.MeshStandardMaterial;
  constructor(private r: Resources) {
    this.geometry = r.keep(new T.BoxGeometry(0.205, 0.306, 0.003));
    this.edge = r.material("#e5dfd1");
    this.back = this.paint();
  }
  private paint(card?: Card) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 192;
    const c = canvas.getContext("2d")!;
    c.fillStyle = card ? "#fff9ed" : "#173c47";
    c.fillRect(0, 0, 128, 192);
    c.strokeStyle = card ? "#c9b99a" : "#d7b66b";
    c.lineWidth = 3;
    c.strokeRect(5, 5, 118, 182);
    if (card) {
      const symbol = { d: "♦", h: "♥", s: "♠", c: "♣" }[card.suit];
      c.fillStyle =
        card.suit === "d" || card.suit === "h" ? "#ae263f" : "#18242a";
      for (let corner = 0; corner < 2; corner++) {
        c.save();
        if (corner) {
          c.translate(128, 192);
          c.rotate(Math.PI);
        }
        c.font = "bold 29px Georgia";
        c.fillText(card.rank, 12, 34);
        c.font = "24px Georgia";
        c.fillText(symbol, 13, 60);
        c.restore();
      }
      c.textAlign = "center";
      c.font = "62px Georgia";
      c.fillText(symbol, 64, 120);
      if (["K", "Q", "J"].includes(card.rank)) {
        c.strokeStyle = c.fillStyle;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(41, 71);
        c.lineTo(35, 53);
        c.lineTo(53, 62);
        c.lineTo(64, 44);
        c.lineTo(75, 62);
        c.lineTo(93, 53);
        c.lineTo(87, 71);
        c.closePath();
        c.stroke();
      }
    } else {
      c.strokeStyle = "#d7b66b";
      c.lineWidth = 1;
      for (let y = 15; y < 183; y += 12)
        for (let x = 15; x < 119; x += 12) {
          c.beginPath();
          c.moveTo(x, y - 4);
          c.lineTo(x + 4, y);
          c.lineTo(x, y + 4);
          c.lineTo(x - 4, y);
          c.closePath();
          c.stroke();
        }
      c.fillStyle = "#173c47";
      c.fillRect(29, 77, 70, 38);
      c.fillStyle = "#edd6a2";
      c.textAlign = "center";
      c.font = "italic 24px Georgia";
      c.fillText("Voxy", 64, 104);
    }
    const texture = this.r.keep(new T.CanvasTexture(canvas));
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    return this.r.keep(
      new T.MeshStandardMaterial({ map: texture, roughness: 0.82 }),
    );
  }
  mesh(card?: Card | null) {
    let face = this.back;
    if (card) {
      const id = cardId(card);
      if (!this.faces.has(id)) this.faces.set(id, this.paint(card));
      face = this.faces.get(id)!;
    }
    const mesh = new T.Mesh(this.geometry, [
      this.edge,
      this.edge,
      this.edge,
      this.edge,
      face,
      this.back,
    ]);
    mesh.castShadow = true;
    return mesh;
  }
}
