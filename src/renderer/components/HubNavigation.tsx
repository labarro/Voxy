import { Search, type LucideIcon } from "lucide-react";
import { useState } from "react";

export type HubPage = {
  id: string;
  group: string;
  icon: LucideIcon;
  description: string;
  keywords?: string;
};
export function HubNavigation({
  pages,
  active,
  change,
  label,
}: {
  pages: HubPage[];
  active: string;
  change: (id: string) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const normalized = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const matches = pages.filter((p) =>
    `${p.id} ${p.description} ${p.keywords || ""}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .includes(normalized),
  );
  return (
    <nav className="hub-nav" aria-label={label}>
      <label className="hub-search">
        <Search size={16} />
        <input
          aria-label={"Buscar em " + label.toLowerCase()}
          placeholder="Encontrar uma opção"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="hub-nav-pages">
        {[...new Set(matches.map((p) => p.group))].map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            {matches
              .filter((p) => p.group === group)
              .map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-current={active === p.id ? "page" : undefined}
                  onClick={() => change(p.id)}
                >
                  <p.icon size={18} />
                  <span>{p.id}</span>
                </button>
              ))}
          </section>
        ))}
        {!matches.length && (
          <p role="status" className="hint">
            Nenhuma seção encontrada. Tente “microfone”, “tema” ou “canal”.
          </p>
        )}
      </div>
    </nav>
  );
}
