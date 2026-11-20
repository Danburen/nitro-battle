import { Biome } from "../terrain/biome.ts";
import { NEUTRAL, NEUTRAL_COLOR, ORG_MAX } from "../game/types.ts";
import type { Army, GameState } from "../game/types.ts";
import { isAtWar } from "../game/diplomacy.ts";
import type { RelationTone } from "./text.ts";

export const BIOME_ZH: Readonly<Record<number, string>> = {
    [Biome.OCEAN]: "海洋",
    [Biome.BEACH]: "海滩",
    [Biome.DESERT]: "沙漠",
    [Biome.BARE]: "荒地",
    [Biome.PLAINS]: "平原",
    [Biome.FOREST]: "森林",
    [Biome.MARSH]: "沼泽",
    [Biome.HILLS]: "丘陵",
    [Biome.MOUNTAINS]: "山地",
    [Biome.TUNDRA]: "苔原",
    [Biome.ICE]: "冰原",
    [Biome.LAKE]: "湖泊",
};

export function ownerName(state: GameState, owner: number): string {
    return owner === NEUTRAL ? "中立" : state.nations[owner].name;
}

export function ownerColor(state: GameState, owner: number): string {
    return owner === NEUTRAL ? NEUTRAL_COLOR : state.nations[owner].color;
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

export function statusPill(state: GameState, army: Army, short: boolean): string {
    const battle = state.battles.some(
        (entry) => entry.attackerId === army.id || entry.defenderId === army.id,
    );
    if (battle) return `<span class="status-pill war">${short ? "激战" : "激战中"}</span>`;
    if (army.march) {
        const target = state.provinces[army.march.target].name;
        return short
            ? `<span class="status-pill idle" title="${army.march.attack ? "远征" : "行军"}→${target}">${army.march.attack ? "远征" : "行军"}→${target}</span>`
            : `<span class="status-pill idle">${army.march.attack ? "远征" : "行军中"}→${target}</span>`;
    }
    if (army.acted) return `<span class="status-pill spent">已行动</span>`;
    return `<span class="status-pill ready">待命</span>`;
}