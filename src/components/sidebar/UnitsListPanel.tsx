import { useState, useMemo } from "react";
import type { ReactNode } from "react";
// Ikony Phosphor — ten sam zestaw co makieta (`ph ph-*`).
import {
  MagnifyingGlass, Eye, EyeSlash,
  CaretDown, CaretRight, CaretUp, Crosshair,
} from "@phosphor-icons/react";
import AcLeftHeader from "./AcLeftHeader";
import { getSymbolUrl } from "../../data/symbolCatalog";
import type { Unit } from "../../types/map";
import type { HierarchyLink } from "../../types/simulation";
import { readinessOf } from "../../utils/readiness";

/**
 * Lewy panel — odwzorowanie 1:1 makiety `project/AICOMMAND.dc.html`
 * (sekcja „LEWY PANEL" / ORBAT).
 *
 * Wartości układu pochodzą wprost z inline'owych stylów makiety i mieszkają
 * w `src/aicommand-left.css` pod przedrostkiem `ac-`. Nie używamy tu klas
 * .sidebar / .unit-list-* — te niosą wcześniejszy, rozjeżdżający się layout.
 *
 * Świadome odstępstwa (poza układem):
 *  · makieta rozwija drzewo tylko o jeden poziom; tu rekurencja jest pełna,
 *    bo hierarchia przychodzi z bazy i bywa głębsza. Wcięcie liczone tym samym
 *    wzorem co w makiecie: pad = 10 + depth × 18 px.
 */

// Kolory z makiety (BLUE / RED / GREEN / AMBER).
const BLUE = "#7fb0dd";
const RED = "#d9635a";
const GREEN = "#86b06a";
const AMBER = "#e0a63c";

/** Skrót szczebla w formacie makiety: „X · BDE". */
const ECHELON_MARK: Record<string, string> = {
  region_theater: "XXXXX",
  army_group_front: "XXXXXX",
  army: "XXXX",
  corps_mef: "XXX",
  division: "XX",
  brigade: "X",
  regiment_group: "III",
  battalion_squadron: "II",
  company_battery_troop: "I",
  platoon_detachment: "•••",
  section: "••",
  squad: "•",
  team_crew: "⊘",
};

const ECHELON_ABBR: Record<string, string> = {
  region_theater: "THTR",
  army_group_front: "AGF",
  army: "ARMY",
  corps_mef: "CORPS",
  division: "DIV",
  brigade: "BDE",
  regiment_group: "REG",
  battalion_squadron: "BN",
  company_battery_troop: "CO",
  platoon_detachment: "PLT",
  section: "SEC",
  squad: "SQD",
  team_crew: "TM",
};

function echelonCode(echelon?: string): string {
  if (!echelon) return "—";
  const key = echelon.toLowerCase();
  const mark = ECHELON_MARK[key];
  const abbr = ECHELON_ABBR[key] ?? echelon.replace(/_/g, " ").toUpperCase();
  return mark ? `${mark} · ${abbr}` : abbr;
}

/** Kolor paska gotowości — progi z makiety: >65 zielony, >35 bursztyn, reszta czerwony. */
function readyColor(pct: number): string {
  return pct > 65 ? GREEN : pct > 35 ? AMBER : RED;
}

type SideFilter = "all" | "friendly" | "hostile";

type Props = {
  units: Unit[];
  hierarchy: HierarchyLink[];
  selectedUnitId: string | null;
  expandedUnits: Set<string>;
  engagedUnitIds?: Set<string>;
  hiddenUnitIds: Set<string>;
  onSelectUnit: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onToggleUnitVisibility: (id: string) => void;
  onToggleGroupVisibility: (side: "friendly" | "hostile") => void;
  onAddUnit?: () => void;
  onCollapse?: () => void;
};

