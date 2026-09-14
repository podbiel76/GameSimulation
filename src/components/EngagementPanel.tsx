import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Unit } from "../types/map";
import type { EngagementInfo } from "../hooks/useLocalSimulation";
import { computeUnitPotential } from "../utils/combatPotential";
import { ATTRITION_COEFFICIENT } from "../hooks/useLocalSimulation";
import { classifyUnitType } from "../utils/attritionRules";

type Props = {
  engagements: EngagementInfo[];
  units: Unit[];
  unitTerrainClassRef: React.MutableRefObject<Map<string, string>>;
};

const VALID_TERRAIN = new Set(["open", "road", "urban", "forest", "wetland", "water"]);
function toTerrain(raw: string | undefined) {
  return (raw && VALID_TERRAIN.has(raw)) ? raw as any : "open";
}

function formatDuration(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─── Tooltip helper ───────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={ref}
      style={{ display: "inline-flex", alignItems: "center", marginLeft: 3, flexShrink: 0 }}
      onMouseEnter={() => {
        if (ref.current) {
          const r = ref.current.getBoundingClientRect();
          setPos({ x: r.left + r.width / 2, y: r.top - 6 });
        }
      }}
      onMouseLeave={() => setPos(null)}
    >
      <span style={{
        width: 13, height: 13, borderRadius: "50%",
        border: "1px solid var(--border-hover)", color: "var(--border-hover)",
        fontSize: 8, fontWeight: 700, display: "inline-flex",
        alignItems: "center", justifyContent: "center",
        cursor: "help", lineHeight: 1, userSelect: "none",
      }}>?</span>
      {pos && createPortal(
        <div style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          transform: "translateX(-50%) translateY(-100%)",
          background: "var(--bg-sunken)",
          border: "1px solid var(--border-strong)",
          borderRadius: 7,
          padding: "8px 11px",
          fontSize: 10,
          color: "var(--text-muted)",
          whiteSpace: "pre-wrap",
          maxWidth: 250,
          zIndex: 9999,
          lineHeight: 1.6,
          pointerEvents: "none",
          boxShadow: "0 6px 20px rgba(0,0,0,0.6)",
        }}>
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}

// ─── LogRow ───────────────────────────────────────────────────────────────────

function LogRow({ label, value, max, color, tip }: {
  label: string;
  value: number | null;
  max: number | null;
  color: string;
  tip?: string;
}) {
  if (value == null) return null;
  const pct = (max != null && max > 0) ? value / max : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
      <span style={{ minWidth: 70, color: "var(--text-dim)", flexShrink: 0, display: "flex", alignItems: "center" }}>
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      <span style={{ color, fontWeight: 700, width: 40, textAlign: "right" }}>{Math.round(value)}</span>
      {pct != null && (
        <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 3 }}>
          <div style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
        </div>
      )}
    </div>
  );
}

// ─── UnitCard ────────────────────────────────────────────────────────────────

