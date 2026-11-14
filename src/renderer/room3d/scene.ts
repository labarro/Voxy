import * as T from "three";
import { defaultAvatar, seats, spawnPose, walkable } from "../../shared/room3d";
import type {
  Participant,
  RoomPose,
  RoomPreset,
  RoomSettings,
} from "../../shared/types";
import { RoomAssets } from "./assets";
import { SocialAvatar } from "./avatar";
import { RoomCamera, type CameraMode } from "./camera";
import { buildEnvironment, type RoomEnvironment } from "./environment";
import { Resources } from "./resources";

import { POOL, type PoolState } from "../../shared/pool";
import { PoolTable } from "./PoolTable";
import { PoolTimeline } from "./GameTimeline";
import { poolStroke } from "../../shared/poolMotion";
import { walkPath } from "../../shared/navigation";
import type { Command } from "../../shared/types";
import type { SocialGamesView } from "../../shared/types";
import {
  GAME_TABLES,
  tableSeat,
  tableSeats,
  tableCamera,
  type TableGame,
} from "../../shared/gameTables";
import { TrucoTable } from "./TrucoTable";
import { cardMotion } from "../../shared/cardMotion";
import { ChessTable } from "./ChessTable";
import { chessMotion } from "../../shared/chessMotion";
import { GameSounds } from "./GameSounds";
export type SceneSnapshot = {
  pool?: PoolState;
  games?: SocialGamesView;
  people: Participant[];
  speaking: Set<string>;
  settings: RoomSettings;
  stream?: MediaStream;
  paused: boolean;
};
export type SceneState = {
  ready: boolean;
  progress: number;
  mode: CameraMode;
  interaction: { label: string; available: boolean };
  fps: number;
  drawCalls: number;
  triangles: number;
  poolReady?: boolean;
  poolAngle?: number;
};
type PersonModel = {
  avatar: SocialAvatar;
  resources: Resources;
  label: T.Sprite;
  ring: T.Mesh;
  signature: string;
  seat: string | null;
  settling: boolean;
};

