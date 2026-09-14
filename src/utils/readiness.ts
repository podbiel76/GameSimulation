import type { Unit } from "../types/map";

/**
 * Gotowość bojowa jednostki w procentach.
 *
 * Podstawą jest obsadzenie etatu — stosunek stanu dostępnego do etatowego.
 * Gdy jednostka nie ma danych osobowych, sięgamy po jawnie podaną sprawność
 * bojową. Bez obu wartości jednostka pozostaje nieoszacowana i zwracamy
 * `null` — interfejs wtedy nie rysuje paska, zamiast pokazywać zmyślone 0%.
 */
export function readinessOf(u: Unit): number | null {
  const l = u.logistics;
  if (l && l.personnel_total > 0) {
    return clampPct((l.personnel_available / l.personnel_total) * 100);
  }
  if (l?.combat_effectiveness_percent != null) {
    return clampPct(l.combat_effectiveness_percent);
  }
  return null;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Kolor progu gotowości. Trzy progi, nie ciągły gradient — próg czyta się
 * szybciej niż odcień, a różnica 62% od 68% i tak nie zmienia decyzji.
 */
export function readinessVar(pct: number): string {
  if (pct >= 70) return "var(--ok)";
  if (pct >= 40) return "var(--accent)";
  return "var(--side-hostile)";
}

/** Słowny odpowiednik progu — dla nagłówka, gdzie liczba już jest obok. */
export function readinessLabel(pct: number): string {
  if (pct >= 85) return "Pełna gotowość";
  if (pct >= 70) return "Gotowość bojowa";
  if (pct >= 40) return "Ograniczona";
  if (pct > 0) return "Krytyczna";
  return "Bez zdolności";
}
