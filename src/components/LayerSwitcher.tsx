import type { LayerName, BaseLayerType } from "./MapView";

type LayerConfig = {
  name: LayerName;
  label: string;
  description: string;
  color: string;
};

const LAYERS: LayerConfig[] = [
  {
    name: "detections",
    label: "Detekcje",
    description: "Wykryte symbole i obiekty",
    color: "#2563eb",
  },
  {
    name: "tracks",
    label: "Ścieżki ruchu",
    description: "Trasy i szlaki przemieszczania",
    color: "#10b981",
  },
  {
    name: "assessments",
    label: "Oceny / Alerty",
    description: "Reguły i alerty zagrożeń",
    color: "#f59e0b",
  },
];

type BaseLayerConfig = {
  id: BaseLayerType;
  label: string;
  description: string;
};

const BASE_LAYERS: BaseLayerConfig[] = [
  {
    id: "osm",
    label: "OpenStreetMap",
    description: "Standardowa mapa drogowa",
  },
  {
    id: "geoportal_orto",
    label: "Satelita (Ortofoto)",
    description: "Zdjęcia lotnicze GUGiK",
  },
  {
    id: "geoportal_topo",
    label: "Mapa Topo",
    description: "Szczegółowa rzeźba terenu",
  },
  {
    id: "terrain",
    label: "Teren / wysokości",
    description: "Wysokości i rzeźba terenu",
  },
];

type LayerSwitcherProps = {
  visibility: Record<LayerName, boolean>;
  counts: Record<LayerName, number>;
  onToggle: (layer: LayerName) => void;
  selectedBaseLayer: BaseLayerType;
  onBaseLayerChange: (base: BaseLayerType) => void;
};

export default function LayerSwitcher({
  visibility,
  counts,
  onToggle,
  selectedBaseLayer,
  onBaseLayerChange,
}: LayerSwitcherProps) {
  return (
    <div className="layer-switcher">
      <div className="layer-section">
        <div className="layer-section-header">Warstwy obiektów</div>
        {LAYERS.map((layer) => {
          const isOn = visibility[layer.name];
          return (
            <div
              key={layer.name}
              className={`layer-item ${isOn ? "active" : ""}`}
              onClick={() => onToggle(layer.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onToggle(layer.name);
              }}
            >
              <div
                className={`layer-dot ${isOn ? "" : "off"}`}
                style={{ backgroundColor: layer.color }}
              />
              <div className="layer-info">
                <div className="layer-name">{layer.label}</div>
                <div className="layer-desc">{layer.description}</div>
              </div>
              {counts[layer.name] > 0 && (
                <span className="layer-count">{counts[layer.name]}</span>
              )}
              <div className={`layer-toggle ${isOn ? "on" : ""}`} />
            </div>
          );
        })}
      </div>

      <div className="layer-section">
        <div className="layer-section-header">Podkład mapowy</div>
        <div className="base-layer-grid">
          {BASE_LAYERS.map((base) => (
            <button
              key={base.id}
              className={`base-layer-card ${selectedBaseLayer === base.id ? "active" : ""}`}
              onClick={() => onBaseLayerChange(base.id)}
            >
              <div className={`base-layer-thumb ${base.id}`} />
              <div className="base-layer-label">{base.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
