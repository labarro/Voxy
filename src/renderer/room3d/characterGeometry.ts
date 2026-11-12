import * as T from "three";
import type { Avatar3D } from "../../shared/types";
import { Resources } from "./resources";

export type Ring = [y: number, radiusX: number, radiusZ: number, z?: number];
export function smoothRadialNormals(g: T.BufferGeometry, segments: number) {
  const n = g.getAttribute("normal"),
    width = segments + 1;
  for (let first = 0; first < n.count; first += width) {
    const last = first + segments;
    if (last >= n.count) break;
    const normal = new T.Vector3()
      .fromBufferAttribute(n, first)
      .add(new T.Vector3().fromBufferAttribute(n, last))
      .normalize();
    n.setXYZ(first, normal.x, normal.y, normal.z);
    n.setXYZ(last, normal.x, normal.y, normal.z);
  }
}
// Smooth elliptical sections, shared vertices and computed normals. All profiles
// describe the silhouette itself, rather than stacking overlapping primitives.
export function profileGeometry(rings: Ring[], segments = 20) {
  const points: number[] = [],
    indices: number[] = [];
  rings.forEach(([y, rx, rz, z = 0], j) => {
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      points.push(Math.sin(t) * rx, y, Math.cos(t) * rz + z);
      if (j && i) {
        const b = j * (segments + 1) + i;
        indices.push(
          b,
          b - 1,
          b - segments - 1,
          b - 1,
          b - segments - 2,
          b - segments - 1,
        );
      }
    }
  });
  if (rings[rings.length - 1][0] < rings[0][0])
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  smoothRadialNormals(g, segments);
  return g;
}
export function surface(
  r: Resources,
  parent: T.Object3D,
  rings: Ring[],
  color: string,
  segments = 20,
) {
  const mesh = new T.Mesh(
    r.keep(profileGeometry(rings, segments)),
    r.material(color, 0.86),
  );
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function swept(
  r: Resources,
  parent: T.Object3D,
  points: number[][],
  radii: number[],
  color: string,
  radial = 10,
  steps = 32,
  braided = false,
) {
  const curve = new T.CatmullRomCurve3(
    points.map((p) => new T.Vector3(...(p as [number, number, number]))),
  );
  const g = new T.TubeGeometry(curve, steps, 1, radial, false),
    p = g.getAttribute("position");
  for (let i = 0; i <= steps; i++) {
    const center = curve.getPointAt(i / steps),
      at = (i / steps) * (radii.length - 1),
      k = Math.min(radii.length - 2, Math.floor(at)),
      radius = T.MathUtils.lerp(radii[k], radii[k + 1], at - k);
    for (let j = 0; j <= radial; j++) {
      const n = i * (radial + 1) + j;
      const v = new T.Vector3()
        .fromBufferAttribute(p, n)
        .sub(center)
        .multiplyScalar(
          radius *
            (braided
              ? 1 +
                0.13 *
                  Math.cos(
                    (j / radial) * Math.PI * 6 + (i / steps) * Math.PI * 16,
                  )
              : 1),
        )
        .add(center);
      p.setXYZ(n, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  smoothRadialNormals(g, radial);
  const mesh = new T.Mesh(r.keep(g), r.material(color, 0.88));
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function skinnedLimb(
  r: Resources,
  parent: T.Object3D,
  length: number,
  joint: number,
  rings: Ring[],
  colorAt: (y: number) => string,
) {
  const geometry = r.keep(profileGeometry(rings, 16)),
    p = geometry.getAttribute("position"),
    weights: number[] = [],
    bones: number[] = [],
    colors: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i),
      w = T.MathUtils.smoothstep(-y, joint - 0.09, joint + 0.09);
    weights.push(1 - w, w, 0, 0);
    bones.push(0, 1, 0, 0);
    new T.Color(colorAt(y)).toArray(colors, i * 3);
  }
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(bones, 4));
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  const material = r.keep(
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.87 }),
  );
  const mesh = new T.SkinnedMesh(geometry, material),
    upper = new T.Bone(),
    lower = new T.Bone();
  upper.name = "limb-root";
  lower.name = "limb-bend";
  lower.position.y = -joint;
  upper.add(lower);
  parent.add(upper, mesh);
  parent.updateMatrixWorld(true);
  const skeleton = new T.Skeleton([upper, lower]);
  mesh.bind(skeleton);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.dynamic = true;
  return { lower, skeleton, mesh };
}

