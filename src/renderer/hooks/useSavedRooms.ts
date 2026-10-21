import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedRoom, RoomAvailability } from "../../shared/types";
export function useSavedRooms() {
  const [rooms, setRooms] = useState<SavedRoom[]>([]),
    [states, setStates] = useState<RoomAvailability[]>([]),
    [checking, setChecking] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const queued = useRef(false);
  const refresh = useCallback(async (): Promise<void> => {
    if (pending.current) {
      queued.current = true;
      return;
    }
    pending.current = true;
    setChecking(true);
    setError("");
    try {
      setRooms(await window.voxy.savedRooms());
      setStates(await window.voxy.roomAvailability());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setChecking(false);
      if (queued.current) {
        queued.current = false;
        void refresh();
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000),
      focus = () => void refresh();
    window.addEventListener("focus", focus);
    const off = window.voxy.onEvent((event) => {
      if (event.type === "saved-rooms" || event.type === "connection") {
        if (event.type === "connection" && event.status !== "connected")
          setStates([]);
        void window.voxy
          .savedRooms()
          .then(setRooms)
          .catch((e) => setError(e.message));
        void refresh();
      }
    });
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      off();
    };
  }, [refresh]);
  const remove = async (id: string) => {
    await window.voxy.removeRoom(id);
    setRooms((list) => list.filter((r) => r.id !== id));
    setStates((list) => list.filter((r) => r.id !== id));
  };
  return { rooms, states, checking, error, refresh, remove };
}
export type SavedRoomsView = ReturnType<typeof useSavedRooms>;
