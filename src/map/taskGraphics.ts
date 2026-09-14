/**
 * Grafiki zadań APP-6A rysowane wzdłuż trasy jednostki.
 *
 * Makieta pokazuje je jako glify w panelu; na mapie muszą być zbudowane
 * geometrycznie, bo podążają za łamaną trasy:
 *
 *  · adv — oś natarcia (Axis of Advance): zamknięty OBRYS strzałki — korpus
 *    o stałej szerokości wzdłuż całej trasy, zakończony grotem. Bez wypełnienia,
 *    rysowany samą kreską.
 *  · atk — kierunek natarcia (Direction of Attack): linia trasy + otwarty grot
 *    na końcu (dwie kreski), również bez wypełnienia.
 *  · mvt — marsz: zwykła linia przerywana, obsługiwana bez tego modułu.
 *
 * Wszystkie współrzędne w EPSG:3857 (metry). Rozmiary podawane w metrach —
 * wołający przelicza je z pikseli przez rozdzielczość widoku, żeby grubość
 * strzałki nie zmieniała się przy zoomowaniu.
 */

export type Pt = [number, number];

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);

function norm(a: Pt): Pt {
  const l = len(a);
  return l < 1e-9 ? [0, 0] : [a[0] / l, a[1] / l];
}

/** Normalna lewa do wektora kierunku. */
const leftNormal = (u: Pt): Pt => [-u[1], u[0]];

/** Usuwa punkty leżące praktycznie na sobie — inaczej normalne się degenerują. */
export function dedupe(pts: Pt[], eps = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || len(sub(p, last)) > eps) out.push(p);
  }
  return out;
}

/**
 * Odsuwa łamaną o `dist` w lewo (dodatnie) lub w prawo (ujemne).
 * Na wierzchołkach używa złącza zaciosowego z ograniczeniem — bez limitu
 * ostre zakręty trasy strzelałyby wierzchołkiem w nieskończoność.
 */
export function offsetPolyline(pts: Pt[], dist: number, miterLimit = 4): Pt[] {
  const p = dedupe(pts);
  if (p.length < 2) return p;

  const normals: Pt[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    normals.push(leftNormal(norm(sub(p[i + 1], p[i]))));
  }

  const out: Pt[] = [];
  out.push(add(p[0], mul(normals[0], dist)));

  for (let i = 1; i < p.length - 1; i++) {
    const n0 = normals[i - 1];
    const n1 = normals[i];
    const bis = norm(add(n0, n1));
    // cos połowy kąta między odcinkami; przy zawrocie o 180° dąży do zera.
    const cos = bis[0] * n1[0] + bis[1] * n1[1];
    const scale = Math.min(miterLimit, cos > 1e-3 ? 1 / cos : miterLimit);
    out.push(add(p[i], mul(bis, dist * scale)));
  }

  out.push(add(p[p.length - 1], mul(normals[normals.length - 1], dist)));
  return out;
}

/** Łączna długość łamanej. */
export function polylineLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += len(sub(pts[i + 1], pts[i]));
  return s;
}

/**
 * Przycina łamaną od końca o `cut` metrów.
 * Zwraca skróconą łamaną oraz kierunek ostatniego odcinka (do budowy grotu).
 */
export function trimEnd(pts: Pt[], cut: number): { body: Pt[]; dir: Pt } {
  const p = dedupe(pts);
  if (p.length < 2) return { body: p, dir: [0, 1] };

  let remaining = cut;
  const body = [...p];

  while (body.length >= 2 && remaining > 0) {
    const a = body[body.length - 2];
    const b = body[body.length - 1];
    const segLen = len(sub(b, a));
    if (segLen > remaining) {
      const u = norm(sub(b, a));
      body[body.length - 1] = add(a, mul(u, segLen - remaining));
      remaining = 0;
    } else {
      body.pop();
      remaining -= segLen;
    }
  }

  const last = body.length >= 2
    ? norm(sub(body[body.length - 1], body[body.length - 2]))
    : norm(sub(p[p.length - 1], p[p.length - 2]));

  return { body, dir: last };
}

export type ArrowSizes = {
  /** Połowa szerokości korpusu strzałki [m]. */
  halfWidth: number;
  /** Długość grotu wzdłuż trasy [m]. */
  headLength: number;
  /** Połowa rozpiętości grotu [m]. */
  headHalfWidth: number;
};

/**
 * Oś natarcia — zamknięty obrys strzałki wzdłuż trasy.
 * Zwraca pojedynczy pierścień: lewa krawędź → grot → prawa krawędź → zamknięcie.
 * Rysować samą kreską, bez wypełnienia.
 */
export function buildAxisOfAdvance(coords: Pt[], s: ArrowSizes): Pt[] | null {
  const pts = dedupe(coords);
  if (pts.length < 2) return null;

  const total = polylineLength(pts);
  // Przy bardzo krótkiej trasie grot zjadłby cały korpus — skracamy go.
  const headLen = Math.min(s.headLength, total * 0.6);
  const tip = pts[pts.length - 1];

  const { body, dir } = trimEnd(pts, headLen);
  if (body.length < 2) return null;

  const base = body[body.length - 1];
  const n = leftNormal(dir);

  const left = offsetPolyline(body, s.halfWidth);
  const right = offsetPolyline(body, -s.halfWidth);

  const leftBarb = add(base, mul(n, s.headHalfWidth));
  const rightBarb = add(base, mul(n, -s.headHalfWidth));

  return [
    ...left,          // od ogona do podstawy grotu, lewa krawędź
    leftBarb,         // lewe skrzydło grotu
    tip,              // ostrze
    rightBarb,        // prawe skrzydło
    ...right.reverse(), // powrót prawą krawędzią do ogona
    left[0],          // zamknięcie obrysu
  ];
}

/**
 * Kierunek natarcia — trasa jako linia plus PEŁNY grot na końcu.
 *
 * Makieta rysuje ten grot jako `glyphFill` z `fill="currentColor"`, czyli
 * zamknięty, wypełniony trójkąt — w odróżnieniu od osi natarcia, która jest
 * samym obrysem. `head` to gotowy pierścień (ostatni punkt = pierwszy),
 * do podania wprost jako wielokąt.
 *
 * Linia jest skracana do podstawy grotu, żeby nie przebijała ostrza.
 */
export function buildDirectionOfAttack(
  coords: Pt[],
  s: Pick<ArrowSizes, "headLength" | "headHalfWidth">,
): { line: Pt[]; head: Pt[] } | null {
  const pts = dedupe(coords);
  if (pts.length < 2) return null;

  const total = polylineLength(pts);
  const headLen = Math.min(s.headLength, total * 0.6);
  const tip = pts[pts.length - 1];
  const { body, dir } = trimEnd(pts, headLen);
  if (body.length < 2) return null;

  const base = body[body.length - 1];
  const n = leftNormal(dir);
  const leftBarb = add(base, mul(n, s.headHalfWidth));
  const rightBarb = add(base, mul(n, -s.headHalfWidth));

  return {
    line: body,
    head: [leftBarb, tip, rightBarb, leftBarb],
  };
}
