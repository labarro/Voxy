import * as T from "three";
import type { Avatar3D } from "../../shared/types";
import { RoomAssets } from "./assets";
import { Resources } from "./resources";

export const avatarModels: Record<
  NonNullable<Avatar3D["hairStyle"]>,
  string
> = {
  short: "character-male-f",
  crest: "character-male-d",
  long: "character-female-f",
  bob: "character-female-e",
  curly: "character-female-b",
};
export class SocialAvatar {
  readonly group = new T.Group();
  private resources = new Resources();
  private mixer: T.AnimationMixer;
  private actions = new Map<string, T.AnimationAction>();
  private action?: T.AnimationAction;
  private root: T.Object3D;
  private skeletons: T.Skeleton[] = [];
  constructor(assets: RoomAssets, appearance: Avatar3D) {
    const name = avatarModels[appearance.hairStyle ?? appearance.hair],
      source = assets.get(name);
    this.root = assets.character(name);
    const outfit = appearance.outfitStyle ?? appearance.outfit;
    const bodyName =
      outfit === "jacket"
        ? "character-male-d"
        : outfit === "tee"
          ? "character-male-f"
          : "character-female-e";
    const bodyTemplate = assets
      .get(bodyName)
      .scene.getObjectByName("body-mesh") as T.Mesh;
    this.root.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(this.root),
      height = box.getSize(new T.Vector3()).y;
    const scale = 2.05 / height;
    this.root.scale.setScalar(scale);
    this.root.scale.x *= appearance.body === "soft" ? 1.12 : 1;
    this.group.add(this.root);
    this.root.traverse((obj) => {
      if (!(obj instanceof T.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const isHead = obj.name.includes("head");
      const geometry = this.resources.keep(
        (isHead ? obj.geometry : bodyTemplate.geometry).clone(),
      );
      const uv = geometry.getAttribute("uv");
      const colors = new Float32Array(
        geometry.getAttribute("position").count * 3,
      );
      const skin = new T.Color(appearance.skin),
        hair = new T.Color(appearance.hairColor),
        cloth = new T.Color(appearance.color),
        pants = new T.Color("#30394c");
      const skinColumn = name === "character-male-f" ? 0.094 : 0.344;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i),
          v = uv.getY(i),
          head = obj.name.includes("head");
        const rowSkin = v > 0.5 && v < 0.75;
        const isSkin =
          rowSkin &&
          (head
            ? Math.abs(u - skinColumn) < 0.035
            : bodyName === "character-male-f"
              ? Math.abs(u - 0.094) < 0.035 || Math.abs(u - 0.344) < 0.035
              : Math.abs(
                  u - (bodyName === "character-male-d" ? 0.344 : 0.094),
                ) < 0.035);
        const isDarkEye =
          head &&
          v > 0.75 &&
          Math.abs(u - 0.469) < 0.03 &&
          geometry.getAttribute("position").getZ(i) > 0.15 &&
          geometry.getAttribute("position").getY(i) < 0.49;
        let color: T.Color;
        if (isSkin) color = skin;
        else if (head && u > 0.9) color = new T.Color("#f3eadc");
        else if (isDarkEye) color = skin;
        else if (head) color = hair;
        else if (geometry.getAttribute("position").getY(i) < 0.2) color = pants;
        else if (bodyName === "character-male-d" && u > 0.9 && v > 0.75)
          color = new T.Color("#e6dcc9");
        else color = cloth;
        color.toArray(colors, i * 3);
        const shade = 0.94 + ((v * 4) % 1) * 0.09;
        for (let c = 0; c < 3; c++) colors[i * 3 + c] *= shade;
      }
      geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
      obj.geometry = geometry;
      obj.material = this.resources.keep(
        new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.83 }),
      );
      if (obj instanceof T.SkinnedMesh) this.skeletons.push(obj.skeleton);
    });
    this.decorate(appearance, scale);
    this.mixer = new T.AnimationMixer(this.root);
    for (const clip of source.animations)
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.play("idle", true);
  }
  private decorate(a: Avatar3D, scale: number) {
    const accessory = a.accessoryStyle ?? a.accessory,
      outfit = a.outfitStyle ?? a.outfit;
    const head = this.root.getObjectByName("head"),
      torso = this.root.getObjectByName("torso");
    if (head) {
      const extras = new T.Group();
      extras.scale.setScalar(1 / scale);
      head.add(extras);
      for (const x of [-0.22, 0.22]) {
        const eye = this.resources.sphere(
          extras,
          x,
          0.4,
          0.67,
          a.face === "bright" ? 0.047 : 0.039,
          "#292b35",
        );
        if (a.face === "calm") eye.scale.y = 0.3;
      }
      if ((a.hairStyle ?? a.hair) === "crest") {
        const tuft = this.resources.sphere(
          extras,
          0,
          0.71,
          0.32,
          0.24,
          a.hairColor,
        );
        tuft.scale.set(1.25, 0.5, 0.65);
      }
      // Accessories are authored in world units and follow the animated +Z face.
      if (accessory === "glasses") {
        for (const x of [-0.23, 0.23]) {
          const rim = new T.Mesh(
            this.resources.keep(new T.TorusGeometry(0.14, 0.02, 6, 24)),
            this.resources.material("#d4ae78", 0.35, 0.6),
          );
          rim.position.set(x, 0.4, 0.66);
          extras.add(rim);
        }
        this.resources.box(
          extras,
          0,
          0.4,
          0.66,
          0.2,
          0.025,
          0.025,
          "#d4ae78",
          0,
        );
      } else if (accessory === "headphones") {
        for (const x of [-0.51, 0.51])
          this.resources.sphere(extras, x, 0.33, 0.08, 0.15, "#b4a3d5");
        const band = new T.Mesh(
          this.resources.keep(new T.TorusGeometry(0.52, 0.04, 8, 24, Math.PI)),
          this.resources.material("#b4a3d5"),
        );
        band.position.set(0, 0.35, 0.08);
        extras.add(band);
      } else if (accessory === "beanie") {
        const hat = this.resources.sphere(extras, 0, 0.65, 0.08, 0.54, a.color);
        hat.scale.set(1, 0.55, 0.9);
      } else if (accessory === "earrings") {
        for (const x of [-0.48, 0.48]) {
          const ring = new T.Mesh(
            this.resources.keep(new T.TorusGeometry(0.065, 0.015, 6, 16)),
            this.resources.material("#e2ba6d", 0.2, 0.7),
          );
          ring.position.set(x, 0.09, 0.2);
          extras.add(ring);
        }
      }
      const mouth = new T.Mesh(
        this.resources.keep(
          new T.TorusGeometry(
            a.face === "bright" ? 0.095 : 0.075,
            0.014,
            5,
            16,
            Math.PI,
          ),
        ),
        this.resources.material("#7b4244"),
      );
      mouth.rotation.z = Math.PI;
      mouth.position.set(0, 0.22, 0.67);
      if (a.face === "calm") mouth.scale.y = 0.25;
      extras.add(mouth);
    }
    if (torso) {
      const clothing = new T.Group();
      clothing.scale.setScalar(1 / scale);
      torso.add(clothing);
      if (outfit === "jacket") {
        this.resources.box(
          clothing,
          0,
          0.25,
          0.28,
          0.075,
          0.5,
          0.04,
          "#e7d9c1",
          0.01,
        );
        for (const x of [-0.23, 0.23])
          this.resources.box(
            clothing,
            x,
            0.1,
            0.29,
            0.15,
            0.1,
            0.025,
            a.color,
            0.02,
          );
      }
      if (outfit === "hoodie") {
        const hood = this.resources.sphere(
          clothing,
          0,
          0.4,
          -0.12,
          0.3,
          a.color,
        );
        hood.scale.set(1, 0.65, 0.45);
        for (const x of [-0.1, 0.1])
          this.resources.box(
            clothing,
            x,
            0.28,
            0.29,
            0.02,
            0.19,
            0.02,
            "#eee1c7",
            0,
          );
      }
      if (outfit === "tee")
        this.resources.box(
          clothing,
          0,
          0.22,
          0.29,
          0.28,
          0.13,
          0.025,
          "#e8dccd",
          0.03,
        );
    }
  }
  play(name: string, immediate = false) {
    const next = this.actions.get(name) ?? this.actions.get("idle");
    if (!next || next === this.action) return;
    next
      .reset()
      .setEffectiveTimeScale(name === "walk" ? 1.05 : 1)
      .setEffectiveWeight(1)
      .play();
    if (this.action) this.action.crossFadeTo(next, immediate ? 0 : 0.24, false);
    this.action = next;
  }
  update(dt: number, moving: boolean, seated: boolean, seatHeight = 0.68) {
    this.root.position.y = T.MathUtils.lerp(
      this.root.position.y,
      seated ? seatHeight - 0.1 : 0,
      1 - Math.exp(-dt * 12),
    );
    this.play(seated ? "sit" : moving ? "walk" : "idle");
    this.mixer.update(dt);
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const skeleton of this.skeletons) skeleton.dispose();
    this.resources.dispose();
    this.group.removeFromParent();
  }
}
