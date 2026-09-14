/**
 * Skrócone oznaczenie jednostki do podpisów na mapie (trasy, AO):
 *   „7 kppanc" — 7. kompania przeciwpancerna,
 *   „12 BZ"    — 12. Brygada Zmechanizowana.
 * Szczeble od brygady w górę pisane wielką literą (jak w oznaczeniach WP).
 */

/** Skrót szczebla. */
const ECHELON_ABBR: Record<string, string> = {
  Region_Theater: "T",
  Army_Group_Front: "F",
  Army: "A",
  Corps_MEF: "K",
  Division: "D",
  Brigade: "B",
  Regiment_Group: "p",
  Battalion_Squadron: "b",
  Company_Battery_Troop: "k",
  Platoon_Detachment: "pl",
  Section: "sek",
  Squad: "dr",
  Team_Crew: "zał",
};

/** Skrót rodzaju wojsk: [niższe szczeble, brygada i wyżej]. */
const TYPE_ABBR: Record<string, [string, string]> = {
  Infantry: ["piech", "P"],
  Motorized: ["zmot", "Zmot"],
  Armored: ["panc", "Panc"],
  Armor_Mechanized: ["zmech", "Z"],
  Armored_Mechanized_Tracked: ["zmech", "Z"],
  Antitank_Antiarmor: ["ppanc", "PPanc"],
  Field_Artillery: ["a", "A"],
  Combined_Arms: ["ogw", "O"],
  Chemical_Biological_Radiological_Nuclear_Defense: ["chem", "Chem"],
};

const HIGH_ECHELONS = new Set(["Region_Theater", "Army_Group_Front", "Army", "Corps_MEF", "Division", "Brigade"]);

type LabelSource = {
  symbol_id: string;
  echelon?: string | null;
  unit_number?: number | null;
  custom_name?: string | null;
};

export function unitShortLabel(u: LabelSource): string {
  // symbol_id: [EN_]Land_unit__<Rodzaj>__<Szczebel>
  const parts = u.symbol_id.replace(/^EN_/, "").split("__");
  const typeKey = parts[1] ?? "";
  const echelon = u.echelon && u.echelon !== "Unspecified" ? u.echelon : (parts[2] ?? "");

  const high = HIGH_ECHELONS.has(echelon);
  const ech = ECHELON_ABBR[echelon] ?? "";
  const type = TYPE_ABBR[typeKey]?.[high ? 1 : 0] ?? "";
  const abbr = `${ech}${type}` || u.custom_name?.trim() || typeKey.replace(/_/g, " ");

  return u.unit_number ? `${u.unit_number} ${abbr}` : abbr;
}

/** Kolor strony jako „r, g, b" — zgodny z --side-friendly / --side-hostile. */
export function sideRgb(side: string | undefined, destroyed = false): string {
  if (destroyed) return "107, 114, 128";
  if (side === "friendly") return "127, 176, 221";
  if (side === "hostile") return "217, 99, 90";
  return "148, 163, 184";
}
