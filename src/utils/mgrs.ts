/**
 * Konwersja WGS84 (lon/lat) → MGRS (Military Grid Reference System).
 *
 * Makieta `project/AICOMMAND.dc.html` generuje MGRS atrapą
 * (`'34U ' + Math.round(lon*1000%1000) + ' ' + Math.round(lat*1000%1000)`),
 * co daje ciąg wyglądający jak MGRS, ale niebędący nim. W symulatorze taktycznym
 * fałszywy odczyt pozycji jest gorszy niż brak odczytu — stąd pełna implementacja.
 *
 * Elipsoida WGS84, odwzorowanie UTM (k0 = 0.9996). Poza pasem 80°S–84°N
 * MGRS nie jest zdefiniowany (obowiązuje UPS) — zwracamy null.
 */

const A = 6378137.0;              // wielka półoś WGS84 [m]
const F = 1 / 298.257223563;      // spłaszczenie
const K0 = 0.9996;                // współczynnik skali UTM
const E2 = F * (2 - F);           // mimośród²
const EP2 = E2 / (1 - E2);        // drugi mimośród²

// Pasy szerokości MGRS, 8° każdy, od 80°S. Pominięte I oraz O (mylą się z 1 i 0).
const LAT_BANDS = "CDEFGHJKLMNPQRSTUVWX";

// Litery kolumn 100 km — trzy zestawy, cyklicznie co 3 strefy.
const COL_SETS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
// Litery wierszy 100 km — 20 liter, bez I i O.
const ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUV";

export type MgrsParts = {
  zone: number;        // strefa UTM 1–60
  band: string;        // litera pasa szerokości
  square: string;      // dwuliterowy identyfikator kwadratu 100 km
  easting: number;     // metry w kwadracie 100 km, 0–99999
  northing: number;
};

function latBand(lat: number): string | null {
  if (lat < -80 || lat > 84) return null;
  // Ostatni pas (X) jest rozciągnięty do 84°N zamiast 80°N.
  const idx = lat >= 72 ? 19 : Math.floor((lat + 80) / 8);
  return LAT_BANDS[idx] ?? null;
}

/** Numer strefy UTM z wyjątkami dla Norwegii i Svalbardu. */
function utmZone(lon: number, lat: number): number {
  let zone = Math.floor((lon + 180) / 6) + 1;
  // Wyjątek norweski: strefa 32 rozszerzona na zachód nad południową Norwegią.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  // Wyjątki svalbardzkie.
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

/** Przeliczenie geograficzne → UTM (metry). */
function toUtm(lon: number, lat: number, zone: number): { east: number; north: number } {
  const rad = Math.PI / 180;
  const phi = lat * rad;
  const lambda = lon * rad;
  const lambda0 = ((zone - 1) * 6 - 180 + 3) * rad;   // południk osiowy strefy

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = EP2 * cosPhi * cosPhi;
  const Aa = cosPhi * (lambda - lambda0);

  const M = A * (
    (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi -
    (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi) +
    (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi) -
    (35 * E2 ** 3 / 3072) * Math.sin(6 * phi)
  );

  const east = K0 * N * (
    Aa +
    (1 - T + C) * Aa ** 3 / 6 +
    (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120
  ) + 500000;

  let north = K0 * (M + N * tanPhi * (
    Aa ** 2 / 2 +
    (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24 +
    (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720
  ));
  if (lat < 0) north += 10000000;   // przesunięcie dla półkuli południowej

  return { east, north };
}

/** Rozkłada pozycję na części MGRS. Zwraca null poza zasięgiem odwzorowania. */
export function toMgrsParts(lon: number, lat: number): MgrsParts | null {
  if (!isFinite(lon) || !isFinite(lat)) return null;
  const band = latBand(lat);
  if (!band) return null;

  const zone = utmZone(lon, lat);
  const { east, north } = toUtm(lon, lat, zone);

  // Kolumna: zestaw liter zależy od strefy (cykl 3), indeks od setek kilometrów.
  const colSet = COL_SETS[(zone - 1) % 3];
  const colIdx = Math.floor(east / 100000) - 1;        // 500 km = środek → indeks 4
  if (colIdx < 0 || colIdx >= colSet.length) return null;

  // Wiersz: 20 liter cyklicznie; strefy parzyste przesunięte o 5 liter.
  const rowShift = zone % 2 === 0 ? 5 : 0;
  const rowIdx = (Math.floor(north / 100000) + rowShift) % 20;

  return {
    zone,
    band,
    square: colSet[colIdx] + ROW_LETTERS[rowIdx],
    easting: Math.floor(east % 100000),
    northing: Math.floor(north % 100000),
  };
}

/**
 * MGRS jako tekst.
 * @param digits liczba cyfr na oś: 5 → 1 m, 4 → 10 m, 3 → 100 m, 2 → 1 km, 1 → 10 km.
 */
export function toMgrs(lon: number, lat: number, digits: 1 | 2 | 3 | 4 | 5 = 3): string | null {
  const p = toMgrsParts(lon, lat);
  if (!p) return null;
  const div = 10 ** (5 - digits);
  const e = String(Math.floor(p.easting / div)).padStart(digits, "0");
  const n = String(Math.floor(p.northing / div)).padStart(digits, "0");
  return `${p.zone}${p.band} ${p.square} ${e} ${n}`;
}
