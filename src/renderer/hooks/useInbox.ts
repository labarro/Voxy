import { useCallback, useEffect, useState } from "react";
import type { Inbox, NetworkEvent } from "../../shared/types";
type Incoming = Extract<NetworkEvent, { type: "inbox" }>["incoming"];
export function useInbox() {
  const [inbox, setInbox] = useState<Inbox>({ rooms: [] }),
    [notice, setNotice] = useState<Incoming>(),
    [error, setError] = useState("");
  useEffect(() => {
    let changed = false,
      alive = true;
    const off = window.voxy.onEvent((event) => {
      if (event.type === "inbox-error") setError(event.message);
      if (event.type === "inbox") {
        setError("");
        changed = true;
        setInbox(event.inbox);
        if (event.incoming) setNotice(event.incoming);
      }
    });
    void window.voxy
      .inbox()
      .then((value) => {
        if (alive && !changed) setInbox(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      off();
    };
  }, []);
  const clearNotice = useCallback(() => setNotice(undefined), []);
  return { inbox, notice, clearNotice, error };
}
