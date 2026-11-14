import * as T from "three";
// Analytic two-bone IK. Targets are world coordinates; solving in the shoulder's
// parent frame keeps the same rig usable with avatar proportions and animation.
export function armIK(
  shoulder: T.Object3D,
  elbow: T.Object3D,
  target: T.Vector3,
  side: number,
) {
  const parent = shoulder.parent!;
  parent.updateWorldMatrix(true, false);
  const root = shoulder.position.clone(),
    goal = parent.worldToLocal(target.clone());
  const delta = goal.sub(root),
    distance = T.MathUtils.clamp(delta.length(), 0.081, 0.619),
    direction = delta.normalize();
  const upper = 0.27,
    lower = 0.35,
    a = (upper * upper - lower * lower + distance * distance) / (2 * distance),
    h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const pole = new T.Vector3(side * 0.7, -0.2, -0.5);
  pole.addScaledVector(direction, -pole.dot(direction));
  if (pole.lengthSq() < 1e-6)
    pole.set(0, 0, 1).addScaledVector(direction, -direction.z);
  pole.normalize();
  const bend = root
    .clone()
    .addScaledVector(direction, a)
    .addScaledVector(pole, h);
  shoulder.quaternion.setFromUnitVectors(
    new T.Vector3(0, -1, 0),
    bend.clone().sub(root).normalize(),
  );
  const end = root.clone().addScaledVector(direction, distance);
  elbow.quaternion.setFromUnitVectors(
    new T.Vector3(0, -1, 0),
    end
      .sub(bend)
      .normalize()
      .applyQuaternion(shoulder.quaternion.clone().invert()),
  );
  shoulder.updateWorldMatrix(true, true);
  return elbow.localToWorld(new T.Vector3(0, -0.35, 0)).distanceTo(target);
}
