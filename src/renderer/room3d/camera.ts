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
  private freeTarget = new T.Vector3(0, 2.2, 0);
  private position = new T.Vector3(0, 5, 12);
  private ray = new T.Raycaster();
  private collisionRadius = 0.24;
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
      this.wantedDistance = 9;
      this.wantedPitch = 0.42;
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
    this.wantedPitch = this.mode === "free" ? 0.42 : 0.43;
    this.wantedDistance = this.mode === "free" ? 9 : 8;
    this.freeTarget.set(0, 2.2, 0);
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
      -11,
      11,
    );
    this.freeTarget.z = T.MathUtils.clamp(
      this.freeTarget.z +
        dx * Math.sin(this.yaw) * scale +
        dy * Math.cos(this.yaw) * scale,
      -8,
      11,
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
      wantedTarget = new T.Vector3(0, 3.15, -10.59);
      const fit =
        Math.max(
          4.3875 / (2 * Math.tan(T.MathUtils.degToRad(48) / 2)),
          7.8 /
            (2 * Math.tan(T.MathUtils.degToRad(48) / 2) * this.camera.aspect),
        ) * 1.1;
      wantedPosition = new T.Vector3(0, 3.15, -10.59 + fit);
    } else {
      wantedTarget =
        this.mode === "free"
          ? this.freeTarget.clone()
          : new T.Vector3(pose.x, pose.seat ? 1.85 : 1.55, pose.z);
      wantedPosition = new T.Vector3(
        wantedTarget.x +
          Math.sin(this.yaw) * this.distance * Math.cos(this.pitch),
        wantedTarget.y + this.distance * Math.sin(this.pitch),
        wantedTarget.z +
          Math.cos(this.yaw) * this.distance * Math.cos(this.pitch),
      );
      wantedPosition = this.resolve(wantedTarget, wantedPosition, colliders);
      // If a wall or a seat blocks the requested orbit at short range, find an
      // unobstructed shoulder orbit. Never shorten through the avatar capsule.
      if (wantedPosition.distanceTo(wantedTarget) < 2.15) {
        let best = wantedPosition,
          bestDistance = best.distanceTo(wantedTarget);
        for (const offset of [
          Math.PI / 4,
          -Math.PI / 4,
          Math.PI / 2,
          -Math.PI / 2,
          Math.PI,
        ]) {
          const candidate = this.resolve(
            wantedTarget,
            new T.Vector3(
              wantedTarget.x + Math.sin(this.yaw + offset) * 4,
              wantedTarget.y + 2,
              wantedTarget.z + Math.cos(this.yaw + offset) * 4,
            ),
            colliders,
          );
          const distance = candidate.distanceTo(wantedTarget);
          if (distance > bestDistance) {
            best = candidate;
            bestDistance = distance;
          }
          if (bestDistance >= 3) break;
        }
        wantedPosition = best;
      }
    }
    if (this.first) {
      this.first = false;
      this.target.copy(wantedTarget);
      this.position.copy(wantedPosition);
    } else {
      this.target.lerp(wantedTarget, alpha);
      this.position.lerp(wantedPosition, alpha);
    }
    // Resolve the interpolated path too: a valid destination does not imply a
    // valid transition. Five rays approximate the near-plane swept volume.
    this.position.copy(this.resolve(this.target, this.position, colliders));
    const capsule = new T.Vector3(
      pose.x,
      T.MathUtils.clamp(this.position.y, 0.35, pose.seat ? 2.15 : 2.35),
      pose.z,
    );
    if (this.position.distanceTo(capsule) < 0.95) {
      this.position.copy(this.resolve(this.target, wantedPosition, colliders));
      const nearest = new T.Vector3(
        pose.x,
        T.MathUtils.clamp(this.position.y, 0.35, pose.seat ? 2.15 : 2.35),
        pose.z,
      );
      if (this.position.distanceTo(nearest) < 0.95)
        this.position.y = Math.max(this.position.y, pose.seat ? 3.15 : 3.35);
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
  private resolve(
    target: T.Vector3,
    position: T.Vector3,
    colliders: T.Object3D[],
  ) {
    const end = position.clone();
    // The architecture is closed. These bounds also protect from grazing rays
    // at wall/ceiling seams and keep the near plane on the interior side.
    end.set(
      T.MathUtils.clamp(end.x, -12.63, 12.63),
      T.MathUtils.clamp(end.y, 0.4, 5.78),
      T.MathUtils.clamp(end.z, -10.62, 12.7),
    );
    const direction = end.clone().sub(target),
      length = direction.length();
    if (length < 0.001) return end;
    direction.normalize();
    let safe = length;
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const origin = target
        .clone()
        .add(
          new T.Vector3(x * this.collisionRadius, y * this.collisionRadius, 0),
        );
      this.ray.set(origin, direction);
      this.ray.near = 0.06;
      this.ray.far = length + 0.25;
      const hit = this.ray.intersectObjects(colliders, true)[0];
      if (hit)
        safe = Math.min(
          safe,
          Math.max(0.08, hit.distance - this.collisionRadius),
        );
    }
    return target.clone().addScaledVector(direction, safe);
  }
}
