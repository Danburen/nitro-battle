/** Unit kinds and their stat tables. No game state, no behaviour. */

export const UnitKind = {
    INFANTRY: 0,
    TANK: 1,
    ARTILLERY: 2,
} as const;

export type UnitKind = (typeof UnitKind)[keyof typeof UnitKind];

export interface UnitProfile {
    readonly name: string;
    readonly glyph: string;
    readonly cost: number;
    readonly manpowerCost: number;
    readonly industryCost: number;
    readonly trainDays: number;
    readonly upkeep: number;
    readonly mp: number;
    readonly atk: number;
    readonly def: number;
    readonly desc: string;
}

export const UNIT_PROFILES: Readonly<Record<UnitKind, UnitProfile>> = {
    [UnitKind.INFANTRY]: {
        name: "步兵",
        glyph: "✕",
        cost: 100,
        manpowerCost: 100,
        industryCost: 0,
        trainDays: 1,
        upkeep: 1,
        mp: 3,
        atk: 4,
        def: 3,
        desc: "廉价主力，消耗[[garrison]]与巩固战线",
    },
    [UnitKind.TANK]: {
        name: "坦克",
        glyph: "▭",
        cost: 300,
        manpowerCost: 80,
        industryCost: 30,
        trainDays: 2,
        upkeep: 3,
        mp: 5,
        atk: 7,
        def: 5,
        desc: "高机动突击力量，[[attack]]与[[defense]]均衡",
    },
    [UnitKind.ARTILLERY]: {
        name: "火炮",
        glyph: "●",
        cost: 250,
        manpowerCost: 60,
        industryCost: 20,
        trainDays: 2,
        upkeep: 2,
        mp: 2,
        atk: 9,
        def: 2,
        desc: "攻坚火力，对高[[garrison]]省份加成显著，但拖慢军团行军",
    },
};

export const UNIT_KINDS: readonly UnitKind[] = [
    UnitKind.INFANTRY,
    UnitKind.TANK,
    UnitKind.ARTILLERY,
];

export const MAX_HP = 10;
/** Regiments one army (军团) may hold. */
export const REGIMENT_CAP = 12;
export const DEPLOY_REFUND = 0.5;
export const BUILD_REFUND = 0.5;
