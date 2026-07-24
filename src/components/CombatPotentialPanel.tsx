import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { Unit, ScenarioMarker } from "../types/map";
import type { UnitArea } from "../api/unitAreasApi";
import {
  compareCombatPotential,
  type TerrainClass,
  type CombatCategory,
  type CombatRole,
  type PotentialComparisonResult,
  type UnitPotentialResult,
} from "../utils/combatPotential";
import { predictContactTime, type ContactPrediction } from "../utils/contactPrediction";

type Props = {
  units: Unit[];
  unitAreas: UnitArea[];
  markers: ScenarioMarker[];
  comparisonOwnUnitIds: string[];
  comparisonTargetUnitIds: string[];
  setComparisonOwnUnitIds: (ids: string[]) => void;
  setComparisonTargetUnitIds: (ids: string[]) => void;
  unitTerrainClassRef: MutableRefObject<Map<string, string>>;
  unitTerrainModifiersRef: MutableRefObject<Map<string, number>>;
  checkTerrainForUnit: (unitId: string) => Promise<void>;
  checkTerrainForUnitArea: (unitId: string) => Promise<void>;
};

// ─── Stałe ──────────────────────────────────────────────────────────────────


const CATEGORY_LABELS: Record<CombatCategory, string> = {
  infantry:  "Piechota",
  armor:     "Pancerz",
  artillery: "Artyleria",
  anti_air:  "OPL/PPanc",
  air:       "Rozp. lot.",
};

const MODIFIER_LABELS: Record<string, string> = {
  readinessModifier:             "Gotowość",
  personnelModifier:             "Personel",
  mobilityModifier:              "Mobilność",
  terrainModifier:               "Teren",
  combatEffectivenessModifier:   "Efekt. bojowa",
};

// ─── Decyzja taktyczna (kluczowy element) ───────────────────────────────────

type Decision = {
  action:      string;   // "NATARCIE" / "WSTRZYMANIE" / "OBRONA" / "ODWRÓT"
  subtitle:    string;
  color:       string;
  bg:          string;
  border:      string;
  icon:        string;
};

function resolveDecision(ratio: number): Decision {
  if (ratio > 1.8) return {
    action: "NATARCIE",
    subtitle: "Zdecydowana przewaga własna",
    color: "#4ade80", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.4)", icon: "⚔️",
  };
  if (ratio > 1.2) return {
    action: "NATARCIE",
    subtitle: "Przewaga własna",
    color: "#86efac", bg: "rgba(74,222,128,0.08)", border: "rgba(74,222,128,0.3)", icon: "⚔️",
  };
  if (ratio >= 0.8) return {
    action: "WSTRZYMANIE",
    subtitle: "Względna równowaga sił",
    color: "#fbbf24", bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.35)", icon: "⏸",
  };
  if (ratio >= 0.5) return {
    action: "OBRONA",
    subtitle: "Przewaga przeciwnika",
    color: "#fb923c", bg: "rgba(251,146,60,0.10)", border: "rgba(251,146,60,0.35)", icon: "🛡",
  };
  return {
    action: "ODWRÓT",
    subtitle: "Zdecydowana przewaga przeciwnika",
    color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.4)", icon: "↩",
  };
}

// ─── Pomocnicze ──────────────────────────────────────────────────────────────

function pct(v: number) { return `${(v * 100).toFixed(0)}%`; }

function avgModifier(units: UnitPotentialResult[], key: string): number {
  if (units.length === 0) return 0;
  return units.reduce((s, r) => s + ((r.breakdown as any)[key] as number), 0) / units.length;
}

function weakestModifier(units: UnitPotentialResult[]): { label: string; value: number } | null {
  if (units.length === 0) return null;
  let minKey = "";
  let minVal = Infinity;
  for (const mk of Object.keys(MODIFIER_LABELS)) {
    const v = avgModifier(units, mk);
    if (v < minVal) { minVal = v; minKey = mk; }
  }
  return minKey ? { label: MODIFIER_LABELS[minKey], value: minVal } : null;
}

