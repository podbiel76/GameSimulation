import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";

import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS";
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import { fromLonLat, toLonLat } from "ol/proj";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import Text from "ol/style/Text";
import CircleStyle from "ol/style/Circle";
import { ScaleLine, defaults as defaultControls } from "ol/control";
import { Modify, Snap, defaults as defaultInteractions } from "ol/interaction";
import GeoJSON from "ol/format/GeoJSON";

import {
  createMarkerStyles,
  routeLineStyle,
  routePointStyle,
} from "./mapStyles";
import {
  shouldShowUnitAtZoom,
  shouldShowAreaAtZoom,
} from "../utils/hierarchyVisibility";
import { unitAreaStyleFunction } from "./unitAreaStyles";
import { buildRotatedSquareGeoJson } from "../utils/geoUtils";
import type { ScenarioMarker, EditorMode, MapDetection } from "../types/map";
import type { SimUnitTrack, SimAssessment } from "../types/simulation";

import "ol/ol.css";
import "../index.css";
import { altKeyOnly, singleClick } from "ol/events/condition";
export type BaseLayerType = "osm" | "geoportal_orto" | "geoportal_topo" | "terrain";

type Props = {
  markers: ScenarioMarker[];
  selectedMarkerId: string | null;
  mode: EditorMode;
  baseLayer?: BaseLayerType;
  detections?: MapDetection[];
  simTracks?: SimUnitTrack[];
  simAssessments?: SimAssessment[];
  unitPositions?: Record<string, [number, number]>;
  showAreas?: boolean;
  unitAreas?: any[];
  suggestedRoutes?: [number, number][][];   // odcinki [[fromX,fromY],[toX,toY]] — doradczo
  refreshAreasTrigger?: number;
  isHierarchicalZoom?: boolean;
  onMapClick: (coord: [number, number]) => void;
  onPointerMove: (coord: [number, number]) => void;
  onMarkerClick: (
    markerId: string,
    payload?: {
      pixel: [number, number];
      coordinate: [number, number];
      clientX: number;
      clientY: number;
    }
  ) => void;
  areaDraftPoints?: [number, number][]; // EPSG:3857
  onMapContextMenu?: (payload: {
    pixel: [number, number];
    coordinate: [number, number];
    lonLat: [number, number];
    clientX: number;
    clientY: number;
  }) => void;
  isLocked?: boolean;
  onAreaDraftChange?: (points: [number, number][]) => void;
};

export type MapViewHandle = {
  captureCanvas: () => {
    image: string;
    width: number;
    height: number;
  } | null;
  captureCanvasClean: () => {
    image: string;
    width: number;
    height: number;
  } | null;
  getCoordinateFromPixel: (pixel: [number, number]) => [number, number] | null;
  getPixelFromCoordinate: (coord: [number, number]) => [number, number] | null;
  getClientFromCoordinate: (coord: [number, number]) => [number, number] | null;
  getSize: () => [number, number] | undefined;
  showTerrainBoxAtCoord: (coord: [number, number], zoom: number, sizePixels: number) => void;
  clearTerrainBox: () => void;
  captureCanvasAtZoom: (coord: [number, number], zoom: number) => {
    image: string; width: number; height: number; cx: number; cy: number;
  } | null;
  captureCanvasForArea: (polygonCoords3857: [number, number][]) => {
    image: string; width: number; height: number;
    pixelCoords: [number, number][]; dpr: number;
  } | null;
  flyTo: (coord3857: [number, number], zoom?: number) => void;
};

