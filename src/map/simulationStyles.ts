import { Style, Circle as CircleStyle, Fill, Stroke, Text } from "ol/style";
import type { SimUnit, SimRoute, SimAssessment } from "../types/simulation";

export function unitStyle(unit: SimUnit, selected: boolean): Style {
  const isEnemy = unit.side === "hostile" || unit.symbol_id.startsWith("EN_");
  const color = isEnemy ? "#ef4444" : "#3b82f6";
  const strokeColor = selected ? "#facc15" : "#ffffff";

  return new Style({
    image: new CircleStyle({
      radius: selected ? 12 : 9,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: strokeColor, width: selected ? 3 : 2 }),
    }),
    text: new Text({
      text: unit.symbol_name.slice(0, 12),
      offsetY: -18,
      font: "bold 11px Inter, sans-serif",
      fill: new Fill({ color: "#f1f5f9" }),
      stroke: new Stroke({ color: "#0a0e1a", width: 3 }),
    }),
  });
}

export function routeLineStyle(_route: SimRoute): Style {
  return new Style({
    stroke: new Stroke({
      color: "rgba(59, 130, 246, 0.7)",
      width: 3,
      lineDash: [8, 6],
    }),
  });
}

export function routePointStyle(orderIndex: number): Style {
  return new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: "#60a5fa" }),
      stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
    }),
    text: new Text({
      text: String(orderIndex + 1),
      font: "bold 9px Inter, sans-serif",
      fill: new Fill({ color: "#ffffff" }),
      offsetY: 1,
    }),
  });
}

export function trackLineStyle(): Style {
  return new Style({
    stroke: new Stroke({
      color: "rgba(16, 185, 129, 0.6)",
      width: 2,
      lineDash: [4, 4],
    }),
  });
}

export function trackPointStyle(): Style {
  return new Style({
    image: new CircleStyle({
      radius: 3,
      fill: new Fill({ color: "#34d399" }),
      stroke: new Stroke({ color: "#064e3b", width: 1 }),
    }),
  });
}

export function assessmentStyle(assessment: SimAssessment): Style {
  const color =
    assessment.status === "critical" ? "#ef4444" :
    assessment.status === "warning" ? "#f59e0b" : "#3b82f6";

  return new Style({
    image: new CircleStyle({
      radius: 16,
      fill: new Fill({ color: "transparent" }),
      stroke: new Stroke({ color, width: 3, lineDash: [4, 3] }),
    }),
    text: new Text({
      text: assessment.status === "critical" ? "⚠" : "!",
      font: "bold 14px sans-serif",
      fill: new Fill({ color }),
      offsetY: -22,
    }),
  });
}
