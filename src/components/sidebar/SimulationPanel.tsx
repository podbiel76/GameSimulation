import { Play, Pause, SkipForward, ArrowCounterClockwise, Broadcast } from "@phosphor-icons/react";
import AcLeftHeader from "./AcLeftHeader";
import { TERRAIN_SPEED_MODIFIERS } from "../../hooks/useLocalSimulation";
import { isUnitDestroyed } from "../../utils/attritionRules";
import type { Unit } from "../../types/map";

/**
 * Lewy panel zakładki „Symulacja" — odwzorowanie makiety
 * `project/AICOMMAND.dc.html` (sekcja `<!-- SYMULACJA -->`).
 *
 * WAŻNE — modyfikatory terenu:
 * Makieta ma własną tablicę `TERRAIN` z wartościami demonstracyjnymi
 * (Las 0.6, Zabudowa 0.5, Rzeka 0.25). Realny model gry ma inne
 * (Las 0.5, Zabudowa 0.7, Woda 0.1) i mieszka w `shared/combat_constants.json`,
 * pilnowany testem `rl/parity/test_ts_json_parity.py`.
 * Panel pokazuje wartości REALNE — przepisanie liczb z makiety utworzyłoby
 * czwartą kopię modelu walki i cicho rozjechało UI z symulacją.
 */

/** Kolory i etykiety terenu — z makiety; przypisane do klas realnego modelu. */
const TERRAIN_VIEW: { key: string; name: string; color: string }[] = [
  { key: "road", name: "Droga", color: "#86b06a" },
  { key: "open", name: "Otwarty", color: "#8ba0ad" },
  { key: "forest", name: "Las", color: "#5f8a5a" },
  { key: "urban", name: "Zabudowa", color: "#b58b56" },
  { key: "wetland", name: "Bagno", color: "#7a7a5c" },
  { key: "water", name: "Rzeka", color: "#5a86a8" },
];

const BLUE = "#7fb0dd";
const RED = "#d9635a";

type Props = {
  units: Unit[];
  simRunning: boolean;
  timeScale: number;
  isDetecting: boolean;
  onToggleSim: () => void;
  onStepMinutes: (minutes: number) => void;
  onReset: () => void;
  onToggleDetecting: () => void;
  onTimeScale: (v: number) => void;
  onCollapse?: () => void;
};

/** „1 s = X" — opis tempa liczony z realnej semantyki mnożnika. */
function tempoText(scale: number): string {
  if (scale >= 60) {
    const m = scale / 60;
    return `1 s = ${Number.isInteger(m) ? m : m.toFixed(1)} min`;
  }
  return `1 s = ${scale} s`;
}

export default function SimulationPanel({
  units, simRunning, timeScale, isDetecting,
  onToggleSim, onStepMinutes, onReset, onToggleDetecting, onTimeScale, onCollapse,
}: Props) {
  const alive = units.filter(u => !isUnitDestroyed(u));
  const side = (s: string) => alive.filter(u => u.side === s);

  const sum = (us: Unit[], f: (u: Unit) => number) => us.reduce((a, u) => a + f(u), 0);
  const personnel = (u: Unit) => u.logistics?.personnel_available ?? 0;
  const vehicles = (u: Unit) =>
    (u.logistics?.tanks_operational ?? 0) +
    (u.logistics?.ifv_operational ?? 0) +
    (u.logistics?.armored_artillery_operational ?? 0);

  const f = side("friendly");
  const h = side("hostile");
  const pct = (a: number, b: number) => Math.round((a / Math.max(1, a + b)) * 100);

  const balance = [
    { label: "Stan osobowy", a: Math.round(sum(f, personnel)), b: Math.round(sum(h, personnel)) },
    { label: "Sprzęt sprawny", a: Math.round(sum(f, vehicles)), b: Math.round(sum(h, vehicles)) },
    { label: "Jednostki zdolne", a: f.length, b: h.length },
  ].map(b => ({ ...b, pct: pct(b.a, b.b) }));

  // Skala paska terenu — najwyższy modyfikator wyznacza 100%.
  const maxMod = Math.max(...Object.values(TERRAIN_SPEED_MODIFIERS));

  return (
    <>
      <AcLeftHeader title="Symulacja" count={`×${timeScale}`} onCollapse={onCollapse} />
      <div className="ac-left-body">
    <div className="ac-sim">
      {/* ── Silnik symulacji ── */}
      <section>
        <div className="ac-sec-title">Silnik symulacji</div>
        <div className="ac-sim-grid">
          <button
            className={`ac-simbtn primary${simRunning ? " running" : ""}`}
            onClick={onToggleSim}
          >
            {simRunning ? <Pause size={15} /> : <Play size={15} />}
            {simRunning ? "Pauza" : "Start"}
          </button>
          <button className="ac-simbtn" onClick={() => onStepMinutes(15)}>
            <SkipForward size={15} />Krok 15 min
          </button>
          <button className="ac-simbtn" onClick={onReset}>
            <ArrowCounterClockwise size={15} />Reset
          </button>
          <button
            className={`ac-simbtn${isDetecting ? " on" : ""}`}
            onClick={onToggleDetecting}
          >
            <Broadcast size={15} />{isDetecting ? "Detekcja wł." : "Detekcja"}
          </button>
        </div>
      </section>

      {/* ── Tempo ── */}
      <section>
        <div className="ac-sec-row">
          <span className="ac-sec-title">Tempo</span>
          <span className="ac-tempo-val">×{timeScale} — {tempoText(timeScale)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={60}
          step={1}
          value={timeScale}
          onChange={e => onTimeScale(Number(e.target.value))}
          className="ac-range"
        />
      </section>

      {/* ── Modyfikatory terenu ── */}
      <section>
        <div className="ac-sec-title">Modyfikatory terenu</div>
        <div className="ac-terrain-list">
          {TERRAIN_VIEW.map(t => {
            const mod = TERRAIN_SPEED_MODIFIERS[t.key] ?? 1;
            return (
              <div className="ac-terrain-row" key={t.key}>
                <span className="ac-terrain-dot" style={{ background: t.color }} />
                <span className="ac-terrain-name">{t.name}</span>
                <span className="ac-terrain-bar">
                  <span style={{ width: `${(mod / maxMod) * 100}%`, background: t.color }} />
                </span>
                <span className="ac-terrain-mod" style={{ color: t.color }}>×{mod}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Bilans sił ── */}
      <section>
        <div className="ac-sec-title">Bilans sił</div>
        <div className="ac-balance-list">
          {balance.map(b => (
            <div key={b.label}>
              <div className="ac-balance-head">
                <span>{b.label}</span>
                <span className="ac-balance-nums">
                  <span style={{ color: BLUE }}>{b.a}</span>
                  <span style={{ color: "#4a4744" }}> / </span>
                  <span style={{ color: RED }}>{b.b}</span>
                </span>
              </div>
              <div className="ac-balance-bar">
                <span style={{ width: `${b.pct}%`, background: BLUE }} />
                <span style={{ flex: 1, background: RED }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
      </div>
    </>
  );
}
