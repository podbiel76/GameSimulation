// Globe3D — tryb "Widok 3D" (CesiumJS). Wizualizuje istniejący stan symulacji:
// teren z reliefem, jednostki (symbole APP-6A), AO, trasy, oś czasu ze smugami (trails),
// efekty starcia/zniszczenia, heatmapę zagrożenia. Nie zmienia mechaniki.
import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { fromLonLat } from "ol/proj";
import { getSymbolUrl } from "../data/symbolCatalog";
import type { Unit, EditorMode } from "../types/map";
import {
  mercToCartesian, mercToLonLat, sideColor, unitsBBoxLonLat, threatHeatmapCanvas,
} from "./cesiumScene";

export type Recording = {
  startMs: number;
  endMs: number;
  byId: Record<string, [number, number, number][]>;   // [tMs, lon, lat][]
};

type Props = {
  units: Unit[];
  routesById: Record<string, [number, number][]>;       // unitId → [[x,y],...] EPSG:3857
  unitAreas: { unit_id: string; coordinates: [number, number][] | null }[];
  recording: Recording | null;
  engagementMidpoints: [number, number][];              // [x,y] EPSG:3857 punkty starć
  destroyedXY: [number, number][];                      // [x,y] zniszczonych jednostek
  showHeatmap: boolean;
  basemap: Basemap;                                     // podkład 3D
  mode: EditorMode;                                     // tryb edytora (np. draw-route)
  onPickUnit: (unitId: string) => void;                // klik w symbol → zaznacz jednostkę
  onGroundClick: (xy: [number, number]) => void;       // klik w teren (EPSG:3857)
  onContextMenu: (p: {                                  // prawy klik → menu „Postaw jednostkę tutaj"
    pixel: [number, number]; coordinate: [number, number];
    lonLat: [number, number]; clientX: number; clientY: number;
  }) => void;
};

export type Basemap = "osm" | "bing" | "google" | "photo3d";
// Asset ID Cesium Ion dla podkładów (wymagają tokena Ion)
const ION_ASSET = { bing: 2, google: 3830182, photo3d: 2275207 };

const ION_TOKEN = (import.meta as any).env?.VITE_CESIUM_ION_TOKEN as string | undefined;

