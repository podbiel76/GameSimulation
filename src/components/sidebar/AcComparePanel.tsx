import AcLeftHeader from "./AcLeftHeader";
import { computeUnitPotential } from "../../utils/combatPotential";
import { isUnitDestroyed } from "../../utils/attritionRules";
import { terrainForRole, type UnitTerrainProfile } from "../../utils/terrainProfile";
import type { Unit } from "../../types/map";

/**
 * Zakładka „Porównaj" — 1:1 z makietą (sekcja `<!-- PORÓWNANIE -->`).
 *
 * Ranking wszystkich zdolnych jednostek według potencjału bojowego.
 * Wynik pochodzi z `computeUnitPotential` — tego samego modelu, który liczy
 * atrycję w pętli symulacji. Makieta ma tu własną formułę demonstracyjną
 * (`persA*0.7 + vehO*6 + droneA*3`), której świadomie nie przenoszę:
 * dałaby liczby niezgodne z tym, co faktycznie rozstrzyga walkę.
 *
 * Skala: potencjał efektywny (0–1) × 1000, zaokrąglony — rząd wielkości
 * odpowiada wartościom z makiety, a porównania między jednostkami są wierne.
 */

const BLUE = "#7fb0dd";
const RED = "#d9635a";

type Props = {
  units: Unit[];
  terrainByUnitId: Map<string, string>;
  /** Profile terenu z backendu — ranking liczony z rozkładu terenu AO. */
  terrainProfiles?: Map<string, UnitTerrainProfile>;
  onSelectUnit?: (id: string) => void;
  onCollapse?: () => void;
};

export default function AcComparePanel({
  units, terrainByUnitId, terrainProfiles, onSelectUnit, onCollapse,
}: Props) {
  const rows = units
    .filter(u => !isUnitDestroyed(u))
    .map(u => ({
      id: u.id,
      name: u.symbol_name,
      color: u.side === "friendly" ? BLUE : RED,
      score: Math.round(
        computeUnitPotential(u as never, terrainForRole(terrainProfiles?.get(u.id), "neutral", terrainByUnitId.get(u.id)))
          .breakdown.effectivePotential * 1000
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const max = Math.max(1, ...rows.map(r => r.score));

  return (
    <>
      <AcLeftHeader title="Potencjał bojowy" count={rows.length} onCollapse={onCollapse} />
      <div className="ac-left-body">
        <div className="ac-cmp">
          <div className="ac-cmp-note">
            Potencjał bojowy liczony z etatu, sprawności sprzętu, zapasu amunicji
            i modyfikatora terenu.
          </div>

          {rows.length === 0 && (
            <div className="ac-mon-empty">Brak jednostek zdolnych do walki</div>
          )}

          {rows.map(r => (
            <div key={r.id} onClick={() => onSelectUnit?.(r.id)} style={{ cursor: onSelectUnit ? "pointer" : "default" }}>
              <div className="ac-cmp-head">
                <span className="ac-cmp-dot" style={{ background: r.color }} />
                <span className="ac-cmp-name">{r.name}</span>
                <span className="ac-cmp-score" style={{ color: r.color }}>{r.score}</span>
              </div>
              <div className="ac-cmp-bar">
                <span style={{ width: `${(r.score / max) * 100}%`, background: r.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
