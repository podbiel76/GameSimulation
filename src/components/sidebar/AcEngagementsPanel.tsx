import { ShieldCheck, Crosshair } from "@phosphor-icons/react";
import AcLeftHeader from "./AcLeftHeader";
import { computeUnitPotential } from "../../utils/combatPotential";
import { readinessOf } from "../../utils/readiness";
import { terrainForRole, type UnitTerrainProfile } from "../../utils/terrainProfile";
import type { Unit } from "../../types/map";
import type { EngagementInfo } from "../../hooks/useLocalSimulation";

/**
 * Zakładka „Starcia" — 1:1 z makietą (sekcja `<!-- STARCIA -->`).
 *
 * Odstępstwo wymuszone modelem: makieta zna wyłącznie starcia 1 vs 1
 * (`e.aName` / `e.bName`). Realny silnik grupuje jednostki w grupy bojowe
 * (BFS po spójnych składowych nakładających się AO), więc po każdej stronie
 * może stać kilka jednostek. Nazwy są wtedy łączone, a paski i przewaga liczone
 * dla całej strony — układ karty pozostaje bez zmian.
 */

const TERRAIN_PL: Record<string, string> = {
  open: "Otwarty", road: "Droga", urban: "Zabudowa",
  forest: "Las", wetland: "Bagno", water: "Rzeka",
};

type Props = {
  engagements: EngagementInfo[];
  units: Unit[];
  terrainByUnitId: Map<string, string>;
  /** Profile terenu z backendu — potencjał liczony z rozkładu terenu. */
  terrainProfiles?: Map<string, UnitTerrainProfile>;
  onCollapse?: () => void;
  onFocusUnit?: (id: string) => void;
};

export default function AcEngagementsPanel({
  engagements, units, terrainByUnitId, terrainProfiles, onCollapse, onFocusUnit,
}: Props) {
  const byId = new Map(units.map(u => [u.id, u]));

  const namesOf = (ids: string[]) =>
    ids.map(id => byId.get(id)?.symbol_name ?? id).join(", ");

  /** Średnia gotowość strony — to samo, co pasek w drzewie sił. */
  const readyOf = (ids: string[]) => {
    const vals = ids.map(id => byId.get(id)).filter((u): u is Unit => !!u).map(readinessOf)
      .filter((v): v is number => v !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  /** Łączny potencjał efektywny strony — z tego samego modelu co symulacja. */
  const potentialOf = (ids: string[]) =>
    ids.reduce((acc, id) => {
      const u = byId.get(id);
      if (!u) return acc;
      const t = terrainForRole(terrainProfiles?.get(id), "neutral", terrainByUnitId.get(id));
      return acc + computeUnitPotential(u as never, t).breakdown.effectivePotential;
    }, 0);

  /** Odległość między środkami ciężkości stron [km]. */
  const distanceKm = (a: string[], b: string[]) => {
    const centroid = (ids: string[]) => {
      const us = ids.map(id => byId.get(id)).filter((u): u is Unit => !!u);
      if (!us.length) return null;
      return [
        us.reduce((s, u) => s + u.x, 0) / us.length,
        us.reduce((s, u) => s + u.y, 0) / us.length,
      ] as [number, number];
    };
    const ca = centroid(a), cb = centroid(b);
    if (!ca || !cb) return null;
    // EPSG:3857 — metry (zniekształcone szerokością, dla dystansów taktycznych OK).
    return Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) / 1000;
  };

  return (
    <>
      <AcLeftHeader title="Aktywne starcia" count={engagements.length} onCollapse={onCollapse} />
      <div className="ac-left-body">
        <div className="ac-eng">
          {engagements.length === 0 && (
            <div className="ac-empty">
              <ShieldCheck size={26} />
              <div className="ac-empty-title">Brak aktywnych starć</div>
              <div className="ac-empty-hint">Uruchom symulację, by jednostki weszły w kontakt</div>
            </div>
          )}

          {engagements.map(e => {
            const fPot = potentialOf(e.friendlyUnitIds);
            const hPot = potentialOf(e.hostileUnitIds);
            const advF = fPot > hPot;
            const ratio = fPot / Math.max(1e-6, hPot);
            const adv =
              Math.abs(ratio - 1) < 0.2 ? "równowaga"
                : advF ? "sojusznicze" : "przeciwnika";
            const advColor =
              Math.abs(ratio - 1) < 0.2 ? "#c9c5bf" : advF ? "#7fb0dd" : "#d9635a";
            const dist = distanceKm(e.friendlyUnitIds, e.hostileUnitIds);
            const terr = TERRAIN_PL[terrainByUnitId.get(e.friendlyUnitIds[0]) ?? "open"] ?? "Otwarty";

            return (
              <button
                key={e.key}
                className="ac-eng-card"
                onClick={() => onFocusUnit?.(e.friendlyUnitIds[0])}
              >
                <div className="ac-eng-head">
                  <Crosshair size={13} />
                  <span className="ac-eng-tag">KONTAKT</span>
                  <div className="ac-left-spacer" />
                  <span className="ac-eng-dist">{dist != null ? dist.toFixed(1) : "—"} km</span>
                </div>

                <div className="ac-eng-sides">
                  <div className="ac-eng-side">
                    <div className="ac-eng-name f">{namesOf(e.friendlyUnitIds)}</div>
                    <div className="ac-eng-barrow">
                      <span className="ac-eng-bar">
                        <span style={{ width: `${readyOf(e.friendlyUnitIds)}%`, background: "#7fb0dd" }} />
                      </span>
                      <span className="ac-eng-pct">{readyOf(e.friendlyUnitIds)}%</span>
                    </div>
                  </div>

                  <span className="ac-eng-vs">vs</span>

                  <div className="ac-eng-side">
                    <div className="ac-eng-name h">{namesOf(e.hostileUnitIds)}</div>
                    <div className="ac-eng-barrow">
                      <span className="ac-eng-pct">{readyOf(e.hostileUnitIds)}%</span>
                      <span className="ac-eng-bar">
                        <span style={{ width: `${readyOf(e.hostileUnitIds)}%`, background: "#d9635a" }} />
                      </span>
                    </div>
                  </div>
                </div>

                <div className="ac-eng-foot">
                  <span className="ac-eng-foot-label">Przewaga</span>
                  <span className="ac-eng-adv" style={{ color: advColor }}>{adv}</span>
                  <div className="ac-left-spacer" />
                  <span className="ac-eng-terrain">{terr}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
