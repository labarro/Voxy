import type { Presence as UserPresence } from "../../shared/types";
export const presenceLabels = {
  online: "Online",
  away: "Ausente",
  busy: "Ocupado",
  offline: "Offline",
};
export function Presence({
  value = "online",
  label = false,
}: {
  value?: UserPresence | "offline";
  label?: boolean;
}) {
  return (
    <span className={"presence " + value} title={presenceLabels[value]}>
      <span
        className="presence-indicator"
        role="img"
        aria-label={"Status: " + presenceLabels[value]}
      />
      {label && <span>{presenceLabels[value]}</span>}
    </span>
  );
}
