import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

export const furnitureNames = [
  "loungeSofa",
  "loungeChair",
  "loungeDesignChair",
  "loungeSofaOttoman",
  "tableCoffee",
  "pottedPlant",
  "bookcaseOpenLow",
  "books",
  "lampRoundFloor",
] as const;
export const characterNames = [
  "character-male-f",
  "character-male-d",
  "character-female-e",
  "character-female-b",
  "character-female-f",
] as const;
export class RoomAssets {
  private models = new Map<string, GLTF>();
  private disposed = false;
  async load(progress: (fraction: number) => void, charactersOnly = false) {
    const loader = new GLTFLoader(),
      base = new URL("assets/room3d/", document.baseURI);
    let loaded = 0;
    const entries = [
      ...(charactersOnly
        ? []
        : furnitureNames.map((name) => ({ name, folder: "furniture" }))),
      ...characterNames.map((name) => ({ name, folder: "characters" })),
    ];
    await Promise.all(
      entries.map(async ({ name, folder }) => {
        const gltf = await loader.loadAsync(
          new URL(`${folder}/${name}.glb`, base).href,
        );
        this.models.set(name, gltf);
        if (this.disposed) this.release(gltf);
        else progress(++loaded / entries.length);
      }),
    );
  }
  get(name: string) {
    const model = this.models.get(name);
    if (!model) throw Error(`Modelo indisponível: ${name}`);
    return model;
  }
  character(name: string) {
    return clone(this.get(name).scene);
  }
  prop(name: string) {
    return this.get(name).scene.clone(true);
  }
  private release(gltf: GLTF) {
    const seen = new Set<any>();
    gltf.scene.traverse((obj) => {
      const mesh = obj as T.Mesh;
      if (mesh.geometry && !seen.has(mesh.geometry)) {
        seen.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      if (mesh.material)
        for (const mat of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]) {
          if (seen.has(mat)) continue;
          seen.add(mat);
          for (const value of Object.values(mat))
            if (value instanceof T.Texture && !seen.has(value)) {
              seen.add(value);
              value.dispose();
              if (value.image instanceof ImageBitmap) value.image.close();
            }
          mat.dispose();
        }
    });
  }
  dispose() {
    this.disposed = true;
    for (const gltf of this.models.values()) this.release(gltf);
    this.models.clear();
  }
}
