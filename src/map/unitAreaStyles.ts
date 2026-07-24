/**
 * OpenLayers styles for unit responsibility area polygons.
 */
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import Text from "ol/style/Text";
import type { FeatureLike } from "ol/Feature";

/** Color palette per area_type */
const AREA_COLORS: Record<string, { fill: string; stroke: string }> = {
  responsibility: {
    fill: "rgba(59, 130, 246, 0.12)",
    stroke: "rgba(59, 130, 246, 0.7)",
  },
  defense: {
    fill: "rgba(239, 68, 68, 0.12)",
    stroke: "rgba(239, 68, 68, 0.7)",
  },
  observation: {
    fill: "rgba(245, 158, 11, 0.12)",
    stroke: "rgba(245, 158, 11, 0.7)",
  },
  danger: {
    fill: "rgba(220, 38, 38, 0.18)",
    stroke: "rgba(220, 38, 38, 0.8)",
  },
};

const DEFAULT_COLOR = {
  fill: "rgba(107, 114, 128, 0.12)",
  stroke: "rgba(107, 114, 128, 0.7)",
};

/**
 * Style function for unit area features.
 * Reads area_type and name from feature properties to color and label the polygon.
 */
export function unitAreaStyleFunction(feature: FeatureLike): Style {
  const areaType = (feature.get("area_type") as string) || "responsibility";
  const areaName = (feature.get("name") as string) || "";
  const unitName = (feature.get("unit_name") as string) || "";
  const areaKm2 = feature.get("area_km2") as number | undefined;

  const colors = AREA_COLORS[areaType] || DEFAULT_COLOR;

  // Build label: area name, or unit name, or area type
  let label = areaName || unitName || areaType;
  if (areaKm2 && areaKm2 > 0) {
    label += `\n${areaKm2.toFixed(1)} km²`;
  }

  return new Style({
    fill: new Fill({ color: colors.fill }),
    stroke: new Stroke({
      color: colors.stroke,
      width: 2,
      lineDash: [8, 4],
    }),
    text: new Text({
      text: label,
      font: "bold 12px Inter, system-ui, sans-serif",
      fill: new Fill({ color: colors.stroke }),
      stroke: new Stroke({ color: "rgba(0,0,0,0.6)", width: 3 }),
      overflow: true,
    }),
  });
}
