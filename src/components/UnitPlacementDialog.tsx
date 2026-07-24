import { useState } from "react";
import { Crosshair, X, Shield, Skull } from "lucide-react";
import { curatedSymbols, getSymbolUrl, UNIT_SIZES, resolveSymbolForSize } from "../data/symbolCatalog";
import { fromLonLat } from "ol/proj";
import { createUnit } from "../api/unitsApi";
import type { Unit } from "../types/map";
import type { UnitTab } from "../types/ui";

type Props = {
  lonLat: [number, number];
  onClose: () => void;
  onConfirm: (newUnit: Unit) => void;
};

export default function UnitPlacementDialog({ lonLat, onClose, onConfirm }: Props) {
  const [selectedTypeId, setSelectedTypeId] = useState<string>(curatedSymbols[0]?.id ?? "");
  const [selectedSizeId, setSelectedSizeId] = useState<string>("Unspecified");
  const [side, setSide] = useState<UnitTab>("friendly");
  const [unitNumber, setUnitNumber] = useState("");
  const [customName, setCustomName] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);

  const handleConfirm = async () => {
    const selectedBase = curatedSymbols.find(s => s.id === selectedTypeId);
    const resolved = resolveSymbolForSize(selectedTypeId, selectedSizeId);
    if (!resolved) {
      alert("Nie można rozpoznać symbolu dla wybranej wielkości.");
      return;
    }

    setIsPlacing(true);
    try {
      const [lon, lat] = lonLat;
      const [x, y] = fromLonLat([lon, lat]);
      const newUnit = await createUnit({
        symbol_id: resolved.id,
        symbol_name: resolved.label,
        side,
        unit_type: selectedBase?.category ?? "infantry",
        echelon: selectedSizeId,
        x,
        y,
        position_lon: lon,
        position_lat: lat,
        source: "manual",
        unit_number: unitNumber.trim() ? Number(unitNumber) : null,
        custom_name: customName.trim() || null,
      });
      onConfirm(newUnit);
    } catch (err) {
      console.error("Error creating unit:", err);
      alert("Nie udało się utworzyć jednostki.");
    } finally {
      setIsPlacing(false);
    }
  };

  const canConfirm = !isPlacing && !!selectedTypeId && selectedSizeId !== "Unspecified" && !!resolveSymbolForSize(selectedTypeId, selectedSizeId);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="unit-placement-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="placement-dialog-header">
          <h3>
            <Crosshair size={18} />
            Nowa jednostka
          </h3>
          <div className="placement-dialog-coords">
            <span>LAT</span> {lonLat[1].toFixed(5)}
            <span style={{ margin: "0 8px", opacity: 0.3 }}>|</span>
            <span>LON</span> {lonLat[0].toFixed(5)}
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="placement-dialog-body">
          <div className="placement-field">
            <div className="placement-field-label">
              <span>STRONA</span>
              <div className="label-line" />
            </div>
            <div className="placement-side-toggle">
              <button
                className={`side-btn ${side === "friendly" ? "active friendly" : ""}`}
                onClick={() => setSide("friendly")}
              >
                <Shield size={16} />
                Jednostki sojusznicze
              </button>
              <button
                className={`side-btn ${side === "hostile" ? "active hostile" : ""}`}
                onClick={() => setSide("hostile")}
              >
                <Skull size={16} />
                Jednostki wrogie
              </button>
            </div>
          </div>

          <div className="placement-field">
            <div className="placement-field-label">
              <span>TYP JEDNOSTKI</span>
              <div className="label-line" />
            </div>
            <div className="symbol-grid">
              {curatedSymbols
                .filter(sym => sym.isEnemy === (side === "hostile"))
                .map(sym => (
                  <button
                    key={sym.id}
                    className={`symbol-btn ${selectedTypeId === sym.id ? "active" : ""}`}
                    onClick={() => {
                      setSelectedTypeId(sym.id);
                      setSelectedSizeId("Unspecified");
                    }}
                    title={sym.label}
                  >
                    <img src={sym.url} alt={sym.label} />
                  </button>
                ))}
            </div>
          </div>

          <div className="placement-field">
            <div className="placement-field-label">
              <span>WIELKOŚĆ JEDNOSTKI</span>
              <div className="label-line" />
            </div>
            <div className="size-tile-grid">
              {UNIT_SIZES.map(size => {
                const resolved = resolveSymbolForSize(selectedTypeId, size.id);
                return (
                  <button
                    key={size.id}
                    className={`size-tile ${selectedSizeId === size.id ? "active" : ""}`}
                    onClick={() => setSelectedSizeId(size.id)}
                    disabled={!resolved}
                    title={size.label}
                  >
                    {resolved && <img src={resolved.url} alt="" className="size-tile-icon" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="placement-field">
            <div className="placement-field-label">
              <span>DANE JEDNOSTKI</span>
              <div className="label-line" />
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="number"
                min="1"
                className="designation-input"
                value={unitNumber}
                onChange={e => setUnitNumber(e.target.value)}
                placeholder="Numer"
                style={{ width: "80px", background: "#1e293b", color: "#fff", border: "1px solid #334155", borderRadius: "6px", padding: "8px" }}
              />
              <input
                type="text"
                className="designation-input"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="Nazwa własna"
                style={{ flex: 1, background: "#1e293b", color: "#fff", border: "1px solid #334155", borderRadius: "6px", padding: "8px" }}
              />
            </div>
          </div>
        </div>

        <div className="placement-dialog-footer">
          <button
            className="action-btn"
            onClick={onClose}
            style={{ border: "none", background: "transparent" }}
          >
            Anuluj
          </button>
          <button
            className="action-btn primary"
            disabled={!canConfirm}
            onClick={handleConfirm}
            style={{
              padding: "12px 32px",
              borderRadius: "12px",
              fontSize: "14px",
              boxShadow: canConfirm ? "var(--glow-blue)" : "none",
            }}
          >
            {isPlacing ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div className="loading-spinner" style={{ width: "14px", height: "14px", borderWidth: "2px" }} />
                Tworzenie…
              </div>
            ) : "✓ Potwierdź operację"}
          </button>
        </div>
      </div>
    </div>
  );
}
