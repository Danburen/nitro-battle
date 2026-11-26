/** State/province buildings, their stat tables and construction orders. */

import { t } from "../../i18n/index.ts";

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
    factory: {
        get name() { return t("game.types.building.factory.name"); },
        get glyph() { return t("game.types.building.factory.glyph"); },
        icon: "building-factory", scope: "state", costFunds: 180, costIndustry: 30, constructionPoints: 8,
        get desc() { return t("game.types.building.factory.desc"); },
    },
    farm: {
        get name() { return t("game.types.building.farm.name"); },
        get glyph() { return t("game.types.building.farm.glyph"); },
        icon: "building-farm", scope: "state", costFunds: 80, costIndustry: 15, constructionPoints: 4,
        get desc() { return t("game.types.building.farm.desc"); },
    },
    infrastructure: {
        get name() { return t("game.types.building.infrastructure.name"); },
        get glyph() { return t("game.types.building.infrastructure.glyph"); },
        icon: "building-infrastructure", scope: "state", costFunds: 80, costIndustry: 15, constructionPoints: 5,
        get desc() { return t("game.types.building.infrastructure.desc"); },
    },
    admin: {
        get name() { return t("game.types.building.admin.name"); },
        get glyph() { return t("game.types.building.admin.glyph"); },
        icon: "building-admin", scope: "state", costFunds: 100, costIndustry: 15, constructionPoints: 6,
        get desc() { return t("game.types.building.admin.desc"); },
    },
    supply: {
        get name() { return t("game.types.building.supply.name"); },
        get glyph() { return t("game.types.building.supply.glyph"); },
        icon: "building-supply", scope: "province", costFunds: 250, costIndustry: 40, constructionPoints: 30,
        get desc() { return t("game.types.building.supply.desc"); },
    },
    fort: {
        get name() { return t("game.types.building.fort.name"); },
        get glyph() { return t("game.types.building.fort.glyph"); },
        icon: "building-fort", scope: "province", costFunds: 120, costIndustry: 15, constructionPoints: 8,
        get desc() { return t("game.types.building.fort.desc"); },
    },
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
