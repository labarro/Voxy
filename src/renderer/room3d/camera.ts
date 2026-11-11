import * as T from "three";
import type { RoomPose } from "../../shared/types";

export type CameraMode = "follow" | "free" | "watch";
export class RoomCamera {
  mode: CameraMode = "follow";
  yaw = 0;
  private wantedYaw = 0;
  private pitch = 0.43;
  private wantedPitch = 0.43;
  private distance = 8;
  private wantedDistance = 8;
  private target = new T.Vector3(0, 1.1, 4);
  private freeTarget = new T.Vector3(0, 1.35, 0);
  private position = new T.Vector3(0, 5, 12);
  private ray = new T.Raycaster();
  private first = true;
  private previous: "follow" | "free" = "follow";
  private beforeWatch?: {
    yaw: number;
    pitch: number;
    distance: number;
    target: T.Vector3;
  };
  constructor(readonly camera: T.PerspectiveCamera) {}
  setMode(mode: CameraMode) {
    if (this.mode === mode) return;
    if (mode === "watch") {
      this.previous = this.mode === "free" ? "free" : "follow";
      this.beforeWatch = {
        yaw: this.wantedYaw,
        pitch: this.wantedPitch,
        distance: this.wantedDistance,
        target: this.freeTarget.clone(),
      };
    } else if (mode === "free") {
      this.wantedDistance = 15;
      this.wantedPitch = 0.62;
    } else {
      this.wantedDistance = 8;
      this.wantedPitch = 0.43;
    }
    this.mode = mode;
  }
  leaveWatch() {
    if (this.mode !== "watch") return;
    this.mode = this.previous;
    if (this.beforeWatch) {
      this.wantedYaw = this.beforeWatch.yaw;
      this.wantedPitch = this.beforeWatch.pitch;
      this.wantedDistance = this.beforeWatch.distance;
      this.freeTarget.copy(this.beforeWatch.target);
    }
  }
  reset() {
    this.wantedYaw = 0;
    this.wantedPitch = this.mode === "free" ? 0.62 : 0.43;
    this.wantedDistance = this.mode === "free" ? 15 : 8;
    this.freeTarget.set(0, 1.35, 0);
  }
  rotate(dx: number, dy: number, sensitivity: number) {
    if (this.mode === "watch") return;
    this.wantedYaw -= dx * 0.004 * sensitivity;
    this.wantedPitch = T.MathUtils.clamp(
      this.wantedPitch + dy * 0.003 * sensitivity,
      0.2,
      1.18,
    );
  }
  zoom(delta: number) {
    if (this.mode === "watch") return;
    this.wantedDistance = T.MathUtils.clamp(
      this.wantedDistance * Math.exp(delta * 0.0012),
      this.mode === "free" ? 7 : 3.2,
      this.mode === "free" ? 20 : 13,
    );
  }
  pan(dx: number, dy: number) {
    if (this.mode !== "free") return;
    const scale = (0.012 * this.distance) / 10;
    this.freeTarget.x = T.MathUtils.clamp(
      this.freeTarget.x -
        dx * Math.cos(this.yaw) * scale +
        dy * Math.sin(this.yaw) * scale,
      -5.5,
      5.5,
    );
    this.freeTarget.z = T.MathUtils.clamp(
      this.freeTarget.z +
        dx * Math.sin(this.yaw) * scale +
        dy * Math.cos(this.yaw) * scale,
      -4,
      5.5,
    );
  }
  update(dt: number, pose: RoomPose, colliders: T.Object3D[]) {
    const alpha = 1 - Math.exp(-dt * 9);
    this.yaw +=
      Math.atan2(
        Math.sin(this.wantedYaw - this.yaw),
        Math.cos(this.wantedYaw - this.yaw),
      ) * alpha;
    this.pitch = T.MathUtils.lerp(this.pitch, this.wantedPitch, alpha);
    this.distance = T.MathUtils.lerp(this.distance, this.wantedDistance, alpha);
    let wantedTarget: T.Vector3, wantedPosition: T.Vector3;
    if (this.mode === "watch") {
      wantedTarget = new T.Vector3(0, 3.15, -5.59);
      const fit =
        Math.max(
          4.3875 / (2 * Math.tan(T.MathUtils.degToRad(48) / 2)),
          7.8 /
            (2 * Math.tan(T.MathUtils.degToRad(48) / 2) * this.camera.aspect),
        ) * 1.1;
      wantedPosition = new T.Vector3(0, 3.15, -5.59 + fit);
    } else {
      wantedTarget =
        this.mode === "free"
          ? this.freeTarget.clone()
          : new T.Vector3(pose.x, pose.seat ? 1.05 : 1.25, pose.z - 0.35);
      wantedPosition = new T.Vector3(
        wantedTarget.x +
          Math.sin(this.yaw) * this.distance * Math.cos(this.pitch),
        wantedTarget.y + this.distance * Math.sin(this.pitch),
        wantedTarget.z +
          Math.cos(this.yaw) * this.distance * Math.cos(this.pitch),
      );
      const direction = wantedPosition.clone().sub(wantedTarget),
        length = direction.length();
      this.ray.set(wantedTarget, direction.normalize());
      this.ray.far = length;
      const hit = this.ray
        .intersectObjects(colliders, true)
        .find((h) => h.distance > 0.5);
      if (hit)
        wantedPosition
          .copy(wantedTarget)
          .addScaledVector(direction, Math.max(0.6, hit.distance - 0.22));
    }
    if (this.first) {
      this.first = false;
      this.target.copy(wantedTarget);
      this.position.copy(wantedPosition);
    } else {
      this.target.lerp(wantedTarget, alpha);
      this.position.lerp(wantedPosition, alpha);
    }
    // A second ray prevents a smoothed transition from crossing a wall on the way.
    if (this.mode !== "watch") {
      const direction = this.position.clone().sub(this.target),
        length = direction.length();
      this.ray.set(this.target, direction.normalize());
      this.ray.far = length;
      const hit = this.ray
        .intersectObjects(colliders, true)
        .find((h) => h.distance > 0.5);
      if (hit)
        this.position
          .copy(this.target)
          .addScaledVector(direction, Math.max(0.6, hit.distance - 0.18));
    }
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
    const fov = T.MathUtils.lerp(
      this.camera.fov,
      this.mode === "watch" ? 48 : 55,
      alpha,
    );
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
