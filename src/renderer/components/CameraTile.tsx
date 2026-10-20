import { useEffect, useRef, useState } from "react";
import { Maximize, Video } from "lucide-react";
export function CameraTile({
  stream,
  name,
  local,
  open,
}: {
  stream?: MediaStream;
  name: string;
  local: boolean;
  open: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const video = ref.current!;
    setReady(false);
    setError("");
    video.srcObject = stream ?? null;
    void video.play().catch(() => setError("Clique para reproduzir a câmera."));
    const timer = setTimeout(() => {
      if (video.readyState < 2)
        setError("Sem vídeo. Confira a conexão da câmera.");
    }, 15000);
    return () => {
      video.srcObject = null;
      clearTimeout(timer);
    };
  }, [stream]);
  return (
    <div className="camera-tile">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        onLoadedData={() => {
          setReady(true);
          setError("");
        }}
      />
      {(!ready || error) && (
        <button
          className="camera-loading"
          onClick={() =>
            void ref.current
              ?.play()
              .then(() => setError(""))
              .catch(() => setError("Não foi possível reproduzir a câmera."))
          }
        >
          {error || "Aguardando câmera…"}
        </button>
      )}
      <div>
        <span>
          <Video size={14} /> {name}
          {local ? " (sua câmera)" : ""}
        </span>
        <button title={"Ampliar câmera de " + name} onClick={open}>
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
