import * as T from "three";
import { Resources } from "./resources";
export function chessPiece(r: Resources, type: string, color: string) {
  const group = new T.Group(),
    mat = r.material(color === "w" ? "#eadfc7" : "#263735", 0.31, 0.08);
  const profile: [[number, number], ...number[][]] = [
    [0.027, 0],
    [0.031, 0.008],
    [0.031, 0.014],
    [0.026, 0.02],
    [0.021, 0.024],
    [0.018, 0.035],
    [0.012, 0.048],
    [0.011, type === "p" ? 0.064 : 0.086],
    [0.019, type === "p" ? 0.071 : 0.093],
    [0.02, type === "p" ? 0.077 : 0.102],
  ];
  const mesh = new T.Mesh(
    r.keep(
      new T.LatheGeometry(
        profile.map(([x, y]) => new T.Vector2(x, y)),
        20,
      ),
    ),
    mat,
  );
  mesh.castShadow = true;
  group.add(mesh);
  const ball = (y: number, radius: number) =>
    r.sphere(group, 0, y, 0, radius, color === "w" ? "#eadfc7" : "#263735");
  if (type === "p") ball(0.092, 0.018);
  if (type === "r") {
    r.cylinder(
      group,
      0,
      0.117,
      0,
      0.026,
      0.021,
      0.03,
      color === "w" ? "#eadfc7" : "#263735",
    );
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      r.box(
        group,
        Math.sin(a) * 0.02,
        0.14,
        Math.cos(a) * 0.02,
        0.017,
        0.022,
        0.017,
        mat,
        0.002,
      );
    }
  }
  if (type === "b") {
    const shape = new T.Shape();
    shape.moveTo(-0.018, 0);
    shape.quadraticCurveTo(-0.033, 0.024, 0, 0.047);
    shape.lineTo(0.016, 0.026);
    shape.lineTo(-0.005, 0.007);
    shape.lineTo(0.022, 0.02);
    shape.quadraticCurveTo(0.028, 0.005, 0.018, 0);
    shape.closePath();
    const head = new T.Mesh(
      r.keep(
        new T.ExtrudeGeometry(shape, {
          depth: 0.02,
          bevelEnabled: true,
          bevelSize: 0.003,
          bevelThickness: 0.003,
          bevelSegments: 2,
          steps: 1,
        }),
      ),
      mat,
    );
    head.position.set(0, 0.102, -0.01);
    group.add(head);
  }
  if (type === "q") {
    r.cylinder(
      group,
      0,
      0.118,
      0,
      0.025,
      0.013,
      0.032,
      color === "w" ? "#eadfc7" : "#263735",
    );
    for (let i = 0; i < 7; i++) {
      const a = (i * Math.PI * 2) / 7;
      r.sphere(
        group,
        Math.sin(a) * 0.023,
        0.14,
        Math.cos(a) * 0.023,
        0.005,
        color === "w" ? "#eadfc7" : "#263735",
      );
    }
    ball(0.15, 0.008);
  }
  if (type === "k") {
    r.cylinder(
      group,
      0,
      0.116,
      0,
      0.022,
      0.015,
      0.028,
      color === "w" ? "#eadfc7" : "#263735",
    );
    r.box(group, 0, 0.151, 0, 0.01, 0.052, 0.01, mat, 0.002);
    r.box(group, 0, 0.159, 0, 0.034, 0.01, 0.01, mat, 0.002);
  }
  if (type === "n") {
    const head = new T.Shape();
    head.moveTo(-0.02, 0);
    head.bezierCurveTo(-0.031, 0.028, -0.024, 0.046, -0.006, 0.06);
    head.lineTo(-0.004, 0.076);
    head.lineTo(0.007, 0.065);
    head.lineTo(0.021, 0.059);
    head.lineTo(0.032, 0.037);
    head.lineTo(0.024, 0.03);
    head.lineTo(0.007, 0.04);
    head.quadraticCurveTo(0.018, 0.014, 0.021, 0);
    head.closePath();
    const horse = new T.Mesh(
      r.keep(
        new T.ExtrudeGeometry(head, {
          depth: 0.026,
          bevelEnabled: true,
          bevelSize: 0.003,
          bevelThickness: 0.002,
          bevelSegments: 2,
          steps: 1,
        }),
      ),
      mat,
    );
    horse.position.set(0, 0.098, -0.013);
    group.add(horse);
    for (const z of [-0.018, 0.018])
      r.sphere(
        group,
        0.012,
        0.148,
        z,
        0.0025,
        color === "w" ? "#263735" : "#d9caa7",
      );
  }
  return group;
}
