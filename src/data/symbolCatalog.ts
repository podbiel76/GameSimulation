const modules: Record<string, string> = import.meta.glob(
  "../assets/APP-6A/*.png",
  { eager: true, import: "default" }
) as Record<string, string>;

export type SymbolEntry = {
  id: string;
  label: string;
  url: string;
  category: string;
  size: string;
  isEnemy: boolean;
};

/**
 * All APP-6A unit sizes in hierarchical order (largest → smallest).
 * `indicator` is the NATO echelon symbol displayed above the icon.
 */
export type UnitSize = {
  id: string;        // matches filename suffix, e.g. "Army_Group_Front"
  label: string;     // human-readable, e.g. "Army Group / Front"
  indicator: string; // NATO echelon indicator characters
};

export const UNIT_SIZES: UnitSize[] = [
  { id: "Region_Theater", label: "Region / Theater", indicator: "XXXXX" },
  { id: "Army_Group_Front", label: "Army Group / Front", indicator: "XXXXXX" },
  { id: "Army", label: "Army", indicator: "XXXX" },
  { id: "Corps_MEF", label: "Corps / MEF", indicator: "XXX" },
  { id: "Division", label: "Division", indicator: "XX" },
  { id: "Brigade", label: "Brigade", indicator: "X" },
  { id: "Regiment_Group", label: "Regiment / Group", indicator: "III" },
  { id: "Battalion_Squadron", label: "Battalion / Squadron", indicator: "II" },
  { id: "Company_Battery_Troop", label: "Company / Battery", indicator: "I" },
  { id: "Platoon_Detachment", label: "Platoon / Detachment", indicator: "• • •" },
  { id: "Section", label: "Section", indicator: "• •" },
  { id: "Squad", label: "Squad", indicator: "•" },
  { id: "Team_Crew", label: "Team / Crew", indicator: "⊘" },
  { id: "Unspecified", label: "Unspecified", indicator: "—" },
];

export type UnitHierarchyNode = {
  id: string;
  label: string;
  children?: UnitHierarchyNode[];
};

export const UNIT_HIERARCHY_ORDER = [
  "Region_Theater",
  "Army_Group_Front",
  "Army",
  "Corps_MEF",
  "Division",
  "Brigade",
  "Regiment_Group",
  "Battalion_Squadron",
  "Company_Battery",
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
  Squad: null,
};

export function getUnitSizeLabel(sizeId: string) {
  return UNIT_SIZES.find((s) => s.id === sizeId)?.label ?? sizeId;
}

export function buildUnitHierarchy(sizeId: string): UnitHierarchyNode | null {
  if (!sizeId || sizeId === "Unspecified") return null;

  const childId = UNIT_CHILDREN[sizeId];

  const node: UnitHierarchyNode = {
    id: sizeId,
    label: getUnitSizeLabel(sizeId),
  };

  if (!childId) return node;

  node.children = [
    buildUnitHierarchy(childId),
    buildUnitHierarchy(childId),
  ].filter(Boolean) as UnitHierarchyNode[];

  return node;
}

export function parseFilename(filename: string): {
  category: string;
  size: string;
  isEnemy: boolean;
} {
  let name = filename.replace(/\.png$/, "");
  const isEnemy = name.startsWith("EN_");
  if (isEnemy) name = name.slice(3);

  const parts = name.split("__");
  const category = (parts[1] || "Unknown").replace(/_/g, " ");
  const size = (parts[2] || "Unknown").replace(/_/g, " ");

  return { category, size, isEnemy };
}

export const symbolCatalog: SymbolEntry[] = Object.entries(modules).map(
  ([path, url]) => {
    const filename = path.split("/").pop() || "";
    const { category, size, isEnemy } = parseFilename(filename);
    const id = filename.replace(/\.png$/, "");
    return { id, label: `${isEnemy ? "🔴" : "🔵"} ${category} — ${size}`, url, category, size, isEnemy };
  }
);

/** Curated subset: one icon per type at "Unspecified" size. */
export const curatedSymbols: SymbolEntry[] = symbolCatalog.filter(
  (s) => s.size === "Unspecified"
);

/**
 * Returns unique categories (unit types) with one representative icon each.
 * Groups by (category + isEnemy) so friendly and enemy types are separate.
 */
export function getUniqueCategories(): { category: string; isEnemy: boolean; sampleUrl: string; sampleId: string }[] {
  const seen = new Map<string, { category: string; isEnemy: boolean; sampleUrl: string; sampleId: string }>();
  for (const sym of symbolCatalog) {
    if (sym.size !== "Unspecified") continue;
    const key = `${sym.isEnemy ? "EN_" : ""}${sym.category}`;
    if (!seen.has(key)) {
      seen.set(key, {
        category: sym.category,
        isEnemy: sym.isEnemy,
        sampleUrl: sym.url,
        sampleId: sym.id,
      });
    }
  }
  return Array.from(seen.values());
}

/**
 * Given a symbol ID at any size, find the same unit type at a different size.
 * E.g. "Land_unit__Infantry__Unspecified" + size "Division" → "Land_unit__Infantry__Division"
 */
export function resolveSymbolForSize(baseSymbolId: string, sizeId: string): SymbolEntry | null {
  // Extract the prefix: everything before the last "__XYZ" part
  const lastDunder = baseSymbolId.lastIndexOf("__");
  if (lastDunder === -1) return null;

  const prefix = baseSymbolId.substring(0, lastDunder);
  const targetId = `${prefix}__${sizeId}`;

  return symbolCatalog.find((s) => s.id === targetId) ?? null;
}

export function getSymbolUrl(symbolId: string): string {
  return symbolCatalog.find((s) => s.id === symbolId)?.url || "";
}