export function buildHair(
  r: Resources,
  parent: T.Object3D,
  a: Avatar3D,
  rx: number,
  ry: number,
  rz: number,
  headwear: boolean,
) {
  const style = a.hairStyle ?? a.hair;
  if (style === "bald") return;
  const long = ["long", "wavy", "bob"].includes(style),
    close = headwear || style === "buzz";
  const segments = 48,
    rows = 18,
    vertices: number[] = [],
    indices: number[] = [],
    colors: number[] = [];
  const base = new T.Color(a.hairColor),
    secondary = new T.Color(a.hairSecondary ?? a.hairColor);
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= segments; i++) {
      const t = j / rows,
        phi = (i / segments) * Math.PI * 2,
        front = Math.max(0, Math.cos(phi)),
        back = 1 - front;
      const hairline =
        (style === "afro" ? 1.28 : 1.22) +
        0.55 * (1 - T.MathUtils.smoothstep(front, 0.12, 0.7)) +
        (style === "short" ? 0.11 * Math.sin(phi) : 0.025 * Math.sin(phi * 3));
      const theta = t * hairline,
        curtain = long
          ? (style === "bob" ? 0.17 : 0.43) *
            Math.pow(t, 5) *
            Math.pow(back, 0.4)
          : 0;
      const volume = close
        ? 0.007
        : style === "afro"
          ? 0.135
          : style === "curly"
            ? 0.085
            : 0.028;
      const curl =
        !close && ["afro", "curly"].includes(style)
          ? (style === "curly" ? 0.025 : 0.022) *
            Math.sin(phi * 11 + t * 10) *
            Math.sin(theta)
          : 0;
      const sweep =
        !close && ["short", "crest"].includes(style)
          ? (style === "crest" ? 0.12 : 0.055) *
            Math.exp(
              -(
                (Math.atan2(Math.sin(phi - 5.65), Math.cos(phi - 5.65)) /
                  0.75) **
                2
              ),
            ) *
            Math.sin(theta * 1.8)
          : 0;
      const wave =
        style === "wavy" ? 0.018 * Math.sin(t * 13 + phi * 4) * back : 0;
      const radial = Math.sin(theta),
        lift = volume + curl + wave;
      const shape = (v: number) =>
        Math.sign(v) *
        Math.pow(Math.abs(v), a.headShape === "square" ? 2 / 2.6 : 1);
      vertices.push(
        shape(Math.sin(phi) * radial) * (rx + lift),
        (ry + volume * 0.8) * shape(Math.cos(theta)) +
          Math.max(0, sweep) -
          curtain,
        shape(Math.cos(phi) * radial) * (rz + lift) -
          (long ? 0.13 * Math.pow(t, 5) * (1 - front) : 0),
      );
      // The scalp must use the same implicit surface as the chosen head. Keep
      // the root layer outside that surface even where the curtain bends back.
      const at = vertices.length - 3,
        power = a.headShape === "square" ? 2.6 : 2;
      const implicit =
        Math.abs(vertices[at] / rx) ** power +
        Math.abs(vertices[at + 1] / ry) ** power +
        Math.abs(vertices[at + 2] / rz) ** power;
      if (implicit < 1.025) {
        const factor = Math.pow(1.025 / implicit, 1 / power);
        for (let c = 0; c < 3; c++) vertices[at + c] *= factor;
      }
      const highlight =
        a.hairSecondary && !headwear
          ? Math.exp(
              -(
                (Math.atan2(Math.sin(phi + 0.48), Math.cos(phi + 0.48)) /
                  0.11) **
                2
              ),
            ) * 0.78
          : 0;
      const shade = 1 - 0.045 * Math.sin(phi * 18 + t * 4) ** 2;
      base
        .clone()
        .lerp(secondary, highlight)
        .multiplyScalar(shade)
        .toArray(colors, (j * (segments + 1) + i) * 3);
      if (j && i) {
        const b = j * (segments + 1) + i;
        indices.push(
          b,
          b - segments - 1,
          b - 1,
          b - 1,
          b - segments - 1,
          b - segments - 2,
        );
      }
    }
  const g = r.keep(new T.BufferGeometry());
  g.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  smoothRadialNormals(g, segments);
  const material = r.keep(
    new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      side: T.DoubleSide,
    }),
  );
  const hair = new T.Mesh(g, material);
  hair.name = "continuous-hair-" + style;
  hair.castShadow = hair.receiveShadow = true;
  parent.add(hair);
  if (headwear) return;
  if (style === "ponytail")
    swept(
      r,
      parent,
      [
        [0, 0.17, -0.25],
        [0, 0.14, -0.39],
        [0.045, -0.08, -0.46],
        [0.08, -0.37, -0.36],
      ],
      [0.075, 0.105, 0.085, 0.008],
      a.hairColor,
    );
  if (style === "bun")
    swept(
      r,
      parent,
      [
        [0, 0.24, -0.22],
        [-0.075, 0.36, -0.28],
        [0, 0.43, -0.35],
        [0.09, 0.36, -0.31],
        [0, 0.25, -0.26],
      ],
      [0.06, 0.09, 0.095, 0.08, 0.04],
      a.hairColor,
      12,
      36,
    );
  if (style === "braids")
    for (const side of [-1, 1]) {
      swept(
        r,
        parent,
        [
          [side * 0.28, 0.06, 0],
          [side * 0.32, -0.12, 0.1],
          [side * 0.29, -0.29, 0.19],
          [side * 0.25, -0.4, 0.2],
        ],
        [0.069, 0.066, 0.05, 0.012],
        a.hairColor,
        14,
        48,
        true,
      );
    }
}

