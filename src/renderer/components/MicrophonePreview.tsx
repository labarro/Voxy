import { useEffect, useRef, useState } from "react";
import type { Profile } from "../../shared/types";
import { MicrophoneTest } from "../../services/webrtc/microphoneTest";

export function MicrophonePreview({
  profile,
  onActive,
}: {
  profile: Profile;
  onActive: (active: boolean) => void;
}) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(-100);
  const [error, setError] = useState("");
  const tester = useRef<MicrophoneTest>(null);
  const generation = useRef(0);
  const notify = useRef(onActive);
  notify.current = onActive;
  const prefs = useRef(profile);
  prefs.current = profile;
  function stop() {
    ++generation.current;
    tester.current?.stop();
    tester.current = null;
    setActive(false);
    setLevel(-100);
    notify.current(false);
  }
  async function start() {
    stop();
    const id = generation.current;
    const test = new MicrophoneTest();
    tester.current = test;
    setActive(true);
    setError("");
    notify.current(true);
    try {
      await test.start(prefs.current, setLevel, () => {
        if (generation.current !== id) return;
        stop();
        setError(
          "Microfone desconectado. Escolha uma entrada e teste novamente.",
        );
      });
    } catch (e) {
      if (generation.current !== id) return;
      stop();
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Permita o microfone nas configurações de privacidade do Windows."
          : "Não foi possível testar o microfone: " + (e as Error).message,
      );
    }
  }
  useEffect(() => {
    tester.current?.configure(profile);
  }, [profile]);
  // Reacquire only when capture processing or the selected devices change.
  useEffect(() => {
    if (tester.current) void start();
  }, [
    profile.input,
    profile.output,
    profile.noiseSuppression,
    profile.echoCancellation,
    profile.autoGainControl,
  ]);
  useEffect(
    () => () => {
      ++generation.current;
      tester.current?.stop();
      notify.current(false);
    },
    [],
  );
  return (
    <section
      className="microphone-preview"
      aria-label="Teste privado do microfone"
    >
      <strong>Teste privado do microfone</strong>
      <p>
        Use fones. Você ouvirá os ajustes atuais, sem enviar esta voz à chamada.
        O Push-to-Talk não bloqueia o teste.
      </p>
      <button type="button" onClick={() => (active ? stop() : void start())}>
        {active ? "Parar teste do microfone" : "Testar meu microfone"}
      </button>
      {active && (
        <>
          <meter
            aria-label="Nível do teste privado"
            min="-100"
            max="0"
            value={level}
          />
          <small role="status">
            Teste local ativo · envio do microfone pausado
          </small>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
