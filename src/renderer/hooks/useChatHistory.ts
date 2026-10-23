import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Message } from "../../shared/types";
export function useChatHistory(
  messages: Message[],
  channelId: string,
  scope?: string,
) {
  const [archive, setArchive] = useState<Message[]>([]),
    [results, setResults] = useState<Message[]>([]),
    [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [exhausted, setExhausted] = useState(false),
    [highlight, setHighlight] = useState("");
  const [newMessages, setNewMessages] = useState(0);
  const [searched, setSearched] = useState(false);
  const list = useRef<HTMLDivElement>(null),
    bottom = useRef(true),
    preserve = useRef<{ height: number; top: number } | null>(null);
  const generation = useRef(0),
    pending = useRef(false),
    jump = useRef("");
  const timeline = useMemo(() => {
    const map = new Map(archive.map((m) => [m.id, m]));
    for (const m of messages) map.set(m.id, m);
    return [...map.values()].sort(
      (a, b) => a.time - b.time || a.id.localeCompare(b.id),
    );
  }, [archive, messages]);
  const byId = useMemo(
    () => new Map(timeline.map((m) => [m.id, m])),
    [timeline],
  );
  const query = scope ? { scope, peer: channelId } : { channelId };
  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      setSearched(false);
    }
  }, [search]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(
    () =>
      window.voxy.onEvent((event) => {
        if (
          event.type !== "message-update" ||
          (scope
            ? event.scope !== scope || event.peer !== channelId
            : event.channelId !== channelId)
        )
          return;
        setArchive((old) => {
          if (!old.some((m) => m.id === event.id)) return old;
          return event.message
            ? old.map((m) => (m.id === event.id ? event.message! : m))
            : old.filter((m) => m.id !== event.id);
        });
        setResults((old) =>
          event.message
            ? old.map((m) => (m.id === event.id ? event.message! : m))
            : old.filter((m) => m.id !== event.id),
        );
      }),
    [channelId, scope],
  );
  const last = messages.at(-1)?.id;
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current || bottom.current) {
      list.current?.scrollTo({ top: list.current.scrollHeight });
      initial.current = false;
    } else setNewMessages((n) => n + 1);
  }, [last]);
  useLayoutEffect(() => {
    if (preserve.current && list.current) {
      list.current.scrollTop =
        preserve.current.top +
        list.current.scrollHeight -
        preserve.current.height;
      preserve.current = null;
    }
    if (jump.current) {
      const element = document.getElementById("message-" + jump.current);
      if (element) {
        element.scrollIntoView({ block: "center" });
        setHighlight(jump.current);
        jump.current = "";
      }
    }
  }, [timeline]);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(""), 2400);
    return () => clearTimeout(timer);
  }, [highlight]);
  async function older() {
    if (pending.current || exhausted) return;
    pending.current = true;
    setLoading(true);
    setError("");
    const current = generation.current;
    try {
      const first = timeline[0];
      const rows = await window.voxy.chatHistory({
        ...query,
        before: first?.time,
        beforeId: first?.id,
      });
      if (current !== generation.current) return;
      setExhausted(rows.length < 100);
      if (list.current)
        preserve.current = {
          height: list.current.scrollHeight,
          top: list.current.scrollTop,
        };
      setArchive((old) => [...rows, ...old].slice(0, 1500));
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (current === generation.current) setLoading(false);
    }
  }
  async function find() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError("");
    const current = generation.current;
    try {
      const rows = await window.voxy.chatHistory({
        ...query,
        search: search.trim(),
      });
      if (current === generation.current) {
        setResults(rows);
        setSearched(true);
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (current === generation.current) setLoading(false);
    }
  }
  async function locate(id: string) {
    const el = document.getElementById("message-" + id);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlight(id);
      setResults([]);
      setSearched(false);
      return;
    }
    setError("");
    const current = generation.current;
    try {
      const rows = await window.voxy.chatHistory({ ...query, messageId: id });
      if (current !== generation.current) return;
      if (!rows.length)
        throw Error("A mensagem original foi excluída ou não está disponível.");
      jump.current = id;
      setArchive((old) =>
        [...old.filter((m) => m.id !== id), ...rows].slice(-1500),
      );
      setResults([]);
      setSearched(false);
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    }
  }
  async function refresh(id: string) {
    const current = generation.current;
    try {
      const rows = await window.voxy.chatHistory({ ...query, messageId: id });
      if (current === generation.current)
        setArchive((old) =>
          old.some((m) => m.id === id)
            ? [...old.filter((m) => m.id !== id), ...rows].slice(-1500)
            : old,
        );
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    }
  }
  return {
    timeline,
    byId,
    list,
    search,
    setSearch,
    results,
    searched,
    find,
    older,
    loading,
    error,
    exhausted,
    locate,
    refresh,
    highlight,
    newMessages,
    onScroll: () => {
      const el = list.current;
      if (el) {
        bottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
        if (bottom.current) setNewMessages(0);
      }
    },
    latest: () => {
      bottom.current = true;
      setNewMessages(0);
      list.current?.scrollTo({
        top: list.current.scrollHeight,
        behavior: "smooth",
      });
    },
  };
}