const ScenarioMapView = forwardRef<MapViewHandle, Props>(({
  markers,
  suggestedRoutes,
  selectedMarkerId,
  mode,
  baseLayer = "osm",
  detections = [],
  simTracks = [],
  simAssessments = [],
  unitPositions = {},
  showAreas = true,
  unitAreas = [],
  refreshAreasTrigger = 0,
  isHierarchicalZoom = false,
  isLocked = false,
  onMapClick,
  onPointerMove,
  onMarkerClick,
  areaDraftPoints = [],
  onMapContextMenu,
  onAreaDraftChange,
}, ref) => {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);

  const markerSourceRef = useRef(new VectorSource());
  const routeSourceRef = useRef(new VectorSource());
  const routePointSourceRef = useRef(new VectorSource());
  const routeArrowSourceRef = useRef(new VectorSource());
  const detectionSourceRef = useRef(new VectorSource());
  const trackSourceRef = useRef(new VectorSource());
  const assessSourceRef = useRef(new VectorSource());
  const areaSourceRef = useRef(new VectorSource());
  const areaLabelSourceRef = useRef(new VectorSource());
  const previewSourceRef = useRef(new VectorSource());
  const areaDraftSourceRef = useRef(new VectorSource());
  const terrainBoxSourceRef = useRef(new VectorSource());
  const suggestSourceRef = useRef(new VectorSource());

  const [currentZoom, setCurrentZoom] = useState<number>(10);

  // Layer refs for toggling visibility during clean capture
  const routeLayerRef = useRef<VectorLayer | null>(null);
  const routePointLayerRef = useRef<VectorLayer | null>(null);
  const routeArrowLayerRef = useRef<VectorLayer | null>(null);
  const detectionLayerRef = useRef<VectorLayer | null>(null);
  const trackLayerRef = useRef<VectorLayer | null>(null);
  const assessLayerRef = useRef<VectorLayer | null>(null);
  const areaLayerRef = useRef<VectorLayer | null>(null);
  const areaLabelLayerRef = useRef<VectorLayer | null>(null);
  const previewLayerRef = useRef<VectorLayer | null>(null);
  const areaDraftLayerRef = useRef<VectorLayer | null>(null);
  const terrainBoxLayerRef = useRef<VectorLayer | null>(null);
  const suggestLayerRef = useRef<VectorLayer | null>(null);
  const markerLayerRef = useRef<VectorLayer | null>(null);
  const onPointerMoveRef = useRef(onPointerMove);
  onPointerMoveRef.current = onPointerMove;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const onMapContextMenuRef = useRef(onMapContextMenu);
  onMapContextMenuRef.current = onMapContextMenu;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    captureCanvas: () => {
      if (!mapRef.current) return null;
      const canvas = mapElRef.current?.querySelector("canvas");
      if (!canvas) return null;
      return {
        image: canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""),
        width: canvas.width,
        height: canvas.height,
      };
    },
    captureCanvasClean: () => {
      if (!mapRef.current) return null;
      // Hide overlay layers
      const overlays = [
        routeLayerRef.current,
        routeArrowLayerRef.current,
        routePointLayerRef.current,
        detectionLayerRef.current,
        trackLayerRef.current,
        assessLayerRef.current,
        areaLayerRef.current,
        areaLabelLayerRef.current,
        previewLayerRef.current,
        areaDraftLayerRef.current,
      ];
      const wasVisible = overlays.map(l => l?.getVisible() ?? true);
      overlays.forEach(l => l?.setVisible(false));
      mapRef.current.renderSync();

      const canvas = mapElRef.current?.querySelector("canvas");
      const result = canvas ? {
        image: canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""),
        width: canvas.width,
        height: canvas.height,
      } : null;

      // Restore
      overlays.forEach((l, i) => l?.setVisible(wasVisible[i]));
      mapRef.current!.renderSync();

      return result;
    },
    getCoordinateFromPixel: (pixel: [number, number]) => {
      if (!mapRef.current) return null;
      const coord = mapRef.current.getCoordinateFromPixel(pixel);
      if (!coord) return null;
      return toLonLat(coord) as [number, number];
    },
    getPixelFromCoordinate: (coord: [number, number]) => {
      if (!mapRef.current) return null;
      const pixel = mapRef.current.getPixelFromCoordinate(coord);
      if (!pixel) return null;
      return pixel as [number, number];
    },
    getClientFromCoordinate: (coord: [number, number]) => {
      if (!mapRef.current) return null;
      const pixel = mapRef.current.getPixelFromCoordinate(coord);
      if (!pixel) return null;
      const rect = mapRef.current.getTargetElement().getBoundingClientRect();
      return [rect.left + pixel[0], rect.top + pixel[1]] as [number, number];
    },
    getSize: () => {
      return mapRef.current?.getSize() as [number, number] | undefined;
    },
    clearTerrainBox: () => {
      terrainBoxSourceRef.current.clear();
    },
    flyTo: (coord3857: [number, number], zoom = 17) => {
      mapRef.current?.getView().animate({ center: coord3857, zoom, duration: 600 });
    },
    captureCanvasForArea: (polygonCoords3857: [number, number][]) => {
      if (!mapRef.current) return null;
      const view = mapRef.current.getView();
      const savedCenter = view.getCenter()!;
      const savedZoom = view.getZoom()!;

      const xs = polygonCoords3857.map(c => c[0]);
      const ys = polygonCoords3857.map(c => c[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const centerCoord: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];

      const mapSize = mapRef.current.getSize() ?? [800, 600];
      const reqRes = Math.max((maxX - minX) / (mapSize[0] * 0.8), (maxY - minY) / (mapSize[1] * 0.8));
      const zoom = Math.floor(view.getZoomForResolution(reqRes) ?? 10);

      const overlays = [
        markerLayerRef.current,
        routeLayerRef.current, routeArrowLayerRef.current, routePointLayerRef.current,
        detectionLayerRef.current, trackLayerRef.current,
        assessLayerRef.current, areaLayerRef.current, areaLabelLayerRef.current,
        previewLayerRef.current, areaDraftLayerRef.current,
        terrainBoxLayerRef.current,
      ];
      const wasVisible = overlays.map(l => l?.getVisible() ?? true);
      overlays.forEach(l => l?.setVisible(false));
      view.setCenter(centerCoord);
      view.setZoom(zoom);
      mapRef.current.renderSync();

      const canvas = mapElRef.current?.querySelector('canvas');
      const cssSize = mapRef.current.getSize()!;
      const dpr = canvas ? canvas.width / cssSize[0] : 1;

      // CSS pixel coords — before restoring view
      const pixelCoords = polygonCoords3857.map(
        coord => mapRef.current!.getPixelFromCoordinate(coord) as [number, number]
      );

      const result = canvas ? {
        image: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
        width: canvas.width,
        height: canvas.height,
        pixelCoords,
        dpr,
      } : null;

      overlays.forEach((l, i) => l?.setVisible(wasVisible[i]));
      view.setCenter(savedCenter);
      view.setZoom(savedZoom);
      mapRef.current.renderSync();

      return result;
    },
    showTerrainBoxAtCoord: (coord: [number, number], zoom: number, sizePixels: number) => {
      if (!mapRef.current) return;
      const resolution = mapRef.current.getView().getResolutionForZoom(zoom);
      const half = (sizePixels / 2) * resolution;
      const [cx, cy] = coord;
      const ring: number[][] = [
        [cx - half, cy - half],
        [cx + half, cy - half],
        [cx + half, cy + half],
        [cx - half, cy + half],
        [cx - half, cy - half],
      ];
      terrainBoxSourceRef.current.clear();
      terrainBoxSourceRef.current.addFeature(new Feature(new Polygon([ring])));
    },
    captureCanvasAtZoom: (coord: [number, number], zoom: number) => {
      if (!mapRef.current) return null;
      const view = mapRef.current.getView();
      const savedCenter = view.getCenter()!;
      const savedZoom = view.getZoom()!;
      const overlays = [
        markerLayerRef.current,
        routeLayerRef.current, routeArrowLayerRef.current, routePointLayerRef.current,
        detectionLayerRef.current, trackLayerRef.current,
        assessLayerRef.current, areaLayerRef.current, areaLabelLayerRef.current,
        previewLayerRef.current, areaDraftLayerRef.current,
        terrainBoxLayerRef.current,
      ];
      const wasVisible = overlays.map(l => l?.getVisible() ?? true);
      overlays.forEach(l => l?.setVisible(false));
      view.setCenter(coord);
      view.setZoom(zoom);
      mapRef.current.renderSync();
      const canvas = mapElRef.current?.querySelector('canvas');
      const result = canvas ? {
        image: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
        width: canvas.width,
        height: canvas.height,
        cx: canvas.width / 2,
        cy: canvas.height / 2,
      } : null;
      overlays.forEach((l, i) => l?.setVisible(wasVisible[i]));
      view.setCenter(savedCenter);
      view.setZoom(savedZoom);
      mapRef.current.renderSync();
      return result;
    },
  }));

  // ── Initialize map once ──
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const markerLayer = new VectorLayer({
      source: markerSourceRef.current,
      zIndex: 30,
    });
    markerLayerRef.current = markerLayer;

    const routeLayer = new VectorLayer({
      source: routeSourceRef.current,
      style: routeLineStyle,
      zIndex: 10,
    });
    routeLayerRef.current = routeLayer;

    const routePointLayer = new VectorLayer({
      source: routePointSourceRef.current,
      style: routePointStyle,
      zIndex: 20,
    });
    routePointLayerRef.current = routePointLayer;

    const routeArrowLayer = new VectorLayer({
      source: routeArrowSourceRef.current,
      zIndex: 15,
    });
    routeArrowLayerRef.current = routeArrowLayer;

    const detectionLayer = new VectorLayer({
      source: detectionSourceRef.current,
      zIndex: 40,
    });
    detectionLayerRef.current = detectionLayer;

    const previewLayer = new VectorLayer({
      source: previewSourceRef.current,
      zIndex: 50,
    });
    previewLayerRef.current = previewLayer;

    const defaultBaseLayer = new TileLayer({
      source: new OSM(),
      zIndex: 0,
    });
    baseLayerRef.current = defaultBaseLayer;

    const trackLayer = new VectorLayer({
      source: trackSourceRef.current,
      zIndex: 5,
    });
    trackLayerRef.current = trackLayer;

    const assessLayer = new VectorLayer({
      source: assessSourceRef.current,
      zIndex: 35,
    });
    assessLayerRef.current = assessLayer;

    const areaLayer = new VectorLayer({
      source: areaSourceRef.current,
      zIndex: 3,
    });
    areaLayerRef.current = areaLayer;

    const areaLabelLayer = new VectorLayer({
      source: areaLabelSourceRef.current,
      zIndex: 4,
    });
    areaLabelLayerRef.current = areaLabelLayer;

    const terrainBoxLayer = new VectorLayer({
      source: terrainBoxSourceRef.current,
      zIndex: 60,
      style: new Style({
        stroke: new Stroke({ color: '#facc15', width: 2, lineDash: [6, 4] }),
        fill: new Fill({ color: 'rgba(250, 204, 21, 0.08)' }),
      }),
    });
    terrainBoxLayerRef.current = terrainBoxLayer;

    const suggestLayer = new VectorLayer({
      source: suggestSourceRef.current,
      zIndex: 105,
      style: [
        new Style({  // "duch" rekomendowanej trasy (doradczo) — wyblakła, przerywana
          stroke: new Stroke({ color: "rgba(139, 92, 246, 0.65)", width: 3, lineDash: [2, 6] }),
        }),
      ],
    });
    suggestLayerRef.current = suggestLayer;

    const areaDraftLayer = new VectorLayer({
      source: areaDraftSourceRef.current,
      style: [
        new Style({
          stroke: new Stroke({ color: "rgba(59, 130, 246, 0.8)", width: 2, lineDash: [4, 4] }),
          fill: new Fill({ color: "rgba(59, 130, 246, 0.1)" }),
        }),
        new Style({
          image: new CircleStyle({
            radius: 4,
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "#3b82f6", width: 2 }),
          }),
        }),
      ],
      zIndex: 110,
    });
    areaDraftLayerRef.current = areaDraftLayer;

    const map = new Map({
      target: mapElRef.current,
      layers: [
        defaultBaseLayer,
        areaLayer,
        areaLabelLayer,
        trackLayer,
        routeLayer,
        routeArrowLayer,
        routePointLayer,
        markerLayer,
        assessLayer,
        detectionLayer,
        previewLayer,
        terrainBoxLayer,
        suggestLayer,
        areaDraftLayer,
      ],
      view: new View({
        center: fromLonLat([19.1451, 51.9194]),
        zoom: 7,
        enableRotation: false,
      }),
      controls: defaultControls({
        attributionOptions: { collapsible: true },
      }).extend([
        new ScaleLine({
          units: "metric",
          bar: true,
          minWidth: 200,
        }),
      ]),
    });

    mapRef.current = map;

    // Click handler
    map.on("click", (evt) => {
      let hitMarker = false;

      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          const markerId = feature.get("__markerId") as string | undefined;
          if (markerId) {
            hitMarker = true;
            // Wyśrodkuj menu radialne na samym znaczku (środek geometrii),
            // a nie w punkcie kliknięcia myszą.
            let centerPixel: [number, number] = [evt.pixel[0], evt.pixel[1]];
            const geom = feature.getGeometry() as any;
            if (geom && typeof geom.getCoordinates === "function") {
              const px = map.getPixelFromCoordinate(geom.getCoordinates());
              if (px) centerPixel = [px[0], px[1]];
            }
            const rect = map.getTargetElement().getBoundingClientRect();
            onMarkerClickRef.current(markerId, {
              pixel: centerPixel,
              coordinate: [evt.coordinate[0], evt.coordinate[1]],
              clientX: rect.left + centerPixel[0],
              clientY: rect.top + centerPixel[1],
            });
            return true;
          }
          return false;
        },
        { hitTolerance: 8 }
      );

      if (!hitMarker) {
        const coord = evt.coordinate;
        // Don't trigger map click (adding points) if Alt is pressed (Modify deletion)
        if (!(evt.originalEvent as MouseEvent).altKey) {
          onMapClickRef.current([coord[0], coord[1]]);
        }
      }
    });

    // Cursor style & Pointer move
    map.on("pointermove", (evt) => {
      const coord = evt.coordinate;
      onPointerMoveRef.current([coord[0], coord[1]]);

      const el = map.getTargetElement() as HTMLElement;
      let cursor = "";

      if (
        modeRef.current === "draw-route" ||
        modeRef.current === "draw-area" ||
        modeRef.current === "edit-area" ||
        modeRef.current === "draw-subordinate-area"
      ) {
        cursor = "crosshair";
      }

      const hit = map.hasFeatureAtPixel(evt.pixel);
      el.style.cursor = hit ? "pointer" : cursor;
    });

    map.getView().on("change:resolution", () => {
      const zoom = map.getView().getZoom();
      if (zoom !== undefined) {
        setCurrentZoom(zoom);
      }
    });

    // Right-click / context menu handler
    const mapTarget = mapElRef.current;
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!mapRef.current) return;
      const viewport = mapRef.current.getViewport();
      const rect = viewport.getBoundingClientRect();

      const pixel: [number, number] = [
        e.clientX - rect.left,
        e.clientY - rect.top,
      ];

      const coordinate = mapRef.current.getCoordinateFromPixel(pixel);
      if (!coordinate) return;
      const lonLat = toLonLat(coordinate) as [number, number];
      onMapContextMenuRef.current?.({
        pixel,
        coordinate: [coordinate[0], coordinate[1]],
        lonLat,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };
    mapTarget.addEventListener("contextmenu", handleContextMenu);

    return () => {
      mapTarget.removeEventListener("contextmenu", handleContextMenu);
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  // ── Base layer switching ──
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    let isMounted = true;

    async function updateBaseLayer() {
      // Remove old base layer
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
      } else if (baseLayer === "terrain") {
        newLayer = new TileLayer({
          source: new XYZ({
            url: "https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png",
            attributions:
              'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap',
            maxZoom: 17,
          }),
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

  // ── Sync React markers → OL features ──
  useEffect(() => {
    const markerSource = markerSourceRef.current;
    const routeSource = routeSourceRef.current;
    const routePointSource = routePointSourceRef.current;
    const routeArrowSource = routeArrowSourceRef.current;

    markerSource.clear();
    routeSource.clear();
    routePointSource.clear();
    routeArrowSource.clear();

    for (const m of markers) {
      if (!shouldShowUnitAtZoom(m.symbolId, currentZoom, isHierarchicalZoom, m.id === selectedMarkerId)) {
        continue;
      }

      // Marker feature
      const markerFeature = new Feature({
        geometry: new Point([m.x, m.y]),
        __markerId: m.id,
        __symbolId: m.symbolId,
      });

      const isSelected = m.id === selectedMarkerId;

      // Zniszczona jednostka: symbol wojskowy znika, zostaje szara pinezka z ✕.
      if (m.destroyed) {
        markerFeature.setStyle([
          new Style({
            image: new CircleStyle({
              radius: 13,
              fill: new Fill({ color: "rgba(75, 85, 99, 0.95)" }),
            }),
          }),
          new Style({
            text: new Text({
              text: "✕",
              font: "bold 16px sans-serif",
              fill: new Fill({ color: "#ffffff" }),
            }),
          }),
        ]);
        markerSource.addFeature(markerFeature);
        continue; // brak symbolu i trasy dla zniszczonej jednostki
      }

      markerFeature.setStyle(createMarkerStyles(m.symbolId, isSelected));
      markerSource.addFeature(markerFeature);

      // Route line
      if (m.route.length > 0) {
        const sorted = [...m.route].sort((a, b) => a.order - b.order);
        const routeCoords: [number, number][] = [
          [m.x, m.y],
          ...sorted.map((rp): [number, number] => [rp.x, rp.y]),
        ];

        const lineFeature = new Feature({
          geometry: new LineString(routeCoords),
        });
        routeSource.addFeature(lineFeature);

        // Directional arrows at segment midpoints
        for (let i = 0; i < routeCoords.length - 1; i++) {
          const [ax, ay] = routeCoords[i];
          const [bx, by] = routeCoords[i + 1];
          const midX = (ax + bx) / 2;
          const midY = (ay + by) / 2;
          // Math.atan2(dx, dy) = clockwise angle from north in EPSG:3857
          const rotation = Math.atan2(bx - ax, by - ay);
          const arrowFeature = new Feature({ geometry: new Point([midX, midY]) });
          arrowFeature.setStyle(new Style({
            text: new Text({
              text: "▲",
              font: "bold 14px sans-serif",
              fill: new Fill({ color: "rgba(16, 185, 129, 0.95)" }),
              stroke: new Stroke({ color: "#ffffff", width: 2 }),
              rotation,
              rotateWithView: false,
            }),
          }));
          routeArrowSource.addFeature(arrowFeature);
        }

        // Route waypoints with order numbers
        for (let i = 0; i < sorted.length; i++) {
          const rp = sorted[i];
          const pointFeature = new Feature({ geometry: new Point([rp.x, rp.y]) });
          pointFeature.setStyle([
            new Style({
              image: new CircleStyle({
                radius: 9,
                fill: new Fill({ color: "rgba(16, 185, 129, 0.9)" }),
                stroke: new Stroke({ color: "#ffffff", width: 2 }),
              }),
            }),
            new Style({
              text: new Text({
                text: String(i + 1),
                font: 'bold 10px "Inter", sans-serif',
                fill: new Fill({ color: "#ffffff" }),
                offsetY: 0.5,
              }),
            }),
          ]);
          routePointSource.addFeature(pointFeature);
        }
      }
    }
  }, [markers, selectedMarkerId, currentZoom, isHierarchicalZoom]);

  // ── "Duch" rekomendowanych tras (tryb doradczy) ──
  useEffect(() => {
    suggestSourceRef.current.clear();
    for (const seg of suggestedRoutes ?? []) {
      if (seg.length < 2) continue;
      suggestSourceRef.current.addFeature(new Feature(new LineString(seg)));
    }
  }, [suggestedRoutes]);

  // ── Sync Detections ──
  useEffect(() => {
    if (!mapRef.current) return;
    const detectionSource = detectionSourceRef.current;
    detectionSource.clear();

    for (const det of detections) {
      const coord = fromLonLat([det.lon, det.lat]);
      const feature = new Feature({
        geometry: new Point(coord),
      });

      feature.setStyle(new Style({
        image: new CircleStyle({
          radius: 8,
          stroke: new Stroke({ color: "#ef4444", width: 2 }),
          fill: new Fill({ color: "rgba(239, 68, 68, 0.2)" }),
        }),
        text: new Text({
          text: `${det.class_name} (${(det.confidence * 100).toFixed(0)}%)`,
          offsetY: -100,
          font: "bold 12px Inter, sans-serif",
          fill: new Fill({ color: "#ef4444" }),

        })
      }));

      detectionSource.addFeature(feature);
    }
  }, [detections]);

  // ── Sync Simulation Tracks ──
  useEffect(() => {
    const src = trackSourceRef.current;
    src.clear();

    for (const track of simTracks) {
      if (track.states.length >= 2) {
        const coords = track.states.map(s => [s.x, s.y]);
        const lineFeat = new Feature({ geometry: new LineString(coords) });
        lineFeat.setStyle(new Style({
          stroke: new Stroke({ color: "rgba(16, 185, 129, 0.6)", width: 2, lineDash: [4, 4] }),
        }));
        src.addFeature(lineFeat);
      }
      for (const s of track.states) {
        const dotFeat = new Feature({ geometry: new Point([s.x, s.y]) });
        dotFeat.setStyle(new Style({
          image: new CircleStyle({
            radius: 3,
            fill: new Fill({ color: "#34d399" }),
            stroke: new Stroke({ color: "#064e3b", width: 1 }),
          }),
        }));
        src.addFeature(dotFeat);
      }
    }
  }, [simTracks]);

  // ── Sync Simulation Assessments ──
  useEffect(() => {
    const src = assessSourceRef.current;
    src.clear();

    for (const a of simAssessments) {
      if (a.subject_type !== "unit") continue;
      const pos = unitPositions[a.subject_id];
      if (!pos) continue;

      const color = a.status === "critical" ? "#ef4444" : a.status === "warning" ? "#f59e0b" : "#3b82f6";
      const feat = new Feature({ geometry: new Point(pos) });
      feat.setStyle(new Style({
        image: new CircleStyle({
          radius: 16,
          fill: new Fill({ color: "transparent" }),
          stroke: new Stroke({ color, width: 3, lineDash: [4, 3] }),
        }),
        text: new Text({
          text: a.status === "critical" ? "⚠" : "!",
          font: "bold 14px sans-serif",
          fill: new Fill({ color }),
          offsetY: -22,
        }),
      }));
      src.addFeature(feat);
    }
  }, [simAssessments, unitPositions]);

  // ── Sync Unit Areas from Props ──
  useEffect(() => {
    if (!mapRef.current) return;
    const areaLayer = areaLayerRef.current;
    const areaLabelLayer = areaLabelLayerRef.current;
    if (areaLayer) areaLayer.setVisible(showAreas);
    if (areaLabelLayer) areaLabelLayer.setVisible(showAreas);
    if (!showAreas) return;

    const src = areaSourceRef.current;
    const labelSrc = areaLabelSourceRef.current;
    src.clear();
    labelSrc.clear();

    if (unitAreas && unitAreas.length > 0) {
      unitAreas.forEach(a => {
        if (!a.coordinates || a.coordinates.length < 3) return;

        const isSelected = a.unit_id === selectedMarkerId;
        if (!shouldShowAreaAtZoom(a.unit_echelon || "unknown", currentZoom, isHierarchicalZoom, isSelected)) {
          return;
        }

        const projected = (a.coordinates as [number, number][]).map(p => fromLonLat(p) as [number, number]);
        const feat = new Feature({ geometry: new Polygon([projected]) });

        const side = (a as any).unit_side as string | undefined;
        const isDestroyed = (a as any).unit_destroyed === true;
        const isFriendly = side === "friendly";
        // Jednostka niezdolna do walki → szary obszar (niezależnie od strony).
        const rgb = isDestroyed ? "107, 114, 128" : (isFriendly ? "59, 130, 246" : "239, 68, 68");
        const fillAlpha = isSelected ? 0.25 : 0.15;
        const strokeAlpha = isDestroyed ? 0.5 : (isSelected ? 0.9 : 0.65);

        feat.setStyle(new Style({
          fill: new Fill({ color: `rgba(${rgb}, ${fillAlpha})` }),
          stroke: new Stroke({
            color: `rgba(${rgb}, ${strokeAlpha})`,
            width: isSelected ? 3 : 2,
            lineDash: [10, 6],
          }),
        }));

        src.addFeature(feat);

        // Edge labels — only at zoom >= 17, only on edges long enough to display text
        if (currentZoom >= 17 && a.name) {
          const labelText = a.name;
          const labelColor = `rgba(${rgb}, 1)`;
          const n = projected.length;
          // Minimum edge length in EPSG:3857 meters — prevents stacking near vertices
          const MIN_EDGE_LEN = 200;
          for (let i = 0; i < n; i++) {
            const p0 = projected[i];
            const p1 = projected[(i + 1) % n];
            const dx = p1[0] - p0[0];
            const dy = p1[1] - p0[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < MIN_EDGE_LEN) continue;
            const edgeFeat = new Feature({
              geometry: new LineString([p0, p1]),
            });
            edgeFeat.setStyle(new Style({
              text: new Text({
                placement: "line" as any,
                text: labelText,
                font: 'bold 11px "Inter", sans-serif',
                fill: new Fill({ color: labelColor }),
                stroke: new Stroke({ color: "#ffffff", width: 3 }),
                overflow: true,
              }),
            }));
            labelSrc.addFeature(edgeFeat);
          }
        }
      });
    }
  }, [unitAreas, showAreas, currentZoom, isHierarchicalZoom, selectedMarkerId]);

  // ── Sync Area Draft ──
  useEffect(() => {
    const src = areaDraftSourceRef.current;
    if (!src) return;
    src.clear();

    if (!areaDraftPoints || areaDraftPoints.length === 0) return;

    // Points
    areaDraftPoints.forEach(p => {
      src.addFeature(new Feature(new Point(p)));
    });

    // Line
    if (areaDraftPoints.length >= 2) {
      src.addFeature(new Feature(new LineString(areaDraftPoints)));
    }

    // Polygon
    if (areaDraftPoints.length >= 3) {
      src.addFeature(new Feature(new Polygon([[...areaDraftPoints, areaDraftPoints[0]]])));
    }
  }, [areaDraftPoints]);

  // ── Lock Interactions ──
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    map.getInteractions().forEach((interaction) => {
      interaction.setActive(!isLocked);
    });
  }, [isLocked]);

  // ── Area Drawing Interactions (Modify & Snap) ──
  useEffect(() => {
    if (!mapRef.current || !areaDraftSourceRef.current) return;
    const map = mapRef.current;
    const source = areaDraftSourceRef.current;

    if (mode !== "draw-area" && mode !== "edit-area") return;

    // Modify interaction allows dragging vertices
    const modify = new Modify({
      source,
      pixelTolerance: 12,
      deleteCondition: (event) => {
        return altKeyOnly(event) && singleClick(event);
      },
    });

    // Snap interaction helps in selecting points exactly
    const snap = new Snap({ source: source });

    modify.on("modifyend", (evt: any) => {
      // Find the polygon or linestring feature
      const features = source.getFeatures();
      const polyFeat = features.find(f => f.getGeometry() instanceof Polygon);
      const lineFeat = features.find(f => f.getGeometry() instanceof LineString);

      let newCoords: [number, number][] = [];

      if (polyFeat) {
        const geom = polyFeat.getGeometry() as Polygon;
        const ring = geom.getCoordinates()[0];
        // Remove last point (closed ring duplicate)
        newCoords = ring.slice(0, -1) as [number, number][];
      } else if (lineFeat) {
        const geom = lineFeat.getGeometry() as LineString;
        newCoords = geom.getCoordinates() as [number, number][];
      }

      if (newCoords.length > 0 && onAreaDraftChange) {
        onAreaDraftChange(newCoords);
      }
    });

    map.addInteraction(modify);
    map.addInteraction(snap);

    return () => {
      map.removeInteraction(modify);
      map.removeInteraction(snap);
    };
  }, [mode, onAreaDraftChange]);

  return (
    <div className="map-container">
      <div ref={mapElRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

export default ScenarioMapView;

