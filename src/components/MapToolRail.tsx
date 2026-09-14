import { useEffect, useRef, useState } from "react";
import {
  Stack, Plus, Minus, CornersOut, CaretDown,
  Polygon, TrendUp, DotsThreeOutline, GridFour, Flame,
  Mountains, MapTrifold, GlobeHemisphereWest, Globe,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { BaseLayerType } from "../types/map";
import type { Basemap } from "../map/Globe3D";
import { UNIT_HIERARCHY_ORDER } from "../utils/hierarchyVisibility";

/**
 * Prawa kolumna narzędzi mapy — przełącznik 2D/3D, warstwy i podkład, zoom.
 *
 * Panel warstw otwiera się na lewo od kolumny, więc nie zasłania ani
 * przycisków, ani przełącznika widoku.
 */

export type MapLayerKey = "areas" | "taskGraphics" | "tracks" | "grid" | "threat";

const LAYER_ROWS: { key: MapLayerKey; label: string; icon: Icon }[] = [
  { key: "areas", label: "Rejony odpowiedzialności", icon: Polygon },
  { key: "taskGraphics", label: "Grafiki zadań", icon: TrendUp },
  { key: "tracks", label: "Ślady ruchu", icon: DotsThreeOutline },
  { key: "grid", label: "Siatka", icon: GridFour },
  { key: "threat", label: "Warstwa zagrożenia", icon: Flame },
];

const BASES_2D: { id: BaseLayerType; label: string; icon: Icon }[] = [
  { id: "terrain", label: "Teren", icon: Mountains },
  { id: "osm", label: "OSM", icon: MapTrifold },
  { id: "geoportal_orto", label: "Satelita", icon: GlobeHemisphereWest },
  { id: "geoportal_topo", label: "Topo", icon: Stack },
];

const BASES_3D: { id: Basemap; label: string; icon: Icon }[] = [
  { id: "osm", label: "OSM", icon: MapTrifold },
  { id: "bing", label: "Bing", icon: GlobeHemisphereWest },
  { id: "google", label: "Google", icon: GlobeHemisphereWest },
  { id: "photo3d", label: "Foto 3D", icon: Globe },
];

const ECHELON_PL: Record<string, string> = {
  Region_Theater: "Teatr", Army_Group_Front: "Front", Army: "Armia", Corps_MEF: "Korpus",
  Division: "Dywizja", Brigade: "Brygada", Regiment_Group: "Pułk", Battalion_Squadron: "Batalion",
  Company_Battery_Troop: "Kompania", Platoon_Detachment: "Pluton", Section: "Sekcja",
  Squad: "Drużyna", Team_Crew: "Załoga",
};

type Props = {
  view3d: boolean;
  onView3dChange: (v: boolean) => void;
  layers: Record<MapLayerKey, boolean>;
  /** Podpowiedź pod nazwą warstwy, gdy nie ma czego pokazać (np. brak tras). */
  layerHints?: Partial<Record<MapLayerKey, string>>;
  onToggleLayer: (key: MapLayerKey) => void;
  baseLayer: BaseLayerType;
  onBaseLayerChange: (id: BaseLayerType) => void;
  basemap3d: Basemap;
  onBasemap3dChange: (id: Basemap) => void;
  isHierarchicalZoom: boolean;
  onToggleHierarchicalZoom: () => void;
  visibleEchelons: Set<string>;
  onToggleEchelon: (echelon: string) => void;
  onEchelonPreset: (preset: "all" | "higher" | "lower" | "none") => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleFullscreen: () => void;
};

export default function MapToolRail(props: Props) {
  const {
    view3d, onView3dChange, layers, layerHints, onToggleLayer,
    baseLayer, onBaseLayerChange, basemap3d, onBasemap3dChange,
    isHierarchicalZoom, onToggleHierarchicalZoom,
    visibleEchelons, onToggleEchelon, onEchelonPreset,
    onZoomIn, onZoomOut, onToggleFullscreen,
  } = props;
  const [open, setOpen] = useState(false);
  const [echelonsOpen, setEchelonsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Zamknięcie panelu kliknięciem poza kolumną albo klawiszem Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="map-rail" ref={rootRef}>
      <div className="view-mode-switch">
        <button className={`vms-btn${!view3d ? " active" : ""}`} onClick={() => onView3dChange(false)}>2D</button>
        <button className={`vms-btn${view3d ? " active" : ""}`} onClick={() => onView3dChange(true)}>3D</button>
      </div>

      <div className="map-rail-tools">
        <button
          className={`map-rail-btn${open ? " active" : ""}`}
          onClick={() => setOpen(v => !v)}
          title="Warstwy i podkład"
          aria-expanded={open}
        >
          <Stack size={18} />
        </button>

        {!view3d && (
          <div className="map-rail-group">
            <button className="map-rail-btn" onClick={onZoomIn} title="Przybliż"><Plus size={16} /></button>
            <button className="map-rail-btn" onClick={onZoomOut} title="Oddal"><Minus size={16} /></button>
            <button className="map-rail-btn" onClick={onToggleFullscreen} title="Pełny ekran"><CornersOut size={16} /></button>
          </div>
        )}

        {open && (
          <div className="map-layers-panel">
            <section className="mlp-section">
              <div className="mlp-title">Warstwy</div>
              {LAYER_ROWS.map(({ key, label, icon: RowIcon }) => {
                // Heatmapa zagrożenia istnieje tylko w widoku 3D.
                const disabled = key === "threat" && !view3d;
                const on = layers[key] && !disabled;
                return (
                  <button
                    key={key}
                    className="mlp-row"
                    onClick={() => onToggleLayer(key)}
                    disabled={disabled}
                    title={disabled ? "Dostępne w widoku 3D" : undefined}
                  >
                    <RowIcon size={17} />
                    <span className="mlp-label">
                      {label}
                      {!disabled && layerHints?.[key] && <span className="mlp-hint">{layerHints[key]}</span>}
                      {disabled && <span className="mlp-hint">Dostępna w widoku 3D</span>}
                    </span>
                    <span className={`mlp-switch${on ? " on" : ""}`} />
                  </button>
                );
              })}
            </section>

            <section className="mlp-section">
              <div className="mlp-title">Podkład{view3d ? " 3D" : ""}</div>
              <div className="mlp-base-grid">
                {view3d
                  ? BASES_3D.map(({ id, label, icon: BaseIcon }) => (
                      <button key={id} className={`mlp-base${basemap3d === id ? " active" : ""}`}
                              onClick={() => onBasemap3dChange(id)}>
                        <BaseIcon size={16} />{label}
                      </button>
                    ))
                  : BASES_2D.map(({ id, label, icon: BaseIcon }) => (
                      <button key={id} className={`mlp-base${baseLayer === id ? " active" : ""}`}
                              onClick={() => onBaseLayerChange(id)}>
                        <BaseIcon size={16} />{label}
                      </button>
                    ))}
              </div>
            </section>

            <section className="mlp-section">
              <button
                className={`mlp-disclosure${echelonsOpen ? " open" : ""}`}
                onClick={() => setEchelonsOpen(v => !v)}
                aria-expanded={echelonsOpen}
              >
                Widoczność szczebli
                <CaretDown size={12} />
              </button>
              {echelonsOpen && (
                <>
                  <button className="mlp-row" onClick={onToggleHierarchicalZoom}>
                    <span className="mlp-label">Zoom hierarchiczny</span>
                    <span className={`mlp-switch${isHierarchicalZoom ? " on" : ""}`} />
                  </button>
                  <div className="mlp-presets">
                    <button className="mlp-chip" onClick={() => onEchelonPreset("all")}>Wszystkie</button>
                    <button className="mlp-chip" onClick={() => onEchelonPreset("higher")}>Wyższe</button>
                    <button className="mlp-chip" onClick={() => onEchelonPreset("lower")}>Niższe</button>
                    <button className="mlp-chip" onClick={() => onEchelonPreset("none")}>Czyść</button>
                  </div>
                  <div className="mlp-echelons">
                    {UNIT_HIERARCHY_ORDER.map(echelon => (
                      <button
                        key={echelon}
                        className={`mlp-chip${visibleEchelons.has(echelon) ? " active" : ""}`}
                        onClick={() => onToggleEchelon(echelon)}
                      >
                        {ECHELON_PL[echelon] ?? echelon}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
