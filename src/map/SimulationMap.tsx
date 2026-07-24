import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import { fromLonLat } from "ol/proj";
import type { FullState, SimUnit } from "../types/simulation";
import {
  unitStyle,
  routeLineStyle,
  routePointStyle,
  trackLineStyle,
  trackPointStyle,
  assessmentStyle,
} from "./simulationStyles";

type Props = {
  state: FullState | null;
  selectedUnitId: string | null;
  onUnitSelect: (unitId: string | null) => void;
};

export default function SimulationMap({ state, selectedUnitId, onUnitSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const unitsSourceRef = useRef(new VectorSource());
  const routesSourceRef = useRef(new VectorSource());
  const tracksSourceRef = useRef(new VectorSource());
  const assessSourceRef = useRef(new VectorSource());

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      target: containerRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({ source: tracksSourceRef.current, zIndex: 1 }),
        new VectorLayer({ source: routesSourceRef.current, zIndex: 2 }),
        new VectorLayer({ source: assessSourceRef.current, zIndex: 3 }),
        new VectorLayer({ source: unitsSourceRef.current, zIndex: 4 }),
      ],
      view: new View({
        center: fromLonLat([19.5, 52.0]),
        zoom: 7,
      }),
    });

    map.on("click", (evt) => {
      let found = false;
      map.forEachFeatureAtPixel(evt.pixel, (feature) => {
        const uid = feature.get("unitId") as string | undefined;
        if (uid && !found) {
          onUnitSelect(uid);
          found = true;
        }
      });
      if (!found) onUnitSelect(null);
    });

    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update features when state changes
  useEffect(() => {
    if (!state) return;

    // ── Units ──
    unitsSourceRef.current.clear();
    const unitLookup: Record<string, SimUnit> = {};
    for (const u of state.units) {
      unitLookup[u.id] = u;
      const f = new Feature({ geometry: new Point(fromLonLat([u.x, u.y])) });
      f.set("unitId", u.id);
      f.setStyle(unitStyle(u, u.id === selectedUnitId));
      unitsSourceRef.current.addFeature(f);
    }

    // ── Routes ──
    routesSourceRef.current.clear();
    for (const route of state.routes) {
      if (route.points.length >= 2) {
        const coords = route.points
          .sort((a, b) => a.order_index - b.order_index)
          .map((p) => fromLonLat([p.x, p.y]));
        const lineFeature = new Feature({ geometry: new LineString(coords) });
        lineFeature.setStyle(routeLineStyle(route));
        routesSourceRef.current.addFeature(lineFeature);
      }
      for (const pt of route.points) {
        const pf = new Feature({ geometry: new Point(fromLonLat([pt.x, pt.y])) });
        pf.setStyle(routePointStyle(pt.order_index));
        routesSourceRef.current.addFeature(pf);
      }
    }

    // ── Tracks ──
    tracksSourceRef.current.clear();
    for (const track of state.tracks) {
      if (track.states.length >= 2) {
        const coords = track.states.map((s) => fromLonLat([s.x, s.y]));
        const lf = new Feature({ geometry: new LineString(coords) });
        lf.setStyle(trackLineStyle());
        tracksSourceRef.current.addFeature(lf);
      }
      for (const s of track.states) {
        const sf = new Feature({ geometry: new Point(fromLonLat([s.x, s.y])) });
        sf.setStyle(trackPointStyle());
        tracksSourceRef.current.addFeature(sf);
      }
    }

    // ── Assessments ──
    assessSourceRef.current.clear();
    for (const a of state.assessments) {
      if (a.subject_type === "unit") {
        const unit = unitLookup[a.subject_id];
        if (unit) {
          const af = new Feature({ geometry: new Point(fromLonLat([unit.x, unit.y])) });
          af.setStyle(assessmentStyle(a));
          assessSourceRef.current.addFeature(af);
        }
      }
    }

    // Auto-fit view if first load and there are units
    if (state.units.length > 0 && unitsSourceRef.current.getFeatures().length > 0) {
      const extent = unitsSourceRef.current.getExtent();
      if (extent && isFinite(extent[0])) {
        mapRef.current?.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom: 14, duration: 500 });
      }
    }
  }, [state, selectedUnitId]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
