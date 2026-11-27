import { Biome } from "../game/terrain/biome.ts";
import { NEUTRAL, NEUTRAL_COLOR } from "../game/types/world.ts";
import { ORG_MAX } from "../game/types/organization.ts";
import type { GameState } from "../game/types/state.ts";
import { nationDisplayColor } from "../game/access.ts";
import { isAtWar } from "../game/diplomacy.ts";
import { t } from "../i18n/index.ts";
import type { RelationTone } from "./text.ts";

export const BIOME_ZH: Readonly<Record<number, string>> = {
    get [Biome.OCEAN]() { return t("misc.biome.ocean"); },
    get [Biome.BEACH]() { return t("misc.biome.beach"); },
    get [Biome.DESERT]() { return t("misc.biome.desert"); },
    get [Biome.BARE]() { return t("misc.biome.bare"); },
    get [Biome.PLAINS]() { return t("misc.biome.plains"); },
    get [Biome.FOREST]() { return t("misc.biome.forest"); },
    get [Biome.MARSH]() { return t("misc.biome.marsh"); },
    get [Biome.HILLS]() { return t("misc.biome.hills"); },
    get [Biome.MOUNTAINS]() { return t("misc.biome.mountains"); },
    get [Biome.TUNDRA]() { return t("misc.biome.tundra"); },
    get [Biome.ICE]() { return t("misc.biome.ice"); },
    get [Biome.LAKE]() { return t("misc.biome.lake"); },
};

export function ownerName(state: GameState, owner: number): string {
    return owner === NEUTRAL ? t("misc.common.neutral") : state.nations[owner].name;
}

export function ownerColor(state: GameState, owner: number): string {
    return owner === NEUTRAL ? NEUTRAL_COLOR : nationDisplayColor(state, owner);
}

export function garrisonRelation(state: GameState, owner: number): RelationTone {
    if (owner === 0) return "friendly";
    if (owner === NEUTRAL) return "neutral";
    return isAtWar(state, 0, owner) ? "hostile" : "neutral";
}

export function orgClass(org: number): string {
    return org <= 30 ? "low" : org <= 60 ? "mid" : "";
}

export function orgPct(org: number): number {
    return Math.max(0, Math.min(100, (org / ORG_MAX) * 100));
}
