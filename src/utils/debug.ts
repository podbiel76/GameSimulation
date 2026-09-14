/**
 * Jeden przełącznik dla logów diagnostycznych z pętli symulacji.
 *
 * Powód: logowanie zagnieżdżonych obiektów (`[POTENCJAŁ]`, `logCombat`) wykonywało się
 * per jednostka per tick. Przy otwartym DevTools serializacja jest najdroższą operacją
 * w pętli, a konsola trzyma referencje do zalogowanych obiektów → stały wzrost pamięci.
 *
 * Domyślnie wyłączone. Włączenie bez przebudowy:
 *   localStorage.setItem("geotactical.simDebug", "1"); location.reload();
 *
 * Uwaga: `simLog` przyjmuje funkcję, a nie gotowe argumenty — dzięki temu przy
 * wyłączonym trybie nie powstaje nawet obiekt do zalogowania.
 */

function readFlag(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem("geotactical.simDebug") === "1";
  } catch {
    return false;
  }
}

/** Odczytane raz przy starcie — nie sprawdzamy localStorage w każdym ticku. */
export const SIM_DEBUG: boolean = readFlag();

/** Loguje tylko gdy SIM_DEBUG. Argumenty budowane leniwie. */
export function simLog(build: () => unknown[]): void {
  if (!SIM_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(...build());
}

/** Jak simLog, ale dla console.groupCollapsed + zawartość w callbacku. */
export function simGroup(label: string, body: () => void): void {
  if (!SIM_DEBUG) return;
  // eslint-disable-next-line no-console
  console.groupCollapsed(label);
  body();
  // eslint-disable-next-line no-console
  console.groupEnd();
}
