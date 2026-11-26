/** Calendar, world-wide sentinels and their display data. */

import { t } from "../../i18n/index.ts";

export interface Season {
    readonly name: string;
    readonly value: number;
}

export const SEASONS: readonly Season[] = [
    { get name() { return t("game.types.world.spring"); }, value: 0.1 },
    { get name() { return t("game.types.world.summer"); }, value: 0.9 },
    { get name() { return t("game.types.world.autumn"); }, value: 0.2 },
    { get name() { return t("game.types.world.winter"); }, value: -0.9 },
];

export const DAYS_PER_SEASON = 8;

/** Nation id used for unowned/neutral land. */
export const NEUTRAL = -1;
export const NEUTRAL_COLOR = "#6e7781";