export class SocialScene {
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(55, 1, 0.12, 80);
  private renderer: T.WebGLRenderer;
  private rig = new RoomCamera(this.camera);
  private assets = new RoomAssets();
  private environment?: RoomEnvironment;
  private poolTable?: PoolTable;
  private trucoTable?: TrucoTable;
  private chessTable?: ChessTable;
  private chessSelected?: string;
  private chessPromotion: "q" | "r" | "b" | "n" = "q";
  private chessRevision = -1;
  private chessClock = 0;
  private chessAt = 0;
  private tableActive?: TableGame;
  private tableClock = 0;
  private tableRevision = -1;
  private tableAt = 0;
  private covered = false;
  private preview?: RoomPose["emote"];
  private previewAt = 0;
  previewEmote(value?: RoomPose["emote"]) {
    this.preview = value;
    this.previewAt = Date.now();
    this.clearKeys();
    this.route = [];
    this.routeEnd = undefined;
  }
  private sounds = new GameSounds();
  private soundEvents = { truco: 0, chess: 0, pool: 0 };
  private joinRequest?: { kind: TableGame; index: number };
  private poolTimeline = new PoolTimeline();
  private poolActive = false;
  private poolAngle = 0;
  private poolPower = 0.55;
  private gameYaw = 1.1;
  private gameDistance = 3.3;
  private aimSent = 0;
  private aimDirty = true;
  private route: { x: number; z: number }[] = [];
  private routeEnd?: () => void;
  private afterStand?: () => void;
  private leavingTable = false;
  private stanceAt = 0;
  private stanceTarget?: { x: number; z: number; yaw: number };
  private drawPool?: PoolState;
  private models = new Map<string, PersonModel>();
  private keys = new Set<string>();
  private observer: ResizeObserver;
  private frame = 0;
  private data: SceneSnapshot;
  private pose: RoomPose = spawnPose();
  private velocity = new T.Vector2();
  private confirmedEntry = false;
  private drag: "rotate" | "pan" | null = null;
  private last = 0;
  private sentAt = 0;
  private pending = false;
  private dirty = true;
  private disposed = false;
  private video = document.createElement("video");
  private texture?: T.VideoTexture;
  private currentStream?: MediaStream;
  private quality = "";
  private pixelRatio = 0;
  private ready = false;
  private progress = 0;
  private stateSentAt = 0;
  private fpsAt = 0;
  private frames = 0;
  private fps = 0;
  private shadowAt = 0;
  private expanded = false;
  constructor(
    private element: HTMLElement,
    private preset: RoomPreset,
    private self: string,
    data: SceneSnapshot,
    private send: (pose: RoomPose) => Promise<void>,
    private audio: (pose: RoomPose, yaw: number) => void,
    private fail: (message: string) => void,
    private changed: (state: SceneState) => void = () => {},
    private openPool: () => void = () => {},
    private gameCommand: (
      command: Command,
    ) => Promise<unknown> = async () => {},
  ) {
    this.data = data;
    this.pose =
      Array.from({ length: 10 }, (_, i) => spawnPose(i)).find(
        (slot) =>
          walkable(preset, slot.x, slot.z) &&
          data.people.every(
            (p) =>
              p.id === self ||
              !p.roomPose ||
              Math.hypot(p.roomPose.x - slot.x, p.roomPose.z - slot.z) >= 0.9,
          ),
      ) ?? spawnPose();
    this.rig.setMode(data.settings.cameraMode ?? "follow");
    this.renderer = new T.WebGLRenderer({
      antialias: data.settings.quality !== "low",
      powerPreference: "low-power",
    });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor("#222c35");
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      "Sala 3D. WASD: andar. Arraste: girar. Roda: zoom. E: interagir. C: câmera. R: reposicionar.",
    );
    canvas.dataset.ready = "false";
    this.element.appendChild(canvas);
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.video.addEventListener("loadedmetadata", this.fitTV);
    this.video.addEventListener("resize", this.fitTV);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(element);
    this.resize();
    canvas.addEventListener("keydown", this.keydown);
    canvas.addEventListener("keyup", this.keyup);
    canvas.addEventListener("blur", this.clearKeys);
    window.addEventListener("blur", this.clearKeys);
    canvas.addEventListener("pointerdown", this.pointerdown);
    canvas.addEventListener("pointermove", this.pointermove);
    canvas.addEventListener("pointerup", this.pointerup);
    canvas.addEventListener("pointercancel", this.pointerup);
    canvas.addEventListener("lostpointercapture", this.pointerup);
    canvas.addEventListener("contextmenu", this.contextmenu);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("webglcontextlost", this.contextlost);
    void this.initialize();
  }
  private async initialize() {
    try {
      await this.assets.load((fraction) => {
        this.progress = fraction * 0.85;
        this.emit();
      });
      if (this.disposed) return;
      this.environment = buildEnvironment(this.scene, this.preset, this.assets);
      if (this.preset !== "cinema")
        this.poolTable = new PoolTable(this.scene, this.environment.colliders);
      if (this.preset !== "cinema")
        this.trucoTable = new TrucoTable(this.scene);
      if (this.preset !== "cinema")
        this.chessTable = new ChessTable(this.scene);
      this.scene.updateMatrixWorld(true);
      this.configureQuality();
      this.progress = 0.96;
      this.emit();
      this.frame = requestAnimationFrame(this.tick);
    } catch {
      if (!this.disposed)
        this.fail(
          "Não foi possível carregar os modelos da sala. A chamada continua no modo tradicional.",
        );
    }
  }
  update(data: SceneSnapshot) {
    if (this.disposed) return;
    const oldMode = this.data.settings.cameraMode;
    this.data = data;
    if (data.pool) this.poolTimeline.receive(data.pool);
    if (data.settings.cameraMode !== oldMode && this.rig.mode !== "watch")
      this.rig.setMode(data.settings.cameraMode ?? "follow");
    const confirmed = data.people.find((p) => p.id === this.self)?.roomPose;
    if (
      confirmed &&
      (!this.confirmedEntry ||
        ((confirmed.seat?.match(/^(truco|chess)-/) ||
          this.pose.seat?.match(/^(truco|chess)-/)) &&
          confirmed.seat !== this.pose.seat))
    ) {
      this.confirmedEntry = true;
      this.pose = { ...confirmed };
      if (!confirmed.seat) {
        this.leavingTable = false;
        const next = this.afterStand;
        this.afterStand = undefined;
        next?.();
      }
    }
    if (data.paused || document.hidden) {
      this.clearKeys();
      if (this.ready) this.flush(performance.now());
    }
  }
  correct(pose?: RoomPose) {
    this.pose = pose ? { ...pose } : spawnPose();
    this.dirty = true;
  }
  setCameraMode(mode: CameraMode) {
    this.rig.setMode(mode);
    this.clearKeys();
    this.emit();
  }
  returnFromTV() {
    this.rig.leaveWatch();
    this.emit();
  }
  resetCamera() {
    this.rig.reset();
  }
  setPoolActive(value: boolean) {
    if (value) this.tableActive = undefined;
    this.poolActive = value;
    this.route = [];
    this.routeEnd = undefined;
    this.stanceTarget = undefined;
    this.clearKeys();
    if (!value) this.rig.setGame();
    this.aimDirty = true;
  }
  setTableActive(kind?: TableGame) {
    this.tableActive = kind;
    this.poolActive = false;
    this.clearKeys();
    if (!kind) this.rig.setGame();
  }
  setCovered(value: boolean) {
    this.covered = value;
  }
  setChessPromotion(value: "q" | "r" | "b" | "n") {
    this.chessPromotion = value;
  }
  leaveGame(kind: TableGame) {
    if (this.leavingTable) return;
    this.leavingTable = true;
    void this.gameCommand({ type: "game.leave", game: kind })
      .then(() => this.setTableActive())
      .catch(() => {
        this.leavingTable = false;
      });
  }
  approachGame(kind: TableGame) {
    if (this.pose.seat?.startsWith(`${kind}-`)) {
      this.tableActive = kind;
      return;
    }
    const state = this.data.games?.[kind];
    const seat = tableSeats(kind)
      .filter((s) => !state?.players[Number(s.id.split("-")[1])])
      .sort(
        (a, b) =>
          Math.hypot(a.x - this.pose.x, a.z - this.pose.z) -
          Math.hypot(b.x - this.pose.x, b.z - this.pose.z),
      )[0];
    if (!seat) return;
    if (this.pose.seat?.match(/^(truco|chess)-/)) {
      this.afterStand = () => this.approachGame(kind);
      this.leaveGame(this.pose.seat.startsWith("truco-") ? "truco" : "chess");
      return;
    }
    if (this.pose.seat) this.interact();
    const target = {
      x: seat.x + Math.cos(seat.yaw) * 0.78,
      z: seat.z - Math.sin(seat.yaw) * 0.78,
    };
    this.route = walkPath(this.preset, this.pose, target);
    this.routeEnd = () => {
      this.velocity.set(0, 0);
      this.pose.moving = false;
      this.dirty = true;
      this.joinRequest = { kind, index: Number(seat.id.split("-")[1]) };
    };
    if (Math.hypot(this.pose.x - target.x, this.pose.z - target.z) < 0.1) {
      this.routeEnd();
      this.routeEnd = undefined;
    }
  }
  setPoolAim(angle: number, power: number) {
    this.poolAngle = angle;
    this.poolPower = power;
    this.aimDirty = true;
    this.emit();
  }
  shootPool() {
    const s = this.data.pool;
    if (!s || !this.poolReady())
      return Promise.reject(Error("Aguarde o personagem se posicionar."));
    return this.gameCommand({
      type: "pool.shoot",
      angle: this.poolAngle,
      power: this.poolPower,
      revision: s.revision,
    });
  }
  approachPool() {
    if (this.preset === "cinema") return;
    if (this.pose.seat?.match(/^(truco|chess)-/)) {
      this.afterStand = () => this.approachPool();
      this.leaveGame(this.pose.seat.startsWith("truco-") ? "truco" : "chess");
      return;
    }
    if (this.pose.seat) this.interact();
    if (this.nearPool()) {
      this.openPool();
      return;
    }
    this.route = walkPath(this.preset, this.pose, {
      x: POOL.x + 1.8,
      z: POOL.z + 1.5,
    });
    this.routeEnd = () => this.openPool();
  }
  private stroke(state: PoolState, id = this.self) {
    return poolStroke(
      state,
      this.data.people.find((p) => p.id === id)?.profile.avatar3d,
    );
  }
  private poolReady() {
    if (!this.poolActive || !this.data.pool) return false;
    const stroke = this.stroke({
      ...this.data.pool,
      aim: { actor: this.self, angle: this.poolAngle, power: this.poolPower },
      shot: undefined,
    });
    return (
      !!this.models.get(this.self)?.avatar.poolAligned &&
      !this.pose.moving &&
      Math.hypot(this.pose.x - stroke.stance.x, this.pose.z - stroke.stance.z) <
        0.18
    );
  }
  private poolPoint(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect(),
      ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const point = ray.ray.intersectPlane(
      new T.Plane(new T.Vector3(0, 1, 0), -POOL.clothY),
      new T.Vector3(),
    );
    if (!point) return;
    const x = (point.x - POOL.x) / POOL.scale,
      z = (point.z - POOL.z) / POOL.scale;
    return Math.abs(x) <= POOL.halfX && Math.abs(z) <= POOL.halfZ
      ? { x, z }
      : undefined;
  }
  setExpanded(value: boolean) {
    this.expanded = value;
    this.clearKeys();
    if (value) this.video.pause();
    else if (this.currentStream) void this.video.play().catch(() => {});
  }
  private resize() {
    const width = this.element.clientWidth,
      height = this.element.clientHeight;
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
  private configureQuality() {
    if (!this.environment || this.quality === this.data.settings.quality)
      return;
    this.quality = this.data.settings.quality;
    this.renderer.shadowMap.enabled = this.quality !== "low";
    this.environment.key.shadow.mapSize.setScalar(
      this.quality === "high" ? 2048 : 1024,
    );
    this.environment.key.shadow.map?.dispose();
    this.environment.key.shadow.map = null;
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.traverse((object) => {
      if (object instanceof T.PointLight)
        object.visible = this.quality !== "low";
      if (object instanceof T.Mesh)
        for (const mat of Array.isArray(object.material)
          ? object.material
          : [object.material])
          if (mat instanceof T.MeshStandardMaterial) {
            if (mat.bumpMap && !mat.userData.bumpMap)
              mat.userData.bumpMap = mat.bumpMap;
            mat.bumpMap =
              this.quality === "low" ? null : (mat.userData.bumpMap ?? null);
            mat.needsUpdate = true;
          }
    });
  }
  private keydown = (event: KeyboardEvent) => {
    this.sounds.unlock();
    if (event.repeat && ["KeyE", "KeyC", "KeyR"].includes(event.code)) return;
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
      ].includes(event.code)
    ) {
      event.preventDefault();
      if (this.rig.mode === "watch") this.returnFromTV();
      if (!this.poolActive) {
        this.route = [];
        this.routeEnd = undefined;
        this.joinRequest = undefined;
      }
      this.keys.add(event.code);
    } else if (event.code === "KeyE") {
      event.preventDefault();
      this.interact();
    } else if (event.code === "KeyC") {
      event.preventDefault();
      this.setCameraMode(this.rig.mode === "free" ? "follow" : "free");
    } else if (event.code === "KeyR") {
      event.preventDefault();
      this.resetCamera();
    } else if (event.code === "Escape" && this.rig.mode === "watch")
      this.returnFromTV();
  };
  private keyup = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private clearKeys = () => {
    this.keys.clear();
    this.velocity.set(0, 0);
    this.drag = null;
    if (this.pose.moving) {
      this.pose.moving = false;
      this.dirty = true;
    }
  };
  private pointerdown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    const canvas = this.renderer.domElement;
    canvas.focus();
    this.sounds.unlock();
    if (this.tableActive && event.button === 0) {
      const rect = canvas.getBoundingClientRect(),
        ray = new T.Raycaster();
      ray.setFromCamera(
        new T.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        this.camera,
      );
      if (this.tableActive === "chess") {
        const square = this.chessTable?.pick(ray),
          state = this.data.games?.chess;
        if (!square || !state) return;
        const moves = state.moves.filter(
          (m) => m.from === this.chessSelected && m.to === square,
        );
        if (moves.length) {
          void this.gameCommand({
            type: "game.act",
            game: "chess",
            revision: state.revision,
            action: {
              type: "move",
              from: this.chessSelected!,
              to: square,
              ...(moves.some((m) => m.promotion)
                ? { promotion: this.chessPromotion }
                : {}),
            },
          }).catch(() => {});
          this.chessSelected = undefined;
        } else
          this.chessSelected = state.moves.some((m) => m.from === square)
            ? square
            : undefined;
        this.chessTable?.select(this.chessSelected);
        return;
      }
      const index = this.trucoTable?.pick(ray),
        state = this.data.games?.truco;
      if (index !== undefined && state)
        void this.gameCommand({
          type: "game.act",
          game: "truco",
          action: { type: "play", index, covered: this.covered },
          revision: state.revision,
        }).catch(() => {});
      return;
    }
    if (this.poolActive && event.button === 0) {
      const s = this.data.pool,
        point = this.poolPoint(event);
      if (point && s?.phase === "placing" && s.players[s.turn] === this.self)
        void this.gameCommand({
          type: "pool.place",
          ...point,
          revision: s.revision,
        }).catch(() => {});
      return;
    }
    this.drag = event.button === 2 ? "pan" : "rotate";
    canvas.setPointerCapture(event.pointerId);
  };
  private pointerup = () => {
    this.drag = null;
  };
  private contextmenu = (event: Event) => event.preventDefault();
  private pointermove = (event: PointerEvent) => {
    if (this.tableActive) {
      if (this.drag === "pan") this.gameYaw -= event.movementX * 0.004;
      return;
    }
    if (this.poolActive) {
      if (this.drag === "pan") {
        this.gameYaw -= event.movementX * 0.006;
        return;
      }
      const s = this.data.pool,
        point = this.poolPoint(event);
      if (point && s?.phase === "aiming" && s.players[s.turn] === this.self) {
        this.poolAngle = Math.atan2(
          point.x - s.balls[0].x,
          -(point.z - s.balls[0].z),
        );
        this.aimDirty = true;
      }
      return;
    }
    if (this.drag === "rotate")
      this.rig.rotate(
        event.movementX,
        event.movementY,
        this.data.settings.sensitivity,
      );
    else if (this.drag === "pan")
      this.rig.pan(event.movementX, event.movementY);
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (this.poolActive) {
      this.gameDistance = T.MathUtils.clamp(
        this.gameDistance * Math.exp(event.deltaY * 0.001),
        2.7,
        5,
      );
      return;
    }
    this.rig.zoom(
      event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? this.element.clientHeight
            : 1),
    );
  };
  private contextlost = (event: Event) => {
    event.preventDefault();
    this.fail(
      "A placa gráfica interrompeu a sala 3D. A chamada continua no modo tradicional.",
    );
  };
  private fitTV = () => {
    if (!this.environment) return;
    const aspect = this.video.videoWidth / this.video.videoHeight || 16 / 9;
    this.environment.screen.scale.set(
      aspect > 16 / 9 ? 1 : aspect / (16 / 9),
      aspect > 16 / 9 ? 16 / 9 / aspect : 1,
      1,
    );
  };
  private nearestSeat() {
    return seats(this.preset)
      .filter(
        (seat) =>
          !seat.game &&
          !this.data.people.some(
            (p) => p.id !== this.self && p.roomPose?.seat === seat.id,
          ),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - this.pose.x, a.z - this.pose.z) -
          Math.hypot(b.x - this.pose.x, b.z - this.pose.z),
      )[0];
  }
  emote(value: NonNullable<RoomPose["emote"]>) {
    this.pose.emote = value;
    this.pose.emoteAt = Date.now();
    this.dirty = true;
  }
  private nearPool() {
    return (
      this.preset !== "cinema" &&
      Math.hypot(this.pose.x - POOL.x, this.pose.z - POOL.z) < 2.9
    );
  }
  private interaction() {
    if (this.pose.seat) return { label: "Levantar", available: true };
    if (
      this.preset !== "cinema" &&
      Math.hypot(
        this.pose.x - GAME_TABLES.truco.x,
        this.pose.z - GAME_TABLES.truco.z,
      ) < 2.7
    )
      return { label: "Jogar Truco Paulista", available: true };
    if (
      this.preset !== "cinema" &&
      Math.hypot(
        this.pose.x - GAME_TABLES.chess.x,
        this.pose.z - GAME_TABLES.chess.z,
      ) < 2.3
    )
      return { label: "Jogar xadrez", available: true };
    const seat = this.nearestSeat();
    return seat && Math.hypot(seat.x - this.pose.x, seat.z - this.pose.z) < 2.35
      ? {
          label:
            seat.kind === "sofa"
              ? "Sentar no sofá"
              : seat.kind === "puff"
                ? "Sentar no puff"
                : "Sentar na poltrona",
          available: true,
        }
      : this.nearPool()
        ? { label: "Jogar sinuca", available: true }
        : { label: "Aproxime-se de um assento", available: false };
  }
  interact() {
    if (!this.ready || this.data.paused) return;
    if (this.pose.seat?.match(/^(truco|chess)-/)) {
      this.leaveGame(this.pose.seat.startsWith("truco-") ? "truco" : "chess");
      return;
    }
    if (
      !this.pose.seat &&
      this.preset !== "cinema" &&
      Math.hypot(
        this.pose.x - GAME_TABLES.truco.x,
        this.pose.z - GAME_TABLES.truco.z,
      ) < 2.7
    ) {
      this.approachGame("truco");
      return;
    }
    if (
      !this.pose.seat &&
      this.preset !== "cinema" &&
      Math.hypot(
        this.pose.x - GAME_TABLES.chess.x,
        this.pose.z - GAME_TABLES.chess.z,
      ) < 2.3
    ) {
      this.approachGame("chess");
      return;
    }
    if (this.pose.seat) {
      const seat = seats(this.preset).find((s) => s.id === this.pose.seat);
      if (!seat) return;
      const front = [Math.sin(seat.yaw) * 1.3, Math.cos(seat.yaw) * 1.3];
      for (const [dx, dz] of [front, [0, 1.3], [1.3, 0], [-1.3, 0], [0, -1.3]])
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
      const seat = this.nearestSeat();
      if (
        this.nearPool() &&
        (!seat ||
          Math.hypot(seat.x - this.pose.x, seat.z - this.pose.z) >= 2.35)
      ) {
        this.openPool();
        return;
      }
      if (
        !seat ||
        Math.hypot(seat.x - this.pose.x, seat.z - this.pose.z) >= 2.35
      )
        return;
      this.pose = {
        x: seat.x,
        z: seat.z,
        yaw: seat.yaw,
        seat: seat.id,
        moving: false,
        emote: this.pose.emote,
        emoteAt: this.pose.emoteAt,
      };
    }
    this.velocity.set(0, 0);
    this.dirty = true;
    this.emit();
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
  private makeAvatar(person: Participant) {
    const appearance = person.profile.avatar3d ?? defaultAvatar,
      avatar = new SocialAvatar(this.assets, appearance),
      resources = new Resources();
    const label = resources.label(
      person.profile.name,
      person.profile.nicknameColor || "#eee8dd",
      256,
      64,
    );
    label.position.y = 2.45;
    label.scale.set(0.95, 0.2375, 1);
    avatar.group.add(label);
    const ring = new T.Mesh(
      resources.keep(new T.RingGeometry(0.38, 0.43, 32)),
      resources.keep(
        new T.MeshBasicMaterial({
          color: "#a1ddbf",
          side: T.DoubleSide,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
      ),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.11;
    avatar.group.add(ring);
    this.scene.add(avatar.group);
    return {
      avatar,
      resources,
      label,
      ring,
      seat: null,
      settling: false,
      signature: JSON.stringify([
        appearance,
        person.profile.name,
        person.profile.nicknameColor,
      ]),
    };
  }
  private emit() {
    if (this.disposed) return;
    this.changed({
      ready: this.ready,
      progress: this.progress,
      mode: this.rig.mode,
      interaction: this.interaction(),
      fps: this.fps,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      poolReady: this.poolReady(),
      poolAngle: this.poolAngle,
    });
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
    if (document.hidden || this.data.paused || this.expanded) {
      this.clearKeys();
      this.flush(time);
      return;
    }
    const environment = this.environment!;
    const truco = this.data.games?.truco;
    if (truco && truco.revision !== this.tableRevision) {
      this.tableRevision = truco.revision;
      this.tableClock = truco.clock;
      this.tableAt = time;
    }
    const cardClock = truco?.paused
      ? truco.clock
      : this.tableClock + time - this.tableAt;
    const sound = (
      type: "raise" | "play" | "win" | "impact" | "accept",
      x: number,
      z: number,
      value?: number,
    ) => {
      if (settings.gameSounds === false) return;
      const distance = Math.hypot(this.pose.x - x, this.pose.z - z),
        gain = Math.max(0, 1 - distance / 10) * settings.volume;
      this.sounds.play(type, value, gain, (x - this.pose.x) / 8);
    };
    if (
      truco?.animation &&
      truco.animation.sequence !== this.soundEvents.truco
    ) {
      const a = truco.animation;
      this.soundEvents.truco = a.sequence;
      if (
        cardClock - a.at < 1500 &&
        ["raise", "play", "win", "accept"].includes(a.type)
      )
        sound(
          a.type as "raise",
          GAME_TABLES.truco.x,
          GAME_TABLES.truco.z,
          a.value,
        );
    }
    const chess = this.data.games?.chess;
    if (chess && chess.revision !== this.chessRevision) {
      this.chessRevision = chess.revision;
      this.chessClock = chess.clock;
      this.chessAt = time;
    }
    const chessClock = chess?.paused
      ? chess.clock
      : this.chessClock + time - this.chessAt;
    if (
      chess?.last &&
      chess.last.sequence !== this.soundEvents.chess &&
      chessClock - chess.last.at >= 250
    ) {
      this.soundEvents.chess = chess.last.sequence;
      if (chessClock - chess.last.at < 1200)
        sound("play", GAME_TABLES.chess.x, GAME_TABLES.chess.z);
    }
    if (this.tableActive === "chess") {
      const index =
          chess?.players.indexOf(
            this.data.people.find((p) => p.id === this.self)?.profile.id ?? "",
          ) ?? -1,
        view = tableCamera("chess", Math.max(0, index));
      this.rig.setGame(
        new T.Vector3(view.position.x, view.position.y, view.position.z),
        new T.Vector3(view.target.x, view.target.y, view.target.z),
      );
    }
    if (this.tableActive === "truco") {
      const index =
          truco?.players.indexOf(
            this.data.people.find((p) => p.id === this.self)?.profile.id ?? "",
          ) ?? -1,
        seat = tableSeat("truco", Math.max(0, index)),
        table = GAME_TABLES.truco;
      const dx = seat.x - table.x,
        dz = seat.z - table.z;
      const view = tableCamera("truco", Math.max(0, index));
      this.rig.setGame(
        new T.Vector3(view.position.x, view.position.y, view.position.z),
        new T.Vector3(view.target.x, view.target.y, view.target.z),
      );
    }
    this.drawPool = this.poolTimeline.sample() ?? this.data.pool;
    const pool = this.data.pool,
      myPoolTurn = pool?.players[pool.turn] === this.self;
    const drawn = this.drawPool;
    if (
      drawn?.shot &&
      drawn.shot.sequence !== this.soundEvents.pool &&
      drawn.clock - drawn.shot.started >= POOL.contact
    ) {
      this.soundEvents.pool = drawn.shot.sequence;
      if (drawn.clock - drawn.shot.started < 1.2)
        sound("impact", POOL.x, POOL.z);
    }
    if (this.poolActive) {
      this.rig.setGame(
        new T.Vector3(
          POOL.x + Math.sin(this.gameYaw) * this.gameDistance,
          4.5,
          POOL.z + Math.cos(this.gameYaw) * this.gameDistance,
        ),
        new T.Vector3(POOL.x, 1.0, POOL.z),
      );
      if (pool && myPoolTurn && pool.phase === "aiming") {
        if (this.aimDirty && time - this.aimSent > 160) {
          this.aimDirty = false;
          this.aimSent = time;
          void this.gameCommand({
            type: "pool.aim",
            angle: this.poolAngle,
            power: this.poolPower,
          }).catch(() => {});
        }
        const stance = this.stroke({
          ...pool,
          shot: undefined,
          aim: {
            actor: this.self,
            angle: this.poolAngle,
            power: this.poolPower,
          },
        }).stance;
        if (
          time - this.stanceAt > 250 &&
          (!this.stanceTarget ||
            Math.hypot(
              this.stanceTarget.x - stance.x,
              this.stanceTarget.z - stance.z,
            ) > 0.06 ||
            Math.abs(
              Math.atan2(
                Math.sin(this.stanceTarget.yaw - stance.yaw),
                Math.cos(this.stanceTarget.yaw - stance.yaw),
              ),
            ) > 0.04)
        ) {
          this.stanceAt = time;
          this.stanceTarget = stance;
          this.route = walkPath(this.preset, this.pose, stance);
          this.routeEnd = () => {
            this.pose.yaw = stance.yaw;
            this.dirty = true;
          };
        }
      }
    }
    this.poolTable?.update(
      drawn,
      dt,
      pool?.players.map(
        (id) =>
          this.data.people.find((p) => p.id === id)?.profile.name ?? "Jogador",
      ),
      this.poolActive && myPoolTurn ? this.poolAngle : undefined,
    );
    this.configureQuality();
    const ratio = Math.min(
      devicePixelRatio,
      settings.quality === "low"
        ? 1
        : settings.quality === "medium"
          ? 1.35
          : 1.75,
    );
    if (this.pixelRatio !== ratio) {
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
    }
    const input = new T.Vector2(
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
        Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft")),
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) -
        Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")),
    );
    if (input.lengthSq() > 0) input.normalize();
    if (this.pose.seat || this.rig.mode === "watch") input.set(0, 0);
    if (this.poolActive) input.set(0, 0);
    const waypoint = this.route[0];
    if (waypoint) {
      const delta = new T.Vector2(
        waypoint.x - this.pose.x,
        waypoint.z - this.pose.z,
      );
      if (delta.length() < 0.09) {
        this.pose.x = waypoint.x;
        this.pose.z = waypoint.z;
        this.velocity.set(0, 0);
        this.dirty = true;
        this.route.shift();
        if (!this.route.length) {
          this.routeEnd?.();
          this.routeEnd = undefined;
        }
      } else {
        delta.normalize();
        input.set(
          delta.x * Math.cos(this.rig.yaw) - delta.y * Math.sin(this.rig.yaw),
          delta.x * Math.sin(this.rig.yaw) + delta.y * Math.cos(this.rig.yaw),
        );
      }
    }
    this.velocity.lerp(input.multiplyScalar(3.5), 1 - Math.exp(-dt * 14));
    const moving = this.velocity.length() > 0.12 && !this.pose.seat;
    if (moving && this.pose.emote === "sitfloor") {
      this.pose.emote = "none";
      this.dirty = true;
    }
    if (moving) {
      const dx =
          (this.velocity.x * Math.cos(this.rig.yaw) +
            this.velocity.y * Math.sin(this.rig.yaw)) *
          dt,
        dz =
          (-this.velocity.x * Math.sin(this.rig.yaw) +
            this.velocity.y * Math.cos(this.rig.yaw)) *
          dt;
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
    if (this.joinRequest && !this.pending && !this.dirty) {
      const request = this.joinRequest,
        seat = tableSeat(request.kind, request.index),
        confirmed = this.data.people.find((p) => p.id === this.self)?.roomPose;
      if (
        confirmed &&
        Math.hypot(confirmed.x - seat.x, confirmed.z - seat.z) < 0.94
      ) {
        this.joinRequest = undefined;
        void this.gameCommand({
          type: "game.join",
          game: request.kind,
          seat: request.index,
        })
          .then(() => {
            this.tableActive = request.kind;
          })
          .catch(() => {});
      }
    }
    this.audio(this.pose, this.rig.yaw);
    const visible = new Set(
      this.data.people
        .filter((p) => p.id === this.self || p.roomPose)
        .map((p) => p.id),
    );
    for (const [id, model] of this.models)
      if (!visible.has(id)) {
        model.avatar.dispose();
        model.resources.dispose();
        this.models.delete(id);
      }
    for (const person of this.data.people) {
      const pose = person.id === this.self ? this.pose : person.roomPose;
      if (!pose) continue;
      let model = this.models.get(person.id);
      const signature = JSON.stringify([
        person.profile.avatar3d ?? defaultAvatar,
        person.profile.name,
        person.profile.nicknameColor,
      ]);
      if (model && model.signature !== signature) {
        model.avatar.dispose();
        model.resources.dispose();
        this.models.delete(person.id);
        model = undefined;
      }
      if (!model) {
        model = this.makeAvatar(person);
        model.avatar.group.position.set(pose.x, 0, pose.z);
        this.models.set(person.id, model);
      }
      const group = model.avatar.group;
      if (model.seat !== pose.seat) model.settling = true;
      const target = new T.Vector3(pose.x, 0, pose.z);
      group.position.lerp(
        target,
        model.settling
          ? 1 - Math.exp(-dt * 10)
          : person.id === this.self
            ? 1
            : 1 - Math.exp(-dt * 14),
      );
      if (group.position.distanceToSquared(target) < 0.000625)
        model.settling = false;
      group.rotation.y +=
        Math.atan2(
          Math.sin(pose.yaw - group.rotation.y),
          Math.cos(pose.yaw - group.rotation.y),
        ) *
        (1 - Math.exp(-dt * 15));
      model.avatar.update(
        dt,
        pose.moving,
        !!pose.seat,
        pose.seat?.startsWith("puff")
          ? 0.7
          : pose.seat?.startsWith("truco-") || pose.seat?.startsWith("chess-")
            ? 0.62
            : 0.74,
        person.id === this.self && this.preview
          ? { ...pose, emote: this.preview, emoteAt: this.previewAt }
          : pose,
        settings.smokeEffects !== false,
        (() => {
          if (!drawn) return undefined;
          const st = this.stroke(
            person.id === this.self && myPoolTurn && drawn.phase === "aiming"
              ? {
                  ...drawn,
                  shot: undefined,
                  aim: {
                    actor: this.self,
                    angle: this.poolAngle,
                    power: this.poolPower,
                  },
                }
              : drawn,
            person.id,
          );
          if (
            st.actor !== person.id ||
            (!st.active && drawn.phase !== "aiming") ||
            pose.moving ||
            Math.hypot(pose.x - st.stance.x, pose.z - st.stance.z) > 0.27
          )
            return undefined;
          return st;
        })(),
        !!pool?.players.includes(person.id),
        truco && pose.seat?.startsWith("truco-")
          ? cardMotion(truco, Number(pose.seat.split("-")[1]), cardClock)
          : chess && pose.seat?.startsWith("chess-")
            ? chessMotion(chess, Number(pose.seat.split("-")[1]), chessClock)
            : undefined,
      );
      model.seat = pose.seat;
      model.label.position.y =
        (pose.seat ? 1.92 : 2.45) * (person.profile.avatar3d?.height ?? 1);
      model.label.visible =
        person.id !== this.self &&
        settings.names &&
        this.rig.mode !== "watch" &&
        !this.poolActive &&
        !this.tableActive;
      model.ring.visible = this.data.speaking.has(person.id) && !person.muted;
    }
    this.trucoTable?.update(
      truco,
      this.data.people.find((p) => p.id === this.self)?.profile.id ?? "",
      cardClock,
      (seat, index) => {
        const id = truco?.players[seat],
          person = this.data.people.find((p) => p.profile.id === id);
        return person
          ? this.models.get(person.id)?.avatar.handWorld(index)
          : undefined;
      },
    );
    this.chessTable?.update(chess, chessClock);
    const nearest = this.nearestSeat();
    for (const [id, marker] of environment.seatMarkers)
      marker.visible =
        !this.pose.seat &&
        nearest?.id === id &&
        this.interaction().available &&
        this.rig.mode !== "watch";
    if (this.currentStream !== this.data.stream) {
      this.currentStream = this.data.stream;
      this.texture?.dispose();
      this.texture = undefined;
      this.video.srcObject = this.currentStream ?? null;
      environment.screen.material.map = environment.poster;
      environment.screen.scale.set(1, 1, 1);
      if (this.currentStream) {
        this.texture = new T.VideoTexture(this.video);
        this.texture.colorSpace = T.SRGBColorSpace;
        environment.screen.material.map = this.texture;
        void this.video.play().catch(() => {});
      } else if (this.rig.mode === "watch") this.returnFromTV();
      environment.screen.material.needsUpdate = true;
    }
    this.scene.updateMatrixWorld(true);
    this.rig.update(dt, this.pose, environment.colliders);
    if (time - this.shadowAt > 100) {
      this.shadowAt = time;
      this.renderer.shadowMap.needsUpdate = true;
    }
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      this.fail(
        "Não foi possível renderizar a sala. A chamada continua no modo tradicional.",
      );
      return;
    }
    this.frames++;
    if (time - this.fpsAt > 1000) {
      this.fps = (this.frames * 1000) / (time - this.fpsAt);
      this.frames = 0;
      this.fpsAt = time;
    }
    if (!this.ready) {
      this.ready = true;
      this.progress = 1;
      this.renderer.domElement.dataset.ready = "true";
      this.emit();
    }
    if (time - this.stateSentAt > 180) {
      this.stateSentAt = time;
      this.emit();
    }
  };
  dispose() {
    if (this.disposed) return;
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
    for (const model of this.models.values()) {
      model.avatar.dispose();
      model.resources.dispose();
    }
    this.models.clear();
    this.poolTable?.dispose();
    this.trucoTable?.dispose();
    this.chessTable?.dispose();
    this.sounds.dispose();
    this.environment?.dispose();
    this.assets.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