function strongestCategory(units: UnitPotentialResult[]): { label: string; value: number } | null {
  if (units.length === 0) return null;
  const cats = Object.keys(CATEGORY_LABELS) as CombatCategory[];
  let maxKey: CombatCategory = "infantry";
  let maxVal = -1;
  for (const cat of cats) {
    const v = units.reduce((s, r) => s + (r.breakdown[cat] as number), 0);
    if (v > maxVal) { maxVal = v; maxKey = cat; }
  }
  return { label: CATEGORY_LABELS[maxKey], value: maxVal };
}

// ─── Komponenty ──────────────────────────────────────────────────────────────

function DecisionBox({ ratio, ownEff, targetEff }: { ratio: number; ownEff: number; targetEff: number }) {
  const d = resolveDecision(ratio);
  return (
    <div style={{
      background: d.bg, border: `2px solid ${d.border}`, borderRadius: 10,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22 }}>{d.icon}</span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: d.color, letterSpacing: "0.04em" }}>
            {d.action}
          </div>
          <div style={{ fontSize: 12, color: d.color, opacity: 0.85 }}>{d.subtitle}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#64748b" }}>stosunek sił</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: d.color }}>{ratio.toFixed(2)}</div>
        </div>
      </div>

      {/* Mini pasek sił */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", marginBottom: 3 }}>
          <span>Jednostki sojusznicze: {(ownEff * 100).toFixed(1)}</span>
          <span>Jednostki wrogie: {(targetEff * 100).toFixed(1)}</span>
        </div>
        <div style={{ height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 5, overflow: "hidden", display: "flex" }}>
          {(() => {
            const total = ownEff + targetEff;
            const ownW = total > 0 ? (ownEff / total) * 100 : 50;
            return (
              <>
                <div style={{ width: `${ownW}%`, background: "#3b82f6", borderRadius: "5px 0 0 5px", transition: "width 0.4s" }} />
                <div style={{ flex: 1, background: "#ef4444", borderRadius: "0 5px 5px 0" }} />
              </>
            );
          })()}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", marginTop: 2 }}>
          <span style={{ color: "#60a5fa" }}>■ własne</span>
          <span style={{ color: "#f87171" }}>■ wskazane</span>
        </div>
      </div>
    </div>
  );
}

const ROLE_LABEL: Record<CombatRole, string> = {
  attacker: "⚔ Atakujący",
  defender: "🛡 Broniący",
  neutral:  "— Neutralny",
};

// ─── Custom role dropdown ────────────────────────────────────────────────────

const ROLE_OPTIONS: Array<{ value: CombatRole; label: string; icon: string; badge: string; color: string }> = [
  { value: "attacker", label: "Atakujący", icon: "✕", badge: "+ATK", color: "#ef4444" },
  { value: "defender", label: "Broniący",  icon: "⬡", badge: "+DEF", color: "#3b82f6" },
  { value: "neutral",  label: "Neutralny", icon: "—", badge: "BASE", color: "#64748b" },
];

