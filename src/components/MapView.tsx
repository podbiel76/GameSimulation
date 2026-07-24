import { useEffect, useRef, useCallback } from "react";

import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS";
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import GeoJSON from "ol/format/GeoJSON";
import OSM from "ol/source/OSM";
import { fromLonLat } from "ol/proj";
import { boundingExtent } from "ol/extent";
import Feature from "ol/Feature";

import type Geometry from "ol/geom/Geometry";

import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import CircleStyle from "ol/style/Circle";
import Text from "ol/style/Text";

import "ol/ol.css";

// ─── Types ──────────────────────────────────────────────────────────
export type LayerName = "detections" | "tracks" | "assessments";
export type BaseLayerType = "osm" | "geoportal_orto" | "geoportal_topo" | "terrain";

export type FeatureSelectPayload = {
  layer: LayerName;
  properties: Record<string, unknown>;
};

export type MapViewProps = {
  scenarioId: string;
  className?: string;
  center?: [number, number];
  zoom?: number;
  autoFit?: boolean;
  reloadToken?: string | number;
  layerVisibility?: Record<LayerName, boolean>;
  baseLayer?: BaseLayerType;
  onFeatureSelect?: (payload: FeatureSelectPayload) => void;
  onLayerStats?: (stats: Record<LayerName, number>) => void;
};

const DEFAULT_CENTER: [number, number] = [19.1451, 51.9194];
const DEFAULT_ZOOM = 6;

// ─── Style Functions ────────────────────────────────────────────────

const SYMBOL_COLORS: Record<string, string> = {
  SAM: "#ef4444",
  APC: "#f97316",
  RADAR: "#8b5cf6",
  HQ: "#ec4899",
  ARTY: "#f59e0b",
  DEPOT: "#06b6d4",
  unknown: "#2563eb",
};

function detectionStyle(feature: Feature<Geometry>): Style {
  const symbolType = String(feature.get("symbol_type") ?? "unknown");
  const confidence = Number(feature.get("confidence") ?? 0);
  const color = SYMBOL_COLORS[symbolType] || SYMBOL_COLORS.unknown;

  return new Style({
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: color + "cc" }),
      stroke: new Stroke({ color: "#ffffff", width: 2.5 }),
    }),
    text: new Text({
      text: `${symbolType} ${confidence ? `(${(confidence * 100).toFixed(0)}%)` : ""}`,
      offsetY: -18,
      font: "600 11px Inter, sans-serif",
      fill: new Fill({ color: "#f1f5f9" }),
      backgroundFill: new Fill({ color: "rgba(10, 14, 26, 0.85)" }),
      backgroundStroke: new Stroke({ color: color + "66", width: 1 }),
      padding: [3, 6, 3, 6],
    }),
  });
}

function trackStyle(feature: Feature<Geometry>): Style {
  const trackId = String(feature.get("track_id") ?? "");
  const confidence = Number(feature.get("confidence") ?? 0);

  return new Style({
    stroke: new Stroke({
      color: "rgba(16, 185, 129, 0.9)",
      width: 3.5,
      lineDash: [8, 4],
      lineCap: "round",
    }),
    text: new Text({
      text: trackId
        ? `▸ ${trackId.slice(4, 12)}${confidence ? ` · ${(confidence * 100).toFixed(0)}%` : ""}`
        : "",
      placement: "line",
      font: "600 11px Inter, sans-serif",
      fill: new Fill({ color: "#34d399" }),
      backgroundFill: new Fill({ color: "rgba(10, 14, 26, 0.8)" }),
      padding: [2, 6, 2, 6],
      overflow: true,
    }),
  });
}

function assessmentStyle(feature: Feature<Geometry>): Style {
  const severity = String(feature.get("severity") ?? "low");
  const ruleId = String(feature.get("rule_id") ?? "rule");

  const colors: Record<string, { fill: string; stroke: string }> = {
    high: { fill: "rgba(239, 68, 68, 0.15)", stroke: "rgba(239, 68, 68, 0.9)" },
    medium: { fill: "rgba(249, 115, 22, 0.12)", stroke: "rgba(249, 115, 22, 0.85)" },
    low: { fill: "rgba(250, 204, 21, 0.1)", stroke: "rgba(202, 138, 4, 0.8)" },
  };

  const c = colors[severity] || colors.low;
  const geomType = feature.getGeometry()?.getType();

  return new Style({
    image:
      geomType === "Point"
        ? new CircleStyle({
            radius: 10,
            fill: new Fill({ color: c.fill }),
            stroke: new Stroke({ color: c.stroke, width: 2.5 }),
          })
        : undefined,
    fill: new Fill({ color: c.fill }),
    stroke: new Stroke({ color: c.stroke, width: 2, lineDash: [6, 4] }),
    text: new Text({
      text: `${severity.toUpperCase()}: ${ruleId.replace(/_/g, " ")}`,
      offsetY: geomType === "Point" ? -22 : 0,
      font: "700 10px Inter, sans-serif",
      fill: new Fill({ color: c.stroke }),
      backgroundFill: new Fill({ color: "rgba(10, 14, 26, 0.9)" }),
      padding: [3, 6, 3, 6],
      overflow: true,
    }),
  });
}

