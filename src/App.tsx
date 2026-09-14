import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import ScenarioMapView from "./map/MapView";
import { X, DiamondPlus, Network, SquarePen, Trash2, Route, BrainCircuit, AlertTriangle } from "lucide-react";
// Górny pasek i zakładki — ikony Phosphor, ten sam zestaw co makieta.
// Makieta: shield-chevron, tree-structure, play-circle, crosshair, scales, broadcast.
import { ShieldChevron, TreeStructure, PlayCircle, Crosshair, Scales, Broadcast, Play, Pause, CaretDoubleRight } from "@phosphor-icons/react";
import type { BaseLayerType, MapViewHandle } from "./map/MapView";
import { UNIT_HIERARCHY_ORDER, UNIT_CHILDREN } from "./utils/hierarchyVisibility";
import { unitShortLabel } from "./utils/unitLabel";
import { fromLonLat, toLonLat } from "ol/proj";
import { getUnits, deleteUnit, createUnitFromDetection, createChildWithArea } from "./api/unitsApi";
import { getUnitAreas, updatePolygonArea, deleteUnitAreaCascade, createPolygonArea } from "./api/unitAreasApi";
import type { UnitArea } from "./api/unitAreasApi";
import type { ScenarioMarker, EditorMode, MapDetection, Unit } from "./types/map";
import type { FullState } from "./types/simulation";
import type { SidebarTab, UnitTab } from "./types/ui";
import { getFullState, simulateUnitStep, simulateAllStep, runRules } from "./api/simulationApi";
import { pointInPolygon } from "./utils/geoUtils";
import { isUnitDestroyed } from "./utils/attritionRules";
import { agentDecide, type AgentRoute } from "./api/agentApi";
import Globe3D, { type Recording, type Basemap } from "./map/Globe3D";
import { useLocalSimulation } from "./hooks/useLocalSimulation";
import type { TerrainPreview } from "./hooks/useLocalSimulation";
import DetectionPanel from "./components/DetectionPanel";
import LogisticsForm from "./components/LogisticsForm";
import AssessmentPanel from "./components/AssessmentPanel";
import CombatPotentialPanel from "./components/CombatPotentialPanel";
import EngagementPanel from "./components/EngagementPanel";
import UnitPlacementDialog from "./components/UnitPlacementDialog";
import MapToolRail, { type MapLayerKey } from "./components/MapToolRail";
import UnitsListPanel from "./components/sidebar/UnitsListPanel";
import SimulationPanel from "./components/sidebar/SimulationPanel";
import AcEngagementsPanel from "./components/sidebar/AcEngagementsPanel";
import AcComparePanel from "./components/sidebar/AcComparePanel";
import AcMonitoringPanel from "./components/sidebar/AcMonitoringPanel";
import SelectedUnitPanel from "./components/sidebar/SelectedUnitPanel";
import "./visibility.css";

let nextId = 1;
function genId(prefix: string) {
  return `${prefix}-${nextId++}-${Date.now().toString(36)}`;
}

/** Zakładki górnego paska — kolejność i etykiety z makiety (`tabDef`). */
const NAV_TABS: { id: SidebarTab; label: string; Icon: typeof TreeStructure }[] = [
  { id: "units", label: "Jednostki", Icon: TreeStructure },
  { id: "simulation", label: "Symulacja", Icon: PlayCircle },
  { id: "alerts", label: "Starcia", Icon: Crosshair },
  { id: "comparison", label: "Porównaj", Icon: Scales },
  { id: "monitoring", label: "Monitoring", Icon: Broadcast },
];

/** Zakładki przepisane już 1:1 na makietę — używają powłoki `ac-left` (332 px).
    Pozostałe wciąż na starym `.sidebar` (380 px), do przepisania. */
const AC_LEFT_TABS = new Set<SidebarTab>([
  "units", "simulation", "alerts", "comparison", "monitoring",
]);

