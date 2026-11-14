export type CallStage =
  | "idle"
  | "microphone"
  | "audio"
  | "output"
  | "server"
  | "negotiating"
  | "connected"
  | "failed";
export const callStageLabels: Record<CallStage, string> = {
  idle: "Fora da chamada",
  microphone: "Abrindo microfone…",
  audio: "Preparando áudio…",
  output: "Configurando saída de áudio…",
  server: "Confirmando entrada no servidor…",
  negotiating: "Conectando áudio aos participantes…",
  connected: "Áudio conectado",
  failed: "Falha ao conectar áudio",
};
export function deadline<T>(
  task: Promise<T>,
  ms: number,
  message: string,
  signal?: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (e: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(e);
    };
    const abort = () =>
      fail(new DOMException("Entrada na chamada cancelada.", "AbortError"));
    const timer = setTimeout(() => fail(new Error(message)), ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    task.then(
      (value) => {
        if (finished) {
          late?.(value);
          return;
        }
        finished = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (!finished) {
          finished = true;
          cleanup();
          reject(error);
        }
      },
    );
  });
}
export function mediaFailure(error: unknown): string {
  const name = (error as Error)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permita o acesso ao microfone nas configurações de privacidade do Windows para aplicativos da área de trabalho e tente novamente.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Microfone indisponível. Conecte uma entrada de áudio e selecione-a nas configurações do Voxy.";
    case "NotReadableError":
    case "AbortError":
      return "Não foi possível abrir o microfone. Verifique se outro aplicativo está usando o dispositivo em modo exclusivo e tente novamente.";
    default:
      return "Falha ao preparar o áudio. Confira o dispositivo selecionado e o diagnóstico de conexão.";
  }
}
export function networkClass(address?: string): string {
  if (!address) return "unknown";
  if (/^26\./.test(address)) return "radmin-range";
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))
    return "private-v4";
  if (/^(127\.|::1$)/.test(address)) return "loopback";
  if (address.endsWith(".local")) return "mdns";
  return address.includes(":") ? "ipv6" : "other-v4";
}
