/**
 * Utility for hierarchical unit visibility based on zoom level.
 */

export const UNIT_HIERARCHY_ORDER = [
  "Region_Theater",
  "Army_Group_Front",
  "Army",
  "Corps_MEF",
  "Division",
  "Brigade",
  "Regiment_Group",
  "Battalion_Squadron",
  "Company_Battery_Troop",
  "Platoon_Detachment",
  "Section",
  "Squad",
  "Team_Crew",
];

export const UNIT_CHILDREN: Record<string, string | null> = {
  Region_Theater: "Army_Group_Front",
  Army_Group_Front: "Army",
  Army: "Corps_MEF",
  Corps_MEF: "Division",
  Division: "Brigade",
  Brigade: "Regiment_Group",
  Regiment_Group: "Battalion_Squadron",
  Battalion_Squadron: "Company_Battery_Troop",
  Company_Battery_Troop: "Platoon_Detachment",
  Platoon_Detachment: "Section",
  Section: "Squad",
  Squad: "Team_Crew",
  Team_Crew: null,
};

/**
 * Returns list of echelons that should be primary (fully visible) at this zoom.
 */
export function getVisibleEchelonsForZoom(zoom: number): string[] {
  // Relaxed zoom levels for better visibility of large units
  let visibleEchelons: string[] = [];
  if (zoom <= 9) visibleEchelons.push("Region_Theater", "Army_Group_Front", "Army");
  if (zoom > 9 && zoom <= 10) visibleEchelons.push("Corps_MEF", "Division");
  if (zoom > 10 && zoom <= 11) visibleEchelons.push("Brigade");
  if (zoom > 11 && zoom <= 12) visibleEchelons.push("Regiment_Group");
  if (zoom > 12 && zoom <= 13) visibleEchelons.push("Battalion_Squadron");
  if (zoom > 13 && zoom <= 14) visibleEchelons.push("Company_Battery_Troop");
  if (zoom > 14 && zoom <= 15) visibleEchelons.push("Platoon_Detachment");
  if (zoom > 15 && zoom <= 16) visibleEchelons.push("Section");
  if (zoom > 16 && zoom <= 17) visibleEchelons.push("Squad");
  if (zoom > 17) visibleEchelons.push("Team_Crew");
  return visibleEchelons;
}

/**
 * Predicate to check if a unit should be visible.
 */

function getLastEchelon(symbolId: string): string {
  return symbolId.split("__").at(-1) ?? "";
}

export function shouldShowUnitAtZoom(
  symbolId: string,
  zoom: number,
  isHierarchical: boolean = true,
  isSelected: boolean = false
): boolean {
  if (!isHierarchical) return true;
  if (isSelected) return true;
  const visibleEchelons = getVisibleEchelonsForZoom(zoom);
  const echelon = getLastEchelon(symbolId);

  // Case insensitive check just in case
  if (!echelon) return true; // Show if echelon unknown? Or false? Let's do true for now to avoid disappearing units.
  return visibleEchelons.some(v => v.toLowerCase() === echelon.toLowerCase());
}

/**
 * Predicate to check if an area should be visible.
 */
export function shouldShowAreaAtZoom(
  unitEchelon: string,
  zoom: number,
  isHierarchical: boolean = true,
  isSelected: boolean = false
): boolean {
  if (!isHierarchical) return true;
  if (isSelected) return true;
  if (!unitEchelon) return true;

  const visibleEchelons = getVisibleEchelonsForZoom(zoom);
  const normalizedEchelon = unitEchelon.toLowerCase();

  // Active echelon areas
  if (visibleEchelons.some(v => v.toLowerCase() === normalizedEchelon)) return true;

  // Immediate parent areas (as context)
  const parentEchelon = Object.keys(UNIT_CHILDREN).find(key =>
    UNIT_CHILDREN[key]?.toLowerCase() === normalizedEchelon
  );
  if (parentEchelon && visibleEchelons.some(v => v.toLowerCase() === parentEchelon.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Returns opacity and border style for an area based on hierarchy.
 */
export function getAreaStyleProps(
  unitEchelon: string,
  zoom: number,
  isHierarchical: boolean = true,
  isSelected: boolean = false
) {
  if (!isHierarchical) return { opacity: 0.18, borderDash: null };
  // Selected area is always prominent
  if (isSelected) return { opacity: 0.25, borderDash: null };
  if (!unitEchelon) return { opacity: 0.18, borderDash: null };

  const visibleEchelons = getVisibleEchelonsForZoom(zoom);
  const normalizedEchelon = unitEchelon.toLowerCase();

  // Active: current visible echelon
  if (visibleEchelons.some(v => v.toLowerCase() === normalizedEchelon)) {
    return { opacity: 0.18, borderDash: null };
  }

  // Context: immediate parent of current visible echelons
  const isParentOfVisible = visibleEchelons.some(e =>
    UNIT_CHILDREN[normalizedEchelon]?.toLowerCase() === e.toLowerCase() ||
    Object.keys(UNIT_CHILDREN).find(key => UNIT_CHILDREN[key]?.toLowerCase() === normalizedEchelon)?.toLowerCase() === e.toLowerCase()
  );

  // Simplified parent check: if the unitEchelon is the parent of any currently visible echelon
  const anyVisibleIsChild = visibleEchelons.some(v =>
    UNIT_CHILDREN[unitEchelon]?.toLowerCase() === v.toLowerCase()
  );

  if (anyVisibleIsChild) {
    return { opacity: 0.08, borderDash: [5, 5] };
  }

  return { opacity: 0, borderDash: null };
}
