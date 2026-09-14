import { UNIT_CHILDREN as CANONICAL_UNIT_CHILDREN } from "../utils/hierarchyVisibility";

// eager:true jest tu świadomym wyborem — katalog to ~270 plików PNG (≈4 MB) i tyle samo
// modułów w grafie Vite. Wersja leniwa zwracałaby `() => Promise<string>`, co zerwałoby
// synchroniczne `getSymbolUrl()` używane w funkcjach stylu OpenLayers (te muszą być sync).
// Jeśli katalog urośnie o rząd wielkości, właściwym ruchem jest przeniesienie ikon
// do `public/APP-6A/` i budowanie URL-a ze stringa — wtedy zero modułów i zero kosztu builda.
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

// UWAGA: UNIT_HIERARCHY_ORDER i UNIT_CHILDREN były tu zdefiniowane po raz drugi,
// w wersji sprzecznej z utils/hierarchyVisibility.ts:
//   • "Company_Battery"  zamiast "Company_Battery_Troop"  → szczebel nie pasował do nazw plików ikon
//   • Squad: null                                          → łańcuch podległości urywał się przed Team_Crew
// Kanoniczna definicja żyje w utils/hierarchyVisibility.ts (tej używa App.tsx).
// Re-eksport zachowany dla zgodności ścieżek importu.
export { UNIT_HIERARCHY_ORDER, UNIT_CHILDREN } from "../utils/hierarchyVisibility";

const UNIT_SIZE_BY_ID = new Map(UNIT_SIZES.map((s) => [s.id, s]));

export function getUnitSizeLabel(sizeId: string) {
  return UNIT_SIZE_BY_ID.get(sizeId)?.label ?? sizeId;
}

export function buildUnitHierarchy(sizeId: string): UnitHierarchyNode | null {
  if (!sizeId || sizeId === "Unspecified") return null;

  const childId = CANONICAL_UNIT_CHILDREN[sizeId];

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

/**
 * Indeks id → wpis. Wcześniej `getSymbolUrl` i `resolveSymbolForSize` robiły
 * `Array.find` po całym katalogu — wołane per jednostka per render warstwy mapy
 * i w funkcji stylu OpenLayers. Teraz O(1).
 */
const SYMBOL_BY_ID = new Map(symbolCatalog.map((s) => [s.id, s]));

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

  return SYMBOL_BY_ID.get(targetId) ?? null;
}

export function getSymbolUrl(symbolId: string): string {
  return SYMBOL_BY_ID.get(symbolId)?.url || "";
}
