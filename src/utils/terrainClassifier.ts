import { SIM_DEBUG } from './debug';

export const TERRAIN_ANALYSIS_ZOOM = 16;

export type TerrainClass = 'forest' | 'water' | 'wetland' | 'urban' | 'road' | 'open';

// Pixel-level classes — 'wetland' is derived by post-processing the distribution, not per-pixel
type PixelClass = Exclude<TerrainClass, 'wetland'>;

export interface TerrainResult {
  terrain: TerrainClass;
  confidence: number;
}

type ColorBucketInfo = {
  rgb: string;
  count: number;
  percent: number;
  terrain: TerrainClass;
  hsl: string;
};

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;

  return [h * 60, s * 100, l * 100];
}

export function classifyPixelColor(r: number, g: number, b: number): PixelClass {
  const [h, s, l] = rgbToHsl(r, g, b);

  if (h >= 170 && h <= 260 && s >= 15 && l >= 20 && l <= 85) return 'water';
  if (h >= 60 && h <= 165 && s >= 20 && l >= 15 && l <= 80) return 'forest';
  if (l >= 88 && s <= 8) return 'road';
  if (s <= 20 && l >= 30 && l <= 87) return 'urban';

  return 'open';
}

export function determineTerrain(counts: Record<PixelClass, number>, total: number): TerrainClass {
  const waterFrac = counts.water / total;
  const urbanFrac = counts.urban / total;
  // wetland: meaningful water mix that isn't a pure water body and isn't urban
  if (waterFrac >= 0.08 && waterFrac < 0.60 && urbanFrac < 0.15) return 'wetland';
  return (Object.keys(counts) as PixelClass[]).reduce((a, b) => counts[a] > counts[b] ? a : b);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function quantizeColor(value: number, step = 16): number {
  return Math.round(value / step) * step;
}

function makeColorBucketKey(r: number, g: number, b: number): string {
  const qr = Math.min(255, quantizeColor(r));
  const qg = Math.min(255, quantizeColor(g));
  const qb = Math.min(255, quantizeColor(b));
  return `${qr},${qg},${qb}`;
}

export async function classifyTerrainFromCanvas(
  imageBase64: string,
  cx: number,
  cy: number,
  windowSize = 64,
  // Domyślnie wyłączone: console.table ×2 na każde wywołanie było liczone także wtedy,
  // gdy nikt nie patrzył na konsolę. Wywołania z pętli symulacji i tak przekazywały false.
  debug = SIM_DEBUG,
): Promise<TerrainResult | null> {
  try {
    const binary = atob(imageBase64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);

    const half = Math.floor(windowSize / 2);

    const requestedX0 = Math.round(cx - half);
    const requestedY0 = Math.round(cy - half);
    const requestedX1 = requestedX0 + windowSize;
    const requestedY1 = requestedY0 + windowSize;

    const x0 = Math.max(0, requestedX0);
    const y0 = Math.max(0, requestedY0);
    const x1 = Math.min(bitmap.width, requestedX1);
    const y1 = Math.min(bitmap.height, requestedY1);

    const cropW = x1 - x0;
    const cropH = y1 - y0;

    if (cropW <= 0 || cropH <= 0) {
      console.warn('[TERRAIN] Brak pikseli do analizy.', {
        cx,
        cy,
        windowSize,
        bitmapWidth: bitmap.width,
        bitmapHeight: bitmap.height,
        requested: { x0: requestedX0, y0: requestedY0, x1: requestedX1, y1: requestedY1 },
      });

      bitmap.close();
      return null;
    }

    const offscreen = new OffscreenCanvas(cropW, cropH);
    const ctx = offscreen.getContext('2d');

    if (!ctx) {
      bitmap.close();
      return null;
    }

    ctx.drawImage(bitmap, x0, y0, cropW, cropH, 0, 0, cropW, cropH);
    bitmap.close();

    const { data } = ctx.getImageData(0, 0, cropW, cropH);

    const counts: Record<PixelClass, number> = {
      forest: 0,
      water: 0,
      urban: 0,
      road: 0,
      open: 0,
    };

    const colorBuckets = new Map<string, number>();

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let hSum = 0;
    let sSum = 0;
    let lSum = 0;

    const totalPixels = cropW * cropH;

    // Statystyki kolorów (sumy HSL + kubełki) służą WYŁĄCZNIE do wydruku diagnostycznego.
    // Poza trybem debug pomijamy je: to drugie wywołanie rgbToHsl, alokacja stringa
    // i operacja na Map — na każdy piksel.
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];

      if (alpha === 0) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const terrainClass = classifyPixelColor(r, g, b);
      counts[terrainClass]++;

      if (!debug) continue;

      const [h, s, l] = rgbToHsl(r, g, b);

      rSum += r;
      gSum += g;
      bSum += b;
      hSum += h;
      sSum += s;
      lSum += l;

      const bucketKey = makeColorBucketKey(r, g, b);
      colorBuckets.set(bucketKey, (colorBuckets.get(bucketKey) ?? 0) + 1);
    }

    const terrain = determineTerrain(counts, totalPixels);

    // for wetland confidence is the water fraction (the signal that triggered the rule)
    const dominantCount = terrain === 'wetland' ? counts.water : counts[terrain as PixelClass];
    const confidence = round2(dominantCount / totalPixels);

    if (debug) {
      const classStats = (Object.keys(counts) as PixelClass[]).map((key) => ({
        terrain: key,
        pixels: counts[key],
        percent: round2((counts[key] / totalPixels) * 100),
      }));

      const avgR = Math.round(rSum / totalPixels);
      const avgG = Math.round(gSum / totalPixels);
      const avgB = Math.round(bSum / totalPixels);
      const avgH = round2(hSum / totalPixels);
      const avgS = round2(sSum / totalPixels);
      const avgL = round2(lSum / totalPixels);

      const topColors: ColorBucketInfo[] = [...colorBuckets.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([key, count]) => {
          const [r, g, b] = key.split(',').map(Number);
          const [h, s, l] = rgbToHsl(r, g, b);
          return {
            rgb: `rgb(${r}, ${g}, ${b})`,
            count,
            percent: round2((count / totalPixels) * 100),
            terrain: classifyPixelColor(r, g, b),
            hsl: `hsl(${round2(h)}, ${round2(s)}%, ${round2(l)}%)`,
          };
        });

      console.groupCollapsed(
        `[TERRAIN] terrain=${terrain}, confidence=${confidence}, pixels=${totalPixels}`,
      );

      console.log('Analizowany obszar canvas:', {
        center: { cx: Math.round(cx), cy: Math.round(cy) },
        requestedWindow: {
          x0: requestedX0,
          y0: requestedY0,
          x1: requestedX1,
          y1: requestedY1,
          width: windowSize,
          height: windowSize,
          requestedPixels: windowSize * windowSize,
        },
        usedWindow: {
          x0,
          y0,
          x1,
          y1,
          width: cropW,
          height: cropH,
          usedPixels: totalPixels,
        },
        canvasSize: {
          width: bitmap.width,
          height: bitmap.height,
        },
      });

      console.log('Średni kolor obszaru:', {
        rgb: `rgb(${avgR}, ${avgG}, ${avgB})`,
        hsl: `hsl(${avgH}, ${avgS}%, ${avgL}%)`,
        classifiedAs: classifyPixelColor(avgR, avgG, avgB),
      });

      console.table(classStats);
      console.table(topColors);

      console.groupEnd();
    }

    return { terrain, confidence };
  } catch (err) {
    console.warn('[TERRAIN] classifyTerrainFromCanvas error:', err);
    return null;
  }
}