export default function UnitsListPanel({
  units, hierarchy, selectedUnitId, expandedUnits, engagedUnitIds,
  hiddenUnitIds, onSelectUnit, onToggleExpand, onToggleUnitVisibility,
  onAddUnit, onCollapse,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SideFilter>("all");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    friendly: true, hostile: true,
  });

  const q = query.trim().toLowerCase();
  const matches = (u: Unit) =>
    !q ||
    u.symbol_name?.toLowerCase().includes(q) ||
    u.custom_name?.toLowerCase().includes(q) ||
    u.echelon?.toLowerCase().includes(q) ||
    u.unit_type?.toLowerCase().includes(q);

  const { childrenMap, hasParent } = useMemo(() => {
    const cm: Record<string, string[]> = {};
    const hp = new Set<string>();
    for (const link of hierarchy) {
      (cm[link.parent_unit_id] ||= []).push(link.child_unit_id);
      hp.add(link.child_unit_id);
    }
    return { childrenMap: cm, hasParent: hp };
  }, [hierarchy]);

  const visibleSides: ("friendly" | "hostile")[] =
    filter === "all" ? ["friendly", "hostile"] : [filter];

  const filters: { key: SideFilter; label: string; dot: string }[] = [
    { key: "all", label: "Wszystkie", dot: "#6a6763" },
    { key: "friendly", label: "Sojusz", dot: BLUE },
    { key: "hostile", label: "Przeciwnik", dot: RED },
  ];

  let anyRows = false;

  const renderRow = (u: Unit, depth: number, sideUnits: Unit[]): ReactNode => {
    const kids = (childrenMap[u.id] ?? [])
      .map(id => sideUnits.find(x => x.id === id))
      .filter((x): x is Unit => !!x && matches(x));
    const hasKids = kids.length > 0;
    const isExpanded = expandedUnits.has(u.id);
    const isHidden = hiddenUnitIds.has(u.id);
    const isEngaged = engagedUnitIds?.has(u.id) ?? false;
    const isSelected = selectedUnitId === u.id;
    const pct = readinessOf(u);

    const mark = isSelected ? AMBER : isEngaged ? RED : "transparent";

    return (
      <div key={u.id}>
        <div
          className={
            "ac-row" +
            (isSelected ? " selected" : "") +
            (isHidden ? " hidden-unit" : "")
          }
          style={{ paddingLeft: 10 + depth * 18 }}
          onClick={() => onSelectUnit(u.id)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter") onSelectUnit(u.id); }}
        >
          <span className="ac-row-mark" style={{ background: mark }} />
          <div
            className="ac-row-sym"
            style={{ backgroundImage: `url(${getSymbolUrl(u.symbol_id)})` }}
          />
          <div className="ac-row-content">
            <div className="ac-row-namerow">
              <span className="ac-row-name">{u.symbol_name}</span>
              {isEngaged && (
                <Crosshair size={11} className="ac-row-engaged" aria-label="Aktywne starcie" />
              )}
            </div>
            <div className="ac-row-meta">
              <span className="ac-row-echelon">{echelonCode(u.echelon)}</span>
              {pct !== null && (
                <>
                  <span className="ac-row-bar">
                    <span style={{ width: `${pct}%`, background: readyColor(pct) }} />
                  </span>
                  <span className="ac-row-pct" style={{ color: readyColor(pct) }}>{pct}%</span>
                </>
              )}
            </div>
          </div>

          <button
            className={"ac-row-btn ac-row-eye" + (isHidden ? " off" : "")}
            title="Widoczność na mapie"
            onClick={e => { e.stopPropagation(); onToggleUnitVisibility(u.id); }}
          >
            {isHidden ? <EyeSlash size={14} /> : <Eye size={14} />}
          </button>

          {hasKids && (
            <button
              className="ac-row-btn ac-row-kids"
              title="Podległe"
              onClick={e => { e.stopPropagation(); onToggleExpand(u.id); }}
            >
              {isExpanded ? <CaretUp size={13} /> : <CaretDown size={13} />}
            </button>
          )}
        </div>

        {hasKids && isExpanded && kids.map(k => renderRow(k, depth + 1, sideUnits))}
      </div>
    );
  };

  const groups = visibleSides.map(side => {
    const all = units.filter(u => u.side === side && matches(u));
    const roots = all.filter(u => !hasParent.has(u.id));
    const rated = all.map(readinessOf).filter((v): v is number => v !== null);
    const avg = rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : 0;
    const open = openGroups[side] !== false;
    if (all.length > 0) anyRows = true;

    return {
      side,
      label: side === "friendly" ? "Jednostki sojusznicze" : "Jednostki przeciwnika",
      color: side === "friendly" ? BLUE : RED,
      count: all.length,
      ready: `GOT ${avg}%`,
      open,
      roots,
      all,
    };
  });

  return (
    <>
      <AcLeftHeader
        title="Struktura sił"
        count={units.length}
        onAdd={onAddUnit}
        onCollapse={onCollapse}
      >
        <div className="ac-search">
          <MagnifyingGlass size={14} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Szukaj jednostki, szczebla…"
          />
        </div>

        <div className="ac-filters">
          {filters.map(f => (
            <button
              key={f.key}
              className={"ac-filter" + (filter === f.key ? " active" : "")}
              onClick={() => setFilter(f.key)}
            >
              <span className="ac-filter-dot" style={{ background: f.dot }} />
              {f.label}
            </button>
          ))}
        </div>
      </AcLeftHeader>

      <div className="ac-left-body">
        <div className="ac-orbat">
          {groups.map(g => (
            <div className="ac-group" key={g.side}>
              <div
                className="ac-group-head"
                onClick={() => setOpenGroups(s => ({ ...s, [g.side]: !g.open }))}
              >
                <span className="ac-group-caret">
                  {g.open ? <CaretDown size={12} /> : <CaretRight size={12} />}
                </span>
                <span className="ac-group-swatch" style={{ background: g.color }} />
                <span className="ac-group-label" style={{ color: g.color }}>{g.label}</span>
                <span className="ac-group-count">{g.count}</span>
                <div className="ac-left-spacer" />
                <span className="ac-group-ready">{g.ready}</span>
              </div>
              {g.open && g.roots.map(u => renderRow(u, 0, g.all))}
            </div>
          ))}

          {!anyRows && (
            <div className="ac-noresults">
              {q ? <>Brak jednostek dla „{query}"</> : "Brak jednostek"}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
