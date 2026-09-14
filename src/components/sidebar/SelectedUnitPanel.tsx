import { useState, useEffect } from "react";
// Ikony Phosphor — ten sam zestaw co makieta.
// Odpowiedniki nazw z makiety: ph-path → Path, ph-polygon → Polygon,
// ph-crosshair-simple → CrosshairSimple, ph-eye-slash → EyeSlash, ph-trash → Trash,
// ph-users-three → UsersThree, ph-truck → Truck, ph-gauge → Gauge,
// ph-drone → Drone, ph-mountains → Mountains, ph-crosshair → Crosshair.
import {
  ClipboardText, Path, Polygon, Mountains, Trash, Check,
  Warning, CheckCircle, TreeStructure, ArrowUpRight,
  CrosshairSimple, EyeSlash, Eye, PencilSimple, X,
  UsersThree, Truck, Gauge, Drone, Crosshair,
  ShieldChevron, Package, Info,
} from "@phosphor-icons/react";
import { getSymbolUrl } from "../../data/symbolCatalog";
import { updateUnit, updateUnitLogistics } from "../../api/unitsApi";
import { ECHELON_CAPS, DEFAULT_POTENTIAL_CONFIG, terrainModifierFor } from "../../utils/combatPotential";
import type { UnitTerrainProfile } from "../../utils/terrainProfile";
import { readinessOf, readinessVar, readinessLabel } from "../../utils/readiness";
import { toMgrs } from "../../utils/mgrs";
import { toLonLat } from "ol/proj";
import { TERRAIN_SPEED_MODIFIERS } from "../../hooks/useLocalSimulation";
import type { Unit, ScenarioMarker, UnitLogistics, UpdateUnitLogisticsPayload, RouteTask } from "../../types/map";
import type { UnitArea } from "../../api/unitAreasApi";
import type { HierarchyLink } from "../../types/simulation";
import type { EditorMode } from "../../types/map";

/** Zakładki prawego panelu — zgodnie z makietą AICOMMAND.dc.html (`rtabs`). */
type RightTab = "przeglad" | "logistyka" | "trasa" | "ao";

const TABS: { id: RightTab; label: string }[] = [
  { id: "przeglad", label: "Przegląd" },
  { id: "logistyka", label: "Logistyka" },
  { id: "trasa", label: "Trasa" },
  { id: "ao", label: "AO" },
];

// Kolory progów z makiety.
const GREEN = "#86b06a";
const AMBER = "#e0a63c";
const RED = "#d9635a";

/**
 * Pola trybu edycji zapasów (makieta: LOGF, przeniesione na pola aplikacji).
 * Klucze są zawężone do nazw kolumn logistyki, więc szkic edycji nie może
 * przemycić pola, którego backend nie zna.
 */
type LogFieldKey =
  | "personnel_total" | "personnel_available" | "personnel_wounded"
  | "ammo_small_arms" | "ammo_at" | "ammo_mortar" | "fuel_liters"
  | "tanks_total" | "tanks_operational" | "ifv_total" | "ifv_operational"
  | "drones_total" | "drones_available";

const LOG_FIELDS: { key: LogFieldKey; label: string; unit: string }[] = [
  { key: "personnel_total", label: "Etat (osoby)", unit: "" },
  { key: "personnel_available", label: "Zdolni do walki", unit: "" },
  { key: "personnel_wounded", label: "Ranni", unit: "" },
  { key: "ammo_small_arms", label: "Amunicja strzelecka", unit: "szt" },
  { key: "ammo_at", label: "Amunicja ppanc.", unit: "szt" },
  { key: "ammo_mortar", label: "Amunicja artyleryjska", unit: "szt" },
  { key: "fuel_liters", label: "Paliwo", unit: "l" },
  { key: "tanks_total", label: "Czołgi — etat", unit: "" },
  { key: "tanks_operational", label: "Czołgi sprawne", unit: "" },
  { key: "ifv_total", label: "BWP — etat", unit: "" },
  { key: "ifv_operational", label: "BWP sprawne", unit: "" },
  { key: "drones_total", label: "BSP — etat", unit: "" },
  { key: "drones_available", label: "BSP dostępne", unit: "" },
];

/** Grafiki zadania APP-6A — ścieżki SVG przepisane wprost z makiety. */
const TASK_OPTS: { key: RouteTask; label: string; glyph: string; glyphFill?: string }[] = [
  { key: "adv", label: "Oś natarcia", glyph: "M2,8 L2,3 L30,3 L30,0 L44,8 L30,16 L30,13 L2,13 Z" },
  { key: "atk", label: "Kierunek natarcia", glyph: "M2,8 L32,8", glyphFill: "M31,3 L44,8 L31,13 Z" },
  {
    key: "mvt", label: "Marsz / trasa",
    glyph: "M2,8 L14,8 M22,8 L34,8 M42,8 L44,8",
    glyphFill: "M12,5.5 A2.5,2.5 0 1 0 12,10.5 A2.5,2.5 0 1 0 12,5.5 M32,5.5 A2.5,2.5 0 1 0 32,10.5 A2.5,2.5 0 1 0 32,5.5",
  },
];

