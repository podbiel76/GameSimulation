import { useState } from "react";
import { ChevronsDown, ChevronUp, Ban, Eye, EyeOff, ChevronRight, ChevronDown, Layers } from "lucide-react";
import { getSymbolUrl } from "../../data/symbolCatalog";
import type { Unit } from "../../types/map";
import type { HierarchyLink } from "../../types/simulation";
import { UNIT_HIERARCHY_ORDER } from "../../utils/hierarchyVisibility";

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
  // Layer controls
  showAreasLayer: boolean;
  isHierarchicalZoom: boolean;
  visibleEchelons: Set<string>;
  onToggleAreasLayer: () => void;
  onToggleHierarchicalZoom: () => void;
  onToggleEchelon: (echelon: string) => void;
  onApplyEchelonPreset: (preset: "all" | "higher" | "lower" | "none") => void;
};

// ─── Layers panel ────────────────────────────────────────────────────────────

function LayerRow({ label, active, onToggle, indent = false }: {
  label: string; active: boolean; onToggle: () => void; indent?: boolean;
}) {
  return (
    <div className="layers-item" style={{ paddingLeft: indent ? 28 : 12 }} onClick={onToggle}>
      <button className="layers-visibility-btn" onClick={e => { e.stopPropagation(); onToggle(); }}>
        {active ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
      <span className={`layers-item-label ${active ? "" : "layers-item-hidden"}`}>{label}</span>
    </div>
  );
}

function LayersPanel({
  showAreasLayer, isHierarchicalZoom, visibleEchelons,
  onToggleAreasLayer, onToggleHierarchicalZoom,
  onToggleEchelon, onApplyEchelonPreset,
}: Pick<Props,
  "showAreasLayer" | "isHierarchicalZoom" | "visibleEchelons" |
  "onToggleAreasLayer" | "onToggleHierarchicalZoom" |
  "onToggleEchelon" | "onApplyEchelonPreset"
>) {
  const [open, setOpen] = useState(true);
  const [echelonsOpen, setEchelonsOpen] = useState(false);

  return (
    <div className="layers-panel">
      <div className="layers-panel-header" onClick={() => setOpen(v => !v)}>
        <Layers size={15} />
        <span>Warstwy mapy</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </div>
      {open && (
        <div className="layers-panel-body">
          <LayerRow label="Obszary Odpowiedzialności" active={showAreasLayer} onToggle={onToggleAreasLayer} />
          <LayerRow label="Zoom Hierarchiczny" active={isHierarchicalZoom} onToggle={onToggleHierarchicalZoom} />
          <div className="layers-divider" />
          <div className="layers-group-header" onClick={() => setEchelonsOpen(v => !v)} style={{ paddingLeft: 12 }}>
            {echelonsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>Widoczność szczebli</span>
          </div>
          {echelonsOpen && (
            <>
              <div className="layers-preset-row">
                <button className="layers-preset-btn" onClick={() => onApplyEchelonPreset("all")}>Wszystkie</button>
                <button className="layers-preset-btn" onClick={() => onApplyEchelonPreset("higher")}>Wyższe</button>
                <button className="layers-preset-btn" onClick={() => onApplyEchelonPreset("lower")}>Niższe</button>
                <button className="layers-preset-btn" onClick={() => onApplyEchelonPreset("none")}>Czyść</button>
              </div>
              <div className="layers-echelon-list">
                {UNIT_HIERARCHY_ORDER.map(echelon => (
                  <div key={echelon} className="layers-echelon-row" onClick={() => onToggleEchelon(echelon)}>
                    <input
                      type="checkbox"
                      className="layers-echelon-check"
                      checked={visibleEchelons.has(echelon)}
                      onChange={() => {}}
                      onClick={e => e.stopPropagation()}
                    />
                    <span className={`layers-item-label ${visibleEchelons.has(echelon) ? "" : "layers-item-hidden"}`}>
                      {echelon.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Unit group (Friendly / Hostile) ─────────────────────────────────────────

function UnitGroup({
  side, units, hierarchy, selectedUnitId, expandedUnits, engagedUnitIds,
  hiddenUnitIds, onSelectUnit, onToggleExpand, onToggleUnitVisibility, onToggleGroupVisibility,
}: {
  side: "friendly" | "hostile";
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
}) {
  const [open, setOpen] = useState(true);

  const sideUnits = units.filter(u => u.side === side);
  const color = side === "friendly" ? "#60a5fa" : "#f87171";
  const label = side === "friendly" ? "Jednostki sojusznicze" : "Jednostki wrogie";
  const allHidden = sideUnits.length > 0 && sideUnits.every(u => hiddenUnitIds.has(u.id));

  const childrenMap: Record<string, string[]> = {};
  const hasParent = new Set<string>();
  hierarchy.forEach(link => {
    if (!childrenMap[link.parent_unit_id]) childrenMap[link.parent_unit_id] = [];
    childrenMap[link.parent_unit_id].push(link.child_unit_id);
    hasParent.add(link.child_unit_id);
  });

  const renderUnit = (unitId: string, depth = 0): React.ReactNode => {
    const u = sideUnits.find(unit => unit.id === unitId);
    if (!u) return null;
    const childrenIds = childrenMap[unitId] || [];
    const hasChildren = childrenIds.length > 0;
    const isExpanded = expandedUnits.has(unitId);
    const isEngaged = engagedUnitIds?.has(u.id) ?? false;
    const isHidden = hiddenUnitIds.has(u.id);

    return (
      <div key={u.id} className="unit-list-tree-item" style={{ marginLeft: depth > 0 ? depth * 12 : 0 }}>
        <div
          className={`unit-list-item-wrapper ${selectedUnitId === u.id ? "active" : ""}`}
          style={{
            ...(isEngaged ? { borderLeft: "3px solid #ef4444", background: "rgba(239,68,68,0.06)" } : {}),
            ...(isHidden ? { opacity: 0.45 } : {}),
          }}
        >
          <button className="unit-list-item" onClick={() => onSelectUnit(u.id)}>
            <img src={getSymbolUrl(u.symbol_id)} alt="" className="unit-list-icon" />
            <div className="unit-list-info">
              <div className="unit-list-name">
                {isEngaged && <span style={{ marginRight: 4, fontSize: 12 }} title="Aktywne starcie">⚔</span>}
                {u.symbol_name}
              </div>
              <div className="unit-list-meta">{u.echelon?.replace(/_/g, " ")} · {u.source}</div>
            </div>
            <button
              className="layers-visibility-btn"
              style={{ marginRight: 4, flexShrink: 0 }}
              onClick={e => { e.stopPropagation(); onToggleUnitVisibility(u.id); }}
              title={isHidden ? "Pokaż na mapie" : "Ukryj na mapie"}
            >
              {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            {hasChildren ? (
              <button className={`expand-btn ${isExpanded ? "expanded" : ""}`} onClick={e => { e.stopPropagation(); onToggleExpand(u.id); }}>
                {isExpanded ? <ChevronUp size={15}/> : <ChevronsDown size={15} />}
              </button>
            ) : (
              <div><Ban size={15}/></div>
            )}
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div className="unit-list-children">
            {childrenIds.map(childId => renderUnit(childId, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const roots = sideUnits.filter(u => !hasParent.has(u.id));

  return (
    <div className="unit-group">
      {/* Group header */}
      <div className="unit-group-header">
        <button className="unit-group-toggle" onClick={() => setOpen(v => !v)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <span className="unit-group-label" style={{ color }} onClick={() => setOpen(v => !v)}>
          {label}
        </span>
        <span className="unit-group-count">{sideUnits.length}</span>
        <button
          className="layers-visibility-btn"
          style={{ marginLeft: "auto" }}
          onClick={() => onToggleGroupVisibility(side)}
          title={allHidden ? "Pokaż grupę na mapie" : "Ukryj grupę na mapie"}
        >
          {allHidden ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      {/* Unit list */}
      {open && (
        <div className="unit-list">
          {roots.map(u => renderUnit(u.id))}
          {sideUnits.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 11, color: "var(--text-muted)" }}>
              Brak jednostek
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export default function UnitsListPanel({
  units, hierarchy, selectedUnitId, expandedUnits, engagedUnitIds,
  hiddenUnitIds, onSelectUnit, onToggleExpand, onToggleUnitVisibility, onToggleGroupVisibility,
  showAreasLayer, isHierarchicalZoom, visibleEchelons,
  onToggleAreasLayer, onToggleHierarchicalZoom, onToggleEchelon, onApplyEchelonPreset,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <LayersPanel
        showAreasLayer={showAreasLayer}
        isHierarchicalZoom={isHierarchicalZoom}
        visibleEchelons={visibleEchelons}
        onToggleAreasLayer={onToggleAreasLayer}
        onToggleHierarchicalZoom={onToggleHierarchicalZoom}
        onToggleEchelon={onToggleEchelon}
        onApplyEchelonPreset={onApplyEchelonPreset}
      />

      <div style={{ borderTop: "1px solid var(--border-default)" }}>
        <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          Jednostki na mapie
        </div>
        <UnitGroup
          side="friendly"
          units={units}
          hierarchy={hierarchy}
          selectedUnitId={selectedUnitId}
          expandedUnits={expandedUnits}
          engagedUnitIds={engagedUnitIds}
          hiddenUnitIds={hiddenUnitIds}
          onSelectUnit={onSelectUnit}
          onToggleExpand={onToggleExpand}
          onToggleUnitVisibility={onToggleUnitVisibility}
          onToggleGroupVisibility={onToggleGroupVisibility}
        />
        <UnitGroup
          side="hostile"
          units={units}
          hierarchy={hierarchy}
          selectedUnitId={selectedUnitId}
          expandedUnits={expandedUnits}
          engagedUnitIds={engagedUnitIds}
          hiddenUnitIds={hiddenUnitIds}
          onSelectUnit={onSelectUnit}
          onToggleExpand={onToggleExpand}
          onToggleUnitVisibility={onToggleUnitVisibility}
          onToggleGroupVisibility={onToggleGroupVisibility}
        />
      </div>
    </div>
  );
}
