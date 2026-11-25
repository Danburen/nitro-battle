import { provinceResourceOutput } from "../game/economy.ts";
import { RESOURCE_DEPOSIT_MAX_LEVEL } from "../game/types/economy.ts";
import type { GameState } from "../game/types/state.ts";
import type { Province } from "../game/types/entities.ts";

/** Legend colours shared by the resource map, markers and settings note. */
export const RESOURCE_MAP_COLORS = {
    raw: "#c9a227",
    food: "#8fd46a",
    strategic: "#e07a9c",
    mixed: "#c98fd0",
} as const;

export interface ResourceTint {
    readonly color: string;
    readonly alpha: number;
}

/** Province fill for the resource colour mode; minerals dominate, farms stay a soft green. */
export function resourceTint(state: GameState, province: Province): ResourceTint {
    const { food, farmFood } = provinceResourceOutput(state, province);
    const rawLevel = province.deposits.raw;
    const strategicLevel = province.deposits.strategic;
    if (rawLevel > 0 || strategicLevel > 0) {
        const strength = Math.min(1, Math.max(rawLevel, strategicLevel) / RESOURCE_DEPOSIT_MAX_LEVEL);
        const color = rawLevel > 0 && strategicLevel > 0
            ? RESOURCE_MAP_COLORS.mixed
            : rawLevel > 0 ? RESOURCE_MAP_COLORS.raw : RESOURCE_MAP_COLORS.strategic;
        return { color, alpha: 0.42 + 0.26 * strength };
    }
    // Every province grows some food; only state centers with farms stand out.
    return { color: RESOURCE_MAP_COLORS.food, alpha: Math.min(0.34, 0.14 + (food + farmFood) * 0.035) };
}