const TERRAIN_LABEL: Record<string, string> = {
  open: "Otwarty",
  road: "Droga",
  urban: "Zabudowany",
  forest: "Las",
  wetland: "Mokradła",
  water: "Woda",
};

/** Kolory klas terenu — te same odcienie co legenda w panelu symulacji. */
const TERRAIN_COLOR: Record<string, string> = {
  open: "#8ba0ad",
  forest: "#5f8f5a",
  road: "#9fc06b",
  urban: "#b58b56",
  wetland: "#6f9c9a",
  water: "#5b86b8",
};

/** Pasek udziałów klas terenu z legendą (udziały 0–1). */
function TerrainShares({ shares }: { shares: Record<string, number> }) {
  const items = Object.entries(shares)
    .filter(([, v]) => v >= 0.005)
    .sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="terrain-bar">
        {items.map(([c, v]) => (
          <span key={c} style={{ width: `${v * 100}%`, background: TERRAIN_COLOR[c] }} />
        ))}
      </div>
      <div className="terrain-legend">
        {items.map(([c, v]) => (
          <div key={c} className="terrain-legend-item">
            <i style={{ background: TERRAIN_COLOR[c] }} />
            <span>{TERRAIN_LABEL[c] ?? c}</span>
            <b>{Math.round(v * 100)}%</b>
          </div>
        ))}
      </div>
    </>
  );
}

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
  // ── Opcjonalne — panel działa bez nich, wtedy pola pokazują „—" ──
  markers?: ScenarioMarker[];
  terrainClass?: string;
  /** Profil terenu z backendu: otoczenie jednostki (obrona) i AO (natarcie, manewr). */
  terrainProfile?: UnitTerrainProfile;
  inContact?: boolean;
  isHidden?: boolean;
  onCenterUnit?: (id: string) => void;
  onToggleHide?: (id: string) => void;
  onDrawArea?: (id: string) => void;
  onSetRouteTask?: (id: string, task: RouteTask) => void;
  /** Po zapisie/uzupełnieniu logistyki — odświeżenie jednostki w stanie aplikacji. */
  onLogisticsSaved?: (logistics: UnitLogistics) => void;
};

