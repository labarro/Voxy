import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export class Resources {
  private entries = new Set<T.BufferGeometry | T.Material | T.Texture>();
  private materials = new Map<string, T.MeshStandardMaterial>();
  keep<A extends T.BufferGeometry | T.Material | T.Texture>(value: A): A {
    this.entries.add(value);
    return value;
  }
  material(color: string, roughness = 0.8, metalness = 0) {
    const key = `${color}/${roughness}/${metalness}`;
    let mat = this.materials.get(key);
    if (!mat) {
      mat = this.keep(
        new T.MeshStandardMaterial({ color, roughness, metalness }),
      );
      this.materials.set(key, mat);
    }
    return mat;
  }
  box(
    parent: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: string | T.Material,
    radius = 0.06,
  ) {
    const geometry = this.keep(
      radius > 0 && Math.min(w, h, d) > 0.12
        ? new RoundedBoxGeometry(
            w,
            h,
            d,
            1,
            Math.min(radius, Math.min(w, h, d) * 0.3),
          )
        : new T.BoxGeometry(w, h, d),
    );
    const mesh = new T.Mesh(
      geometry,
      typeof material === "string" ? this.material(material) : material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  sphere(
    parent: T.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    color: string,
  ) {
    const mesh = new T.Mesh(
      this.keep(new T.SphereGeometry(r, r < 0.2 ? 10 : 16, r < 0.2 ? 8 : 12)),
      this.material(color),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  cylinder(
    parent: T.Object3D,
    x: number,
    y: number,
    z: number,
    top: number,
    bottom: number,
    height: number,
    color: string,
  ) {
    const mesh = new T.Mesh(
      this.keep(new T.CylinderGeometry(top, bottom, height, 24)),
      this.material(color),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  label(text: string, color = "#f0e8df", width = 512, height = 96) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(21,26,34,.86)";
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 24);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = "600 32px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(text.slice(0, 28), width / 2, height * 0.62, width - 32);
    const texture = this.keep(new T.CanvasTexture(canvas));
    const sprite = new T.Sprite(
      this.keep(new T.SpriteMaterial({ map: texture, depthWrite: false })),
    );
    sprite.scale.set(1.9, (1.9 * height) / width, 1);
    return sprite;
  }
  texture(kind: "wood" | "fabric" | "rug") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = kind === "wood" ? "#c5aa8b" : "#cccccc";
    ctx.fillRect(0, 0, 256, 256);
    let seed = 13;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < (kind === "wood" ? 700 : 3500); i++) {
      const x = random() * 256,
        y = random() * 256;
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${kind === "wood" ? 0.08 : 0.12})`;
      ctx.fillRect(
        x,
        y,
        kind === "wood" ? random() * 80 + 8 : 1,
        kind === "wood" ? 0.5 : 2,
      );
    }
    if (kind === "wood") {
      ctx.strokeStyle = "#6b514345";
      for (let y = 0; y < 256; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
        ctx.fillStyle = "#5a423522";
        ctx.fillRect(((y / 64) % 2) * 128, y, 1, 64);
      }
    }
    const texture = this.keep(new T.CanvasTexture(canvas));
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.colorSpace = T.SRGBColorSpace;
    texture.repeat.set(kind === "wood" ? 3 : 4, kind === "wood" ? 5 : 4);
    texture.anisotropy = 2;
    return texture;
  }
  // Merge rigid pieces per joint/material, keeping animated pivots separate.
  // Call before any animation starts; dynamic children opt out explicitly.
  batch(root: T.Object3D) {
    for (const child of [...root.children])
      if (!(child instanceof T.Mesh)) this.batch(child);
    const buckets = new Map<T.Material, T.Mesh[]>();
    for (const child of root.children) {
      if (
        !(child instanceof T.Mesh) ||
        Array.isArray(child.material) ||
        child.userData.dynamic
      )
        continue;
      const meshes = buckets.get(child.material) ?? [];
      meshes.push(child);
      buckets.set(child.material, meshes);
    }
    for (const [material, meshes] of buckets) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map((mesh) => {
        mesh.updateMatrix();
        const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
        if (!g.index) return g;
        const flat = g.toNonIndexed();
        g.dispose();
        return flat;
      });
      const geometry = mergeGeometries(geometries);
      for (const g of geometries) g.dispose();
      if (!geometry) continue;
      const combined = new T.Mesh(this.keep(geometry), material);
      combined.castShadow = meshes.some((m) => m.castShadow);
      combined.receiveShadow = true;
      for (const mesh of meshes) mesh.removeFromParent();
      root.add(combined);
    }
  }
  dispose() {
    for (const value of this.entries) value.dispose();
    this.entries.clear();
    this.materials.clear();
  }
}
