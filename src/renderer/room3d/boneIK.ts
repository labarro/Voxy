import * as T from "three";

const q = new T.Quaternion(),
  pq = new T.Quaternion(),
  wq = new T.Quaternion();

function rotateTowards(
  bone: T.Object3D,
  from: T.Vector3,
  to: T.Vector3,
  weight: number,
) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  if (weight < 1) q.slerp(new T.Quaternion(), 1 - weight);
  bone.parent!.getWorldQuaternion(pq);
  bone.getWorldQuaternion(wq);
  bone.quaternion.copy(pq.invert().multiply(q).multiply(wq));
  bone.updateMatrixWorld(true);
}

// Analytic two-bone IK on skeleton bones, in world space. The effector is a
// point carried by the hand (palm frame) so held props land on the target.
// Returns the remaining distance between effector and target.
export function boneIK(
  upper: T.Bone,
  lower: T.Bone,
  hand: T.Bone,
  target: T.Vector3,
  pole: T.Vector3,
  weight = 1,
  effector: T.Object3D = hand,
) {
  upper.updateWorldMatrix(true, true);
  const s = upper.getWorldPosition(new T.Vector3()),
    e = lower.getWorldPosition(new T.Vector3()),
    w = effector.getWorldPosition(new T.Vector3());
  const a = s.distanceTo(e),
    b = e.distanceTo(w);
  const toTarget = target.clone().sub(s);
  const d = T.MathUtils.clamp(
    toTarget.length(),
    Math.abs(a - b) + 1e-4,
    a + b - 1e-4,
  );
  const dir = toTarget.normalize();
  const x = (a * a - b * b + d * d) / (2 * d),
    h = Math.sqrt(Math.max(0, a * a - x * x));
  const bend = pole.clone().sub(s);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0).addScaledVector(dir, -dir.y);
  bend.normalize();
  const elbow = s.clone().addScaledVector(dir, x).addScaledVector(bend, h);
  rotateTowards(upper, e.clone().sub(s), elbow.clone().sub(s), weight);
  const e2 = lower.getWorldPosition(new T.Vector3()),
    w2 = effector.getWorldPosition(new T.Vector3());
  const goal = s.clone().addScaledVector(dir, d);
  rotateTowards(lower, w2.clone().sub(e2), goal.sub(e2), weight);
  return effector.getWorldPosition(new T.Vector3()).distanceTo(target);
}
