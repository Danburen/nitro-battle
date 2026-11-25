/** State/province buildings, their stat tables and construction orders. */

export type StateBuildingKind = "factory" | "farm" | "infrastructure" | "admin";
export type ProvinceBuildingKind = "supply" | "fort";
export type BuildingKind = StateBuildingKind | ProvinceBuildingKind;

export interface BuildingProfile {
    readonly name: string;
    /** Compact monochrome text token for canvas map labels. */
    readonly glyph: string;
    /** SVG artwork in public/assets/icons/, rendered through iconMaskStyle. */
    readonly icon: string;
    readonly scope: "state" | "province";
    readonly costFunds: number;
    readonly costIndustry: number;
    readonly constructionPoints: number;
    readonly desc: string;
}

export const BUILDING_PROFILES: Readonly<Record<BuildingKind, BuildingProfile>> = {
    factory: { name: "工厂", glyph: "工", icon: "building-factory", scope: "state", costFunds: 180, costIndustry: 30, constructionPoints: 8, desc: "[[production]][[funds]]/[[industry]]，或[[idle]]参与施工；上限为州内省份数" },
    farm: { name: "农场", glyph: "农", icon: "building-farm", scope: "state", costFunds: 80, costIndustry: 15, constructionPoints: 4, desc: "州中心 [[funds:+2]]、[[food:+0.5]]/回合；上限为州内省份数" },
    infrastructure: { name: "基础设施", glyph: "基", icon: "building-infrastructure", scope: "state", costFunds: 80, costIndustry: 15, constructionPoints: 5, desc: "提升全州[[factory]]产出、施工、[[movement]]及[[supply]]效率，最多 8 级" },
    admin: { name: "行政中心", glyph: "政", icon: "building-admin", scope: "state", costFunds: 100, costIndustry: 15, constructionPoints: 6, desc: "州中心为核心或[[occupation]] ≥50% 时 [[politics:+1]]/回合；每州一个" },
    supply: { name: "补给中心", glyph: "补", icon: "building-supply", scope: "province", costFunds: 250, costIndustry: 40, constructionPoints: 30, desc: "核心或[[occupation]] ≥50% 时提供范围 8 的[[supply]]源与衰减增益；每省一个，不叠加" },
    fort: { name: "要塞", glyph: "防", icon: "building-fort", scope: "province", costFunds: 120, costIndustry: 15, constructionPoints: 8, desc: "本省[[garrison]]容量 +50%、每日恢复 15%、伤害 +25%、承伤 ×0.8；每省一个" },
};

export const STATE_BUILDING_KINDS: readonly StateBuildingKind[] = ["factory", "farm", "infrastructure", "admin"];
export const PROVINCE_BUILDING_KINDS: readonly ProvinceBuildingKind[] = ["supply", "fort"];
export const BUILDING_KINDS: readonly BuildingKind[] = [...STATE_BUILDING_KINDS, ...PROVINCE_BUILDING_KINDS];
export const INFRASTRUCTURE_MAX = 8;

export interface ConstructionOrder {
    readonly id: number;
    readonly nation: number;
    /** State center for state buildings; local province for supply/fort. */
    readonly site: number;
    readonly kind: BuildingKind;
    remainingPoints: number;
    readonly paidFunds: number;
    readonly paidIndustry: number;
}