function RoleDropdown({ value, onChange }: { value: CombatRole; onChange: (v: CombatRole) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = ROLE_OPTIONS.find(o => o.value === value)!;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: open ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.05)",
          border: `1px solid ${open ? "rgba(56,139,253,0.55)" : "rgba(255,255,255,0.14)"}`,
          borderRadius: 7, padding: "5px 9px 5px 8px",
          cursor: "pointer", fontSize: 12, fontWeight: 700,
          color: "#e2e8f0", minWidth: 120, whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: current.color, fontSize: 13, lineHeight: 1 }}>{current.icon}</span>
        <span style={{ flex: 1 }}>{current.label}</span>
        <span style={{ color: "#4a5568", fontSize: 9, marginLeft: 2 }}>{open ? "▲" : "▼"}</span>
      </button>

      {/* Menu */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 5px)", right: 0, zIndex: 300,
          background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 9, padding: 4, minWidth: 168,
          boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
        }}>
          {ROLE_OPTIONS.map(opt => {
            const sel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "7px 10px",
                  background: sel ? "rgba(37,99,235,0.18)" : "transparent",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  color: sel ? "#93c5fd" : "#94a3b8",
                  fontSize: 13, fontWeight: 600, textAlign: "left",
                }}
              >
                <span style={{ color: opt.color, fontSize: 14, width: 16, textAlign: "center", lineHeight: 1 }}>{opt.icon}</span>
                <span style={{ flex: 1 }}>{opt.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                  color: "#475569", background: "rgba(255,255,255,0.06)",
                  borderRadius: 4, padding: "1px 5px",
                }}>{opt.badge}</span>
                {sel && <span style={{ color: "#3b82f6", fontSize: 13, marginLeft: 2 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


function ReasonBox({
  ownUnits, targetUnits,
}: { ownUnits: UnitPotentialResult[]; targetUnits: UnitPotentialResult[] }) {
  const ownWeak   = weakestModifier(ownUnits);
  const tgtWeak   = weakestModifier(targetUnits);
  const ownStrong = strongestCategory(ownUnits);

  // Średni modifier terenu per strona
  const ownTerrainAvg    = ownUnits.length > 0    ? ownUnits.reduce((s, r)    => s + r.breakdown.terrainModifier, 0) / ownUnits.length    : 1;
  const targetTerrainAvg = targetUnits.length > 0 ? targetUnits.reduce((s, r) => s + r.breakdown.terrainModifier, 0) / targetUnits.length : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Uzasadnienie
      </div>

      {/* Efekt terenu i roli */}
      <div style={{
        display: "flex", gap: 6, flexWrap: "wrap",
        background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "6px 8px",
      }}>
        <div style={{ fontSize: 11, color: "#64748b", width: "100%", marginBottom: 2 }}>Modyfikator terenu × rola:</div>
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 10, color: "#60a5fa" }}>Jednostki sojusznicze: </span>
            <span style={{
              fontSize: 13, fontWeight: 800,
              color: ownTerrainAvg > 1.05 ? "#4ade80" : ownTerrainAvg < 0.8 ? "#f87171" : "#94a3b8",
            }}>×{ownTerrainAvg.toFixed(2)}</span>
            
          </div>
          <div style={{ flex: 1, textAlign: "right" }}>
            <span style={{ fontSize: 10, color: "#f87171" }}>Jednostki wrogie: </span>
            <span style={{
              fontSize: 13, fontWeight: 800,
              color: targetTerrainAvg > 1.05 ? "#4ade80" : targetTerrainAvg < 0.8 ? "#f87171" : "#94a3b8",
            }}>×{targetTerrainAvg.toFixed(2)}</span>
            
          </div>
        </div>
      </div>

      {ownStrong && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ color: "#22c55e", fontSize: 14 }}>↑</span>
          <span style={{ color: "#94a3b8" }}>Najsilniejsza kategoria własna:</span>
          <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{ownStrong.label}</span>
        </div>
      )}

      {ownWeak && ownWeak.value < 0.7 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ color: "#f59e0b", fontSize: 14 }}>⚠</span>
          <span style={{ color: "#94a3b8" }}>Słaby punkt własny:</span>
          <span style={{ color: "#fbbf24", fontWeight: 700 }}>{ownWeak.label} ({pct(ownWeak.value)})</span>
        </div>
      )}

      {tgtWeak && tgtWeak.value < 0.7 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ color: "#60a5fa", fontSize: 14 }}>↓</span>
          <span style={{ color: "#94a3b8" }}>Słaby punkt przeciwnika:</span>
          <span style={{ color: "#60a5fa", fontWeight: 700 }}>{tgtWeak.label} ({pct(tgtWeak.value)})</span>
        </div>
      )}
    </div>
  );
}