function UnitCard({ unit, pot, lossRatePctPerSec, side }: {
  unit: Unit;
  pot: number;
  lossRatePctPerSec: number;
  side: "friendly" | "hostile";
}) {
  const log = unit.logistics;
  const color = side === "friendly" ? "var(--side-friendly)" : "var(--side-hostile-light)";
  const ceVal = log?.combat_effectiveness_percent ?? 100;

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "7px 9px",
      border: `1px solid ${color}22`,
    }}>
      <div style={{ fontSize: 11, color, fontWeight: 700, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
        <span>{unit.custom_name || unit.symbol_name}</span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
          <span style={{ color: "var(--text-dim)", fontWeight: 400, fontSize: 10 }}>{unit.echelon?.replace(/_/g, " ")}</span>
          <span style={{ color: "var(--border-strong)", fontWeight: 400, fontSize: 9 }}>
            {classifyUnitType(unit as any) === "armor" ? "Pancerna"
              : classifyUnitType(unit as any) === "artillery" ? "Artyleria"
              : classifyUnitType(unit as any) === "anti_tank" ? "Ppanc"
              : "Piechota"}
          </span>
        </div>
      </div>

      {/* CE bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: "var(--text-dim)", minWidth: 70, display: "flex", alignItems: "center" }}>
          Sprawność
          <InfoTip text={"combat_effectiveness_percent z logistyki.\n\nBezpośredni mnożnik potencjału bojowego:\nCE 100% → ×1.0, CE 50% → ×0.5.\n\nSpada automatycznie w wyniku strat w trakcie starcia."} />
        </span>
        <span style={{
          fontSize: 13, fontWeight: 800,
          color: ceVal > 70 ? "var(--ok-light)" : ceVal > 40 ? "var(--accent)" : "var(--side-hostile-light)",
        }}>{ceVal.toFixed(1)}%</span>
      </div>

      {log && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <LogRow
            label="Personel"
            value={log.personnel_available}
            max={log.personnel_total}
            color={color}
            tip={"personnel_available (zdolni do walki) / personnel_total (etat).\n\nMnożnik: avail / total stosowany w obliczaniu potencjału piechoty i pancernego.\n\nMaleje wskutek strat osobowych."}
          />
          <LogRow
            label="Czołgi/BWP"
            value={(log.tanks_operational ?? 0) + (log.ifv_operational ?? 0)}
            max={(log.tanks_total ?? 0) + (log.ifv_total ?? 0)}
            color={color}
            tip={"(tanks_operational + ifv_operational) / (tanks_total + ifv_total).\n\nSprawne pojazdy pancerne (czołgi + BWP/KTO).\n\nMnożnik pojazdów stosowany w potencjale pancernym. Maleje gdy pojazdy są niszczone w walce."}
          />
          <LogRow
            label="Amun. (SA)"
            value={log.ammo_small_arms}
            max={10000}
            color={color}
            tip={"ammo_small_arms — naboje do broni strzeleckiej.\n\nPasek = wartość / 10 000 (orientacyjny zakres).\n\nPrzy braku amunicji spada potencjał piechoty. Spalana intensywnie przez piechotę w walce."}
          />
          <LogRow
            label="Paliwo (L)"
            value={log.fuel_liters}
            max={500}
            color={color}
            tip={"fuel_liters — bieżący zapas paliwa w litrach.\n\nPasek = wartość / pojemność baku jednostki.\n\nNormy spalania w ruchu:\n• pancerne ~3 L/km\n• artyleria / ppanc ~1.5 L/km\n• piechota ~0.2 L/km\n\nBrak paliwa blokuje ruch pojazdów."}
          />
        </div>
      )}

      <div style={{ marginTop: 5, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
        <span style={{ color: "var(--border-hover)", display: "flex", alignItems: "center" }}>
          Pot. efekt. / Strata/s
          <InfoTip text={"Pot. efekt.: effectivePotential×100 tej jednostki.\n\neffectivePotential = staticPotential × CE% × maintenance × komms × paliwo × ammo\n\nStrata/s: % potencjału/s narzucony przez stronę przeciwną:\npot_wroga × 0.002 (współczynnik) × 10 (takty) × 100%."} />
        </span>
        <span style={{ color: "var(--text-primary)" }}>
          <span style={{ fontWeight: 700 }}>{(pot * 100).toFixed(1)}</span>
          <span style={{ color: "var(--accent)", marginLeft: 6 }}>−{lossRatePctPerSec.toFixed(3)}%</span>
        </span>
      </div>
    </div>
  );
}

// ─── SideColumn ───────────────────────────────────────────────────────────────

function SideColumn({ unitIds, allUnits, terrainRef, side, opponentTotalPot, role }: {
  unitIds: string[];
  allUnits: Unit[];
  terrainRef: React.MutableRefObject<Map<string, string>>;
  side: "friendly" | "hostile";
  opponentTotalPot: number;
  role: "attacker" | "defender" | "neutral";
}) {
  const color = side === "friendly" ? "var(--side-friendly)" : "var(--side-hostile-light)";
  const label = side === "friendly" ? "Sojusznicy" : "Wrogowie";
  const roleBadge =
    role === "attacker" ? { text: "⚔ Atakujący", bg: "rgba(239,68,68,0.18)", fg: "var(--side-hostile-light)" } :
    role === "defender" ? { text: "🛡 Broniący",  bg: "rgba(59,130,246,0.18)", fg: "var(--side-friendly)" } :
    null;

  const units = unitIds.map(id => allUnits.find(u => u.id === id)).filter(Boolean) as Unit[];
  const totalPot = units.reduce((sum, u) => {
    const terrain = toTerrain(terrainRef.current.get(u.id));
    return sum + computeUnitPotential(u as any, terrain, undefined, role).breakdown.effectivePotential;
  }, 0);

  const lossRatePctPerSec = opponentTotalPot * ATTRITION_COEFFICIENT * 10 * 100;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Side header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontWeight: 700, color }}>
        <span>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-dim)" }}>{units.length} jedn.</span>
      </div>

      {/* Rola w starciu: atakujący (w ruchu) / broniący (w miejscu) */}
      {roleBadge && (
        <div style={{
          alignSelf: "flex-start", fontSize: 10, fontWeight: 700,
          color: roleBadge.fg, background: roleBadge.bg,
          borderRadius: 5, padding: "2px 7px",
        }}>
          {roleBadge.text}
        </div>
      )}

      {/* Combined potential summary */}
      <div style={{
        background: `${color}11`, borderRadius: 5, padding: "4px 8px",
        border: `1px solid ${color}22`, display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", alignItems: "center" }}>
          Łączny potencjał
          <InfoTip text={"Suma effectivePotential wszystkich jednostek tej strony (×100).\n\neffectivePotential = staticPotential × CE% × maintenance × komms × paliwo × ammo\n\nstaticPotential pochodzi z etatowych wartości logistyki (personel, pojazdy, amunicja)."} />
        </span>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color }}>{(totalPot * 100).toFixed(1)}</span>
          <div style={{ fontSize: 9, color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            −{lossRatePctPerSec.toFixed(3)}%/s każda
            <InfoTip text={"Prędkość strat narzucona przez potencjał przeciwnika na każdą jednostkę tej strony.\n\nFormula:\npot_wroga × 0.002 × 10 × 100%\n\ngdzie 0.002 = ATTRITION_COEFFICIENT\n10 = takty między obliczeniami strat."} />
          </div>
        </div>
      </div>

      {/* Individual unit cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 320, overflowY: "auto" }}>
        {units.map(u => {
          const terrain = toTerrain(terrainRef.current.get(u.id));
          const pot = computeUnitPotential(u as any, terrain, undefined, role).breakdown.effectivePotential;
          return (
            <UnitCard
              key={u.id}
              unit={u}
              pot={pot}
              lossRatePctPerSec={lossRatePctPerSec}
              side={side}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── EngagementCard ───────────────────────────────────────────────────────────

function EngagementCard({ eng, units, terrainRef }: {
  eng: EngagementInfo;
  units: Unit[];
  terrainRef: React.MutableRefObject<Map<string, string>>;
}) {
  const [elapsed, setElapsed] = useState(() => formatDuration(eng.startedAt));
  useEffect(() => {
    const id = setInterval(() => setElapsed(formatDuration(eng.startedAt)), 1000);
    return () => clearInterval(id);
  }, [eng.startedAt]);

  const friendlyUnits = eng.friendlyUnitIds.map(id => units.find(u => u.id === id)).filter(Boolean) as Unit[];
  const hostileUnits  = eng.hostileUnitIds.map(id => units.find(u => u.id === id)).filter(Boolean) as Unit[];
  if (friendlyUnits.length === 0 || hostileUnits.length === 0) return null;

  // Rola ustalona dla starcia — atakujący/obrońca wpływa na modyfikator terenu,
  // więc musi być uwzględniona także w wyświetlanych potencjałach (jak w symulacji).
  const friendlyRole: "attacker" | "defender" | "neutral" =
    eng.attackerSide == null ? "neutral" : eng.attackerSide === "friendly" ? "attacker" : "defender";
  const hostileRole: "attacker" | "defender" | "neutral" =
    eng.attackerSide == null ? "neutral" : eng.attackerSide === "hostile" ? "attacker" : "defender";

  const friendlyTotalPot = friendlyUnits.reduce((sum, u) => {
    const terrain = toTerrain(terrainRef.current.get(u.id));
    return sum + computeUnitPotential(u as any, terrain, undefined, friendlyRole).breakdown.effectivePotential;
  }, 0);

  const hostileTotalPot = hostileUnits.reduce((sum, u) => {
    const terrain = toTerrain(terrainRef.current.get(u.id));
    return sum + computeUnitPotential(u as any, terrain, undefined, hostileRole).breakdown.effectivePotential;
  }, 0);

  const ratio = friendlyTotalPot / Math.max(0.0001, hostileTotalPot);
  const ratioColor = ratio > 1.2 ? "var(--ok-light)" : ratio < 0.8 ? "var(--side-hostile-light)" : "var(--accent)";
  const ratioLabel = ratio > 1.5 ? "Zdecydowana przewaga własnych"
    : ratio > 1.2 ? "Przewaga własnych"
    : ratio >= 0.8 ? "Równowaga"
    : ratio >= 0.5 ? "Przewaga wroga"
    : "Zdecydowana przewaga wroga";

  return (
    <div style={{
      border: "1px solid rgba(239,68,68,0.25)", borderRadius: 9,
      overflow: "hidden", background: "rgba(239,68,68,0.04)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "7px 12px", background: "rgba(239,68,68,0.08)",
        borderBottom: "1px solid rgba(239,68,68,0.15)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 14 }}>⚔</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--side-hostile-light)" }}>STARCIE AKTYWNE</span>
          <InfoTip text={"Starcie wykryte gdy obszar działania (AO) jednostki friendly i wrogiej nakładają się.\n\nStraty są naliczane co 10 taktów symulacji na podstawie potencjałów obu stron.\n\nModel heurystyczny — abstrakcyjna miara symulacyjna, nie prognoza bojowa."} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center" }}>
            Czas trwania
            <InfoTip text={"Czas rzeczywisty (MM:SS) od momentu wykrycia starcia.\n\nStraty są naliczane cyklicznie co 10 taktów symulacji (ok. co 0.1 s czasu rzeczywistego przy normalnej prędkości)."} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {elapsed}
          </span>
        </div>
      </div>

      {/* Side columns */}
      <div style={{ display: "flex", gap: 8, padding: "10px 10px 8px", alignItems: "flex-start" }}>
        <SideColumn
          unitIds={eng.friendlyUnitIds}
          allUnits={units}
          terrainRef={terrainRef}
          side="friendly"
          opponentTotalPot={hostileTotalPot}
          role={eng.attackerSide == null ? "neutral" : eng.attackerSide === "friendly" ? "attacker" : "defender"}
        />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start", alignItems: "center", gap: 4, padding: "24px 2px 0" }}>
          <span style={{ fontSize: 16, color: "var(--text-dim)" }}>↔</span>
          <span style={{ fontSize: 10, color: "var(--border-hover)" }}>vs</span>
        </div>
        <SideColumn
          unitIds={eng.hostileUnitIds}
          allUnits={units}
          terrainRef={terrainRef}
          side="hostile"
          opponentTotalPot={friendlyTotalPot}
          role={eng.attackerSide == null ? "neutral" : eng.attackerSide === "hostile" ? "attacker" : "defender"}
        />
      </div>

      {/* Ratio summary */}
      <div style={{
        margin: "0 10px 10px", borderRadius: 6, padding: "6px 10px",
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", alignItems: "center" }}>
          Stosunek łącznych potencjałów
          <InfoTip text={"pot_własnych / pot_wroga\n\n> 1.5 → zdecydowana przewaga własnych\n1.2–1.5 → przewaga własnych\n0.8–1.2 → równowaga\n0.5–0.8 → przewaga wroga\n< 0.5 → zdecydowana przewaga wroga\n\nOparty wyłącznie na bieżących potencjałach efektywnych."} />
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: ratioColor }}>{ratio.toFixed(2)}</span>
          <span style={{ fontSize: 10, color: ratioColor }}>{ratioLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function EngagementPanel({ engagements, units, unitTerrainClassRef }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
        Aktywne starcia
        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "var(--text-dim)" }}>
          ({engagements.length})
        </span>
      </div>

      {engagements.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "24px 12px", fontSize: 12, color: "var(--border-hover)",
          border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 8,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <span style={{ fontSize: 24 }}>🕊</span>
          <span>Brak aktywnych starć.</span>
          <span style={{ fontSize: 11, color: "var(--border-strong)" }}>
            Starcie rozpoczyna się gdy AO jednostki friendly i hostile nakładają się.
          </span>
        </div>
      ) : (
        engagements.map(eng => (
          <EngagementCard
            key={eng.key}
            eng={eng}
            units={units}
            terrainRef={unitTerrainClassRef}
          />
        ))
      )}

      <div style={{ fontSize: 10, color: "var(--border-strong)", textAlign: "center" }}>
        ⚠ Model heurystyczny — nie jest prognozą realną. Wyłącznie abstrakcyjna miara symulacyjna.
      </div>
    </div>
  );
}