export function headSurface(
  x: number,
  y: number,
  rx: number,
  ry: number,
  rz: number,
  power: number,
) {
  return (
    rz *
    Math.pow(
      Math.max(
        0.001,
        1 -
          Math.pow(Math.abs(x / rx), power) -
          Math.pow(Math.abs(y / ry), power),
      ),
      1 / power,
    )
  );
}
export function buildFace(
  r: Resources,
  parent: T.Object3D,
  a: Avatar3D,
  rx: number,
  ry: number,
  rz: number,
  power: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const c = canvas.getContext("2d")!;
  const x = (v: number) => (v / 0.48 + 0.5) * 512,
    y = (v: number) => ((0.22 - v) / 0.54) * 512;
  c.lineCap = "round";
  c.lineJoin = "round";
  const dark = "#302a30";
  for (const side of [-1, 1]) {
    const ex = side * 0.108,
      ey = 0.027;
    c.fillStyle = dark;
    c.beginPath();
    c.ellipse(
      x(ex),
      y(ey),
      a.eyes === "almond" ? 21 : 17,
      a.face === "calm" || a.eyes === "sleepy" ? 6 : 23,
      side * -0.08,
      0,
      Math.PI * 2,
    );
    c.fill();
    if (a.eyes !== "sleepy" && a.face !== "calm") {
      c.fillStyle = "#fff4e4";
      c.beginPath();
      c.arc(x(ex - 0.008), y(ey + 0.013), 5, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = a.hairColor;
    c.lineWidth = a.brows === "bold" ? 10 : 6;
    c.beginPath();
    c.moveTo(x(ex - 0.035), y(0.105));
    c.quadraticCurveTo(
      x(ex),
      y(a.brows === "arched" ? 0.13 : 0.113),
      x(ex + 0.035),
      y(0.105),
    );
    c.stroke();
  }
  if (a.facialHair && a.facialHair !== "none") {
    c.fillStyle = a.hairColor;
    if (a.facialHair === "mustache") {
      c.beginPath();
      c.ellipse(x(0), y(-0.075), 48, 10, 0, 0, Math.PI * 2);
      c.fill();
    } else {
      c.globalAlpha = a.facialHair === "stubble" ? 0.38 : 1;
      c.beginPath();
      c.moveTo(x(-0.19), y(-0.1));
      c.quadraticCurveTo(x(0), y(-0.4), x(0.19), y(-0.1));
      c.lineTo(x(0.15), y(-0.2));
      c.quadraticCurveTo(x(0), y(-0.34), x(-0.15), y(-0.2));
      c.closePath();
      c.fill();
      c.globalAlpha = 1;
    }
  }
  c.strokeStyle = "#78464c";
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(x(-0.065), y(-0.105));
  c.quadraticCurveTo(
    x(0),
    y(a.face === "calm" ? -0.112 : a.face === "bright" ? -0.17 : -0.145),
    x(0.065),
    y(-0.105),
  );
  c.stroke();
  const map = r.keep(new T.CanvasTexture(canvas));
  map.colorSpace = T.SRGBColorSpace;
  const p: number[] = [],
    uv: number[] = [],
    idx: number[] = [],
    n = 18;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const px = (i / n - 0.5) * 0.48,
        py = 0.22 - (j / n) * 0.54;
      p.push(px, py, headSurface(px, py, rx, ry, rz, power) + 0.0018);
      uv.push(i / n, 1 - j / n);
      if (j && i) {
        const b = j * (n + 1) + i;
        idx.push(b, b - 1, b - n - 1, b - 1, b - n - 2, b - n - 1);
      }
    }
  const g = r.keep(new T.BufferGeometry());
  g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = r.keep(
    new T.MeshStandardMaterial({
      map,
      transparent: true,
      alphaTest: 0.03,
      depthWrite: false,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: T.DoubleSide,
    }),
  );
  const face = new T.Mesh(g, mat);
  face.name = "conforming-face";
  parent.add(face);
}