function CategoryBar({ ownVal, targetVal }: { ownVal: number; targetVal: number }) {
  const max = Math.max(ownVal, targetVal, 0.001);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }}>
      {[
        { val: ownVal,    color: "#3b82f6", label: (ownVal * 100).toFixed(0) },
        { val: targetVal, color: "#ef4444", label: (targetVal * 100).toFixed(0) },
      ].map(({ val, color, label }, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 24, fontSize: 10, color, textAlign: "right" }}>{label}</span>
          <div style={{ flex: 1, height: 7, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${(val / max) * 100}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ModifierTable({ ownUnits, targetUnits }: { ownUnits: UnitPotentialResult[]; targetUnits: UnitPotentialResult[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
        Modyfikatory (śr. jednostki)
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", color: "#475569", fontWeight: 500, paddingBottom: 4 }}>Modyfikator</th>
            <th style={{ textAlign: "right", color: "#60a5fa", fontWeight: 500, paddingBottom: 4 }}>Jednostki sojusznicze:</th>
            <th style={{ textAlign: "right", color: "#f87171", fontWeight: 500, paddingBottom: 4 }}>Jednostki wrogie:</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(MODIFIER_LABELS).map(([mk, label]) => {
            const ov = avgModifier(ownUnits, mk);
            const tv = avgModifier(targetUnits, mk);
            const isLow = ov < 0.5;
            return (
              <tr key={mk} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ color: isLow ? "#fbbf24" : "#94a3b8", padding: "3px 0" }}>
                  {isLow && <span style={{ marginRight: 4 }}>⚠</span>}{label}
                </td>
                <td style={{ textAlign: "right", color: "#60a5fa", padding: "3px 4px" }}>{pct(ov)}</td>
                <td style={{ textAlign: "right", color: "#f87171", padding: "3px 0" }}>{pct(tv)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EngagementSection({ result }: { result: PotentialComparisonResult }) {
  const [open, setOpen] = useState(false);
  const pred = result.engagementPrediction;
  if (!pred) return null;

  const winColor = pred.predictedWinner === "own" ? "#22c55e"
    : pred.predictedWinner === "draw" ? "#fbbf24"
    : "#f87171";
  const winLabel = pred.predictedWinner === "own" ? "Jednostki sojusznicze"
    : pred.predictedWinner === "draw" ? "Remis"
    : "Jednostki wrogie";

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "rgba(255,255,255,0.03)", border: "none", cursor: "pointer",
          padding: "8px 12px", color: "#94a3b8", fontSize: 12, fontWeight: 600,
        }}
      >
        <span>Predykcja starcia (Lanchester)</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "Zwycięzca", value: winLabel, color: winColor },
              { label: "Czas starcia", value: `${pred.estimatedEngagementTimeMinutes} min`, color: "#94a3b8" },
              { label: "Ufność modelu", value: `${(pred.confidence * 100).toFixed(0)}%`,
                color: pred.confidence >= 0.7 ? "#22c55e" : pred.confidence >= 0.4 ? "#fbbf24" : "#f87171" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                flex: 1, textAlign: "center",
                background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "6px 4px",
              }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "Jednostki sojusznicze: — pozostałe", value: pred.ownRemainingPercent, color: "#60a5fa" },
              { label: "Jednostki wrogie — pozostałe", value: pred.targetRemainingPercent, color: "#f87171" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                flex: 1, textAlign: "center",
                background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "6px 4px",
              }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}%</div>
              </div>
            ))}
          </div>

          <div style={{
            background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.18)",
            borderRadius: 5, padding: "5px 9px", fontSize: 10, color: "#92400e", lineHeight: 1.4,
          }}>
            ⚠ Model heurystyczny — nie jest prognozą realną. Wyłącznie abstrakcyjna miara symulacyjna.
          </div>
        </div>
      )}
    </div>
  );
}

