import { useEffect, useMemo, useState } from "react";
import { MapPinPlus, X, Plus, Crosshair, Flag, Network } from "lucide-react";
import { curatedSymbols, UNIT_SIZES, resolveSymbolForSize } from "../data/symbolCatalog";
import { UNIT_HIERARCHY_ORDER } from "../utils/hierarchyVisibility";
import { fromLonLat } from "ol/proj";
import { createUnit, linkSubordinate } from "../api/unitsApi";
import type { Unit } from "../types/map";
import type { UnitTab } from "../types/ui";

type HierarchyLink = { parent_unit_id: string; child_unit_id: string };

type Props = {
  lonLat: [number, number];
  units: Unit[];
  hierarchy: HierarchyLink[];
  /** Okno ukryte na czas wskazywania położenia na mapie (stan formularza zostaje). */
  hidden?: boolean;
  onPickLocation: () => void;
  onClose: () => void;
  onConfirm: (newUnit: Unit) => void;
};

/** Polskie nazwy rodzajów wojsk — klucz to `category` z katalogu APP-6A. */
const TYPE_PL: Record<string, string> = {
  "Infantry": "Piechota",
  "Motorized": "Zmotoryzowane",
  "Armored": "Pancerne",
  "Armor Mechanized": "Zmechanizowane",
  "Armored Mechanized Tracked": "Zmechanizowane gąsienicowe",
  "Antitank Antiarmor": "Przeciwpancerne",
  "Field Artillery": "Artyleria",
  "Combined Arms": "Ogólnowojskowe",
  "Chemical Biological Radiological Nuclear Defense": "OPBMR",
};
const TYPE_ORDER = Object.keys(TYPE_PL);

/** Skrót i pełna nazwa szczebla. */
const ECHELON_PL: Record<string, { abbr: string; name: string }> = {
  Region_Theater: { abbr: "TEATR", name: "Teatr działań" },
  Army_Group_Front: { abbr: "FRONT", name: "Front" },
  Army: { abbr: "ARMIA", name: "Armia" },
  Corps_MEF: { abbr: "KORP", name: "Korpus" },
  Division: { abbr: "DYW", name: "Dywizja" },
  Brigade: { abbr: "BRYG", name: "Brygada" },
  Regiment_Group: { abbr: "PUŁK", name: "Pułk" },
  Battalion_Squadron: { abbr: "BAT", name: "Batalion" },
  Company_Battery_Troop: { abbr: "KOMP", name: "Kompania" },
  Platoon_Detachment: { abbr: "PLUT", name: "Pluton" },
  Section: { abbr: "SEK", name: "Sekcja" },
  Squad: { abbr: "DRUŻ", name: "Drużyna" },
  Team_Crew: { abbr: "ZAŁ", name: "Załoga" },
};

/** Orientacyjny stan osobowy szczebla — punkt wyjścia do edycji. */
const PERSONNEL_BY_ECHELON: Record<string, number> = {
  Region_Theater: 500000, Army_Group_Front: 250000, Army: 100000, Corps_MEF: 40000,
  Division: 12000, Brigade: 4000, Regiment_Group: 1800, Battalion_Squadron: 600,
  Company_Battery_Troop: 120, Platoon_Detachment: 35, Section: 20, Squad: 9, Team_Crew: 4,
};

/** Pojazdy na żołnierza i prędkość marszowa wg rodzaju wojsk. */
const TYPE_PROFILE: Record<string, { vehiclesPerSoldier: number; speed: number }> = {
  "Infantry": { vehiclesPerSoldier: 0.12, speed: 32 },
  "Motorized": { vehiclesPerSoldier: 0.2, speed: 60 },
  "Armored": { vehiclesPerSoldier: 0.25, speed: 40 },
  "Armor Mechanized": { vehiclesPerSoldier: 0.2, speed: 50 },
  "Armored Mechanized Tracked": { vehiclesPerSoldier: 0.2, speed: 50 },
  "Antitank Antiarmor": { vehiclesPerSoldier: 0.15, speed: 40 },
  "Field Artillery": { vehiclesPerSoldier: 0.15, speed: 35 },
  "Combined Arms": { vehiclesPerSoldier: 0.18, speed: 45 },
  "Chemical Biological Radiological Nuclear Defense": { vehiclesPerSoldier: 0.15, speed: 40 },
};