export default function Globe3D({
  units, routesById, unitAreas, recording, engagementMidpoints, destroyedXY, showHeatmap, basemap,
  mode, onPickUnit, onGroundClick, onContextMenu,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const dsRef = useRef<Record<string, Cesium.CustomDataSource>>({});
  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const flewToRef = useRef(false);
  // refy do aktualnych callbacków/trybu (handler tworzony raz)
  const modeRef = useRef(mode); modeRef.current = mode;
  const onPickRef = useRef(onPickUnit); onPickRef.current = onPickUnit;
  const onGroundRef = useRef(onGroundClick); onGroundRef.current = onGroundClick;
  const onCtxRef = useRef(onContextMenu); onCtxRef.current = onContextMenu;

  // ── Inicjalizacja Viewera (raz, gdy komponent jest zamontowany = tryb 3D włączony) ──
  useEffect(() => {
    if (!containerRef.current) return;
    if (ION_TOKEN) Cesium.Ion.defaultAccessToken = ION_TOKEN;

    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, infoBox: false, selectionIndicator: false,
      timeline: false, animation: false, fullscreenButton: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),   // płaski fallback do czasu Ion
    });
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewerRef.current = viewer;

    // Teren z reliefem (Cesium Ion World Terrain) — jeśli jest token
    if (ION_TOKEN) {
      Cesium.createWorldTerrainAsync()
        .then(tp => { if (viewerRef.current) viewerRef.current.terrainProvider = tp; })
        .catch(() => { /* zostaje płaski */ });
    }

    for (const key of ["units", "areas", "routes", "trails", "effects", "heatmap"]) {
      const ds = new Cesium.CustomDataSource(key);
      dsRef.current[key] = ds;
      viewer.dataSources.add(ds);
    }

    // Interakcja: klik w symbol = zaznacz jednostkę; klik w teren = punkt (np. trasy, jak w 2D).
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: any) => {
      const picked = viewer.scene.pick(click.position);
      const eid = picked && picked.id && picked.id.id;
      if (typeof eid === "string" && eid.startsWith("u-")) {
        onPickRef.current(eid.slice(2));
        return;
      }
      const ray = viewer.camera.getPickRay(click.position);
      const pos = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
      if (!pos) return;
      const carto = Cesium.Cartographic.fromCartesian(pos);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      onGroundRef.current(fromLonLat([lon, lat]) as [number, number]);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Prawy klik w teren → menu kontekstowe „Postaw jednostkę tutaj" (ten sam dialog co w 2D).
    handler.setInputAction((click: any) => {
      const ray = viewer.camera.getPickRay(click.position);
      const pos = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
      if (!pos) return;
      const carto = Cesium.Cartographic.fromCartesian(pos);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const rect = viewer.scene.canvas.getBoundingClientRect();
      onCtxRef.current({
        pixel: [click.position.x, click.position.y],
        coordinate: fromLonLat([lon, lat]) as [number, number],
        lonLat: [lon, lat],
        clientX: rect.left + click.position.x,
        clientY: rect.top + click.position.y,
      });
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    return () => { handler.destroy(); viewer.destroy(); viewerRef.current = null; dsRef.current = {}; };
  }, []);

  // ── Podkład mapy (OSM / satelita / fotorealistyczny 3D) ──
  useEffect(() => {
    const viewer = viewerRef.current; if (!viewer) return;
    let cancelled = false;
    // sprzątanie poprzedniego stanu
    if (tilesetRef.current) { viewer.scene.primitives.remove(tilesetRef.current); tilesetRef.current = null; }
    viewer.scene.globe.show = true;
    viewer.imageryLayers.removeAll();

    if (basemap === "osm") {
      viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maximumLevel: 18, credit: "© OpenStreetMap",
      }));
    } else if (basemap === "photo3d") {
      // Fotorealistyczne kafle 3D (Google przez Ion) — wyłącz glob, dodaj tileset.
      Cesium.Cesium3DTileset.fromIonAssetId(ION_ASSET.photo3d).then(ts => {
        if (cancelled) { return; }
        viewer.scene.primitives.add(ts); tilesetRef.current = ts; viewer.scene.globe.show = false;
      }).catch(() => { /* brak tokena/assetu → zostaw glob */ });
    } else {
      // satelita: Bing Aerial (asset 2) lub Google Satellite (3830182) z Ion
      Cesium.IonImageryProvider.fromAssetId(ION_ASSET[basemap as "bing" | "google"]).then(p => {
        if (!cancelled) viewer.imageryLayers.addImageryProvider(p);
      }).catch(() => {
        if (!cancelled) viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maximumLevel: 18,
        }));
      });
    }
    return () => { cancelled = true; };
  }, [basemap]);

  // ── Jednostki + AO + trasy (scena statyczna / billboardy na żywo) ──
  useEffect(() => {
    const viewer = viewerRef.current; if (!viewer) return;
    const unitsDS = dsRef.current.units; const areasDS = dsRef.current.areas; const routesDS = dsRef.current.routes;
    unitsDS.entities.removeAll(); areasDS.entities.removeAll(); routesDS.entities.removeAll();

    // Symbol jednostki ZAWSZE statycznie w bieżącej pozycji → zawsze wyśrodkowany w swoim AO.
    // Smugi tras (oś czasu) to osobne encje (efekt poniżej), więc nie ruszają symbolu.
    for (const u of units) {
      const url = getSymbolUrl(u.symbol_id);
      unitsDS.entities.add({
        id: `u-${u.id}`,
        position: mercToCartesian(u.x, u.y),
        billboard: url ? {
          image: url, scale: 0.2,   // jak w 2D (mapStyles Icon scale 0.2)
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
        point: url ? undefined : { pixelSize: 12, color: sideColor(u.side), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        label: {
          text: u.custom_name || u.symbol_name || "",
          font: "12px sans-serif", fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, 22), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: false, scale: 0.8,
        },
      });
    }

    for (const a of unitAreas) {
      if (!a.coordinates || a.coordinates.length < 3) continue;
      const u = units.find(x => x.id === a.unit_id);
      const flat: number[] = [];
      for (const [lon, lat] of a.coordinates) { flat.push(lon, lat); }
      areasDS.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
          material: sideColor(u?.side).withAlpha(0.18),
          outline: true, outlineColor: sideColor(u?.side).withAlpha(0.9),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      });
    }

    for (const [uid, route] of Object.entries(routesById)) {
      if (!route || route.length < 1) continue;
      const u = units.find(x => x.id === uid); if (!u) continue;
      const pts = [[u.x, u.y], ...route];
      const positions = pts.map(([x, y]) => mercToCartesian(x, y));
      routesDS.entities.add({
        polyline: {
          positions, width: 3, clampToGround: true,
          material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString("#22c55e") }),
        },
      });
    }

    if (!flewToRef.current && units.length) {
      const bbox = unitsBBoxLonLat(units, 0.03);
      if (bbox) {
        viewer.camera.flyTo({
          destination: Cesium.Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]),
          duration: 1.5,
        });
        flewToRef.current = true;
      }
    }
  }, [units, unitAreas, routesById]);

  // ── Smugi tras (oś czasu) — osobne encje, nie ruszają symbolu jednostki ──
  useEffect(() => {
    const viewer = viewerRef.current; if (!viewer) return;
    const trailsDS = dsRef.current.trails; trailsDS.entities.removeAll();
    if (!recording || !Object.keys(recording.byId).length) return;
    const u = units;
    for (const [uid, samples] of Object.entries(recording.byId)) {
      if (!samples || samples.length < 2) continue;
      const side = u.find(x => x.id === uid)?.side;
      trailsDS.entities.add({
        position: sampledPosition(samples),     // animowana "głowa" smugi (wg zegara)
        point: { pixelSize: 7, color: sideColor(side),
                 heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                 disableDepthTestDistance: Number.POSITIVE_INFINITY },
        path: { leadTime: 0, trailTime: 1e9, width: 4, resolution: 2,
                material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: sideColor(side) }) },
      });
    }
    // zegar wg zakresu nagrania → pasek czasu gra/przewija
    const start = Cesium.JulianDate.fromDate(new Date(recording.startMs));
    const stop = Cesium.JulianDate.fromDate(new Date(Math.max(recording.endMs, recording.startMs + 1000)));
    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    if (Cesium.JulianDate.lessThan(viewer.clock.currentTime, start) ||
        Cesium.JulianDate.greaterThan(viewer.clock.currentTime, stop)) {
      viewer.clock.currentTime = start.clone();
    }
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = 8;
    viewer.clock.shouldAnimate = true;     // auto-odtwarzanie smug (brak widżetu osi czasu)
    viewer.timeline?.zoomTo(start, stop);
  }, [recording, units]);

  // ── Efekty: pulsy starć + eksplozje zniszczeń ──
  useEffect(() => {
    const viewer = viewerRef.current; if (!viewer) return;
    const fx = dsRef.current.effects; fx.entities.removeAll();
    for (const [x, y] of engagementMidpoints) {
      fx.entities.add({
        position: mercToCartesian(x, y),
        ellipse: {
          semiMinorAxis: 220, semiMajorAxis: 220, height: 0,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty((time) => {
              const s = (Cesium.JulianDate.secondsDifference(time!, viewer.clock.startTime) % 1.2) / 1.2;
              return Cesium.Color.ORANGE.withAlpha(0.5 * (1 - s));
            }, false) as any),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      });
    }
    for (const [x, y] of destroyedXY) {
      fx.entities.add({
        position: mercToCartesian(x, y, 0),
        point: { pixelSize: 22, color: Cesium.Color.RED.withAlpha(0.9),
                 heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        label: { text: "✕", font: "20px sans-serif", fillColor: Cesium.Color.WHITE,
                 heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      });
    }
  }, [engagementMidpoints, destroyedXY]);

  // ── Heatmapa zagrożenia (toggle) ──
  useEffect(() => {
    const viewer = viewerRef.current; if (!viewer) return;
    const hm = dsRef.current.heatmap; hm.entities.removeAll();
    if (!showHeatmap) return;
    const bbox = unitsBBoxLonLat(units, 0.05); if (!bbox) return;
    const canvas = threatHeatmapCanvas(units, bbox);
    hm.entities.add({
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]),
        material: new Cesium.ImageMaterialProperty({ image: canvas, transparent: true }),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    });
  }, [showHeatmap, units]);

  return <div ref={containerRef} className="globe3d-container"
              onContextMenu={(e) => e.preventDefault()} />;
}

/** Buduje SampledPositionProperty z próbek [tMs, lon, lat] (clamp do gruntu w billboardzie). */
function sampledPosition(samples: [number, number, number][]): Cesium.SampledPositionProperty {
  const prop = new Cesium.SampledPositionProperty();
  for (const [tMs, lon, lat] of samples) {
    prop.addSample(Cesium.JulianDate.fromDate(new Date(tMs)), Cesium.Cartesian3.fromDegrees(lon, lat, 0));
  }
  prop.setInterpolationOptions({
    interpolationDegree: 1, interpolationAlgorithm: Cesium.LinearApproximation,
  });
  return prop;
}