// ─── Component ──────────────────────────────────────────────────────

export default function MapView({
  scenarioId,
  className,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  autoFit = true,
  reloadToken,
  layerVisibility,
  baseLayer = "geoportal_orto",
  onFeatureSelect,
  onLayerStats,
}: MapViewProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);
  const layersRef = useRef<Record<LayerName, VectorLayer> | null>(null);
  const sourcesRef = useRef<Record<LayerName, VectorSource> | null>(null);

  // Feature click handler ref (stable callback)
  const onFeatureSelectRef = useRef(onFeatureSelect);
  onFeatureSelectRef.current = onFeatureSelect;

  const onLayerStatsRef = useRef(onLayerStats);
  onLayerStatsRef.current = onLayerStats;

  const emitStats = useCallback(() => {
    if (!sourcesRef.current || !onLayerStatsRef.current) return;
    onLayerStatsRef.current({
      detections: sourcesRef.current.detections.getFeatures().length,
      tracks: sourcesRef.current.tracks.getFeatures().length,
      assessments: sourcesRef.current.assessments.getFeatures().length,
    });
  }, []);

  // Toggle layer visibility
  useEffect(() => {
    if (!layersRef.current || !layerVisibility) return;
    (Object.keys(layerVisibility) as LayerName[]).forEach((name) => {
      layersRef.current![name].setVisible(layerVisibility[name]);
    });
  }, [layerVisibility]);

  // Initialize map
  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const detectionSource = new VectorSource({ format: new GeoJSON() });
    const trackSource = new VectorSource({ format: new GeoJSON() });
    const assessmentSource = new VectorSource({ format: new GeoJSON() });

    sourcesRef.current = {
      detections: detectionSource,
      tracks: trackSource,
      assessments: assessmentSource,
    };

    const detectionsLayer = new VectorLayer({
      source: detectionSource,
      style: (feature) => {
        if (feature instanceof Feature) {
          feature.set("__layerName", "detections", true);
          return detectionStyle(feature);
        }
        return undefined;
      },
      zIndex: 30,
    });

    const tracksLayer = new VectorLayer({
      source: trackSource,
      style: (feature) => {
        if (feature instanceof Feature) {
          feature.set("__layerName", "tracks", true);
          return trackStyle(feature);
        }
        return undefined;
      },
      zIndex: 20,
    });

    const assessmentsLayer = new VectorLayer({
      source: assessmentSource,
      style: (feature) => {
        if (feature instanceof Feature) {
          feature.set("__layerName", "assessments", true);
          return assessmentStyle(feature);
        }
        return undefined;
      },
      zIndex: 40,
    });

    layersRef.current = {
      detections: detectionsLayer,
      tracks: tracksLayer,
      assessments: assessmentsLayer,
    };

    const map = new Map({
      target: mapElementRef.current,
      layers: [tracksLayer, detectionsLayer, assessmentsLayer],
      view: new View({
        center: fromLonLat(center),
        zoom,
        enableRotation: false,
      }),
    });

    mapRef.current = map;

    // ── Click handler ──
    map.on("click", (evt) => {
      if (!onFeatureSelectRef.current) return;

      map.forEachFeatureAtPixel(evt.pixel, (feature) => {
        const layerName = String(feature.get("__layerName") ?? "");
        if (layerName === "detections" || layerName === "tracks" || layerName === "assessments") {
          const props = { ...feature.getProperties() };
          delete props.geometry;
          delete props.__layerName;
          onFeatureSelectRef.current!({ layer: layerName, properties: props });
          return true;
        }
        return false;
      });
    });

    // ── Pointer cursor ──
    map.on("pointermove", (evt) => {
      const el = map.getTargetElement() as HTMLElement;
      let hit = false;
      map.forEachFeatureAtPixel(evt.pixel, () => {
        hit = true;
        return true;
      });
      el.style.cursor = hit ? "pointer" : "";
    });

    // ── Load GeoJSON data ──
    const format = new GeoJSON();

    async function loadLayerData() {
      try {
        const [detRes, trkRes, asmRes] = await Promise.all([
          fetch(`/api/scenarios/${scenarioId}/detections.geojson`),
          fetch(`/api/scenarios/${scenarioId}/tracks.geojson`),
          fetch(`/api/scenarios/${scenarioId}/assessments.geojson`),
        ]);

        const [detJson, trkJson, asmJson] = await Promise.all([
          detRes.json(),
          trkRes.json(),
          asmRes.json(),
        ]);

        detectionSource.addFeatures(format.readFeatures(detJson, { featureProjection: "EPSG:3857" }));
        trackSource.addFeatures(format.readFeatures(trkJson, { featureProjection: "EPSG:3857" }));
        assessmentSource.addFeatures(format.readFeatures(asmJson, { featureProjection: "EPSG:3857" }));

        emitStats();

        // Auto-fit
        if (autoFit) {
          const allFeatures = [
            ...detectionSource.getFeatures(),
            ...trackSource.getFeatures(),
            ...assessmentSource.getFeatures(),
          ];

          const extents = allFeatures
            .map((f) => f.getGeometry()?.getExtent())
            .filter(Boolean) as number[][];

          if (extents.length > 0) {
            const coords = extents.flatMap((e) => [
              [e[0], e[1]],
              [e[2], e[3]],
            ]) as [number, number][];

            const extent = boundingExtent(coords);
            map.getView().fit(extent, {
              padding: [60, 60, 60, 60],
              duration: 600,
              maxZoom: 14,
            });
          }
        }
      } catch (err) {
        console.error("Failed to load GeoJSON data:", err);
      }
    }

    void loadLayerData();

    // ── Add Geoportal WMTS base layer ──
    let isMounted = true;

    // void addGeoportalBaseLayer(); // Removed old static initialization

    return () => {
      isMounted = false;
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, [scenarioId]);

  // Base layer switcher
  useEffect(() => {
    if (!mapRef.current) return;

    let isMounted = true;

    async function updateBaseLayer() {
      const map = mapRef.current;
      if (!map) return;

      // Remove old base layer if exists
      if (baseLayerRef.current) {
        map.removeLayer(baseLayerRef.current);
        baseLayerRef.current = null;
      }

      let newLayer: TileLayer;

      if (baseLayer === "osm") {
        newLayer = new TileLayer({
          source: new OSM(),
          zIndex: 0,
        });
      } else {
        // Geoportal WMTS
        try {
          const response = await fetch("/api/map-proxy/geoportal/wmts-capabilities");
          const capabilitiesText = await response.text();

          if (!isMounted || !mapRef.current) return;

          const parser = new WMTSCapabilities();
          const capabilities = parser.read(capabilitiesText);

          const layerName = baseLayer === "geoportal_orto" ? "ORTOFOTOMAPA" : "mapatopo_standard";

          const wmtsOptions = optionsFromCapabilities(capabilities, {
            layer: layerName,
            matrixSet: "EPSG:3857",
          });

          if (!wmtsOptions) throw new Error("WMTS options failed");

          wmtsOptions.urls = ["/api/map-proxy/geoportal/wmts-tile"];

          newLayer = new TileLayer({
            source: new WMTS(wmtsOptions),
            zIndex: 0,
            opacity: baseLayer === "geoportal_orto" ? 0.85 : 1,
          });
        } catch (err) {
          console.error("Failed to load Geoportal layer, falling back to OSM", err);
          newLayer = new TileLayer({
            source: new OSM(),
            zIndex: 0,
          });
        }
      }

      if (isMounted) {
        baseLayerRef.current = newLayer;
        map.getLayers().insertAt(0, newLayer);
      }
    }

    void updateBaseLayer();

    return () => {
      isMounted = false;
    };
  }, [baseLayer]);

  // Reload data
  useEffect(() => {
    if (!sourcesRef.current || !reloadToken) return;

    const format = new GeoJSON();

    async function reload() {
      if (!sourcesRef.current) return;

      const [detRes, trkRes, asmRes] = await Promise.all([
        fetch(`/api/scenarios/${scenarioId}/detections.geojson`),
        fetch(`/api/scenarios/${scenarioId}/tracks.geojson`),
        fetch(`/api/scenarios/${scenarioId}/assessments.geojson`),
      ]);

      const [detJson, trkJson, asmJson] = await Promise.all([
        detRes.json(),
        trkRes.json(),
        asmRes.json(),
      ]);

      sourcesRef.current.detections.clear();
      sourcesRef.current.tracks.clear();
      sourcesRef.current.assessments.clear();

      sourcesRef.current.detections.addFeatures(format.readFeatures(detJson, { featureProjection: "EPSG:3857" }));
      sourcesRef.current.tracks.addFeatures(format.readFeatures(trkJson, { featureProjection: "EPSG:3857" }));
      sourcesRef.current.assessments.addFeatures(format.readFeatures(asmJson, { featureProjection: "EPSG:3857" }));

      emitStats();
    }

    void reload();
  }, [scenarioId, reloadToken, emitStats]);

  return (
    <div className={`map-container ${className ?? ""}`}>
      <div ref={mapElementRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