function defaultEtat(category: string | undefined, sizeId: string) {
  const personnel = PERSONNEL_BY_ECHELON[sizeId] ?? 0;
  const profile = TYPE_PROFILE[category ?? ""] ?? { vehiclesPerSoldier: 0.12, speed: 30 };
  return {
    personnel: String(personnel),
    vehicles: String(Math.round(personnel * profile.vehiclesPerSoldier)),
    uav: String(Math.max(personnel >= 30 ? 1 : 0, Math.round(personnel / 150))),
    speed: String(profile.speed),
  };
}

const toInt = (v: string) => Math.max(0, Math.round(Number(v) || 0));

export default function UnitPlacementDialog({
  lonLat, units, hierarchy, hidden, onPickLocation, onClose, onConfirm,
}: Props) {
  const [side, setSide] = useState<UnitTab>("friendly");
  const typeOptions = useMemo(
    () => curatedSymbols
      .filter(sym => sym.isEnemy === (side === "hostile"))
      .sort((a, b) => TYPE_ORDER.indexOf(a.category) - TYPE_ORDER.indexOf(b.category)),
    [side],
  );

  const [selectedTypeId, setSelectedTypeId] = useState<string>(
    () => curatedSymbols.find(s => !s.isEnemy && s.category === "Infantry")?.id ?? curatedSymbols[0]?.id ?? "",
  );
  const [selectedSizeId, setSelectedSizeId] = useState<string>("Battalion_Squadron");
  const [unitNumber, setUnitNumber] = useState("");
  const [customName, setCustomName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [etat, setEtat] = useState(() => defaultEtat("Infantry", "Battalion_Squadron"));
  const [isPlacing, setIsPlacing] = useState(false);

  const selectedBase = curatedSymbols.find(s => s.id === selectedTypeId);

  // Zmiana strony — ten sam rodzaj wojsk po drugiej stronie.
  const changeSide = (next: UnitTab) => {
    setSide(next);
    const twin = curatedSymbols.find(s => s.isEnemy === (next === "hostile") && s.category === selectedBase?.category);
    if (twin) setSelectedTypeId(twin.id);
    setParentId(null);
  };

  // Etat domyślny odświeża się przy zmianie rodzaju lub szczebla.
  useEffect(() => {
    setEtat(defaultEtat(selectedBase?.category, selectedSizeId));
  }, [selectedBase?.category, selectedSizeId]);

  const sizeOptions = UNIT_SIZES.filter(
    s => s.id !== "Unspecified" && !!resolveSymbolForSize(selectedTypeId, s.id),
  );

  // Przełożonym może być tylko jednostka tej samej strony o wyższym szczeblu.
  const parentOptions = useMemo(() => {
    const sideKey = side === "hostile" ? "hostile" : "friendly";
    const rank = (e: string) => {
      const i = UNIT_HIERARCHY_ORDER.indexOf(e);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const myRank = rank(selectedSizeId);
    return units
      .filter(u => u.side === sideKey && rank(u.echelon) < myRank)
      .sort((a, b) => rank(a.echelon) - rank(b.echelon) || a.symbol_name.localeCompare(b.symbol_name));
  }, [units, side, selectedSizeId]);
  const effectiveParentId = parentOptions.some(u => u.id === parentId) ? parentId : null;

  const subordinateCount = (id: string) => hierarchy.filter(l => l.parent_unit_id === id).length;

  const resolvedPreview = resolveSymbolForSize(selectedTypeId, selectedSizeId);
  const canConfirm = !isPlacing && !!selectedTypeId && !!resolvedPreview;

  const typeName = (category: string | undefined) => TYPE_PL[category ?? ""] ?? category ?? "";
  const echelon = ECHELON_PL[selectedSizeId];
  const sizeIndicator = UNIT_SIZES.find(s => s.id === selectedSizeId)?.indicator ?? "";
  const autoName = echelon ? `${echelon.name} — ${typeName(selectedBase?.category)}` : typeName(selectedBase?.category);
  const previewName = `${unitNumber.trim() ? `${unitNumber.trim()}. ` : ""}${customName.trim() || autoName}`;

  const handleConfirm = async () => {
    if (!resolvedPreview) return;
    setIsPlacing(true);
    try {
      const [lon, lat] = lonLat;
      const [x, y] = fromLonLat([lon, lat]);
      const personnel = toInt(etat.personnel);
      const vehicles = toInt(etat.vehicles);
      const uav = toInt(etat.uav);
      const category = selectedBase?.category ?? "";
      // Pojazdy trafiają do podtypu właściwego dla rodzaju wojsk.
      const vehicleFields =
        category === "Armored" ? { tanks_total: vehicles, tanks_operational: vehicles }
        : category === "Field Artillery" ? { armored_artillery_total: vehicles, armored_artillery_operational: vehicles }
        : { ifv_total: vehicles, ifv_operational: vehicles };

      const newUnit = await createUnit({
        symbol_id: resolvedPreview.id,
        symbol_name: resolvedPreview.label,
        side,
        unit_type: category || "infantry",
        echelon: selectedSizeId,
        x,
        y,
        position_lon: lon,
        position_lat: lat,
        source: "manual",
        unit_number: unitNumber.trim() ? Number(unitNumber) : null,
        custom_name: customName.trim() || null,
        base_speed_kmh: Number(etat.speed) > 0 ? Number(etat.speed) : null,
        logistics: {
          personnel_total: personnel,
          personnel_available: personnel,
          drones_total: uav,
          drones_available: uav,
          ...vehicleFields,
        },
      });

      if (effectiveParentId) {
        try {
          await linkSubordinate(effectiveParentId, newUnit.id);
        } catch (err) {
          console.error("Error linking subordinate:", err);
          alert("Jednostka utworzona, ale nie udało się jej podporządkować.");
        }
      }
      onConfirm(newUnit);
    } catch (err) {
      console.error("Error creating unit:", err);
      alert("Nie udało się utworzyć jednostki.");
    } finally {
      setIsPlacing(false);
    }
  };

  return (
    <div className="dialog-backdrop" style={hidden ? { display: "none" } : undefined} onClick={onClose}>
      <div className="unit-placement-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="placement-dialog-header">
          <MapPinPlus size={18} className="pdh-icon" />
          <div className="pdh-text">
            <h3>Utwórz nową jednostkę</h3>
            <div className="pdh-coords-row">
              <span className="placement-dialog-coords">
                {lonLat[1].toFixed(5)}° N&nbsp;&nbsp;{lonLat[0].toFixed(5)}° E
              </span>
              <button className="pdh-pick-btn" onClick={onPickLocation} title="Wskaż położenie jednostki na mapie">
                <Crosshair size={12} />
                Wskaż na mapie
              </button>
            </div>
          </div>
          <button className="close-btn" onClick={onClose} title="Zamknij">
            <X size={14} />
          </button>
        </div>

        <div className="placement-dialog-body">
          <div className="placement-field">
            <div className="placement-field-label">Strona</div>
            <div className="placement-side-toggle">
              <button
                className={`side-btn ${side === "friendly" ? "active friendly" : ""}`}
                onClick={() => changeSide("friendly")}
              >
                <span className="side-swatch" style={{ background: "var(--side-friendly)" }} />
                Sojusznicza
              </button>
              <button
                className={`side-btn ${side === "hostile" ? "active hostile" : ""}`}
                onClick={() => changeSide("hostile")}
              >
                <span className="side-swatch" style={{ background: "var(--side-hostile)" }} />
                Przeciwnika
              </button>
            </div>
          </div>

          <div className="placement-field">
            <div className="placement-field-label">Rodzaj wojsk</div>
            <div className="symbol-grid">
              {typeOptions.map(sym => (
                <button
                  key={sym.id}
                  className={`symbol-btn ${selectedTypeId === sym.id ? "active" : ""}`}
                  onClick={() => setSelectedTypeId(sym.id)}
                  title={typeName(sym.category)}
                >
                  <img src={sym.url} alt="" />
                  <span>{typeName(sym.category)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="placement-field">
            <div className="placement-field-label">Szczebel</div>
            <div className="size-tile-grid">
              {sizeOptions.map(size => (
                <button
                  key={size.id}
                  className={`size-tile ${selectedSizeId === size.id ? "active" : ""}`}
                  onClick={() => setSelectedSizeId(size.id)}
                  title={ECHELON_PL[size.id]?.name ?? size.label}
                >
                  {/* Wskaźnik wielkości wg APP-6A, Tab. IV. */}
                  <span className="size-tile-indicator">{size.indicator}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label className="field field-num">
              <span>Numer</span>
              <input
                type="number"
                min="1"
                className="designation-input"
                value={unitNumber}
                onChange={e => setUnitNumber(e.target.value)}
                placeholder="—"
              />
            </label>
            <label className="field">
              <span>Nazwa własna (opcjonalnie)</span>
              <input
                type="text"
                className="designation-input"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder={autoName}
              />
            </label>
          </div>

          <div className="placement-field">
            <div className="placement-field-label">Podporządkowanie</div>
            <div className="parent-list">
              <button
                className={`parent-option ${effectiveParentId === null ? "active" : ""}`}
                onClick={() => setParentId(null)}
              >
                <Flag size={14} />
                <span className="parent-option-name">Samodzielna</span>
              </button>
              {parentOptions.map(u => (
                <button
                  key={u.id}
                  className={`parent-option ${effectiveParentId === u.id ? "active" : ""}`}
                  onClick={() => setParentId(u.id)}
                  title={u.symbol_name}
                >
                  <Network size={14} />
                  <span className="parent-option-name">Podległa: {u.symbol_name}</span>
                  <span className="parent-option-meta">
                    {ECHELON_PL[u.echelon]?.abbr ?? u.echelon}
                    {subordinateCount(u.id) > 0 ? ` · ${subordinateCount(u.id)} podl.` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="placement-field">
            <div className="placement-field-label">Etat i zapasy początkowe</div>
            <div className="etat-grid">
              <label>Stan osobowy</label>
              <input type="number" min="0" value={etat.personnel}
                onChange={e => setEtat(v => ({ ...v, personnel: e.target.value }))} />
              <label>Pojazdy</label>
              <input type="number" min="0" value={etat.vehicles}
                onChange={e => setEtat(v => ({ ...v, vehicles: e.target.value }))} />
              <label>BSP</label>
              <input type="number" min="0" value={etat.uav}
                onChange={e => setEtat(v => ({ ...v, uav: e.target.value }))} />
              <label>Prędkość km/h</label>
              <input type="number" min="0" value={etat.speed}
                onChange={e => setEtat(v => ({ ...v, speed: e.target.value }))} />
            </div>
          </div>

          {/* Podgląd — znak i rozstrzygnięte oznaczenie przed utworzeniem. */}
          <div className="placement-preview">
            {resolvedPreview
              ? <img src={resolvedPreview.url} alt="" />
              : <div className="placement-preview-blank" />}
            <div className="placement-preview-text">
              <div className="ppt-name">{resolvedPreview ? previewName : "Wybierz rodzaj i szczebel"}</div>
              <div className="ppt-meta">
                {sizeIndicator} · {echelon?.abbr ?? "—"} · {toInt(etat.personnel)} os. · {toInt(etat.vehicles)} poj. · {toInt(etat.speed)} km/h
              </div>
            </div>
          </div>
        </div>

        <div className="placement-dialog-footer">
          <button className="action-btn" onClick={onClose}>Anuluj</button>
          <button className="action-btn primary full" disabled={!canConfirm} onClick={handleConfirm}>
            {isPlacing ? (
              <>
                <div className="loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                Tworzenie…
              </>
            ) : (
              <><Plus size={15} />Utwórz jednostkę</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