function formatContactTime(minutes: number): string {
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h} h ${m} min` : `~${h} h`;
}

function ContactSection({ contact }: { contact: ContactPrediction }) {
  const hasContact = contact.willMeet && contact.timeToContactMinutes != null;
  const isConverging = contact.closingSpeedKmh > 0.5;

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${hasContact ? "rgba(251,191,36,0.25)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 8, padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Czas do kontaktu
        </div>
        <div title="Szacunek heurystyczny — nie uwzględnia zmiany terenu ani manewrów" style={{ fontSize: 10, color: "#475569", cursor: "help" }}>ℹ</div>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <div style={{
          flex: 1, textAlign: "center",
          background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "6px 4px",
        }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>Odległość</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#94a3b8" }}>
            {contact.currentDistanceKm < 1
              ? `${(contact.currentDistanceKm * 1000).toFixed(0)} m`
              : `${contact.currentDistanceKm.toFixed(1)} km`}
          </div>
        </div>

        <div style={{
          flex: 1, textAlign: "center",
          background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "6px 4px",
        }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>Zbliżanie</div>
          <div style={{
            fontSize: 14, fontWeight: 800,
            color: isConverging ? "#4ade80" : contact.closingSpeedKmh < -0.5 ? "#f87171" : "#94a3b8",
          }}>
            {isConverging
              ? `${contact.closingSpeedKmh.toFixed(0)} km/h`
              : contact.closingSpeedKmh < -0.5
                ? `↗ ${Math.abs(contact.closingSpeedKmh).toFixed(0)} km/h`
                : "— brak"}
          </div>
        </div>

        <div style={{
          flex: 1, textAlign: "center",
          background: hasContact ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.04)",
          border: hasContact ? "1px solid rgba(251,191,36,0.2)" : "none",
          borderRadius: 6, padding: "6px 4px",
        }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>Kontakt</div>
          {hasContact ? (
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fbbf24" }}>
              {formatContactTime(contact.timeToContactMinutes!)}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#475569" }}>
              {contact.timeToContactMinutes === 0 ? "teraz" : "brak"}
            </div>
          )}
        </div>
      </div>

      {!isConverging && !hasContact && (
        <div style={{ fontSize: 10, color: "#475569", textAlign: "center" }}>
          Jednostki nie zbliżają się lub nie mają przypisanych tras
        </div>
      )}

      <div style={{ fontSize: 10, color: "#475569", fontStyle: "italic" }}>
        ⚠ Szacunek heurystyczny — nie uwzględnia zmiany terenu ani manewrów
      </div>
    </div>
  );
}

function ResultsSection({ result, contact }: { result: PotentialComparisonResult; contact: ContactPrediction | null }) {
  const cats: CombatCategory[] = ["infantry", "armor", "artillery", "anti_air", "air"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 1. DECYZJA — najważniejszy element */}
      <DecisionBox
        ratio={result.ratioEffective}
        ownEff={result.ownTotalEffective}
        targetEff={result.targetTotalEffective}
      />

      {/* 2. Czas do kontaktu */}
      {contact && <ContactSection contact={contact} />}

      {/* 3. Uzasadnienie */}
      <ReasonBox ownUnits={result.ownUnits} targetUnits={result.targetUnits} />

      {/* 4. Kategorie */}
      <div>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Porównanie kategorii
          <span style={{ marginLeft: 8, fontSize: 10, color: "#475569" }}>■ własne &nbsp; ■ wskazane</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cats.map(cat => (
            <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 76, fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{CATEGORY_LABELS[cat]}</span>
              <CategoryBar
                ownVal={result.categoryComparison[cat].own}
                targetVal={result.categoryComparison[cat].target}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 5. Modyfikatory */}
      <ModifierTable ownUnits={result.ownUnits} targetUnits={result.targetUnits} />

      {/* 6. Predykcja Lanchester (zwijalna) */}
      <EngagementSection result={result} />
    </div>
  );
}

// ─── Główny komponent ────────────────────────────────────────────────────────

const VALID_TERRAIN = new Set<string>(["open", "road", "urban", "forest", "wetland", "water"]);

function toTerrainClass(raw: string | undefined): TerrainClass {
  return (raw && VALID_TERRAIN.has(raw)) ? raw as TerrainClass : "open";
}

export default function CombatPotentialPanel({
  units,
  unitAreas,
  markers,
  comparisonOwnUnitIds,
  comparisonTargetUnitIds,
  setComparisonOwnUnitIds,
  setComparisonTargetUnitIds,
  unitTerrainClassRef,
  unitTerrainModifiersRef,
  checkTerrainForUnit,
  checkTerrainForUnitArea,
}: Props) {
  const [ownRole, setOwnRole]       = useState<CombatRole>("neutral");
  const [targetRole, setTargetRole] = useState<CombatRole>("neutral");
  // bumped after terrain analysis completes — triggers useMemo to re-read ref
  const [terrainVersion, setTerrainVersion] = useState(0);

  const analyzeAndRefresh = useCallback(async (unitId: string) => {
    const hasArea = unitAreas.some(a => a.unit_id === unitId && a.area_type === "responsibility");
    if (hasArea) await checkTerrainForUnitArea(unitId);
    else await checkTerrainForUnit(unitId);
    setTerrainVersion(v => v + 1);
  }, [unitAreas, checkTerrainForUnit, checkTerrainForUnitArea]);

  const toggle = (list: string[], setList: (ids: string[]) => void, id: string) => {
    if (list.includes(id)) {
      setList(list.filter(x => x !== id));
    } else {
      setList([...list, id]);
      void analyzeAndRefresh(id);
    }
  };

  const ownUnits    = useMemo(() => units.filter(u => comparisonOwnUnitIds.includes(u.id)),    [units, comparisonOwnUnitIds]);
  const targetUnits = useMemo(() => units.filter(u => comparisonTargetUnitIds.includes(u.id)), [units, comparisonTargetUnitIds]);

  const result = useMemo<PotentialComparisonResult | null>(() => {
    if (ownUnits.length === 0 || targetUnits.length === 0) return null;
    const terrainMap = unitTerrainClassRef.current;
    return compareCombatPotential(ownUnits as any, targetUnits as any, {
      ownTerrainByUnitId:    Object.fromEntries(ownUnits.map(u    => [u.id, toTerrainClass(terrainMap.get(u.id))])),
      targetTerrainByUnitId: Object.fromEntries(targetUnits.map(u => [u.id, toTerrainClass(terrainMap.get(u.id))])),
      ownRole,
      targetRole,
      includeEngagementPrediction: true,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownUnits, targetUnits, ownRole, targetRole, terrainVersion]);

  const contact = useMemo<ContactPrediction | null>(() => {
    if (ownUnits.length === 0 || targetUnits.length === 0) return null;
    const modifiers = unitTerrainModifiersRef.current;
    const toContactUnit = (u: Unit) => ({
      id: u.id,
      x: u.x,
      y: u.y,
      base_speed_kmh: u.base_speed_kmh ?? null,
      route: markers.find(m => m.id === u.id)?.route ?? [],
    });
    return predictContactTime(
      ownUnits.map(toContactUnit),
      targetUnits.map(toContactUnit),
      modifiers,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownUnits, targetUnits, markers, terrainVersion]);


  const terrainBadge = (unitId: string) => {
    const raw = unitTerrainClassRef.current.get(unitId);
    if (!raw) return <span style={{ fontSize: 10, color: "#475569", marginLeft: 4 }}>brak analizy</span>;
    return <span style={{ fontSize: 10, color: "#fbbf24", marginLeft: 4 }}>{raw}</span>;
  };

  const friendlyUnits = units.filter(u => u.side === "friendly");
  const hostileUnits  = units.filter(u => u.side === "hostile");

  const unitRow = (u: Unit, checked: boolean, onChange: () => void, color: string) => (
    <label key={u.id} style={{
      display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
      padding: "4px 6px", borderRadius: 4,
      background: checked ? `${color}18` : "transparent",
      border: `1px solid ${checked ? color + "44" : "transparent"}`,
    }}>
      <input type="checkbox" checked={checked} onChange={onChange}
        style={{ accentColor: color, cursor: "pointer", flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: checked ? "#e2e8f0" : "#94a3b8", lineHeight: 1.3, flex: 1 }}>
        {u.custom_name || u.symbol_name}
        {u.echelon && <span style={{ color: "#475569", marginLeft: 4 }}>{u.echelon.replace(/_/g, " ")}</span>}
      </span>
      {checked && terrainBadge(u.id)}
    </label>
  );

  const unitGroup = (list: Unit[], ownIds: string[], setIds: (ids: string[]) => void, color: string) => (
    <>
      {friendlyUnits.filter(u => list.includes(u)).map(u =>
        unitRow(u, ownIds.includes(u.id), () => toggle(ownIds, setIds, u.id), color)
      )}
      {hostileUnits.filter(u => list.includes(u)).map(u =>
        unitRow(u, ownIds.includes(u.id), () => toggle(ownIds, setIds, u.id), color)
      )}
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 0" }}>

      {/* Nagłówek */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="layers-panel-header">
        <span>Porównanie potencjału</span></div>
        <button
          onClick={() => { setComparisonOwnUnitIds([]); setComparisonTargetUnitIds([]); }}
          style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4, padding: "3px 8px", color: "#94a3b8", fontSize: 11, cursor: "pointer",
          }}
        >Wyczyść</button>
      </div>

      {/* sojusznicze jednostki */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 600 }}>
            Jednostki sojusznicze ({comparisonOwnUnitIds.length})
          </div>
          <RoleDropdown value={ownRole} onChange={setOwnRole} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 150, overflowY: "auto" }}>
          {friendlyUnits.length > 0 && <div style={{ fontSize: 10, color: "#475569", padding: "2px 6px" }}></div>}
          {friendlyUnits.map(u => unitRow(u, comparisonOwnUnitIds.includes(u.id), () => toggle(comparisonOwnUnitIds, setComparisonOwnUnitIds, u.id), "#3b82f6"))}
          {units.length === 0 && <div style={{ fontSize: 11, color: "#475569", padding: "4px 6px" }}>Brak jednostek</div>}
        </div>
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

      {/* wrogie jednostki */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>
            Jednostki wrogie ({comparisonTargetUnitIds.length})
          </div>
          <RoleDropdown value={targetRole} onChange={setTargetRole} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 150, overflowY: "auto" }}>
          {hostileUnits.length > 0 && <div style={{ fontSize: 10, color: "#475569", padding: "2px 6px" }}></div>}
          {hostileUnits.map(u => unitRow(u, comparisonTargetUnitIds.includes(u.id), () => toggle(comparisonTargetUnitIds, setComparisonTargetUnitIds, u.id), "#ef4444"))}
          {units.length === 0 && <div style={{ fontSize: 11, color: "#475569", padding: "4px 6px" }}>Brak jednostek</div>}
        </div>
      </div>

      {/* Wyniki */}
      {result ? (
        <>
          <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
          <ResultsSection result={result} contact={contact} />
        </>
      ) : (
        <div style={{
          textAlign: "center", padding: "18px 8px", fontSize: 12, color: "#475569",
          border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 8,
        }}>
          Wybierz co najmniej jedną jednostkę z każdej strony, aby zobaczyć porównanie i decyzję taktyczną.
        </div>
      )}
    </div>
  );
}
