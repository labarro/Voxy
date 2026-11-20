import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Tip = {
  text: string;
  x: number;
  y: number;
  side: "top" | "right" | "bottom";
};

function place(target: HTMLElement, text: string): Tip {
  const r = target.getBoundingClientRect();
  const side = target.closest(".server-rail")
    ? "right"
    : r.top < 64
      ? "bottom"
      : "top";
  return {
    text,
    side,
    x: side === "right" ? r.right + 10 : r.left + r.width / 2,
    y:
      side === "right"
        ? r.top + r.height / 2
        : side === "bottom"
          ? r.bottom + 8
          : r.top - 8,
  };
}

/**
 * One tooltip layer for the whole app. Elements keep their `title` (and
 * accessible names). While the pointer hovers, the title is parked in
 * `data-tip` so the browser's own tooltip does not double up; a styled bubble
 * appears after a short delay, clamped to the window. If React changes the
 * title meanwhile, the observer follows it. Keyboard focus shows the bubble
 * without touching attributes. Nothing runs while the pointer is idle.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useEffect(() => {
    let timer = 0;
    let parked: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    const observer = new MutationObserver(() => {
      if (!parked) return;
      const next = parked.getAttribute("title");
      if (next === null) return;
      parked.dataset.tip = next;
      if (parked.dataset.tipLabel !== undefined)
        parked.setAttribute("aria-label", next);
      parked.removeAttribute("title");
      setTip((t) => (t ? { ...t, text: next } : t));
    });
    const unpark = () => {
      observer.disconnect();
      const el = parked;
      parked = null;
      if (!el) return;
      const text = el.dataset.tip;
      delete el.dataset.tip;
      if (text !== undefined && !el.hasAttribute("title"))
        el.setAttribute("title", text);
      if (el.dataset.tipLabel !== undefined) {
        el.removeAttribute("aria-label");
        delete el.dataset.tipLabel;
      }
    };
    const hide = () => {
      clearTimeout(timer);
      unpark();
      focused = null;
      setTip(null);
    };
    const titled = (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.(
        "[title]",
      ) as HTMLElement | null;
      if (!el || el.closest("svg, iframe, [data-native-title]")) return null;
      return el;
    };
    const over = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (parked && target && parked.contains(target)) return;
      const el = titled(event);
      if (!el) return;
      hide();
      const text = el.getAttribute("title") || "";
      if (!text.trim()) return;
      parked = el;
      el.dataset.tip = text;
      // Keep the accessible name while the native title is parked.
      if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) {
        el.setAttribute("aria-label", text);
        el.dataset.tipLabel = "";
      }
      el.removeAttribute("title");
      observer.observe(el, { attributes: true, attributeFilter: ["title"] });
      timer = window.setTimeout(() => {
        if (parked === el && el.isConnected)
          setTip(place(el, el.dataset.tip ?? text));
      }, 380);
    };
    const out = (event: Event) => {
      if (!parked) return;
      const next = (event as PointerEvent).relatedTarget as Node | null;
      if (next && parked.contains(next)) return;
      hide();
    };
    const focusIn = (event: Event) => {
      const el = titled(event);
      if (!el || parked || !el.matches(":focus-visible")) return;
      const text = el.getAttribute("title") || "";
      if (!text.trim()) return;
      focused = el;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (focused === el) setTip(place(el, text));
      }, 380);
    };
    const focusOut = () => {
      if (!focused) return;
      focused = null;
      clearTimeout(timer);
      setTip(null);
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focusIn, true);
    document.addEventListener("focusout", focusOut, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focusIn, true);
      document.removeEventListener("focusout", focusOut, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  useEffect(() => {
    if (!tip || !bubble.current) return;
    const r = bubble.current.getBoundingClientRect();
    let left = tip.side === "right" ? tip.x : tip.x - r.width / 2;
    let top =
      tip.side === "right"
        ? tip.y - r.height / 2
        : tip.side === "bottom"
          ? tip.y
          : tip.y - r.height;
    left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
    top = Math.max(8, Math.min(top, innerHeight - r.height - 8));
    setPos({ left, top });
  }, [tip]);
  if (!tip) return null;
  return createPortal(
    <div
      ref={bubble}
      className="vx-tooltip"
      role="tooltip"
      data-side={tip.side}
      style={pos}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