export default function SelectedUnitPanel({
  selectedUnit, mode, simRunning, simSpeedKmh,
  unitAreas, hierarchy, units,
  onShowLogistics, onStartDrawRoute, onStopDrawRoute, onClearRoute,
  onDeleteUnit, onUnitSaved, onCheckTerrain, onCheckTerrainArea, onSelectUnit,
  markers, terrainClass, terrainProfile, inContact, isHidden, onCenterUnit, onToggleHide,
  onDrawArea, onLogisticsSaved, onSetRouteTask,
}: Props) {
  const [tab, setTab] = useState<RightTab>("przeglad");
  // Formularz oznaczenia wydzielony w osobny tryb edycji — makieta trzyma
  // Przegląd wyłącznie do odczytu.
  const [editing, setEditing] = useState(false);

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

  // Zmiana jednostki zamyka edycję — inaczej niezapisany szkic wyciekłby na inną jednostkę.
  useEffect(() => { setEditing(false); }, [selectedUnit.id]);

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
      setEditing(false);
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

  const parentLink = hierarchy.find(link => link.child_unit_id === selectedUnit.id);
  const parentUnit = parentLink ? units.find(u => u.id === parentLink.parent_unit_id) : undefined;

  const isFriendly = selectedUnit.side === "friendly";
  const sideVar = isFriendly ? "var(--side-friendly)" : "var(--side-hostile)";
  const sideTint = isFriendly ? "var(--side-friendly-tint)" : "var(--side-hostile-tint)";
  const ready = readinessOf(selectedUnit);
  const readyColor = ready !== null ? readinessVar(ready) : "var(--text-dim)";

  const log = selectedUnit.logistics;

  // ── Logistyka: podgląd / edycja / uzupełnienie ───────────────────────────
  const [logEdit, setLogEdit] = useState(false);
  const [savingLog, setSavingLog] = useState(false);
  const [logError, setLogError] = useState("");
  const [logDraft, setLogDraft] = useState<Partial<Record<LogFieldKey, number>>>({});

  useEffect(() => { setLogEdit(false); setLogError(""); }, [selectedUnit.id]);

  /**
   * Limity etatowe dla szczebla — te same, których używa model potencjału
   * (`ECHELON_CAPS`, pilnowane testem parity). Makieta trzyma amunicję i paliwo
   * jako 0–100%, aplikacja jako wartości bezwzględne, więc procent liczymy
   * względem etatu zamiast przepisywać skalę z makiety.
   */
  const caps = ECHELON_CAPS[(selectedUnit.echelon ?? "").toLowerCase()] ?? ECHELON_CAPS.battalion_squadron;

  const fuelCapacity = (log?.fuel_capacity_liters && log.fuel_capacity_liters > 0)
    ? log.fuel_capacity_liters
    : caps.fuelCapacityDefault;

  const fuelPct = Math.round(((log?.fuel_liters ?? 0) / Math.max(1, fuelCapacity)) * 100);

  const startEditLogistics = () => {
    if (!log) return;
    setLogDraft({
      personnel_total: log.personnel_total ?? 0,
      personnel_available: log.personnel_available ?? 0,
      personnel_wounded: log.personnel_wounded ?? 0,
      ammo_small_arms: log.ammo_small_arms ?? 0,
      ammo_at: log.ammo_at ?? 0,
      ammo_mortar: log.ammo_mortar ?? 0,
      fuel_liters: Math.round(log.fuel_liters ?? 0),
      tanks_total: log.tanks_total ?? 0,
      tanks_operational: log.tanks_operational ?? 0,
      ifv_total: log.ifv_total ?? 0,
      ifv_operational: log.ifv_operational ?? 0,
      drones_total: log.drones_total ?? 0,
      drones_available: log.drones_available ?? 0,
    });
    setLogError("");
    setLogEdit(true);
  };

  const persistLogistics = async (payload: UpdateUnitLogisticsPayload) => {
    setSavingLog(true);
    setLogError("");
    try {
      const saved = await updateUnitLogistics(selectedUnit.id, payload);
      onLogisticsSaved?.(saved);
      setLogEdit(false);
    } catch (err: any) {
      console.error(err);
      setLogError(err?.message || "Nie udało się zapisać logistyki.");
    } finally {
      setSavingLog(false);
    }
  };

  const saveLogistics = () => {
    // Sprawni nie mogą przekroczyć etatu — ta sama zasada, co po stronie makiety.
    const d = { ...logDraft };
    d.personnel_available = Math.min(d.personnel_available ?? 0, d.personnel_total ?? 0);
    d.tanks_operational = Math.min(d.tanks_operational ?? 0, d.tanks_total ?? 0);
    d.ifv_operational = Math.min(d.ifv_operational ?? 0, d.ifv_total ?? 0);
    d.drones_available = Math.min(d.drones_available ?? 0, d.drones_total ?? 0);
    void persistLogistics(d);
  };

  /**
   * „Uzupełnij" — odtworzenie zapasów do etatu.
   * Makieta: amunicja i paliwo do 100%, sprzęt do etatu, 60% rannych wraca do służby.
   */
  const resupply = () => {
    if (!log) return;
    const wounded = log.personnel_wounded ?? 0;
    const recovered = Math.round(wounded * 0.6);
    void persistLogistics({
      ammo_small_arms: caps.ammoSmallArmsMax,
      ammo_at: caps.ammoAtMax,
      ammo_mortar: caps.ammoMortarMax,
      fuel_liters: Math.round(fuelCapacity),
      tanks_operational: log.tanks_total ?? 0,
      ifv_operational: log.ifv_total ?? 0,
      armored_artillery_operational: log.armored_artillery_total ?? 0,
      drones_available: log.drones_total ?? 0,
      personnel_available: Math.min(log.personnel_total ?? 0, (log.personnel_available ?? 0) + recovered),
      personnel_wounded: wounded - recovered,
    });
  };

  // ── Kafle statystyk (makieta: sel.stats — 2 × 3) ──
  const vehiclesOp = log
    ? (log.tanks_operational ?? 0) + (log.ifv_operational ?? 0) + (log.armored_artillery_operational ?? 0)
    : 0;
  const vehiclesTotal = log
    ? (log.tanks_total ?? 0) + (log.ifv_total ?? 0) + (log.armored_artillery_total ?? 0)
    : 0;

  const stats = [
    { icon: <UsersThree size={12} />, label: "Stan", value: log ? `${log.personnel_available ?? 0}/${log.personnel_total ?? 0}` : "—" },
    { icon: <Truck size={12} />, label: "Sprzęt", value: vehiclesTotal > 0 ? `${vehiclesOp}/${vehiclesTotal}` : "—" },
    { icon: <Gauge size={12} />, label: "Prędkość", value: selectedUnit.base_speed_kmh != null ? `${selectedUnit.base_speed_kmh} km/h` : "—" },
    {
      icon: <Mountains size={12} />, label: "Teren",
      value: terrainClass ? (TERRAIN_LABEL[terrainClass] ?? terrainClass) : "—",
    },
    { icon: <Drone size={12} />, label: "BSP", value: log ? `${log.drones_available ?? 0}/${log.drones_total ?? 0}` : "—" },
    {
      icon: <Crosshair size={12} />, label: "Kontakt",
      value: inContact ? "TAK" : "nie",
      danger: !!inContact,
    },
  ];

  // ── Sekcje logistyki (makieta: sel.logGroups) ────────────────────────────
  // `bar()` z makiety: gdy podano etat → „v / t", inaczej procent.
  // Progi koloru: >65 zielony, >30 bursztyn, poniżej czerwony.
  const bar = (label: string, v: number, total?: number, unit = "%") => {
    const pct = total != null
      ? Math.round((v / Math.max(1, total)) * 100)
      : Math.round(v);
    const color = pct > 65 ? GREEN : pct > 30 ? AMBER : RED;
    return {
      label,
      pct: Math.min(100, Math.max(0, pct)),
      value: total != null ? `${Math.round(v)} / ${total}` : `${Math.round(v)}${unit}`,
      color,
    };
  };

  const pctOf = (v: number | null | undefined, cap: number) =>
    Math.round(((v ?? 0) / Math.max(1, cap)) * 100);

  const logGroups = log ? [
    {
      label: "Stan osobowy",
      icon: <UsersThree size={13} />,
      rows: [
        bar("Zdolni do walki", log.personnel_available ?? 0, log.personnel_total ?? 0),
        bar("Ranni", log.personnel_wounded ?? 0, log.personnel_total ?? 0),
        bar("Etat", log.personnel_total ?? 0, log.personnel_total ?? 0),
      ],
    },
    {
      label: "Amunicja",
      icon: <ShieldChevron size={13} />,
      rows: [
        bar("Strzelecka", pctOf(log.ammo_small_arms, caps.ammoSmallArmsMax)),
        bar("Przeciwpancerna", pctOf(log.ammo_at, caps.ammoAtMax)),
        bar("Artyleryjska", pctOf(log.ammo_mortar, caps.ammoMortarMax)),
      ],
    },
    {
      label: "Sprzęt i zaopatrzenie",
      icon: <Truck size={13} />,
      rows: [
        bar("Pojazdy sprawne", vehiclesOp, vehiclesTotal),
        bar("Paliwo", fuelPct),
        bar("BSP dostępne", log.drones_available ?? 0, log.drones_total ?? 0),
      ],
    },
  ] : [];

  // Autonomia marszu — makieta: fuel% / 9 godzin.
  const logNote = fuelPct < 40
    ? "Zapas paliwa poniżej normy — zaplanuj uzupełnienie z GWL."
    : `Zapasy w normie. Autonomia ok. ${Math.round(fuelPct / 9)} h marszu.`;

  // ── Trasa ────────────────────────────────────────────────────────────────
  const marker = markers?.find(m => m.id === selectedUnit.id);
  const routePoints = marker?.route ? [...marker.route].sort((a, b) => a.order - b.order) : [];

  /**
   * Długość odcinka w kilometrach. Punkty trasy są w EPSG:3857, gdzie metry
   * są rozciągnięte o 1/cos(szerokość) — bez tej korekty trasa w Polsce
   * wychodziłaby o ~60% za długa.
   */
  const segKm = (a: [number, number], b: [number, number]) => {
    const [lon1, lat1] = toLonLat(a) as [number, number];
    const [lon2, lat2] = toLonLat(b) as [number, number];
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const la1 = lat1 * Math.PI / 180, la2 = lat2 * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  // Prędkość efektywna = bazowa × modyfikator terenu, w którym stoi jednostka.
  const effectiveKmh = (selectedUnit.base_speed_kmh ?? 0) *
    (terrainClass ? (TERRAIN_SPEED_MODIFIERS[terrainClass] ?? 1) : 1);

  // Skumulowany dystans do każdego punktu — od bieżącej pozycji jednostki.
  const cumulativeKm: number[] = [];
  {
    let acc = 0;
    let prev: [number, number] = [selectedUnit.x, selectedUnit.y];
    for (const rp of routePoints) {
      acc += segKm(prev, [rp.x, rp.y]);
      cumulativeKm.push(acc);
      prev = [rp.x, rp.y];
    }
  }
  const routeKm = cumulativeKm.length ? cumulativeKm[cumulativeKm.length - 1] : 0;
  const legEtaHours = cumulativeKm.map(km => effectiveKmh > 0 ? km / effectiveKmh : null);
  const etaHours = effectiveKmh > 0 ? routeKm / effectiveKmh : null;

  const wpCoords = routePoints.map(rp => {
    const [wlon, wlat] = toLonLat([rp.x, rp.y]) as [number, number];
    return `${wlat.toFixed(3)} / ${wlon.toFixed(3)}`;
  });

  // ── Pozycja ──
  const lon = selectedUnit.position_lon;
  const lat = selectedUnit.position_lat;
  const mgrs = lon != null && lat != null ? toMgrs(lon, lat, 3) : null;

  // Kurs — azymut do najbliższego niezrealizowanego punktu trasy.
  const nextPoint = routePoints[0];
  const heading = (() => {
    if (!nextPoint || lon == null || lat == null) return null;
    // Punkty trasy są w EPSG:3857; azymut liczymy na uproszczonych stopniach —
    // dla dystansów taktycznych błąd jest pomijalny.
    const from: [number, number] = [selectedUnit.x, selectedUnit.y];
    const to: [number, number] = [nextPoint.x, nextPoint.y];
    const dx = to[0] - from[0], dy = to[1] - from[1];
    if (dx === 0 && dy === 0) return null;
    return Math.round((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360);
  })();

  const geo: { k: string; v: string }[] = [
    { k: "Szerokość", v: lat != null ? `${lat.toFixed(5)}° N` : "—" },
    { k: "Długość", v: lon != null ? `${lon.toFixed(5)}° E` : "—" },
    { k: "MGRS", v: mgrs ?? "—" },
    { k: "Kurs", v: heading != null ? `${heading}°` : "—" },
  ];

  const quickActions = [
    {
      icon: mode === "draw-route" ? <Check size={15} /> : <Path size={15} />,
      label: mode === "draw-route" ? "Zakończ" : "Trasa",
      active: mode === "draw-route",
      onClick: mode === "draw-route" ? onStopDrawRoute : onStartDrawRoute,
    },
    {
      icon: <Polygon size={15} />, label: "AO",
      active: mode === "draw-area",
      onClick: () => onDrawArea?.(selectedUnit.id),
      disabled: !onDrawArea,
    },
    {
      icon: <CrosshairSimple size={15} />, label: "Centruj", active: false,
      onClick: () => onCenterUnit?.(selectedUnit.id), disabled: !onCenterUnit,
    },
    {
      icon: isHidden ? <Eye size={15} /> : <EyeSlash size={15} />,
      label: isHidden ? "Pokaż" : "Ukryj",
      active: !!isHidden,
      onClick: () => onToggleHide?.(selectedUnit.id), disabled: !onToggleHide,
    },
    {
      icon: <Trash size={15} />, label: "Usuń", active: false, danger: true,
      onClick: () => onDeleteUnit(selectedUnit.id), disabled: simRunning,
    },
  ];

  return (
    <div className="sel-panel">

      {/* ── Nagłówek: znak, nazwa, szczebel ── */}
      <div className="sel-head">
        <img src={getSymbolUrl(selectedUnit.symbol_id)} alt="" className="sel-symbol" />
        <div className="sel-ident">
          <div className="sel-name">{selectedUnit.symbol_name}</div>
          <div className="sel-sub">
            <span className="sel-echelon" style={{ background: sideTint, color: sideVar }}>
              {selectedUnit.echelon?.replace(/_/g, " ") || "—"}
            </span>
            <span className="sel-type">{selectedUnit.unit_type || "—"}</span>
          </div>
        </div>
        <button
          className={`sel-edit-btn${editing ? " on" : ""}`}
          onClick={() => setEditing(v => !v)}
          title={editing ? "Zamknij edycję" : "Edytuj oznaczenie"}
        >
          {editing ? <X size={14} /> : <PencilSimple size={14} />}
        </button>
      </div>

      {/* ── Szybkie akcje ── */}
      <div className="sel-quick">
        {quickActions.map(qa => (
          <button
            key={qa.label}
            className={`quick-btn${qa.active ? " on" : ""}${qa.danger ? " danger" : ""}`}
            onClick={qa.onClick}
            disabled={qa.disabled}
            title={qa.label}
          >
            {qa.icon}<span>{qa.label}</span>
          </button>
        ))}
      </div>

      {/* ── Tryb edycji oznaczenia (zastępuje zakładki) ── */}
      {editing ? (
        <section className="sel-section sel-edit">
          <div className="section-title">Oznaczenie</div>
          <div className="field-row">
            <label className="field field-num">
              <span>Numer</span>
              <input
                type="number" min="1"
                className={`designation-input ${unitNumberError ? "error" : ""}`}
                value={unitNumberDraft}
                onChange={e => setUnitNumberDraft(e.target.value)}
                placeholder="—"
              />
            </label>
            <label className="field">
              <span>Nazwa własna</span>
              <input
                type="text" className="designation-input"
                value={customNameDraft}
                onChange={e => setCustomNameDraft(e.target.value)}
                placeholder="opcjonalnie"
              />
            </label>
          </div>

          <label className="field">
            <span>Prędkość bazowa (km/h)</span>
            <input
              type="number" min="1" max="200" className="designation-input"
              value={baseSpeedDraft}
              onChange={e => setBaseSpeedDraft(e.target.value)}
              placeholder="Domyślna"
            />
          </label>
          <div className="speed-presets">
            {([{ label: "Piechota", v: 5 }, { label: "Kołowe", v: 30 }, { label: "Pancerne", v: 60 }] as const).map(({ label, v }) => (
              <button
                key={v}
                className={`preset-btn${Number(baseSpeedDraft) === v ? " active" : ""}`}
                onClick={() => setBaseSpeedDraft(String(v))}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="sel-row-actions">
            <button className="action-btn primary" disabled={saving || !unitNumberDraft} onClick={saveUnitData}>
              {saving ? "Zapisywanie…" : "Zapisz"}
            </button>
            <button className="action-btn" onClick={() => setEditing(false)}>Anuluj</button>
          </div>
          {unitNumberError && <div className="form-error">{unitNumberError}</div>}
        </section>
      ) : (
        <>
          {/* ── Zakładki ── */}
          <div className="sel-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`sel-tab${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="sel-tabbody">

            {/* ═══ PRZEGLĄD ═══ */}
            {tab === "przeglad" && (
              <div className="sel-tabpane">
                <div className="ready-card">
                  <div
                    className="ready-ring"
                    style={{ background: `conic-gradient(${readyColor} ${(ready ?? 0) * 3.6}deg, #23272b 0deg)` }}
                  >
                    <div className="ready-ring-core">
                      <span style={{ color: readyColor }}>{ready !== null ? ready : "—"}</span>
                    </div>
                  </div>
                  <div className="ready-text">
                    <div className="section-title">Gotowość bojowa</div>
                    <div className="ready-label" style={{ color: readyColor }}>
                      {selectedUnit.readiness_status === "destroyed"
                        ? "Zniszczona"
                        : ready !== null ? readinessLabel(ready) : "Nieoszacowana"}
                    </div>
                    <div className="ready-note">
                      {selectedUnit.requires_logistics_completion
                        ? <><Warning size={12} /> Wymaga uzupełnienia logistyki</>
                        : <><CheckCircle size={12} /> Logistyka uzupełniona</>}
                    </div>
                  </div>
                </div>

                <div className="stat-grid">
                  {stats.map(s => (
                    <div className="stat-tile" key={s.label}>
                      <div className="stat-label">{s.icon}{s.label}</div>
                      <div className={`stat-value${s.danger ? " danger" : ""}`}>{s.value}</div>
                    </div>
                  ))}
                </div>

                <section className="sel-section">
                  <div className="section-title">Pozycja</div>
                  <div className="geo-list">
                    {geo.map(g => (
                      <div className="geo-row" key={g.k}>
                        <span className="geo-key">{g.k}</span>
                        <span className="geo-val">{g.v}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="sel-section">
                  <div className="section-title">Podporządkowanie</div>
                  {parentUnit ? (
                    <button className="parent-card" onClick={() => onSelectUnit(parentUnit.id)}>
                      <TreeStructure size={14} />
                      <span className="parent-name">{parentUnit.symbol_name}</span>
                      <ArrowUpRight size={13} className="child-go" />
                    </button>
                  ) : (
                    <div className="sel-note">Jednostka nadrzędna nieprzypisana.</div>
                  )}

                  {directChildren.length > 0 && (
                    <div className="child-list">
                      {directChildren.map(child => {
                        const cReady = readinessOf(child);
                        return (
                          <button key={child.id} className="child-row" onClick={() => onSelectUnit(child.id)}>
                            <img src={getSymbolUrl(child.symbol_id)} alt="" className="child-symbol" />
                            <div className="child-info">
                              <div className="child-name">{child.symbol_name}</div>
                              <div className="child-meta">
                                {child.echelon?.replace(/_/g, " ")}
                                {cReady !== null && (
                                  <span style={{ color: readinessVar(cReady) }}> · {cReady}%</span>
                                )}
                              </div>
                            </div>
                            <ArrowUpRight size={13} className="child-go" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ═══ LOGISTYKA ═══ */}
            {tab === "logistyka" && (
              <div className="sel-tabpane">
                {!log ? (
                  <div className="sel-empty">
                    <ClipboardText size={22} />
                    <div className="sel-empty-title">Brak danych logistycznych</div>
                  </div>
                ) : (
                  <>
                    <div className="ac-log-actions">
                      {logEdit ? (
                        <>
                          <button className="ac-log-save" disabled={savingLog} onClick={saveLogistics}>
                            <Check size={14} />{savingLog ? "Zapisywanie…" : "Zapisz"}
                          </button>
                          <button className="ac-log-cancel" onClick={() => setLogEdit(false)}>Anuluj</button>
                        </>
                      ) : (
                        <>
                          <button className="ac-log-btn grow" onClick={startEditLogistics}>
                            <PencilSimple size={14} />Edytuj zapasy
                          </button>
                          <button
                            className="ac-log-btn resupply"
                            title="Uzupełnij do 100%"
                            disabled={savingLog}
                            onClick={resupply}
                          >
                            <Package size={14} />Uzupełnij
                          </button>
                        </>
                      )}
                    </div>

                    {logEdit ? (
                      <div className="ac-log-fields">
                        {LOG_FIELDS.map(f => (
                          <label className="ac-log-field" key={f.key}>
                            <span className="ac-log-field-label">{f.label}</span>
                            <input
                              type="number"
                              min={0}
                              value={logDraft[f.key] ?? 0}
                              onChange={e => setLogDraft(d => ({
                                ...d, [f.key]: Math.max(0, Number(e.target.value) || 0),
                              }))}
                            />
                            <span className="ac-log-field-unit">{f.unit}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      logGroups.map(g => (
                        <div key={g.label}>
                          <div className="ac-log-group-head">
                            {g.icon}
                            <span className="section-title">{g.label}</span>
                          </div>
                          <div className="ac-log-rows">
                            {g.rows.map(r => (
                              <div key={r.label}>
                                <div className="ac-log-row-head">
                                  <span className="ac-log-row-label">{r.label}</span>
                                  <span className="ac-log-row-value" style={{ color: r.color }}>{r.value}</span>
                                </div>
                                <div className="ac-log-bar">
                                  <span style={{ width: `${r.pct}%`, background: r.color }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}

                    <div className="ac-log-note">
                      <Info size={14} />
                      <span>{logNote}</span>
                    </div>

                    {logError && <div className="form-error">{logError}</div>}
                  </>
                )}
              </div>
            )}

            {/* ═══ TRASA ═══ */}
            {tab === "trasa" && (
              <div className="sel-tabpane">
                {!routePoints.length ? (
                  <>
                    <div className="sel-empty">
                      <Path size={22} />
                      <div className="sel-empty-title">Jednostka nie wykonuje zadań</div>
                      <div className="sel-empty-hint">Wyznacz trasę, by rozpocząć marsz.</div>
                    </div>
                    <button className="action-btn full" onClick={onStartDrawRoute}>
                      <Path size={14} />{mode === "draw-route" ? "Rysowanie…" : "Wyznacz trasę"}
                    </button>
                  </>
                ) : (
                  <>
                    {/* Grafika zadania APP-6A */}
                    <section className="sel-section">
                      <div className="section-title">Grafika zadania · APP-6A</div>
                      <div className="ac-task-opts">
                        {TASK_OPTS.map(t => {
                          const on = (marker?.task ?? "mvt") === t.key;
                          return (
                            <button
                              key={t.key}
                              className={`ac-task-opt${on ? " active" : ""}`}
                              title={t.label}
                              onClick={() => onSetRouteTask?.(selectedUnit.id, t.key)}
                              disabled={!onSetRouteTask}
                            >
                              <svg viewBox="0 0 46 16" width="46" height="16">
                                <g fill="none" stroke="currentColor" strokeWidth="1.4"
                                   strokeLinejoin="round" strokeLinecap="round">
                                  <path d={t.glyph} />
                                </g>
                                {t.glyphFill && <path d={t.glyphFill} fill="currentColor" stroke="none" />}
                              </svg>
                              <span>{t.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <div className="ac-route-stats">
                      <div className="stat-tile">
                        <div className="stat-label">Długość</div>
                        <div className="ac-route-stat-val">{routeKm.toFixed(0)} km</div>
                      </div>
                      <div className="stat-tile">
                        <div className="stat-label">Pozostało</div>
                        <div className="ac-route-stat-val accent">{routeKm.toFixed(0)} km</div>
                      </div>
                      <div className="stat-tile">
                        <div className="stat-label">ETA</div>
                        <div className="ac-route-stat-val">{etaHours != null ? `${etaHours.toFixed(1)} h` : "—"}</div>
                      </div>
                    </div>

                    <section className="sel-section">
                      <div className="section-title">Punkty trasy</div>
                      <div className="ac-wp-list">
                        {routePoints.map((rp, i) => (
                          <div className="ac-wp" key={rp.id}>
                            <span className="ac-wp-line" />
                            <span className={`ac-wp-dot${i === 0 ? " current" : ""}`} />
                            <div className="ac-wp-body">
                              <div className="ac-wp-head">
                                <span className={`ac-wp-label${i === 0 ? " current" : ""}`}>
                                  PPK {i + 1}{i === 0 ? " — w drodze" : ""}
                                </span>
                                <span className="ac-wp-eta">
                                  {legEtaHours[i] != null ? `${legEtaHours[i]!.toFixed(1)} h` : "—"}
                                </span>
                              </div>
                              <div className="ac-wp-meta">
                                <span>{wpCoords[i]}</span>
                                {/* Teren w punkcie trasy wymaga rastra terenu (wariant A, faza 1).
                                    Dziś klasa terenu jest znana wyłącznie dla pozycji jednostki,
                                    więc nie zmyślamy jej dla punktów. */}
                                <span className="ac-wp-terrain">—</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <div className="sel-row-actions">
                      <button className="action-btn" onClick={onStartDrawRoute}>
                        <Path size={14} />{mode === "draw-route" ? "Rysowanie…" : "Zmień trasę"}
                      </button>
                      <button className="action-btn danger" onClick={onClearRoute}>
                        <Trash size={14} />Usuń
                      </button>
                    </div>
                  </>
                )}
                {simRunning && (
                  <div className="sel-note">Symulacja w toku — tempo {simSpeedKmh} km/h.</div>
                )}
              </div>
            )}

            {/* ═══ AO ═══ */}
            {tab === "ao" && (
              <div className="sel-tabpane">
                {!responsibilityArea ? (
                  <div className="sel-empty">
                    <Mountains size={22} />
                    <div className="sel-empty-title">Brak wyznaczonego AO</div>
                    <div className="sel-empty-hint">Wyznacz obszar z menu jednostki na mapie.</div>
                  </div>
                ) : (
                  <>
                    <div className="stat-grid">
                      <div className="stat-tile">
                        <div className="stat-label">Powierzchnia</div>
                        <div className="stat-value">
                          {responsibilityArea.area_km2 ? `${responsibilityArea.area_km2.toFixed(1)} km²` : "—"}
                        </div>
                      </div>
                      <div className="stat-tile">
                        <div className="stat-label">Punkty obrysu</div>
                        <div className="stat-value">
                          {Array.isArray(responsibilityArea.coordinates) ? responsibilityArea.coordinates.length : 0}
                        </div>
                      </div>
                    </div>
                    <section className="sel-section">
                      <div className="section-title">Nazwa</div>
                      <div className="sel-note">{responsibilityArea.name || "—"}</div>
                    </section>
                  </>
                )}

                {/* Analiza terenu: natarcie i manewr — AO, obrona — otoczenie jednostki. */}
                {terrainProfile?.available ? (
                  <>
                    {terrainProfile.ao && (
                      <section className="sel-section">
                        <div className="section-title">Teren AO — natarcie i manewr</div>
                        <TerrainShares shares={terrainProfile.ao.shares} />
                        <div className="terrain-mod">
                          Modyfikator natarcia
                          <b>×{terrainModifierFor(DEFAULT_POTENTIAL_CONFIG.terrainModifiersAttacker, terrainProfile.ao.shares).toFixed(2)}</b>
                        </div>
                      </section>
                    )}
                    {terrainProfile.local && (
                      <section className="sel-section">
                        <div className="section-title">
                          Otoczenie jednostki ({((terrainProfile.local.radius_m ?? 0) / 1000).toFixed(1)} km) — obrona
                        </div>
                        <TerrainShares shares={terrainProfile.local.shares} />
                        <div className="terrain-mod">
                          Modyfikator obrony
                          <b>×{terrainModifierFor(DEFAULT_POTENTIAL_CONFIG.terrainModifiersDefender, terrainProfile.local.shares).toFixed(2)}</b>
                        </div>
                        {terrainProfile.local.elevation_m != null && (
                          <div className="stat-grid terrain-relief">
                            <div className="stat-tile">
                              <div className="stat-label">Wysokość</div>
                              <div className="stat-value">{Math.round(terrainProfile.local.elevation_m)} m</div>
                            </div>
                            <div className="stat-tile">
                              <div className="stat-label">Nachylenie</div>
                              <div className="stat-value">{terrainProfile.local.mean_slope_deg ?? "—"}°</div>
                            </div>
                            <div className="stat-tile">
                              <div className="stat-label">Deniwelacja</div>
                              <div className="stat-value">{Math.round(terrainProfile.local.relief_m ?? 0)} m</div>
                            </div>
                          </div>
                        )}
                      </section>
                    )}
                    <div className="terrain-source">
                      {terrainProfile.sources.landcover}
                      {terrainProfile.sources.dem ? ` · ${terrainProfile.sources.dem}` : ""}
                      {terrainProfile.sources.roads ? ` · ${terrainProfile.sources.roads}` : ""}
                    </div>
                  </>
                ) : (
                  <div className="sel-note">
                    {terrainProfile
                      ? `Analiza terenu z danych niedostępna — ${terrainProfile.reason ?? "brak danych"}. Używana jest analiza kolorów mapy.`
                      : "Analiza terenu w toku…"}
                  </div>
                )}

                <button
                  className="action-btn full"
                  onClick={() => (responsibilityArea ? onCheckTerrainArea : onCheckTerrain)(selectedUnit.id)}
                >
                  <Mountains size={14} />Odśwież analizę terenu
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