/** Zegar misji HH:MM:SS z sekund symulowanych. */
function formatMissionClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function App() {
  const [markers, setMarkers] = useState<ScenarioMarker[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [showLogistics, setShowLogistics] = useState(false);

  useEffect(() => {
    getUnits()
      .then(data => setUnits(data))
      .catch(err => console.error("Failed to load units:", err));
  }, []);

  const [mode, setMode] = useState<EditorMode>("idle");
  const [terrainPreview, setTerrainPreview] = useState<TerrainPreview | null>(null);

  // Detection states
  const [isDetecting, setIsDetecting] = useState(false);
  const [detections, setDetections] = useState<MapDetection[]>([]);
  const [inferenceMs, setInferenceMs] = useState(0);
  const mapHandleRef = useRef<MapViewHandle>(null);
  const markersRef = useRef<ScenarioMarker[]>([]);
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { if (selectedUnitId) setRightPanelCollapsed(false); }, [selectedUnitId]);

  // Radial menu state
  const [radialMenu, setRadialMenu] = useState<{ unitId: string; screenX: number; screenY: number } | null>(null);

  // Powiadomienia o przegranych / zniszczonych jednostkach (alert z boku, auto-znikają)
  const [defeatNotices, setDefeatNotices] = useState<{ unitId: string; name: string; reason: string; side: string }[]>([]);
  const dismissDefeatNotice = useCallback((unitId: string) => {
    setDefeatNotices(prev => prev.filter(n => n.unitId !== unitId));
  }, []);
  const handleUnitDefeated = useCallback((info: { unitId: string; name: string; reason: string; side: string }) => {
    setDefeatNotices(prev => (prev.some(n => n.unitId === info.unitId) ? prev : [...prev, info]));
    // Auto-ukrycie po 7 s — alert nie blokuje interfejsu.
    window.setTimeout(() => {
      setDefeatNotices(prev => prev.filter(n => n.unitId !== info.unitId));
    }, 7000);
  }, []);

  // Area drawing state
  const [drawingAreaUnitId, setDrawingAreaUnitId] = useState<string | null>(null);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [areaDraftPoints, setAreaDraftPoints] = useState<[number, number][]>([]);
  const [unitAreas, setUnitAreas] = useState<UnitArea[]>([]);

  // Base layer
  const [baseLayer, setBaseLayer] = useState<BaseLayerType>("osm");
  const [showAreasLayer, setShowAreasLayer] = useState(true);
  // Warstwy z panelu w prawej kolumnie narzędzi mapy.
  const [showTaskGraphics, setShowTaskGraphics] = useState(true);
  const [showTracks, setShowTracks] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [refreshAreasTrigger, setRefreshAreasTrigger] = useState(0);

  // Context menu & placement dialog
  const [contextMenu, setContextMenu] = useState<{
    screenX: number;
    screenY: number;
    coordinate: [number, number];
    lonLat: [number, number];
  } | null>(null);
  const [placementDialog, setPlacementDialog] = useState<{
    lonLat: [number, number];
    /** true — okno ukryte, użytkownik wskazuje położenie kliknięciem w mapę. */
    picking?: boolean;
  } | null>(null);
  const placementPickingRef = useRef(false);
  placementPickingRef.current = !!placementDialog?.picking;
  /** Esc podczas wskazywania wraca do okna zamiast je zamykać. */
  const escapePlacementDialog = useCallback(() => {
    setPlacementDialog(prev => (prev?.picking ? { ...prev, picking: false } : null));
  }, []);
  const [isHierarchicalZoom, setIsHierarchicalZoom] = useState(false);

  const [subordinateUnitNumber, setSubordinateUnitNumber] = useState<string>("");
  const [subordinateCustomName, setSubordinateCustomName] = useState<string>("");

  // Simulation state (unified — always available)
  const [fullState, setFullState] = useState<FullState | null>(null);
  const fullStateRef = useRef<FullState | null>(null);
  useEffect(() => { fullStateRef.current = fullState; }, [fullState]);
  const [isSimulationEnabled, setIsSimulationEnabled] = useState(false);
  const [isSimulationRunning, setIsSimulationRunning] = useState(false);
  const simAutoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("units");
  const [uniteTab, setUniteTab] = useState<UnitTab>("friendly");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // Combat potential comparison mode
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonOwnUnitIds, setComparisonOwnUnitIds] = useState<string[]>([]);
  const [comparisonTargetUnitIds, setComparisonTargetUnitIds] = useState<string[]>([]);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  const [pendingSubordinateCreation, setPendingSubordinateCreation] = useState<{
    parentUnitId: string;
    parentAreaId: string;
  } | null>(null);

  // Echelon Visibility
  const [visibleEchelons, setVisibleEchelons] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("geotactical.visibleEchelons");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return new Set(parsed);
      } catch (e) { console.error("Failed to load visible echelons:", e); }
    }
    return new Set(UNIT_HIERARCHY_ORDER);
  });

  useEffect(() => {
    localStorage.setItem("geotactical.visibleEchelons", JSON.stringify(Array.from(visibleEchelons)));
  }, [visibleEchelons]);

  const toggleEchelon = (echelon: string) => {
    setVisibleEchelons(prev => {
      const next = new Set(prev);
      if (next.has(echelon)) next.delete(echelon);
      else next.add(echelon);
      return next;
    });
  };

  const applyEchelonPreset = (preset: "all" | "higher" | "lower" | "none") => {
    if (preset === "all") setVisibleEchelons(new Set(UNIT_HIERARCHY_ORDER));
    if (preset === "none") setVisibleEchelons(new Set());
    if (preset === "higher") setVisibleEchelons(new Set(UNIT_HIERARCHY_ORDER.slice(0, 8)));
    if (preset === "lower") setVisibleEchelons(new Set(UNIT_HIERARCHY_ORDER.slice(8)));
  };

  const [hiddenUnitIds, setHiddenUnitIds] = useState<Set<string>>(new Set());

  const toggleUnitVisibility = useCallback((id: string) => {
    setHiddenUnitIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleGroupVisibility = useCallback((side: "friendly" | "hostile") => {
    setHiddenUnitIds(prev => {
      const sideIds = units.filter(u => u.side === side).map(u => u.id);
      const allHidden = sideIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allHidden) sideIds.forEach(id => next.delete(id));
      else sideIds.forEach(id => next.add(id));
      return next;
    });
  }, [units]);

  const visibleUnits = useMemo(
    () => units.filter(u => (!u.echelon || visibleEchelons.has(u.echelon)) && !hiddenUnitIds.has(u.id)),
    [units, visibleEchelons, hiddenUnitIds]
  );

  const visibleUnitAreas = useMemo(() => {
    const visibleIds = new Set(visibleUnits.map(u => u.id));
    const unitMap = new Map(units.map(u => [u.id, u]));
    return unitAreas
      .filter(a => visibleIds.has(a.unit_id))
      .map(a => {
        const u = unitMap.get(a.unit_id);
        return {
          ...a,
          unit_side: u?.side,
          unit_destroyed: u ? isUnitDestroyed(u) : false,
        };
      });
  }, [unitAreas, visibleUnits, units]);

  const unitsRef = useRef<Unit[]>([]);
  const unitAreasRef = useRef<UnitArea[]>([]);
  const selectedUnitIdRef = useRef<string | null>(null);

  useEffect(() => { selectedUnitIdRef.current = selectedUnitId; }, [selectedUnitId]);
  useEffect(() => { unitsRef.current = units; }, [units]);
  useEffect(() => { unitAreasRef.current = unitAreas; }, [unitAreas]);

  // ── Sterowanie agentem RL (M6) ──────────────────────────────────────────────
  // aiSide: która strona jest prowadzona przez wytrenowaną politykę. Gdy włączone
  // i symulacja działa, co kilka sekund pobieramy trasy z /agent/decide i wpinamy je
  // w istniejący mechanizm ruchu (markery). Agent NIE wprowadza nowej mechaniki walki.
  const [aiSide, setAiSide] = useState<null | "friendly" | "hostile" | "both">(null);
  const [aiMode, setAiMode] = useState<"advise" | "control">("advise");
  const [suggestions, setSuggestions] = useState<AgentRoute[]>([]);
  // Widok 3D (CesiumJS)
  const [view3d, setView3d] = useState(false);
  const [showHeatmap3d, setShowHeatmap3d] = useState(false);
  const [basemap3d, setBasemap3d] = useState<Basemap>("osm");

  const toggleUnitExpanded = (unitId: string) => {
    setExpandedUnits(prev => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const refreshState = useCallback(async () => {
    try {
      const data = await getFullState();
      setFullState(data);
    } catch (err) {
      console.error("Failed to load full state:", err);
    }
  }, []);

  useEffect(() => { refreshState(); }, [refreshState]);

  const refreshAreas = useCallback(async () => {
    try {
      const areas = await getUnitAreas();
      setUnitAreas(prevAreas => {
        const hierarchy = fullStateRef.current?.hierarchy || [];

        const childrenByParent = new Map<string, string[]>();
        for (const link of hierarchy) {
          const children = childrenByParent.get(link.parent_unit_id) ?? [];
          children.push(link.child_unit_id);
          childrenByParent.set(link.parent_unit_id, children);
        }

        function getDescendantIds(unitId: string): Set<string> {
          const result = new Set<string>();
          const stack = [...(childrenByParent.get(unitId) ?? [])];
          while (stack.length) {
            const childId = stack.pop();
            if (!childId || result.has(childId)) continue;
            result.add(childId);
            stack.push(...(childrenByParent.get(childId) ?? []));
          }
          return result;
        }

        const movingUnitIds = new Set<string>();
        for (const marker of markersRef.current) {
          if (marker.route.length > 0) {
            movingUnitIds.add(marker.id);
            for (const descId of getDescendantIds(marker.id)) {
              movingUnitIds.add(descId);
            }
          }
        }

        return areas.map(serverArea => {
          if (movingUnitIds.has(serverArea.unit_id)) {
            const simArea = prevAreas.find(a => a.id === serverArea.id);
            if (simArea?.coordinates) {
              return { ...serverArea, coordinates: simArea.coordinates };
            }
          }
          return serverArea;
        });
      });
      setRefreshAreasTrigger(t => t + 1);
    } catch (err) {
      console.error("Failed to load unit areas:", err);
    }
  }, []);

  useEffect(() => { refreshAreas(); }, [refreshAreas]);

  // Local simulation hook
  const {
    simRunning,
    simSpeedKmh,
    setSimSpeedKmh,
    timeScale,
    setTimeScale,
    missionClockSec,
    resetMissionClock,
    stepMinutes,
    startSimulation,
    stopSimulation,
    unitTerrainClassRef,
    unitTerrainModifiersRef,
    activeEngagementUnitIds,
    activeEngagementsState,
    checkTerrainForUnit,
    checkTerrainForUnitArea,
    unitTerrainProfileRef,
    refreshTerrainProfile,
  } = useLocalSimulation({
    markersRef,
    unitsRef,
    unitAreasRef,
    fullStateRef,
    mapHandleRef,
    selectedUnitIdRef,
    setMarkers,
    setUnits,
    setUnitAreas,
    setTerrainPreview,
    refreshState,
    refreshAreas,
    onUnitDefeated: handleUnitDefeated,
  });

  // Profil terenu zaznaczonej jednostki — przy wyborze i po zmianie AO
  // (backend trzyma cache, a hook pomija zapytanie, gdy nic się nie zmieniło).
  useEffect(() => {
    if (selectedUnitId) void refreshTerrainProfile(selectedUnitId);
  }, [selectedUnitId, unitAreas, refreshTerrainProfile]);

  // Wpnij trasy agenta w markery (używane w trybie "Steruje" i przez "Zastosuj").
  const applyAgentRoutes = useCallback((routes: AgentRoute[]) => {
    const byId = new Map(routes.map(r => [r.unit_id, r.waypoints]));
    setMarkers(prev => prev.map(m => {
      const wps = byId.get(m.id);
      if (!wps) return m;
      return { ...m, route: wps.map((w, i) => ({ id: genId("ai"), x: w[0], y: w[1], order: i })) };
    }));
  }, []);

  // Agent RL (M6/Faza2): co 3 s pobierz rekomendacje z /agent/decide.
  //  • tryb "control" → wpina trasy automatycznie (autonomiczny),
  //  • tryb "advise"  → tylko wyświetla sugestie (operator zatwierdza "Zastosuj").
  useEffect(() => {
    if (!aiSide) return;
    if (aiMode === "control" && !simRunning) return;   // sterowanie tylko w trakcie symulacji
    let cancelled = false;
    const decide = async () => {
      const alive = unitsRef.current.filter(u => !isUnitDestroyed(u));
      if (alive.length === 0) return;
      const payload = alive.map(u => ({
        id: u.id, side: u.side, x: u.x, y: u.y,
        unit_type: u.unit_type, echelon: u.echelon, base_speed_kmh: u.base_speed_kmh,
        logistics: (u.logistics ?? {}) as Record<string, unknown>,
      }));
      const sides = aiSide === "both" ? ["friendly", "hostile"] : [aiSide];
      try {
        const all: AgentRoute[] = [];
        for (const s of sides) {
          const resp = await agentDecide(s, payload);
          all.push(...resp.routes);
        }
        if (cancelled) return;
        if (aiMode === "control") applyAgentRoutes(all);
        else setSuggestions(all);
      } catch (e) {
        console.error("[AGENT] decide error:", e);
      }
    };
    void decide();
    const iv = window.setInterval(() => void decide(), 3000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [aiSide, aiMode, simRunning, applyAgentRoutes]);

  // Wyczyść sugestie, gdy agent wyłączony lub tryb sterowania.
  useEffect(() => {
    if (!aiSide || aiMode === "control") setSuggestions([]);
  }, [aiSide, aiMode]);

  // Odcinki "ducha" tras do mapy (od pozycji jednostki do rekomendowanego waypointu).
  const suggestedRouteSegments = useMemo<[number, number][][]>(() => {
    if (aiMode !== "advise") return [];
    const segs: [number, number][][] = [];
    for (const s of suggestions) {
      if (!s.waypoints.length) continue;
      const u = units.find(x => x.id === s.unit_id);
      if (!u) continue;
      const last = s.waypoints[s.waypoints.length - 1];
      segs.push([[u.x, u.y], [last[0], last[1]]]);
    }
    return segs;
  }, [suggestions, units, aiMode]);

  // ── Rejestrator przebiegu dla widoku 3D (oś czasu / smugi tras) ──
  const recordingRef = useRef<{ startMs: number; byId: Record<string, [number, number, number][]> }>(
    { startMs: Date.now(), byId: {} });
  const [recordingTick, setRecordingTick] = useState(0);
  const prevSimRunningRef = useRef(false);
  useEffect(() => {
    if (simRunning && !prevSimRunningRef.current) {
      recordingRef.current = { startMs: Date.now(), byId: {} };  // nowy przebieg
      setRecordingTick(t => t + 1);
    }
    prevSimRunningRef.current = simRunning;
  }, [simRunning]);
  useEffect(() => {
    if (!simRunning) return;
    const sample = () => {
      const now = Date.now();
      for (const u of unitsRef.current) {
        if (isUnitDestroyed(u)) continue;
        const [lon, lat] = toLonLat([u.x, u.y]) as [number, number];
        (recordingRef.current.byId[u.id] ||= []).push([now, lon, lat]);
      }
    };
    const ivSample = window.setInterval(sample, 250);
    const ivTick = window.setInterval(() => setRecordingTick(t => t + 1), 1000);
    return () => { window.clearInterval(ivSample); window.clearInterval(ivTick); setRecordingTick(t => t + 1); };
  }, [simRunning]);

  const recording = useMemo<Recording | null>(() => {
    const r = recordingRef.current;
    const ids = Object.keys(r.byId);
    if (!ids.length) return null;
    let endMs = r.startMs;
    for (const id of ids) { const arr = r.byId[id]; if (arr.length) endMs = Math.max(endMs, arr[arr.length - 1][0]); }
    return { startMs: r.startMs, endMs, byId: r.byId };
  }, [recordingTick]);

  // Trasy (markery) → mapa unitId→[[x,y]] EPSG:3857 dla widoku 3D
  const routesById3d = useMemo<Record<string, [number, number][]>>(() => {
    const o: Record<string, [number, number][]> = {};
    for (const m of markers) {
      if (!m.route?.length) continue;
      o[m.id] = [...m.route].sort((a, b) => a.order - b.order).map(p => [p.x, p.y] as [number, number]);
    }
    return o;
  }, [markers]);

  const engagementMidpoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    for (const e of activeEngagementsState) {
      const ids = [...e.friendlyUnitIds, ...e.hostileUnitIds];
      const us = ids.map(id => units.find(u => u.id === id)).filter(Boolean) as Unit[];
      if (!us.length) continue;
      pts.push([us.reduce((s, u) => s + u.x, 0) / us.length, us.reduce((s, u) => s + u.y, 0) / us.length]);
    }
    return pts;
  }, [activeEngagementsState, units]);

  const destroyedXY = useMemo<[number, number][]>(
    () => units.filter(u => isUnitDestroyed(u)).map(u => [u.x, u.y] as [number, number]),
    [units]);

  const confirmSubordinateAreaDrawing = useCallback(async () => {
    if (!pendingSubordinateCreation) return;

    if (areaDraftPoints.length < 3) {
      alert("Narysuj przynajmniej 3 punkty dla obszaru.");
      return;
    }

    const lonLatCoords = areaDraftPoints.map(p => toLonLat(p) as [number, number]);
    const parentAO = unitAreas.find(a => a.id === pendingSubordinateCreation.parentAreaId);

    if (parentAO?.coordinates) {
      const allInside = lonLatCoords.every(p =>
        pointInPolygon(p, parentAO.coordinates as [number, number][])
      );
      if (!allInside) {
        alert("Niektóre punkty znajdują się poza obszarem jednostki nadrzędnej. Narysuj obszar ponownie.");
        setAreaDraftPoints([]);
        return;
      }
    }

    try {
      const parsedSubNum = subordinateUnitNumber.trim() ? Number(subordinateUnitNumber) : undefined;
      const res = await createChildWithArea(
        pendingSubordinateCreation.parentUnitId,
        lonLatCoords,
        parsedSubNum,
        subordinateCustomName.trim() || undefined
      );

      await refreshAreas();
      await refreshState();

      if (res.created_unit?.id) {
        setSelectedUnitId(res.created_unit.id);
      }

      setAreaDraftPoints([]);
      setPendingSubordinateCreation(null);
      setSubordinateUnitNumber("");
      setSubordinateCustomName("");
      setMode("idle");
    } catch (err: any) {
      console.error("Failed to create subordinate with area:", err);
      const message = err?.response?.data?.detail || err?.detail || err?.message || "Nie udało się utworzyć podległej jednostki.";
      alert(`Nie udało się utworzyć podległej jednostki:\n${message}\n\nNarysuj obszar ponownie.`);
      setAreaDraftPoints([]);
      setMode("draw-subordinate-area");
    }
  }, [pendingSubordinateCreation, areaDraftPoints, unitAreas, refreshAreas, refreshState, subordinateUnitNumber, subordinateCustomName]);

  const routeSnapshotRef = useRef<ScenarioMarker[]>([]);
  const stopDrawRoute  = useCallback(() => setMode("idle"), []);
  const cancelDrawRoute = useCallback(() => {
    setMarkers(routeSnapshotRef.current);
    setMode("idle");
  }, []);

  // Click outside map-area while drawing route → commit
  useEffect(() => {
    if (mode !== "draw-route") return;
    const handler = (e: MouseEvent) => {
      const mapArea = document.querySelector(".map-area");
      if (mapArea && !mapArea.contains(e.target as Node)) {
        stopDrawRoute();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mode, stopDrawRoute]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode === "draw-route") {
          cancelDrawRoute();
          return;
        }
        escapePlacementDialog();
        setContextMenu(null);
        setRadialMenu(null);
        if (mode === "draw-area" || mode === "edit-area" || mode === "draw-subordinate-area") {
          cancelAreaDrawing();
        }
        setMode("idle");
      }
      if (e.key === "Enter") {
        if (mode === "draw-route") {
          stopDrawRoute();
          return;
        }
        if (mode === "draw-subordinate-area" && pendingSubordinateCreation) {
          void confirmSubordinateAreaDrawing();
          return;
        }
        if ((mode === "draw-area" || mode === "edit-area") && areaDraftPoints.length >= 3) {
          confirmAreaDrawing();
        }
      }
      if (e.key === "Backspace") {
        if (mode === "draw-area" || mode === "edit-area" || mode === "draw-subordinate-area") {
          setAreaDraftPoints(prev => prev.slice(0, -1));
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, areaDraftPoints, pendingSubordinateCreation, confirmSubordinateAreaDrawing, cancelDrawRoute, stopDrawRoute]);

  // Sync units from fullState — preserve simulation position for units still moving
  useEffect(() => {
    if (!fullState?.units) return;
    setMarkers(prevMarkers => {
      const newUnits = fullState.units.map(su => {
        // If unit has an active route, keep its current simulation position
        const marker = prevMarkers.find(m => m.id === su.id);
        const isMoving = marker && marker.route.length > 0;
        const simUnit = unitsRef.current.find(u => u.id === su.id);
        return {
          id: su.id,
          symbol_id: su.symbol_id,
          symbol_name: su.symbol_name,
          side: su.side,
          x: isMoving && simUnit ? simUnit.x : su.x,
          y: isMoving && simUnit ? simUnit.y : su.y,
          position_lon: isMoving && simUnit ? simUnit.position_lon : su.position_lon,
          position_lat: isMoving && simUnit ? simUnit.position_lat : su.position_lat,
          bbox: su.bbox as [number, number, number, number] | null,
          confidence: su.confidence,
          source: su.source,
          created_at: su.created_at,
          updated_at: su.updated_at,
          echelon: su.echelon,
          unit_type: su.unit_type,
          unit_number: su.unit_number,
          custom_name: su.custom_name,
          logistics: su.logistics as any,
          current_elevation_m: su.current_elevation_m,
          readiness_status: su.readiness_status,
          requires_logistics_completion: su.requires_logistics_completion,
          base_speed_kmh: su.base_speed_kmh ?? null,
        };
      });
      setUnits(newUnits);
      return newUnits.map(u => {
        const existing = prevMarkers.find(m => m.id === u.id);
        return { id: u.id, symbolId: u.symbol_id, echelon: u.echelon || "team", x: u.x, y: u.y, route: existing?.route || [] };
      });
    });
  }, [fullState]);

  const simStepSelected = useCallback(async () => {
    if (!selectedUnitId) return;
    try {
      const res = await simulateUnitStep(selectedUnitId);
      setFullState(res.full_state);
    } catch (err) { console.error(err); }
  }, [selectedUnitId]);

  const simStepAll = useCallback(async () => {
    try {
      const res = await simulateAllStep();
      setFullState(res.full_state);
    } catch (err) { console.error(err); }
  }, []);

  const simRunRules = useCallback(async () => {
    try {
      const res = await runRules();
      setFullState(res.full_state);
    } catch (err) { console.error(err); }
  }, []);

  const simStartAuto = useCallback(() => {
    if (simAutoRef.current) return;
    setIsSimulationRunning(true);
    simAutoRef.current = setInterval(async () => {
      try {
        const res = await simulateAllStep();
        setFullState(res.full_state);
      } catch (err) { console.error(err); }
    }, 1000);
  }, []);

  const simStopAuto = useCallback(() => {
    if (simAutoRef.current) { clearInterval(simAutoRef.current); simAutoRef.current = null; }
    setIsSimulationRunning(false);
  }, []);

  const selectedUnit = units.find(u => u.id === selectedUnitId) ?? null;

  useEffect(() => {
    if (!selectedUnitId) mapHandleRef.current?.clearTerrainBox();
  }, [selectedUnitId]);

  const unitPositions = useMemo(() => {
    const positions: Record<string, [number, number]> = {};
    for (const u of units) positions[u.id] = [u.x, u.y];
    return positions;
  }, [units]);

  // Detection Loop
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function runDetection() {
      if (!active || !isDetecting || !mapHandleRef.current) return;
      const canvasData = mapHandleRef.current.captureCanvasClean();
      if (canvasData) {
        const { image: base64, width: screenshotWidth, height: screenshotHeight } = canvasData;
        const mapSize = mapHandleRef.current.getSize();
        if (!mapSize) return;
        const scaleX = mapSize[0] / screenshotWidth;
        const scaleY = mapSize[1] / screenshotHeight;
        try {
          const res = await fetch("/api/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: base64, width: screenshotWidth, height: screenshotHeight }),
          });
          if (res.ok) {
            const data = await res.json();
            if (active) {
              setInferenceMs(data.inference_ms);
              const newDetections: MapDetection[] = data.detections.map((d: any) => {
                const scaledCenter: [number, number] = [d.center[0] * scaleX, d.center[1] * scaleY];
                const [lon, lat] = mapHandleRef.current!.getCoordinateFromPixel(scaledCenter) || [0, 0];
                const scaledBbox: [number, number, number, number] = [
                  d.bbox[0] * scaleX, d.bbox[1] * scaleY, d.bbox[2] * scaleX, d.bbox[3] * scaleY,
                ];
                return { id: genId("det"), class_name: d.class_name, confidence: d.confidence, bbox: scaledBbox, center_px: scaledCenter, lon, lat, timestamp: Date.now() };
              });
              setDetections(newDetections);
            }
          }
        } catch (err) { console.error("YOLO detection error:", err); }
      }
      if (active && isDetecting) timer = setTimeout(runDetection, 1000);
    }

    if (isDetecting) { runDetection(); } else { setDetections([]); }
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [isDetecting]);

  // Map interaction
  const handleMapPointerMove = useCallback((_coord: [number, number]) => {}, []);

  const handleMapClick = useCallback(
    async (coord: [number, number]) => {
      setContextMenu(null);
      if (placementPickingRef.current) {
        setPlacementDialog({ lonLat: toLonLat(coord) as [number, number], picking: false });
        return;
      }
      if (mode === "draw-area" || mode === "edit-area") {
        setAreaDraftPoints(prev => [...prev, coord]);
        return;
      }
      if (mode === "idle") { setSelectedUnitId(null); setRadialMenu(null); }
      if (mode === "draw-route" && selectedUnitId) {
        const hierarchy = fullStateRef.current?.hierarchy || [];
        const parentByChild = new Map<string, string>();
        for (const link of hierarchy) parentByChild.set(link.child_unit_id, link.parent_unit_id);
        if (parentByChild.has(selectedUnitId)) return;

        setMarkers(prev => {
          const marker = prev.find(m => m.id === selectedUnitId);
          if (!marker) {
            const unit = units.find(u => u.id === selectedUnitId);
            if (!unit) return prev;
            return [...prev, { id: selectedUnitId, symbolId: unit.symbol_id, echelon: unit.echelon, x: unit.x, y: unit.y, route: [{ id: genId("rp"), x: coord[0], y: coord[1], order: 0 }] }];
          }
          if (marker.route.length >= 8) return prev;
          return prev.map(m => m.id === selectedUnitId
            ? { ...m, route: [...m.route, { id: genId("rp"), x: coord[0], y: coord[1], order: m.route.length }] }
            : m
          );
        });
      }
      if (mode === "draw-subordinate-area" && pendingSubordinateCreation) {
        const parentAO = unitAreas.find(a => a.id === pendingSubordinateCreation.parentAreaId);
        if (parentAO?.coordinates) {
          const [lon, lat] = toLonLat(coord);
          if (!pointInPolygon([lon, lat], parentAO.coordinates as [number, number][])) {
            alert("Punkt musi znajdować się wewnątrz obszaru odpowiedzialności jednostki nadrzędnej.");
            return;
          }
        }
        setAreaDraftPoints(prev => [...prev, coord]);
      }
    },
    [mode, selectedUnitId, units, pendingSubordinateCreation, unitAreas]
  );

  const handleMarkerClick = useCallback(
    (markerId: string, payload?: any) => {
      if (mode === "draw-route") return;
      if (comparisonMode) {
        if (comparisonOwnUnitIds.length === 0) {
          setComparisonOwnUnitIds([markerId]);
        } else {
          setComparisonTargetUnitIds(prev =>
            prev.includes(markerId) ? prev.filter(id => id !== markerId) : [...prev, markerId]
          );
        }
        return;
      }
      const clickedUnit = units.find(u => u.id === markerId);
      const destroyed = clickedUnit ? isUnitDestroyed(clickedUnit) : false;
      setMode("idle");
      // Zniszczona jednostka: nie otwieraj panelu zaznaczonej jednostki —
      // dozwolone jest tylko usunięcie przez menu radialne.
      if (!destroyed) {
        setSelectedUnitId(markerId);
      }
      if (payload) {
        setRadialMenu({ unitId: markerId, screenX: payload.clientX, screenY: payload.clientY });
      }
    },
    [mode, comparisonMode, comparisonOwnUnitIds, units]
  );

  // Menu radialne jest zakotwiczone w znaczku: po otwarciu panelu jednostki mapa
  // zmienia rozmiar i marker przesuwa się na ekranie — przeliczamy pozycję menu
  // co klatkę z aktualnej pozycji jednostki, aż się ustabilizuje.
  useEffect(() => {
    if (!radialMenu) return;
    const targetId = radialMenu.unitId;
    let raf = 0;
    const update = () => {
      const unit = unitsRef.current.find(u => u.id === targetId);
      const handle = mapHandleRef.current;
      if (unit && handle) {
        const client = handle.getClientFromCoordinate([unit.x, unit.y]);
        if (client) {
          setRadialMenu(prev => {
            if (!prev || prev.unitId !== targetId) return prev;
            if (Math.abs(prev.screenX - client[0]) < 0.5 && Math.abs(prev.screenY - client[1]) < 0.5) return prev;
            return { ...prev, screenX: client[0], screenY: client[1] };
          });
        }
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [radialMenu?.unitId]);

  const startDrawRoute = useCallback(() => {
    if (!selectedUnitId) return;
    const hierarchy = fullStateRef.current?.hierarchy || [];
    const parentByChild = new Map<string, string>();
    for (const link of hierarchy) parentByChild.set(link.child_unit_id, link.parent_unit_id);
    if (parentByChild.has(selectedUnitId)) {
      alert("Jednostka podległa nie może poruszać się samodzielnie. Najpierw odłącz ją od rodzica.");
      return;
    }
    routeSnapshotRef.current = markers;
    setMode("draw-route");
  }, [selectedUnitId, markers]);

  const clearRoute = useCallback(() => {
    if (!selectedUnitId) return;
    setMarkers(prev => prev.map(m => m.id === selectedUnitId ? { ...m, route: [] } : m));
  }, [selectedUnitId]);

  const handleDeleteUnit = useCallback(async (unitId: string) => {
    try {
      await deleteUnit(unitId);
      setUnits(prev => prev.filter(u => u.id !== unitId));
      setSelectedUnitId(null);
      setShowLogistics(false);
      setMode("idle");
      setRadialMenu(null);
      refreshState();
    } catch (err) {
      console.error("Error deleting unit:", err);
      alert("Nie udało się usunąć jednostki.");
    }
  }, [refreshState]);

  const startDrawAreaForUnit = (unitId: string) => {
    setDrawingAreaUnitId(unitId);
    setEditingAreaId(null);
    setAreaDraftPoints([]);
    setMode("draw-area");
    setRadialMenu(null);
  };

  const startEditAreaForUnit = (unitId: string, areaId: string) => {
    const area = unitAreas.find(a => a.id === areaId);
    if (!area || !area.coordinates) return;
    setDrawingAreaUnitId(unitId);
    setEditingAreaId(areaId);
    const points3857 = (area.coordinates as [number, number][]).map(p => fromLonLat(p) as [number, number]);
    if (points3857.length > 1 && points3857[0][0] === points3857[points3857.length - 1][0] && points3857[0][1] === points3857[points3857.length - 1][1]) {
      points3857.pop();
    }
    setAreaDraftPoints(points3857);
    setMode("edit-area");
    setRadialMenu(null);
  };

  const deleteResponsibilityAreaForUnit = async (unitId: string, areaId: string) => {
    if (!window.confirm("Usunąć ten obszar odpowiedzialności i wszystkie jednostki podległe wraz z ich danymi?")) return;
    try {
      await deleteUnitAreaCascade(areaId);
      setRadialMenu(null);
      await refreshAreas();
      await refreshState();
    } catch (err) {
      console.error("Failed to delete area cascade:", err);
      alert("Nie udało się usunąć obszarów.");
    }
  };

  const confirmAreaDrawing = async () => {
    if (!drawingAreaUnitId || areaDraftPoints.length < 3) return;
    const unit = units.find(u => u.id === drawingAreaUnitId);
    try {
      const lonLatCoords = areaDraftPoints.map(p => toLonLat(p) as [number, number]);
      if (mode === "edit-area" && editingAreaId) {
        await updatePolygonArea(editingAreaId, {
          coordinates: lonLatCoords,
          name: `AO ${unit?.symbol_name ?? ""}`,
          area_type: "responsibility",
        });
      } else {
        await createPolygonArea({
          unit_id: drawingAreaUnitId,
          name: `AO ${unit?.symbol_name ?? ""}`,
          area_type: "responsibility",
          coordinates: lonLatCoords,
          bearing_deg: 0,
        });
      }
      setAreaDraftPoints([]);
      setDrawingAreaUnitId(null);
      setEditingAreaId(null);
      setMode("idle");
      await refreshAreas();
      await refreshState();
    } catch (err: any) {
      console.error("Failed to save area:", err);
      alert(`Nie udało się zapisać strefy:\n${err.message || "Błąd serwera"}`);
    }
  };

  const cancelAreaDrawing = () => {
    setAreaDraftPoints([]);
    setDrawingAreaUnitId(null);
    setEditingAreaId(null);
    setPendingSubordinateCreation(null);
    setMode("idle");
  };

  const handleYoloSave = async (detection: MapDetection) => {
    try {
      const newUnit = await createUnitFromDetection({
        class_id: 0,
        class_name: detection.class_name,
        confidence: detection.confidence,
        bbox: detection.bbox,
        center: detection.center_px,
        lon: detection.lon,
        lat: detection.lat,
      });
      setUnits(prev => [...prev, newUnit]);
      setDetections(prev => prev.filter(d => d.id !== detection.id));
      refreshState();
    } catch (err) {
      console.error(err);
      alert("Nie udało się utworzyć jednostki z detekcji.");
    }
    setMode("idle");
  };

  const handleCreateSubordinateUnit = async (parentUnitId: string) => {
    const parentUnit = units.find(u => u.id === parentUnitId);
    if (!parentUnit) return;
    const parentAO = unitAreas.find(a => a.unit_id === parentUnitId && a.area_type === "responsibility");
    if (!parentAO) {
      alert("Najpierw dodaj obszar odpowiedzialności jednostki nadrzędnej.");
      return;
    }
    const childEchelon = UNIT_CHILDREN[parentUnit.echelon || ""];
    if (!childEchelon) {
      alert("Ta jednostka nie może mieć niższego szczebla.");
      return;
    }
    setPendingSubordinateCreation({ parentUnitId, parentAreaId: parentAO.id });
    setAreaDraftPoints([]);
    setMode("draw-subordinate-area");
    setRadialMenu(null);
  };

  const hasRoutes = markers.some(m => m.route.length > 0);

  const handleMapContextMenu = useCallback((payload: {
    pixel: [number, number];
    coordinate: [number, number];
    lonLat: [number, number];
    clientX: number;
    clientY: number;
  }) => {
    setContextMenu({ screenX: payload.clientX, screenY: payload.clientY, coordinate: payload.coordinate, lonLat: payload.lonLat });
  }, []);

  const handlePlaceUnitHere = useCallback(() => {
    if (!contextMenu) return;
    setPlacementDialog({ lonLat: contextMenu.lonLat });
    setContextMenu(null);
  }, [contextMenu]);

  const getResponsibilityAreaForUnit = useCallback((unitId: string) =>
    unitAreas.find(a => a.unit_id === unitId && a.area_type === "responsibility") || null
  , [unitAreas]);

  // Cancellation listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setContextMenu(null); escapePlacementDialog(); }
    };
    const handleClickAway = () => setContextMenu(null);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", handleClickAway);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleClickAway);
    };
  }, []);

  const toggleMapLayer = (key: MapLayerKey) => {
    if (key === "areas") setShowAreasLayer(v => !v);
    if (key === "taskGraphics") setShowTaskGraphics(v => !v);
    if (key === "tracks") setShowTracks(v => !v);
    if (key === "grid") setShowGrid(v => !v);
    if (key === "threat") setShowHeatmap3d(v => !v);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  return (
    <div className="app-layout">
      {/* ── Top navigation bar ── */}
      <nav className="ac-nav">
        <div className="ac-brand">
          <ShieldChevron size={19} weight="fill" />
          <span className="ac-brand-name">AICOMMAND</span>
          <span className="ac-brand-ver">v2</span>
        </div>
        <div className="ac-nav-divider" />

        <div className="ac-nav-tabs">
          {NAV_TABS.map(t => (
            <button
              key={t.id}
              className={`ac-nav-tab${sidebarTab === t.id ? " active" : ""}`}
              onClick={() => { setSidebarTab(t.id); setComparisonMode(t.id === "comparison"); }}
            >
              <t.Icon size={15} /><span>{t.label}</span>
              {/* Licznik jako znacznik, nie przemalowanie zakładki — czerwień
                  zostaje zarezerwowana dla strony przeciwnika. */}
              {t.id === "alerts" && activeEngagementUnitIds.size > 0 && (
                <span className="ac-nav-badge">{activeEngagementsState.length}</span>
              )}
              {t.id === "monitoring" && isDetecting && (
                <span className="ac-nav-dot" title="Detekcja aktywna" />
              )}
            </button>
          ))}
        </div>

        <div className="ac-nav-spacer" />

        <div className="ac-nav-right">
          <div className="ac-clock">
            <span className="ac-clock-label">Czas misji</span>
            <span className="ac-clock-value">{formatMissionClock(missionClockSec)}</span>
          </div>

          <div className="ac-simctl">
            <button
              className={`ac-sim-btn${simRunning ? " running" : ""}`}
              onClick={() => (simRunning ? stopSimulation() : startSimulation())}
              title="Start / stop symulacji"
            >
              {simRunning ? <Pause size={14} /> : <Play size={14} />}
              {simRunning ? "Pauza" : "Start"}
            </button>
            <div className="ac-seg">
              {[1, 8, 20, 60].map(v => (
                <button
                  key={v}
                  className={`ac-seg-btn mono${timeScale === v ? " active" : ""}`}
                  onClick={() => setTimeScale(v)}
                  title={`Tempo symulacji ×${v}`}
                >
                  ×{v}
                </button>
              ))}
            </div>
          </div>

        </div>
      </nav>

      {/* ── Body ── */}
      <div className="app-body">
      {/* ── Sidebar ── */}
      <aside
        className={
          AC_LEFT_TABS.has(sidebarTab)
            ? `ac-left${leftCollapsed ? " collapsed" : ""}`
            : `sidebar${leftCollapsed ? " collapsed" : ""}`
        }
      >
        <div className={AC_LEFT_TABS.has(sidebarTab) ? "ac-left-inner" : "sidebar-content"}>
          {sidebarTab === "units" && (
            <UnitsListPanel
              units={units}
              hierarchy={fullState?.hierarchy ?? []}
              selectedUnitId={selectedUnitId}
              expandedUnits={expandedUnits}
              engagedUnitIds={activeEngagementUnitIds}
              hiddenUnitIds={hiddenUnitIds}
              onToggleUnitVisibility={toggleUnitVisibility}
              onToggleGroupVisibility={toggleGroupVisibility}
              onSelectUnit={id => {
                setSelectedUnitId(id);
                const u = units.find(u => u.id === id);
                if (u) mapHandleRef.current?.flyTo([u.x, u.y], 17);
              }}
              onToggleExpand={toggleUnitExpanded}
              onAddUnit={() => {
                // Otwarte z panelu bocznego — domyślnie geometryczny środek Polski.
                setPlacementDialog({ lonLat: [19.48, 52.07] });
              }}
              onCollapse={() => setLeftCollapsed(true)}
            />
          )}

          {sidebarTab === "simulation" && (
            <SimulationPanel
              units={units}
              simRunning={simRunning}
              timeScale={timeScale}
              isDetecting={isDetecting}
              onToggleSim={() => (simRunning ? stopSimulation() : startSimulation())}
              onStepMinutes={stepMinutes}
              onReset={() => {
                stopSimulation();
                resetMissionClock();
                setMarkers([]);
                void refreshState();
                void refreshAreas();
              }}
              onToggleDetecting={() => setIsDetecting(v => !v)}
              onTimeScale={setTimeScale}
              onCollapse={() => setLeftCollapsed(true)}
            />
          )}

          {sidebarTab === "alerts" && (
            <AcEngagementsPanel
              engagements={activeEngagementsState}
              units={units}
              terrainByUnitId={unitTerrainClassRef.current}
              terrainProfiles={unitTerrainProfileRef.current}
              onCollapse={() => setLeftCollapsed(true)}
              onFocusUnit={id => {
                setSelectedUnitId(id);
                const u = units.find(x => x.id === id);
                if (u) mapHandleRef.current?.flyTo([u.x, u.y], 15);
              }}
            />
          )}

          {sidebarTab === "comparison" && (
            <AcComparePanel
              units={units}
              terrainByUnitId={unitTerrainClassRef.current}
              terrainProfiles={unitTerrainProfileRef.current}
              onCollapse={() => setLeftCollapsed(true)}
              onSelectUnit={id => {
                setSelectedUnitId(id);
                const u = units.find(x => x.id === id);
                if (u) mapHandleRef.current?.flyTo([u.x, u.y], 15);
              }}
            />
          )}

          {sidebarTab === "monitoring" && (
            <AcMonitoringPanel
              detections={detections}
              isDetecting={isDetecting}
              inferenceMs={inferenceMs}
              onCollapse={() => setLeftCollapsed(true)}
            />
          )}
        </div>
      </aside>

      {/* ── Przywrócenie lewego panelu ──
          Zwijanie odbywa się przyciskiem « w nagłówku panelu; po zwinięciu
          zostaje tylko wiszący przycisk », który panel przywraca. */}
      {leftCollapsed && (
        <button
          className="panel-edge-btn left-btn ac-reopen-btn"
          onClick={() => setLeftCollapsed(false)}
          title="Pokaż panel boczny"
        >
          <CaretDoubleRight size={14} />
        </button>
      )}

      {/* ── Map ── */}
      {/* --rail-right cofa prawą kolumnę narzędzi przed panel jednostki, aby
          nakładki nigdy nie chowały się pod nim. Jedna zmienna zamiast
          powtarzanego offsetu przy każdej nakładce. */}
      <main
        className="map-area"
        style={{ ["--rail-right" as string]: selectedUnit && !rightPanelCollapsed ? "364px" : "12px" }}
      >
        {/* Marker mapy składa pozycję z `units` (aktualizowaną co tick) z trasą
            i grafiką zadania z `markers`. Wcześniej `task` był tu pomijany, więc
            przełącznik grafiki APP-6A nie miał żadnego wpływu na rysowanie. */}
        <ScenarioMapView
          ref={mapHandleRef}
          markers={visibleUnits.map(u => {
            const m = markers.find(x => x.id === u.id);
            return {
              id: u.id,
              symbolId: u.symbol_id,
              x: u.x,
              y: u.y,
              route: m?.route || [],
              task: m?.task,
              destroyed: isUnitDestroyed(u),
              side: u.side,
              label: unitShortLabel(u),
            };
          })}
          selectedMarkerId={selectedUnitId}
          mode={mode}
          baseLayer={baseLayer}
          detections={detections}
          simTracks={fullState?.tracks ?? []}
          trails={recording}
          simAssessments={fullState?.assessments ?? []}
          unitPositions={unitPositions}
          showAreas={showAreasLayer}
          showTaskGraphics={showTaskGraphics}
          showTracks={showTracks}
          showGrid={showGrid}
          unitAreas={visibleUnitAreas}
          suggestedRoutes={suggestedRouteSegments}
          refreshAreasTrigger={refreshAreasTrigger}
          isHierarchicalZoom={isHierarchicalZoom}
          areaDraftPoints={areaDraftPoints}
          isLocked={!!radialMenu}
          onMapClick={handleMapClick}
          onPointerMove={handleMapPointerMove}
          onMarkerClick={handleMarkerClick}
          onMapContextMenu={handleMapContextMenu}
          onAreaDraftChange={setAreaDraftPoints}
        />

        {/* ── Widok 3D (CesiumJS) overlay ── */}
        {view3d && (
          <Globe3D
            units={visibleUnits}
            routesById={routesById3d}
            unitAreas={visibleUnitAreas as any}
            recording={recording}
            engagementMidpoints={engagementMidpoints}
            destroyedXY={destroyedXY}
            showHeatmap={showHeatmap3d}
            basemap={basemap3d}
            mode={mode}
            onPickUnit={handleMarkerClick}
            onGroundClick={handleMapClick}
            onContextMenu={handleMapContextMenu}
          />
        )}

        {/* ── Prawa kolumna narzędzi: 2D/3D, warstwy i podkład, zoom ── */}
        <MapToolRail
          view3d={view3d}
          onView3dChange={setView3d}
          layers={{
            areas: showAreasLayer,
            taskGraphics: showTaskGraphics,
            tracks: showTracks,
            grid: showGrid,
            threat: showHeatmap3d,
          }}
          onToggleLayer={toggleMapLayer}
          layerHints={{
            taskGraphics: markers.some(m => m.route.length > 0) ? undefined : "Brak narysowanych tras",
            tracks: recording || (fullState?.tracks?.length ?? 0) > 0
              ? undefined
              : "Pojawią się po uruchomieniu symulacji",
          }}
          baseLayer={baseLayer}
          onBaseLayerChange={setBaseLayer}
          basemap3d={basemap3d}
          onBasemap3dChange={setBasemap3d}
          isHierarchicalZoom={isHierarchicalZoom}
          onToggleHierarchicalZoom={() => setIsHierarchicalZoom(v => !v)}
          visibleEchelons={visibleEchelons}
          onToggleEchelon={toggleEchelon}
          onEchelonPreset={applyEchelonPreset}
          onZoomIn={() => mapHandleRef.current?.zoomBy(1)}
          onZoomOut={() => mapHandleRef.current?.zoomBy(-1)}
          onToggleFullscreen={toggleFullscreen}
        />

        {/* Draw Subordinate Area Instructions */}
        {mode === "draw-subordinate-area" && (
          <div className="draw-area-overlay">
            <div className="overlay-content">
              <div className="overlay-icon"><Network size={20} /></div>
              <div className="overlay-text">
                <strong>Tryb rysowania</strong>
                <span>Obszaru podległej jednostki</span>
                <span>Klikaj punkty tylko wewnątrz obszaru AO jednostki nadrzędnej.</span>
                <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                  <input
                    type="number"
                    min="1"
                    className="designation-input"
                    value={subordinateUnitNumber}
                    onChange={e => setSubordinateUnitNumber(e.target.value)}
                    placeholder="Numer"
                    style={{ width: "80px", background: "var(--bg-sunken)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: "6px", padding: "8px" }}
                  />
                  <input
                    type="text"
                    className="designation-input"
                    value={subordinateCustomName}
                    onChange={e => setSubordinateCustomName(e.target.value)}
                    placeholder="Nazwa własna"
                    style={{ flex: 1, background: "var(--bg-sunken)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: "6px", padding: "8px" }}
                  />
                </div>
                <div className="draw-area-actions" style={{ marginTop: "12px" }}>
                  ENTER<span className="action-key"> utwórz </span>
                  ESC<span className="action-key"> anuluj</span>
                </div>
              </div>
              <div className="point-count">Punkty: {areaDraftPoints.length}</div>
            </div>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="map-context-menu"
            style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div className="context-menu-coords">
              <div className="context-menu-coord-row">
                <span className="coord-label">Lon</span>
                <span className="coord-value">{contextMenu.lonLat[0].toFixed(6)}</span>
              </div>
              <div className="context-menu-coord-row">
                <span className="coord-label">Lat</span>
                <span className="coord-value">{contextMenu.lonLat[1].toFixed(6)}</span>
              </div>
            </div>
            <div className="context-menu-divider" />
            <button
              className="context-menu-action"
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handlePlaceUnitHere(); }}
            >
              📍 Postaw jednostkę tutaj
            </button>
          </div>
        )}

        {/* Placement Dialog */}
        {placementDialog?.picking && (
          <div className="placement-pick-hint">
            Kliknij na mapie, aby wskazać położenie nowej jednostki
            <span>Esc — powrót</span>
          </div>
        )}
        {placementDialog && (
          <UnitPlacementDialog
            lonLat={placementDialog.lonLat}
            units={units}
            hierarchy={fullState?.hierarchy ?? []}
            hidden={placementDialog.picking}
            onPickLocation={() => setPlacementDialog(prev => (prev ? { ...prev, picking: true } : prev))}
            onClose={() => setPlacementDialog(null)}
            onConfirm={newUnit => {
              setUnits(prev => [...prev, newUnit]);
              setSelectedUnitId(newUnit.id);
              setPlacementDialog(null);
              setShowLogistics(true); // od razu otwórz panel logistyki do uzupełnienia
              refreshState();
            }}
          />
        )}

        {/* Floating Map Layer Switcher */}
        {/* ── Sterowanie agentem RL (M6) ── */}
        <div className="ai-control">
          <div className="ai-control-title">
            <BrainCircuit size={14} /> Agent AI
            <span className="ai-control-hint" title="Polityka symulacyjna (abstrakcyjna) — nie realne doradztwo taktyczne. Działa przy włączonej symulacji.">ⓘ</span>
          </div>
          <div className="ai-control-row">
            {([
              { v: null, label: "Wył." },
              { v: "friendly", label: "Sojusz." },
              { v: "hostile", label: "Wrogie" },
              { v: "both", label: "Oba (AI vs AI)" },
            ] as { v: typeof aiSide; label: string }[]).map(opt => (
              <button
                key={String(opt.v)}
                className={`ai-control-btn${aiSide === opt.v ? " active" : ""}`}
                onClick={() => setAiSide(opt.v)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {aiSide && (
            <div className="ai-control-row ai-mode-row">
              {([
                { v: "advise", label: "Doradza" },
                { v: "control", label: "Steruje" },
              ] as { v: typeof aiMode; label: string }[]).map(opt => (
                <button
                  key={opt.v}
                  className={`ai-control-btn${aiMode === opt.v ? " active" : ""}`}
                  onClick={() => setAiMode(opt.v)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {aiSide && aiMode === "control" && !simRunning && (
            <div className="ai-control-warn">Uruchom symulację, by agent sterował</div>
          )}
          {aiSide && aiMode === "advise" && (
            <div className="ai-suggestions">
              <div className="ai-suggestions-head">
                <span>Rekomendacje</span>
                {suggestions.some(s => s.waypoints.length > 0) && (
                  <button className="ai-apply-btn" onClick={() => applyAgentRoutes(suggestions)}>
                    Zastosuj
                  </button>
                )}
              </div>
              {suggestions.length === 0 ? (
                <div className="ai-suggestions-empty">— brak (postaw jednostki / uruchom symulację)</div>
              ) : (
                suggestions.map(s => {
                  const u = units.find(x => x.id === s.unit_id);
                  const name = u?.custom_name || u?.symbol_name || s.unit_id.slice(0, 6);
                  const act = s.action || "—";
                  return (
                    <div className="ai-suggestion" key={s.unit_id}>
                      <span className="ai-suggestion-name">{name}</span>
                      <span className={`ai-suggestion-act act-${act}`}>{act}</span>
                      {s.rationale && <span className="ai-suggestion-why">{s.rationale}</span>}
                    </div>
                  );
                })
              )}
            </div>
          )}
          <div className="ai-control-disclaimer">
            Model abstrakcyjny — polityka symulacyjna, nie realne doradztwo taktyczne.
          </div>
        </div>

        {/* Logistics Form Overlay */}
        {showLogistics && selectedUnitId && (
          <div className="logistics-overlay">
            <LogisticsForm
              unitId={selectedUnitId}
              initialLogistics={selectedUnit?.logistics || null}
              onSaved={newLogistics => {
                setUnits(prev => prev.map(u => u.id === selectedUnitId ? { ...u, logistics: newLogistics } : u));
                setShowLogistics(false);
                refreshState();
              }}
              onClose={() => setShowLogistics(false)}
            />
          </div>
        )}

        {/* Draw Area Overlay */}
        {(mode === "draw-area" || mode === "edit-area") && (
          <div className="draw-area-overlay">
            <div className="overlay-content">
              <div className="overlay-icon">📐</div>
              <div className="overlay-text">
                <strong>{mode === "draw-area" ? "Tryb rysowania obszaru" : "Tryb edycji obszaru"}</strong>
                <span>Klikaj na mapie by dodać punkt.</span>
                <span className="hint">Przeciągnij punkt by go przesunąć. Alt + Klik na punkcie by go usunąć.</span>
                <span className="hint">Enter — zapisz, Esc — anuluj</span>
              </div>
              <div className="point-count">Punkty: {areaDraftPoints.length}</div>
            </div>
          </div>
        )}

        {/* Unit Radial Menu */}
        {radialMenu && (
          <div className="radial-backdrop" onClick={() => setRadialMenu(null)} />
        )}
        {radialMenu && (
          <div
            className="unit-radial-menu"
            style={{ left: radialMenu.screenX, top: radialMenu.screenY }}
            onClick={e => e.stopPropagation()}
          >
            <div className="radial-center" onClick={() => setRadialMenu(null)}>
              <X size={14} />
            </div>
            {(() => {
              const radialUnit = units.find(u => u.id === radialMenu.unitId);
              if (radialUnit && isUnitDestroyed(radialUnit)) {
                // Zniszczona jednostka: jedyna dozwolona akcja to usunięcie.
                return (
                  <button
                    className="radial-action delete-area"
                    title="Usuń zniszczoną jednostkę"
                    onClick={() => handleDeleteUnit(radialMenu.unitId)}
                    style={{ transform: "translate(-50%, -50%) translate(0, -60px)" }}
                  >
                    <div className="action-icon"><Trash2 /></div>
                  </button>
                );
              }
              const radialUnitArea = getResponsibilityAreaForUnit(radialMenu.unitId);
              const handleRadialDrawRoute = () => {
                const unitId = radialMenu.unitId;
                const hierarchy = fullStateRef.current?.hierarchy || [];
                const parentByChild = new Map<string, string>();
                for (const link of hierarchy) parentByChild.set(link.child_unit_id, link.parent_unit_id);
                if (parentByChild.has(unitId)) {
                  alert("Jednostka podległa nie może poruszać się samodzielnie.");
                  return;
                }
                setSelectedUnitId(unitId);
                setRadialMenu(null);
                setMode("draw-route");
              };

              if (!radialUnitArea) {
                return (
                  <>
                    <button
                      className="radial-action draw-area"
                      title="Dodaj AO"
                      onClick={() => startDrawAreaForUnit(radialMenu.unitId)}
                      style={{ transform: "translate(-50%, -50%) translate(0, -60px)" }}
                    >
                      <div className="action-icon"><DiamondPlus /></div>
                    </button>
                    <button
                      className="radial-action draw-route"
                      title="Rysuj trasę"
                      onClick={handleRadialDrawRoute}
                      style={{ transform: "translate(-50%, -50%) translate(0, 60px)" }}
                    >
                      <div className="action-icon"><Route size={20} /></div>
                    </button>
                  </>
                );
              }
              return (
                <>
                  <button
                    className="radial-action subordinate"
                    onClick={() => handleCreateSubordinateUnit(radialMenu.unitId)}
                    title="Dodaj podległą jednostkę"
                    style={{ transform: "translate(-50%, -50%) translate(0, -95px)" }}
                  >
                    <Network size={22} />
                  </button>
                  <button
                    className="radial-action edit-area"
                    title="Edytuj AO"
                    onClick={() => startEditAreaForUnit(radialMenu.unitId, radialUnitArea.id)}
                    style={{ transform: "translate(-50%, -50%) translate(-55px, -45px)" }}
                  >
                    <div className="action-icon"><SquarePen /></div>
                  </button>
                  <button
                    className="radial-action delete-area"
                    title="Usuń AO"
                    onClick={() => deleteResponsibilityAreaForUnit(radialMenu.unitId, radialUnitArea.id)}
                    style={{ transform: "translate(-50%, -50%) translate(55px, -45px)" }}
                  >
                    <div className="action-icon"><Trash2 /></div>
                  </button>
                  <button
                    className="radial-action draw-route"
                    title="Rysuj trasę"
                    onClick={handleRadialDrawRoute}
                    style={{ transform: "translate(-50%, -50%) translate(0, 65px)" }}
                  >
                    <div className="action-icon"><Route size={20} /></div>
                  </button>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Alert z boku: jednostka przegrała / została zniszczona ── */}
        {defeatNotices.length > 0 && (
          <div className="defeat-toasts">
            {defeatNotices.map(n => (
              <div className={`defeat-toast ${n.side === "friendly" ? "friendly" : "hostile"}`} key={n.unitId}>
                <AlertTriangle size={18} className="defeat-toast-icon" />
                <div className="defeat-toast-content">
                  <div className="defeat-toast-title">
                    <span className={`defeat-toast-dot ${n.side === "friendly" ? "friendly" : "hostile"}`} />
                    {n.name}
                  </div>
                  <div className="defeat-toast-reason">{n.reason}</div>
                </div>
                <button className="defeat-toast-close" onClick={() => dismissDefeatNotice(n.unitId)} title="Zamknij">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

      </main>

      {/* ── Right panel toggle ── */}
      {selectedUnit && (
        <button
          className="panel-edge-btn right-btn"
          style={{ right: rightPanelCollapsed ? 0 : 340 }}
          onClick={() => setRightPanelCollapsed(v => !v)}
          title={rightPanelCollapsed ? "Pokaż panel jednostki" : "Ukryj panel jednostki"}
        >
          {rightPanelCollapsed ? "‹" : "›"}
        </button>
      )}

      {/* ── Right panel: selected unit ── */}
      {selectedUnit && (
        <aside className={`right-panel${rightPanelCollapsed ? " collapsed" : ""}`}>
          <div className="right-panel-header">
            <span>ZAZNACZONA JEDNOSTKA</span>
            <button className="right-panel-close" onClick={() => setSelectedUnitId(null)}>✕</button>
          </div>
          <div className="right-panel-content">
            <SelectedUnitPanel
              key={selectedUnit.id}
              selectedUnit={selectedUnit}
              mode={mode}
              simRunning={simRunning}
              simSpeedKmh={simSpeedKmh}
              unitAreas={unitAreas}
              hierarchy={fullState?.hierarchy ?? []}
              units={units}
              onShowLogistics={() => setShowLogistics(true)}
              onStartDrawRoute={startDrawRoute}
              onStopDrawRoute={stopDrawRoute}
              onClearRoute={clearRoute}
              onDeleteUnit={handleDeleteUnit}
              onUnitSaved={updated => {
                setUnits(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u));
                refreshState();
                refreshAreas(); // nazwa AO śledzi nazwę jednostki — odśwież etykiety
              }}
              onCheckTerrain={id => void checkTerrainForUnit(id)}
              onCheckTerrainArea={id => void checkTerrainForUnitArea(id)}
              onSelectUnit={setSelectedUnitId}
              markers={markers}
              terrainClass={unitTerrainClassRef.current.get(selectedUnit.id)}
              terrainProfile={unitTerrainProfileRef.current.get(selectedUnit.id)}
              inContact={activeEngagementUnitIds.has(selectedUnit.id)}
              isHidden={hiddenUnitIds.has(selectedUnit.id)}
              onCenterUnit={id => {
                const u = unitsRef.current.find(x => x.id === id);
                if (u) mapHandleRef.current?.flyTo([u.x, u.y]);
              }}
              onToggleHide={toggleUnitVisibility}
              onDrawArea={startDrawAreaForUnit}
              onSetRouteTask={(id, task) =>
                setMarkers(prev => prev.map(m => m.id === id ? { ...m, task } : m))}
              onLogisticsSaved={newLogistics => {
                setUnits(prev => prev.map(u =>
                  u.id === selectedUnit.id ? { ...u, logistics: newLogistics } : u));
                void refreshState();
              }}
            />
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}
