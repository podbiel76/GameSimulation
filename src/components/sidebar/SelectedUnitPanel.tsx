import { useState, useEffect } from "react";
import {
  Ban, Square, Diamond, ShieldCheck, CircleOff, CircleAlert, CircleCheck,
} from "lucide-react";
import { getSymbolUrl } from "../../data/symbolCatalog";
import { updateUnit } from "../../api/unitsApi";
import type { Unit } from "../../types/map";
import type { UnitArea } from "../../api/unitAreasApi";
import type { HierarchyLink } from "../../types/simulation";
import type { EditorMode } from "../../types/map";

type Props = {
  selectedUnit: Unit;
  mode: EditorMode;
  simRunning: boolean;
  simSpeedKmh: number;
  unitAreas: UnitArea[];
  hierarchy: HierarchyLink[];
  units: Unit[];
  onShowLogistics: () => void;
  onStartDrawRoute: () => void;
  onStopDrawRoute: () => void;
  onClearRoute: () => void;
  onDeleteUnit: (id: string) => void;
  onUnitSaved: (unit: Unit) => void;
  onCheckTerrain: (id: string) => void;
  onCheckTerrainArea: (id: string) => void;
  onSelectUnit: (id: string) => void;
};

export default function SelectedUnitPanel({
  selectedUnit, mode, simRunning, simSpeedKmh,
  unitAreas, hierarchy, units,
  onShowLogistics, onStartDrawRoute, onStopDrawRoute, onClearRoute,
  onDeleteUnit, onUnitSaved, onCheckTerrain, onCheckTerrainArea, onSelectUnit,
}: Props) {
  const [unitNumberDraft, setUnitNumberDraft] = useState(selectedUnit.unit_number?.toString() || "");
  const [customNameDraft, setCustomNameDraft] = useState(selectedUnit.custom_name || "");
  const [baseSpeedDraft, setBaseSpeedDraft] = useState(selectedUnit.base_speed_kmh?.toString() || "");
  const [unitNumberError, setUnitNumberError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUnitNumberDraft(selectedUnit.unit_number?.toString() || "");
    setCustomNameDraft(selectedUnit.custom_name || "");
    setBaseSpeedDraft(selectedUnit.base_speed_kmh?.toString() || "");
    setUnitNumberError("");
  }, [selectedUnit.id, selectedUnit.unit_number, selectedUnit.custom_name, selectedUnit.base_speed_kmh]);

  const saveUnitData = async () => {
    const parsedNumber = unitNumberDraft.trim() ? Number(unitNumberDraft) : null;
    if (parsedNumber !== null && (!Number.isInteger(parsedNumber) || parsedNumber <= 0)) {
      setUnitNumberError("Numer jednostki musi być dodatnią liczbą całkowitą.");
      return;
    }
    if (parsedNumber === null) {
      setUnitNumberError("Numer jednostki jest wymagany.");
      return;
    }
    const parsedSpeed = baseSpeedDraft.trim() ? Number(baseSpeedDraft) : null;
    if (parsedSpeed !== null && (isNaN(parsedSpeed) || parsedSpeed <= 0 || parsedSpeed > 200)) {
      setUnitNumberError("Prędkość bazowa musi być liczbą z zakresu 1–200 km/h.");
      return;
    }
    setSaving(true);
    setUnitNumberError("");
    try {
      const updated = await updateUnit(selectedUnit.id, {
        unit_number: parsedNumber,
        custom_name: customNameDraft.trim() || null,
        base_speed_kmh: parsedSpeed,
      });
      onUnitSaved(updated);
    } catch (err: any) {
      console.error(err);
      setUnitNumberError(err.message || "Nie udało się zapisać danych jednostki.");
    } finally {
      setSaving(false);
    }
  };

  const responsibilityArea = unitAreas.find(
    a => a.unit_id === selectedUnit.id && a.area_type === "responsibility"
  );

  const directChildren = hierarchy
    .filter(link => link.parent_unit_id === selectedUnit.id)
    .map(link => units.find(u => u.id === link.child_unit_id))
    .filter((u): u is Unit => u !== undefined);

  return (
    <div className="section">
      
      <div className="marker-detail-card">
        <div className="marker-detail-header">
          <img src={getSymbolUrl(selectedUnit.symbol_id)} alt="" className="marker-detail-icon" />
          <div>
            <div className="marker-detail-id">{selectedUnit.symbol_name}</div>
            <span className="value">
              {selectedUnit.requires_logistics_completion
                ? <div style={{ gap: 4, display: "flex", alignItems: "center", color: "#e02f2fff", fontSize: "14px" }}><CircleAlert />Wymaga uzupełnienia logistyki</div>
                : <div style={{ gap: 4, display: "flex", alignItems: "center", color: "#04aa2eff", fontSize: "14px" }}><CircleCheck />Logistyka uzupełniona</div>
              }
            </span>
          </div>
        </div>

        <div className="marker-actions">
          <button className="action-btn primary" onClick={onShowLogistics}>
            📋 Logistyka
          </button>
          {mode === "draw-route" ? (
            <button className="action-btn warn" onClick={onStopDrawRoute}>
              ✓ Zakończ rysowanie
            </button>
          ) : (
            <button className="action-btn primary" onClick={onStartDrawRoute}>
              ✏️ Rysuj trasę
            </button>
          )}
          <button className="action-btn" onClick={onClearRoute}>
            🗑 Wyczyść trasę
          </button>
          <button className="action-btn danger" onClick={() => onDeleteUnit(selectedUnit.id)} disabled={simRunning}>
            ✕ Usuń jednostkę
          </button>
        </div>

        <div style={{ marginTop: "12px", borderTop: "1px solid var(--border-subtle)", paddingTop: "12px" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>
            DANE JEDNOSTKI
          </div>

          {/* Numer + Nazwa */}
          <div className="designation-form">
            <label style={{ fontSize: 12, color: "#94a3b8" }}>
              Numer jednostki:
              <input
                type="number"
                min="1"
                className={`designation-input ${unitNumberError ? "error" : ""}`}
                value={unitNumberDraft}
                onChange={e => setUnitNumberDraft(e.target.value)}
                placeholder="Numer"
                style={{ width: "80px" }}
              />
            </label>
            <label style={{ fontSize: 12, color: "#94a3b8" }}>
              Nazwa własna:
              <input
                type="text"
                className="designation-input"
                value={customNameDraft}
                onChange={e => setCustomNameDraft(e.target.value)}
                placeholder="Nazwa własna"
                style={{ flex: 1 }}
              />
            </label>
          </div>

          {/* Prędkość bazowa — osobny blok pionowy */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Prędkość bazowa (km/h):</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="number"
                min="1"
                max="200"
                className="designation-input"
                value={baseSpeedDraft}
                onChange={e => setBaseSpeedDraft(e.target.value)}
                placeholder="Domyślna"
                style={{ width: "80px" }}
              />
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {([{ label: "Piechota", v: 5 }, { label: "Kołowe", v: 30 }, { label: "Pancerne", v: 60 }] as const).map(({ label, v }) => (
                <button
                  key={v}
                  className="action-btn small"
                  style={{ flex: 1, opacity: Number(baseSpeedDraft) === v ? 1 : 0.6 }}
                  onClick={() => setBaseSpeedDraft(String(v))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            className="action-btn primary full"
            style={{ marginTop: 10 }}
            disabled={saving || !unitNumberDraft}
            onClick={saveUnitData}
          >
            {saving ? "..." : "Zapisz dane jednostki"}
          </button>
          {unitNumberError && <div className="form-error">{unitNumberError}</div>}
        </div>

        <button
          className="action-btn secondary full"
          style={{ marginTop: 8 }}
          onClick={() => onCheckTerrain(selectedUnit.id)}
        >
          Sprawdź teren
        </button>
        {responsibilityArea && (
          <button
            className="action-btn secondary full"
            style={{ marginTop: 4 }}
            onClick={() => onCheckTerrainArea(selectedUnit.id)}
          >
            Analiza terenu AO
          </button>
        )}

        <div className="unit-data-section">
          <div className="unit-info-grid">
            <div className="unit-info-row">
              <span className="label">Szczebel:</span>
              <span className="value">{selectedUnit.echelon?.replace(/_/g, " ") || "—"}</span>
            </div>
            <div className="unit-info-row">
              <span className="label">Typ:</span>
              <span className="value">{selectedUnit.unit_type || "—"}</span>
            </div>
            <div className="unit-info-row">
              <span className="label">Gotowość bojowa:</span>
              <span className="value">
                {selectedUnit.readiness_status === "ready"
                  ? <div style={{ gap: 4, display: "flex", alignItems: "center", color: "#108600ff" }}><ShieldCheck />Pełna gotowość</div>
                  : selectedUnit.readiness_status === "incomplete"
                    ? <div style={{ gap: 4, display: "flex", alignItems: "center", color: "rgb(196, 127, 0)" }}><CircleOff />Brak gotowości</div>
                    : selectedUnit.readiness_status === "destroyed"
                    ? <div style={{ gap: 4, display: "flex", alignItems: "center", color: "#e02f2fff" }}><CircleOff />Zniszczona</div>
                    : "—"}
              </span>
            </div>
            <div className="unit-info-row">
              <span className="label">Strona:</span>
              <span className="value">
                {selectedUnit.side === "friendly"
                  ? <div style={{ gap: 4, display: "flex", alignItems: "center", color: "#0059ffff" }}><Square />Sojusznik</div>
                  : selectedUnit.side
                    ? <div style={{ gap: 4, display: "flex", alignItems: "center", color: "#e02f2fff" }}><Diamond />Wróg</div>
                    : "—"}
              </span>
            </div>
            <div className="unit-info-row">
              <span className="label">Pozycja:</span>
              <span className="value">
                Lat: {selectedUnit.position_lat?.toFixed(6) || "—"} <br />
                Lon: {selectedUnit.position_lon?.toFixed(6) || "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="unit-data-section">
          <div className="section-subtitle" style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>
            OBSZAR ODPOWIEDZIALNOŚCI
          </div>
          {!responsibilityArea
            ? <div className="value" style={{ gap: 4, display: "flex", alignItems: "center", color: "#e02f2fff" }}><Ban /> Brak obszaru odpowiedzialności</div>
            : (
              <div className="unit-info-grid">
                <div className="unit-info-row">
                  <span className="label">Nazwa:</span>
                  <span className="value">{responsibilityArea.name || "—"}</span>
                </div>
                <div className="unit-info-row">
                  <span className="label">Powierzchnia:</span>
                  <span className="value">{responsibilityArea.area_km2 ? `${responsibilityArea.area_km2.toFixed(2)} km²` : "—"}</span>
                </div>
                <div className="unit-info-row">
                  <span className="label">Wysokość położenia:</span>
                  <span className="value">{selectedUnit.current_elevation_m ? `${selectedUnit.current_elevation_m.toFixed(2)} m` : "—"}</span>
                </div>
              </div>
            )
          }
        </div>

        <div className="unit-data-section">
          <div className="section-subtitle" style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>
            JEDNOSTKI PODLEGŁE
          </div>
          {directChildren.length === 0
            ? <div className="value" style={{ gap: 4, display: "flex", alignItems: "center", color: "#e02f2fff" }}><Ban /> Brak jednostek podległych</div>
            : (
              <div className="children-list">
                {directChildren.map(child => (
                  <div key={child.id} className="unit-list-tree-item">
                    <div className="unit-list-item-wrapper">
                      <button className="unit-list-item" onClick={() => onSelectUnit(child.id)}>
                        <img src={getSymbolUrl(child.symbol_id)} alt="" className="unit-list-icon" />
                        <div className="unit-list-info">
                          <div className="unit-list-name">{child.symbol_name}</div>
                          <div className="unit-list-meta">
                            {child.echelon?.replace(/_/g, " ")} · {child.source}
                          </div>
                        </div>
                        <button className="action-btn small" onClick={() => onSelectUnit(child.id)}>
                          Wybierz
                        </button>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}
