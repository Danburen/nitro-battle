/** Calendar, world-wide sentinels and their display data. */

export interface Season {
    readonly name: string;
    readonly value: number;
}

export const SEASONS: readonly Season[] = [
    { name: "春季", value: 0.1 },
    { name: "夏季", value: 0.9 },
    { name: "秋季", value: 0.2 },
    { name: "冬季", value: -0.9 },
];

export const DAYS_PER_SEASON = 8;

/** Nation id used for unowned/neutral land. */
export const NEUTRAL = -1;
export const NEUTRAL_COLOR = "#6e7781";
