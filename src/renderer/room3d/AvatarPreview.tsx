import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Avatar3D } from "../../shared/types";
import { RoomAssets } from "./assets";
import { SocialAvatar } from "./avatar";
import { Resources } from "./resources";

export function AvatarPreview({
  appearance,
  pose = "idle",
  reset = 0,
}: {
  appearance: Avatar3D;
  pose?: "idle" | "walk" | "sit";
  reset?: number;
}) {
  const mount = useRef<HTMLDivElement>(null),
    current = useRef({ appearance, pose });
  current.current = { appearance, pose };
  const controller = useRef<
    { refresh: () => void; reset: () => void } | undefined
  >(undefined);
  const [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const signature = JSON.stringify(appearance);
  useEffect(() => {
    setProgress(0);
    setError("");
    const element = mount.current!;
    let renderer: T.WebGLRenderer | undefined,
      avatar: SocialAvatar | undefined,
      disposed = false,
      lost = false,
      frame = 0,
      observer: ResizeObserver | undefined,
      controls: OrbitControls | undefined;
    const assets = new RoomAssets(),
      resources = new Resources(),
      scene = new T.Scene();
    const camera = new T.PerspectiveCamera(36, 1, 0.1, 30);
    const contextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      setError(
        "O preview foi interrompido pela placa gráfica. Suas escolhas continuam aqui.",
      );
    };
    camera.position.set(2.6, 1.8, 4.8);
    try {
      renderer = new T.WebGLRenderer({
        alpha: false,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      scene.background = new T.Color("#273337");
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute(
        "aria-label",
        "Preview 3D do personagem. Arraste para girar.",
      );
      element.appendChild(renderer.domElement);
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      scene.add(new T.HemisphereLight("#f5e9d8", "#64717f", 2));
      const key = new T.DirectionalLight("#ffe0b0", 3);
      key.position.set(-3, 5, -4);
      scene.add(key);
      const rim = new T.DirectionalLight("#b9bdf2", 2);
      rim.position.set(4, 3, 3);
      scene.add(rim);
      resources.cylinder(scene, 0, -0.1, 0, 1.05, 1.1, 0.18, "#475158");
      const stool = resources.cylinder(
        scene,
        0,
        0.27,
        0,
        0.43,
        0.38,
        0.54,
        "#8b6c63",
      );
      stool.visible = false;
      const shadow = document.createElement("canvas");
      shadow.width = shadow.height = 64;
      const ctx = shadow.getContext("2d")!,
        gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      gradient.addColorStop(0, "rgba(10,15,25,.6)");
      gradient.addColorStop(1, "rgba(10,15,25,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
      const plane = new T.Mesh(
        resources.keep(new T.PlaneGeometry(1.7, 1.7)),
        resources.keep(
          new T.MeshBasicMaterial({
            map: resources.keep(new T.CanvasTexture(shadow)),
            transparent: true,
            depthWrite: false,
          }),
        ),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 0.003;
      scene.add(plane);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.09;
      controls.enablePan = false;
      controls.enableZoom = true;
      controls.minDistance = 2.4;
      controls.maxDistance = 7;
      controls.minPolarAngle = 0.65;
      controls.maxPolarAngle = 1.7;
      controls.update();
      controls.saveState();
      const resize = () => {
        const width = element.clientWidth,
          height = element.clientHeight;
        renderer!.setSize(Math.max(1, width), Math.max(1, height));
        camera.aspect = width / Math.max(1, height);
        camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();
      const refresh = () => {
        if (disposed || progressRef < 1) return;
        avatar?.dispose();
        avatar = new SocialAvatar(assets, current.current.appearance);
        scene.add(avatar.group);
      };
      let progressRef = 0;
      controller.current = { refresh, reset: () => controls?.reset() };
      void assets
        .load((value) => {
          if (!disposed) setProgress(value * 0.9);
        }, true)
        .then(() => {
          if (disposed) return;
          progressRef = 1;
          refresh();
          setProgress(1);
        })
        .catch(() => {
          if (!disposed)
            setError(
              "Não foi possível abrir o preview. Feche e tente novamente.",
            );
        });
      let last = 0;
      const tick = (time: number) => {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        if (lost || document.hidden || time - last < 1000 / 30) return;
        const dt = Math.min(0.08, (time - last) / 1000);
        last = time;
        controls!.update(dt);
        stool.visible = current.current.pose === "sit";
        avatar?.update(
          dt,
          current.current.pose === "walk",
          current.current.pose === "sit",
          0.72,
        );
        renderer!.render(scene, camera);
      };
      frame = requestAnimationFrame(tick);
    } catch {
      setError(
        "Preview indisponível. Verifique a aceleração gráfica e tente novamente.",
      );
    }
    return () => {
      disposed = true;
      controller.current = undefined;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controls?.dispose();
      avatar?.dispose();
      resources.dispose();
      assets.dispose();
      renderer?.dispose();
      renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
    };
  }, [attempt]);
  useEffect(() => controller.current?.refresh(), [signature]);
  useEffect(() => controller.current?.reset(), [reset]);
  return (
    <div className="avatar-studio" ref={mount} data-ready={progress === 1}>
      {progress < 1 && !error && (
        <div className="avatar-studio-loading" role="status">
          Preparando personagem…
          <progress max="1" value={progress} />
        </div>
      )}
      {error && (
        <div className="avatar-preview-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Recarregar preview
          </button>
        </div>
      )}
    </div>
  );
}
