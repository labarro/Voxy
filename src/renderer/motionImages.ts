// Animated profile images (GIF): on-demand fetch, cache and playback budget.
//
// The room snapshot only carries the small static avatar. The GIF itself is
// referenced as "avatar:<sha256>" and fetched once through the existing
// profile-image request, then kept as a Blob URL so every place that shows
// the same person reuses one decoded resource.
import { useEffect, useState, useSyncExternalStore } from "react";

const CACHE_LIMIT = 48;
/** Animated images allowed to play at the same time across the window. */
export const MAX_ANIMATED = 12;
const RETRY_MS = 60_000;

const cache = new Map<string, Promise<string>>();
const failures = new Map<string, number>();

// Decoded locally: the renderer CSP does not allow fetch() of data: URLs.
async function toBlobUrl(data: string) {
  const match =
    /^data:(image\/(?:gif|png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(data);
  if (!match) throw Error("Imagem animada inválida.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: match[1] }));
}

// Remote GIFs are fetched at most two at a time so a room full of animated
// profiles never arrives as one burst on the host link during a call.
let running = 0;
const waiting: (() => void)[] = [];
async function queued<T>(task: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
/** Resolves a data URL or "avatar:" reference to a cached Blob URL. */
export function loadMotionImage(ref: string): Promise<string> {
  const cached = cache.get(ref);
  if (cached) {
    cache.delete(ref);
    cache.set(ref, cached); // LRU touch
    return cached;
  }
  const failed = failures.get(ref);
  if (failed && Date.now() - failed < RETRY_MS)
    return Promise.reject(Error("Imagem indisponível."));
  const promise = (
    ref.startsWith("avatar:")
      ? queued(() => window.voxy.profileImage(ref)).then(toBlobUrl)
      : toBlobUrl(ref)
  ).catch((error) => {
    cache.delete(ref);
    failures.set(ref, Date.now());
    throw error;
  });
  cache.set(ref, promise);
  while (cache.size > CACHE_LIMIT) {
    const [oldest, value] = cache.entries().next().value!;
    cache.delete(oldest);
    void value.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  return promise;
}

// ── Playback budget ──────────────────────────────────────────────────────
const playing = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export function claimAnimation(token: symbol) {
  if (playing.has(token)) return true;
  if (playing.size >= MAX_ANIMATED) return false;
  playing.add(token);
  return true;
}
export function releaseAnimation(token: symbol) {
  if (playing.delete(token)) notify();
}
function subscribeBudget(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const budgetSize = () => playing.size;

// ── Environment: reduced motion and window visibility ────────────────────
function subscribeEnvironment(listener: () => void) {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    media.removeEventListener("change", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}
const environment = () =>
  !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches;
/** False when the OS asks for reduced motion or the window is hidden. */
export function useMotionAllowed() {
  return useSyncExternalStore(subscribeEnvironment, environment, () => false);
}

/**
 * Animated source for an element: only while it is on screen, motion is
 * allowed, and a playback slot is free. Returns null to show the still.
 */
export function useMotionSource(
  ref: string | undefined,
  element: React.RefObject<Element | null>,
  enabled: boolean,
) {
  const allowed = useMotionAllowed() && enabled && !!ref;
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [token] = useState(() => Symbol("motion"));
  useSyncExternalStore(subscribeBudget, budgetSize, budgetSize);
  useEffect(() => {
    const el = element.current;
    if (!allowed || !el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "64px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      setVisible(false);
    };
  }, [allowed, element]);
  const active = allowed && visible && claimAnimation(token);
  useEffect(() => {
    if (!active) {
      releaseAnimation(token);
      return;
    }
    return () => releaseAnimation(token);
  }, [active, token]);
  useEffect(() => {
    if (!active || !ref) return;
    let alive = true;
    loadMotionImage(ref)
      .then((value) => alive && setUrl(value))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [active, ref]);
  useEffect(() => setUrl(null), [ref]);
  return active ? url : null;
}

/** First frame of an image (GIF or not) as a still data URL. */
export function useStillFrame(src: string, wanted: boolean) {
  const [still, setStill] = useState<string | null>(null);
  useEffect(() => {
    setStill(null);
    if (!wanted || !src) return;
    let alive = true;
    const image = new Image();
    image.src = src;
    void image
      .decode()
      .then(() => {
        // Drawing a decoded GIF paints its first frame.
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        if (alive) setStill(canvas.toDataURL("image/webp", 0.85));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src, wanted]);
  return still;
}
