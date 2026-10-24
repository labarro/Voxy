import { useEffect, useState } from "react";
import type { AppNotification, NotificationState } from "../../shared/types";
let context: AudioContext | undefined;
function notificationSound() {
  context ??= new AudioContext();
  void context
    .resume()
    .then(() => {
      const tone = context!.createOscillator(),
        gain = context!.createGain();
      const now = context!.currentTime;
      tone.frequency.setValueAtTime(740, now);
      tone.frequency.setValueAtTime(980, now + 0.08);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      tone.connect(gain).connect(context!.destination);
      tone.start(now);
      tone.stop(now + 0.18);
      tone.onended = () => {
        tone.disconnect();
        gain.disconnect();
      };
    })
    .catch(() => {});
}
export function useNotifications() {
  const [state, setState] = useState<NotificationState>({
    items: [],
    unreadChannels: {},
    unreadServers: {},
  });
  const [alert, setAlert] = useState<AppNotification>();
  const [target, setTarget] = useState<AppNotification>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      changed = false;
    const off = window.voxy.onEvent((event) => {
      if (event.type === "notifications") {
        changed = true;
        setState(event.state);
        if (event.alert) setAlert(event.alert);
        if (event.sound) notificationSound();
      }
      if (event.type === "open-notification") setTarget(event.notification);
    });
    void window.voxy
      .notifications()
      .then((value) => {
        if (alive && !changed) setState(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      off();
    };
  }, []);
  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setAlert(undefined), 6000);
    return () => clearTimeout(timer);
  }, [alert]);
  return { state, alert, setAlert, target, setTarget, error };
}
