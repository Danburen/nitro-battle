import type { GameState, ProvinceBuildingKind, StateBuildingKind, UnitKind } from "../types.ts";

/**
 * Extension point for computer opponents. The engine runs every non-player
 * nation through its controller at end of turn and applies the returned
 * actions through the same validation path as player commands.
 */
export interface AIController {
    readonly nationId: number;
    takeTurn(state: GameState): AIAction[];
}

export type AIAction =
    | { kind: "move"; armyId: number; to: number }
    | { kind: "attack"; armyId: number; target: number }
    | { kind: "march"; armyId: number; target: number; attack: boolean }
    | { kind: "train"; province: number | null; unitKind: UnitKind }
    | { kind: "build"; stateId: number; buildingKind: StateBuildingKind }
    | { kind: "provinceBuild"; site: number; buildingKind: ProvinceBuildingKind }
    | { kind: "factoryProduction"; prod: number };

/** One of the fixed AI temperaments; generated once and kept with the nation. */
export type AITendencyId =
    | "pacifist"
    | "defensive"
    | "bully"
    | "opportunist"
    | "hegemon"
    | "trader"
    | "ideologue"
    | "isolated"
    | "militarist";

/**
 * Five 1–5 axes. They never change the rules; they only shift decision
 * thresholds and the dice the controller rolls. Vassals read the very same
 * axes as everyone else — there is no separate subservience dimension.
 */
export interface AITendencyProfile {
    readonly id: AITendencyId;
    readonly name: string;
    /** One-line summary shown in the UI tooltip. */
    readonly blurb: string;
    /** 主动发动战争、先发制人的倾向。 */
    readonly aggression: number;
    /** 修建工事、维持守备军、反击入侵的倾向。 */
    readonly defense: number;
    /** 夺取领土、建立势力范围的欲望。 */
    readonly expansion: number;
    /** 寻求盟友、外交妥协的意愿。 */
    readonly alliance: number;
    /** 对长期战争、军备竞赛与冲突升级的接受程度。 */
    readonly warTolerance: number;
}

/**
 * Vassal-only thresholds derived from the nation's tendency axes and its
 * contract type. Non-vassals never read these fields.
 */
export interface VassalTuning {
    /** Non-negative passive independence growth per day, scaled by the contract cap. */
    readonly independenceDrift: number;
    /** Share of the nominal resource tribute actually paid (0.8–1.2). */
    readonly tributeCompliance: number;
    /** Base willingness (0–1) to answer an overlord's call to arms. */
    readonly callToArmsAccept: number;
    /** 0–1 readiness to flip to a stronger attacker when the overlord looks weak. */
    readonly flipWill: number;
    /** 0–1 willingness to seek a gentler contract; also gates upgrade acceptance. */
    readonly upgradeWill: number;
}

/**
 * Numeric knobs derived from the axes. Keeping the conversion in one place
 * makes the behaviour auditable and comparable in tests.
 */
export interface AITuning extends VassalTuning {
    /** Minimum attack/defense power ratio before a corps assaults. */
    readonly attackRatio: number;
    /** Corps below this organisation refits instead of attacking. */
    readonly attackMinOrg: number;
    /** Required power advantage before the nation declares war. */
    readonly warPowerRatio: number;
    /** Earliest turn the nation considers starting a war. */
    readonly warMinDay: number;
    /** War length after which the nation actively seeks peace. */
    readonly fatigueDays: number;
    /** Power ratio below the opponent at which peace is accepted. */
    readonly peacePowerRatio: number;
    /** Earliest war length before offering the player peace. */
    readonly offerMinDays: number;
    /** Power ratio below the player at which the AI offers peace. */
    readonly offerPowerRatio: number;
    /** 0–1 preference for forts and frontier works. */
    readonly fortAppetite: number;
}
