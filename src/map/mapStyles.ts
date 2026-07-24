import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import CircleStyle from "ol/style/Circle";

import { getSymbolUrl } from "../data/symbolCatalog";

export function createMarkerStyles(
  symbolId: string,
  selected: boolean
): Style[] {
  const styles: Style[] = [];

  if (selected) {
    styles.push(
      new Style({
        image: new CircleStyle({
          radius: 30,
          fill: new Fill({ color: "rgba(37, 99, 235, 0.12)" }),
          stroke: new Stroke({
            color: "rgba(37, 99, 235, 0.8)",
            width: 2.5,
            lineDash: [6, 4],
          }),
        }),
      })
    );
  }

  const url = getSymbolUrl(symbolId);
  if (url) {
    styles.push(
      new Style({
        image: new Icon({
          src: url,
          scale: 0.2,
          anchor: [0.5, 0.5],
        }),
      })
    );
  }

  return styles;
}

export const routeLineStyle = new Style({
  stroke: new Stroke({
    color: "rgba(16, 185, 129, 0.85)",
    width: 3,
    lineDash: [10, 6],
    lineCap: "round",
    lineJoin: "round",
  }),
});

export const routePointStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: "rgba(16, 185, 129, 0.8)" }),
    stroke: new Stroke({ color: "#ffffff", width: 2 }),
  }),
});