// Returns a base64 data URL of the terrain analysis window, scaled up for display.
export async function cropTerrainWindow(
  imageBase64: string,
  cx: number,
  cy: number,
  windowSize = 64,
  displaySize = 256,
): Promise<string | null> {
  try {
    const binary = atob(imageBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);

    const half = Math.floor(windowSize / 2);
    const x0 = Math.max(0, Math.round(cx - half));
    const y0 = Math.max(0, Math.round(cy - half));
    const x1 = Math.min(bitmap.width, x0 + windowSize);
    const y1 = Math.min(bitmap.height, y0 + windowSize);
    const cropW = x1 - x0;
    const cropH = y1 - y0;

    if (cropW <= 0 || cropH <= 0) { bitmap.close(); return null; }

    const offscreen = new OffscreenCanvas(displaySize, displaySize);
    const ctx = offscreen.getContext('2d')!;
    (ctx as OffscreenCanvasRenderingContext2D).imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, x0, y0, cropW, cropH, 0, 0, displaySize, displaySize);
    bitmap.close();

    const outBlob = await offscreen.convertToBlob({ type: 'image/png' });
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });
  } catch (err) {
    console.warn('[TERRAIN] cropTerrainWindow error:', err);
    return null;
  }
}

export interface AreaTerrainBreakdown {
  dominant: TerrainClass;
  totalPixels: number;
  breakdown: Array<{ terrain: TerrainClass; pixels: number; percent: number }>;
}

// Classifies terrain only inside a polygon defined by CSS pixel coordinates.
// Uses canvas destination-in masking — pixels outside the polygon are transparent and skipped.
export async function classifyTerrainForAreaCanvas(
  imageBase64: string,
  canvasWidth: number,
  canvasHeight: number,
  dpr: number,
  polygonCssPixels: [number, number][],
): Promise<AreaTerrainBreakdown | null> {
  try {
    const binary = atob(imageBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);

    // Work in CSS pixel space to match the CSS-pixel polygon coordinates
    const cssW = Math.round(canvasWidth / dpr);
    const cssH = Math.round(canvasHeight / dpr);

    const offscreen = new OffscreenCanvas(cssW, cssH);
    const ctx = offscreen.getContext('2d')!;

    // Draw the full map image at CSS scale
    ctx.drawImage(bitmap, 0, 0, cssW, cssH);
    bitmap.close();

    // Mask: keep only pixels inside the polygon
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    // close the ring: skip duplicate last vertex if present
    const ring = polygonCssPixels[0] &&
      polygonCssPixels[polygonCssPixels.length - 1][0] === polygonCssPixels[0][0] &&
      polygonCssPixels[polygonCssPixels.length - 1][1] === polygonCssPixels[0][1]
      ? polygonCssPixels.slice(0, -1)
      : polygonCssPixels;
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (const [px, py] of ring.slice(1)) ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const { data } = ctx.getImageData(0, 0, cssW, cssH);
    const counts: Record<PixelClass, number> = { forest: 0, water: 0, urban: 0, road: 0, open: 0 };
    let totalPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // outside polygon
      counts[classifyPixelColor(data[i], data[i + 1], data[i + 2])]++;
      totalPixels++;
    }

    if (totalPixels === 0) return null;

    const dominant = determineTerrain(counts, totalPixels);
    const breakdown = (Object.keys(counts) as PixelClass[])
      .map(cls => ({ terrain: cls as TerrainClass, pixels: counts[cls], percent: round2((counts[cls] / totalPixels) * 100) }))
      .sort((a, b) => b.pixels - a.pixels);

    return { dominant, totalPixels, breakdown };
  } catch (err) {
    console.warn('[TERRAIN] classifyTerrainForAreaCanvas error:', err);
    return null;
  }
}