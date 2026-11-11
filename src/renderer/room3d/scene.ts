import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { defaultAvatar, seats, spawnPose, walkable } from "../../shared/room3d";
import type {
  Participant,
  RoomPose,
  RoomPreset,
  RoomSettings,
} from "../../shared/types";

type Snapshot = {
  people: Participant[];
  speaking: Set<string>;
  settings: RoomSettings;
  stream?: MediaStream;
  paused: boolean;
};
type PersonModel = {
  group: T.Group;
  legs: T.Group[];
  knees: T.Group[];
  arms: T.Group[];
  body: T.Group;
  label: T.Sprite;
  ring: T.Mesh;
  signature: string;
};
export class SocialScene {
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(56, 1, 0.1, 80);
  private renderer: T.WebGLRenderer;
  private models = new Map<string, PersonModel>();
  private keys = new Set<string>();
  private frame = 0;
  private observer: ResizeObserver;
  private data: Snapshot;
  private pose: RoomPose = spawnPose();
  private confirmedEntry = false;
  private yaw = 0;
  private pitch = 0.62;
  private zoom = 15;
  private drag = false;
  private last = 0;
  private sentAt = 0;
  private pending = false;
  private dirty = true;
  private video = document.createElement("video");
  private texture?: T.VideoTexture;
  private screen: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  private currentStream?: MediaStream;
  private disposed = false;
  private pixelRatio = 0;
  private resources = new Set<T.BufferGeometry | T.Material | T.Texture>();
  constructor(
    private element: HTMLElement,
    private preset: RoomPreset,
    private self: string,
    data: Snapshot,
    private send: (pose: RoomPose) => Promise<void>,
    private audio: (pose: RoomPose, yaw: number) => void,
    private fail: (message: string) => void,
  ) {
    this.data = data;
    this.pose =
      Array.from({ length: 10 }, (_, i) => spawnPose(i)).find((slot) =>
        data.people.every(
          (p) =>
            p.id === self ||
            !p.roomPose ||
            Math.hypot(p.roomPose.x - slot.x, p.roomPose.z - slot.z) >= 0.9,
        ),
      ) ?? spawnPose();
    this.renderer = new T.WebGLRenderer({
      antialias: data.settings.quality !== "low",
      powerPreference: "low-power",
    });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setClearColor("#171d2b");
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Sala 3D. WASD ou setas para andar. E para sentar ou levantar. Arraste para girar a câmera.",
    );
    element.appendChild(this.renderer.domElement);
    this.scene.fog = new T.Fog("#171d2b", 20, 45);
    this.scene.add(new T.HemisphereLight("#ffe5d0", "#59617c", 2.7));
    const light = new T.DirectionalLight("#ffd1a0", 3);
    light.position.set(-3, 8, 4);
    this.scene.add(light);
    this.buildRoom();
    this.screen = new T.Mesh(
      this.keep(new T.PlaneGeometry(7.6, 4.275)),
      this.keep(new T.MeshBasicMaterial({ color: "#13182a" })),
    );
    this.screen.position.set(0, 3.4, -5.72);
    this.scene.add(this.screen);
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(element);
    this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener("keydown", this.keydown);
    canvas.addEventListener("keyup", this.keyup);
    canvas.addEventListener("blur", this.clearKeys);
    window.addEventListener("blur", this.clearKeys);
    canvas.addEventListener("pointerdown", this.pointerdown);
    canvas.addEventListener("pointermove", this.pointermove);
    canvas.addEventListener("pointerup", this.pointerup);
    canvas.addEventListener("pointercancel", this.pointerup);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("webglcontextlost", this.contextlost);
    this.frame = requestAnimationFrame(this.tick);
  }
  private keep<A extends T.BufferGeometry | T.Material | T.Texture>(
    value: A,
  ): A {
    this.resources.add(value);
    return value;
  }
  private material(color: string) {
    return this.keep(new T.MeshStandardMaterial({ color, roughness: 0.85 }));
  }
  private box(
    parent: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
  ) {
    const geometry =
      Math.min(w, h, d) > 0.16
        ? new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.15)
        : new T.BoxGeometry(w, h, d);
    const mesh = new T.Mesh(this.keep(geometry), this.material(color));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  private ball(
    parent: T.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    color: string,
  ) {
    const mesh = new T.Mesh(
      this.keep(new T.SphereGeometry(r, 12, 8)),
      this.material(color),
    );
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  private text(value: string, color = "#eee9ff") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(22,25,40,.85)";
    ctx.beginPath();
    ctx.roundRect(0, 0, 512, 80, 25);
    ctx.fill();
    ctx.font = "600 30px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(value.slice(0, 26), 256, 50, 480);
    const texture = this.keep(new T.CanvasTexture(canvas));
    const sprite = new T.Sprite(
      this.keep(new T.SpriteMaterial({ map: texture, depthTest: false })),
    );
    sprite.scale.set(2.4, 0.375, 1);
    return sprite;
  }
  private buildRoom() {
    const room = this.scene;
    this.box(room, 0, -0.2, 0, 14, 0.4, 14, "#654f49");
    for (let i = 0; i < 14; i++)
      this.box(room, i - 6.5, 0.005, 0, 0.025, 0.01, 14, "#473f40");
    this.box(
      room,
      0,
      2.9,
      -6.1,
      14,
      6,
      0.25,
      this.preset === "cinema" ? "#303047" : "#42435b",
    );
    this.box(room, -7, 1, 0, 0.2, 2, 14, "#33374b");
    this.box(room, 7, 1, 0, 0.2, 2, 14, "#33374b");
    this.box(
      room,
      0,
      0.03,
      1,
      9,
      0.05,
      8,
      this.preset === "cinema" ? "#302d48" : "#71617f",
    );
    this.box(room, 0, 3.4, -5.9, 8.1, 4.8, 0.3, "#171b29");
    this.box(room, 0, 0.5, -5.5, 8, 1, 0.8, "#4b3c3c");
    const logo = this.text(
      "V O X Y  /  " + (this.preset === "cinema" ? "CINEMA" : "LOUNGE"),
      "#e2bd92",
    );
    logo.position.set(0, 6.05, -5.8);
    room.add(logo);
    for (const s of seats(this.preset)) {
      const group = new T.Group();
      group.position.set(s.x, 0, s.z);
      group.rotation.y = s.yaw;
      const color =
        s.kind === "puff"
          ? "#b77862"
          : this.preset === "cinema"
            ? "#755a88"
            : "#8273a7";
      if (s.kind === "puff") {
        const puff = this.ball(group, 0, 0.35, 0, 0.65, color);
        puff.scale.y = 0.65;
      } else {
        this.box(
          group,
          0,
          0.45,
          0,
          s.kind === "sofa" ? 1.65 : 1.3,
          0.38,
          1.15,
          color,
        );
        this.box(
          group,
          0,
          0.95,
          -0.5,
          s.kind === "sofa" ? 1.65 : 1.3,
          0.9,
          0.24,
          color,
        );
        for (const x of [-0.6, 0.6]) {
          if (s.kind !== "sofa")
            this.box(group, x, 0.7, 0, 0.18, 0.3, 1.15, color);
          this.box(group, x, 0.17, 0, 0.12, 0.3, 0.85, "#3a3036");
        }
      }
      room.add(group);
    }
    if (this.preset === "lounge") {
      this.box(room, 0, 0.27, 2, 5.6, 0.28, 1.3, "#665986");
      this.box(room, 0, 0.94, 2.52, 5.6, 0.9, 0.25, "#8273a7");
      for (const x of [-2.8, 2.8])
        this.box(room, x, 0.65, 2, 0.25, 0.6, 1.3, "#8273a7");
      this.box(room, 0, 0.52, -0.2, 3.5, 0.2, 1.5, "#bb9277");
      for (const x of [-1.4, 1.4])
        this.box(room, x, 0.25, -0.2, 0.15, 0.5, 1.1, "#3a3036");
      this.ball(room, 0.8, 0.79, -0.2, 0.15, "#dba673");
      this.box(room, -0.5, 0.65, -0.1, 0.7, 0.06, 0.5, "#6e8c87");
    }
    for (const x of [-5.6, 5.6]) {
      this.box(room, x, 0.45, -4.1, 0.8, 0.9, 0.8, "#b88f72");
      this.box(room, x, 1.4, -4.1, 0.1, 1.2, 0.1, "#4d6759");
      for (let i = 0; i < 4; i++) {
        const leaf = this.ball(
          room,
          x + Math.sin(i * 2) * 0.3,
          1.8 + i * 0.18,
          -4.1,
          0.55,
          "#718f79",
        );
        leaf.scale.y = 1.4;
      }
      this.box(room, x, 0.1, 3.8, 0.65, 0.15, 0.65, "#323344");
      this.box(room, x, 1.6, 3.8, 0.06, 3, 0.06, "#c2a486");
      this.ball(room, x, 3.1, 3.8, 0.45, "#ffe3ac");
    }
    for (const x of [-6.7, 6.7])
      this.box(room, x, 2, -4, 0.05, 0.05, 3, "#d7a274");
  }
  private makeAvatar(person: Participant) {
    const a = person.profile.avatar3d ?? defaultAvatar,
      group = new T.Group(),
      body = new T.Group();
    group.add(body);
    this.box(body, 0, 1.05, 0, 0.65, 0.72, 0.4, a.color);
    if (a.outfit === "jacket")
      this.box(body, 0, 1.1, 0.216, 0.1, 0.65, 0.025, "#e7ddcf");
    this.ball(body, 0, 1.73, 0, 0.35, a.skin);
    const hair = this.ball(body, 0, 1.93, -0.03, 0.355, a.hairColor);
    hair.scale.y = a.hair === "crest" ? 1.1 : 0.48;
    if (a.hair === "long")
      this.box(body, 0, 1.67, -0.24, 0.67, 0.65, 0.23, a.hairColor);
    for (const x of [-0.12, 0.12]) {
      this.ball(body, x, 1.76, 0.31, 0.035, "#292933");
      if (a.accessory === "glasses")
        this.box(body, x, 1.76, 0.345, 0.19, 0.12, 0.025, "#33364a");
    }
    if (a.accessory === "headphones") {
      for (const x of [-0.35, 0.35])
        this.ball(body, x, 1.8, 0, 0.13, "#e6bd80");
      this.box(body, 0, 2.08, 0, 0.64, 0.09, 0.12, "#e6bd80");
    }
    const legs: T.Group[] = [],
      knees: T.Group[] = [],
      arms: T.Group[] = [];
    for (const x of [-0.19, 0.19]) {
      const leg = new T.Group();
      leg.position.set(x, 0.75, 0);
      this.box(leg, 0, -0.135, 0, 0.23, 0.27, 0.26, "#35384d");
      const knee = new T.Group();
      knee.position.y = -0.27;
      this.box(knee, 0, -0.2, 0, 0.23, 0.4, 0.26, "#35384d");
      this.box(knee, 0, -0.43, 0.06, 0.28, 0.15, 0.4, "#e6d8cd");
      leg.add(knee);
      body.add(leg);
      legs.push(leg);
      knees.push(knee);
    }
    for (const x of [-0.45, 0.45]) {
      const arm = new T.Group();
      arm.position.set(x, 1.35, 0);
      this.box(arm, 0, -0.2, 0, 0.2, 0.5, 0.25, a.color);
      this.ball(arm, 0, -0.5, 0, 0.12, a.skin);
      body.add(arm);
      arms.push(arm);
    }
    const label = this.text(
      person.profile.name,
      person.profile.nicknameColor || "#eee9ff",
    );
    label.position.y = 2.5;
    group.add(label);
    const ring = new T.Mesh(
      this.keep(new T.RingGeometry(0.45, 0.53, 24)),
      this.keep(
        new T.MeshBasicMaterial({ color: "#a7efd0", side: T.DoubleSide }),
      ),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    group.add(ring);
    this.scene.add(group);
    return {
      group,
      body,
      legs,
      knees,
      arms,
      label,
      ring,
      signature: JSON.stringify([
        a,
        person.profile.name,
        person.profile.nicknameColor,
      ]),
    };
  }
  update(data: Snapshot) {
    this.data = data;
    const confirmed = data.people.find((p) => p.id === this.self)?.roomPose;
    if (!this.confirmedEntry && confirmed) {
      this.confirmedEntry = true;
      this.pose = { ...confirmed };
    }
    if (data.paused || document.hidden) {
      this.clearKeys();
      this.flush(performance.now());
    }
  }
  correct(pose?: RoomPose) {
    this.pose = pose ? { ...pose } : spawnPose();
    this.dirty = true;
  }
  private resize() {
    const w = this.element.clientWidth,
      h = this.element.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
  private keydown = (e: KeyboardEvent) => {
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "KeyE",
      ].includes(e.code)
    ) {
      e.preventDefault();
      this.keys.add(e.code);
      if (e.code === "KeyE" && !e.repeat) this.interact();
    }
  };
  private keyup = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private clearKeys = () => {
    this.keys.clear();
    this.drag = false;
    if (this.pose.moving) {
      this.pose.moving = false;
      this.dirty = true;
    }
  };
  private pointerdown = (e: PointerEvent) => {
    this.renderer.domElement.focus();
    this.drag = true;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private pointerup = () => {
    this.drag = false;
  };
  private pointermove = (e: PointerEvent) => {
    if (this.drag) {
      this.yaw -= e.movementX * 0.006 * this.data.settings.sensitivity;
      this.pitch = Math.max(
        0.25,
        Math.min(1.25, this.pitch + e.movementY * 0.004),
      );
    }
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom = Math.max(5, Math.min(17, this.zoom + e.deltaY * 0.01));
  };
  private contextlost = (e: Event) => {
    e.preventDefault();
    this.fail(
      "A placa gráfica interrompeu a sala 3D. A chamada continua no modo tradicional.",
    );
  };
  interact() {
    if (this.pose.seat) {
      const seat = seats(this.preset).find((s) => s.id === this.pose.seat)!;
      const candidates = [
        [0, 1.2],
        [1.2, 0],
        [-1.2, 0],
        [0, -1.2],
      ];
      for (const [dx, dz] of candidates)
        if (walkable(this.preset, seat.x + dx, seat.z + dz)) {
          this.pose = {
            ...this.pose,
            x: seat.x + dx,
            z: seat.z + dz,
            seat: null,
          };
          break;
        }
    } else {
      const nearest = seats(this.preset)
        .filter(
          (s) =>
            !this.data.people.some(
              (p) => p.id !== this.self && p.roomPose?.seat === s.id,
            ),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - this.pose.x, a.z - this.pose.z) -
            Math.hypot(b.x - this.pose.x, b.z - this.pose.z),
        )[0];
      if (
        nearest &&
        Math.hypot(nearest.x - this.pose.x, nearest.z - this.pose.z) < 2.5
      )
        this.pose = {
          x: nearest.x,
          z: nearest.z,
          yaw: nearest.yaw,
          seat: nearest.id,
          moving: false,
        };
    }
    this.dirty = true;
  }
  private flush(time: number) {
    if (this.dirty && !this.pending && time - this.sentAt >= 110) {
      this.sentAt = time;
      this.pending = true;
      this.dirty = false;
      void this.send({ ...this.pose })
        .catch(() => {
          if (!this.disposed)
            this.correct(
              this.data.people.find((p) => p.id === this.self)?.roomPose,
            );
        })
        .finally(() => (this.pending = false));
    }
  }
  private tick = (time: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    const settings = this.data.settings,
      fps =
        settings.quality === "low"
          ? 24
          : settings.quality === "medium"
            ? 40
            : 60;
    if (time - this.last < 1000 / fps) return;
    const dt = Math.min(0.08, (time - this.last) / 1000);
    this.last = time;
    if (document.hidden || this.data.paused) {
      this.clearKeys();
      return;
    }
    const ratio = Math.min(
      devicePixelRatio,
      settings.quality === "low" ? 1 : settings.quality === "medium" ? 1.5 : 2,
    );
    if (this.pixelRatio !== ratio) {
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
    }
    let x =
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    let z =
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) -
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    const moving = !!(x || z) && !this.pose.seat;
    if (moving) {
      const len = Math.hypot(x, z);
      x /= len;
      z /= len;
      const dx = (x * Math.cos(this.yaw) + z * Math.sin(this.yaw)) * dt * 3.5,
        dz = (-x * Math.sin(this.yaw) + z * Math.cos(this.yaw)) * dt * 3.5;
      if (walkable(this.preset, this.pose.x + dx, this.pose.z))
        this.pose.x += dx;
      if (walkable(this.preset, this.pose.x, this.pose.z + dz))
        this.pose.z += dz;
      this.pose.yaw = Math.atan2(dx, dz);
      this.dirty = true;
    }
    if (this.pose.moving !== moving) {
      this.pose.moving = moving;
      this.dirty = true;
    }
    this.flush(time);
    this.audio(this.pose, this.yaw);
    const ids = new Set(
      this.data.people
        .filter((p) => p.id === this.self || p.roomPose)
        .map((p) => p.id),
    );
    for (const [id, model] of this.models)
      if (!ids.has(id)) {
        this.disposeModel(model);
        this.models.delete(id);
      }
    for (const person of this.data.people) {
      const pose = person.id === this.self ? this.pose : person.roomPose;
      if (!pose) continue;
      let model = this.models.get(person.id);
      const sig = JSON.stringify([
        person.profile.avatar3d ?? defaultAvatar,
        person.profile.name,
        person.profile.nicknameColor,
      ]);
      if (model && model.signature !== sig) {
        this.disposeModel(model);
        this.models.delete(person.id);
        model = undefined;
      }
      if (!model) {
        model = this.makeAvatar(person);
        model.group.position.set(pose.x, 0, pose.z);
        this.models.set(person.id, model);
      }
      model.group.position.lerp(
        new T.Vector3(pose.x, 0, pose.z),
        person.id === this.self ? 1 : 1 - Math.exp(-dt * 14),
      );
      model.group.rotation.y = pose.yaw;
      model.body.position.y = pose.seat
        ? pose.seat.startsWith("puff")
          ? -0.3
          : -0.1
        : Math.sin(time * 0.002) * 0.018;
      model.legs.forEach(
        (leg, i) =>
          (leg.rotation.x = pose.seat
            ? -Math.PI / 2
            : pose.moving
              ? Math.sin(time * 0.012 + i * Math.PI) * 0.55
              : 0),
      );
      model.knees.forEach(
        (knee) => (knee.rotation.x = pose.seat ? Math.PI / 2 : 0),
      );
      model.arms.forEach(
        (arm, i) =>
          (arm.rotation.x = pose.seat
            ? -0.45
            : pose.moving
              ? Math.sin(time * 0.012 - i * Math.PI) * 0.4
              : 0),
      );
      model.label.visible = settings.names;
      model.ring.visible = this.data.speaking.has(person.id) && !person.muted;
    }
    if (this.currentStream !== this.data.stream) {
      this.currentStream = this.data.stream;
      this.texture?.dispose();
      this.video.srcObject = this.currentStream ?? null;
      this.screen.material.map = null;
      this.screen.material.color.set("#13182a");
      if (this.currentStream) {
        this.texture = new T.VideoTexture(this.video);
        this.texture.colorSpace = T.SRGBColorSpace;
        this.screen.material.map = this.texture;
        this.screen.material.color.set("#ffffff");
        void this.video.play().catch(() => {});
      }
      this.screen.material.needsUpdate = true;
    }
    const target = new T.Vector3(
      this.pose.x * 0.55,
      1.6,
      this.pose.z * 0.15 - 0.9,
    );
    this.camera.position.set(
      target.x + Math.sin(this.yaw) * this.zoom * Math.cos(this.pitch),
      target.y + this.zoom * Math.sin(this.pitch),
      target.z + Math.cos(this.yaw) * this.zoom * Math.cos(this.pitch),
    );
    this.camera.lookAt(target);
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      this.fail(
        "Não foi possível renderizar a sala. A chamada continua no modo tradicional.",
      );
    }
  };
  private disposeModel(model: PersonModel) {
    model.group.removeFromParent();
    model.group.traverse((obj) => {
      if (obj instanceof T.Mesh || obj instanceof T.Sprite) {
        obj.geometry?.dispose();
        if (obj.geometry) this.resources.delete(obj.geometry);
        const mats = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const mat of mats) {
          if ("map" in mat && mat.map) {
            (mat.map as T.Texture).dispose();
            this.resources.delete(mat.map as T.Texture);
          }
          mat.dispose();
          this.resources.delete(mat);
        }
      }
    });
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    window.removeEventListener("blur", this.clearKeys);
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.contextlost,
    );
    this.video.pause();
    this.video.srcObject = null;
    this.texture?.dispose();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
