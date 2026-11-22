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
 * Six 1–5 axes. They never change the rules; they only shift decision
 * thresholds and the dice the controller rolls.
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
    /**
     * 1–5, 3 neutral. Only read while the nation is a vassal; the generated
     * world adds a seeded ±1 jitter per nation and stores it on `Nation`.
     */
    readonly subservience: number;
}

/**
 * Vassal-only thresholds derived from subservience and the contract type.
 * Non-vassals never read these fields.
 */
export interface VassalTuning {
    /** Independence change per day; positive drifts toward revolt. */
    readonly independenceDrift: number;
    /** Daily probability that a manually-freeing vassal spends PP on independence. */
    readonly raiseIndependenceWill: number;
    /** Share of the nominal resource tribute actually paid (0.8–1.2). */
    readonly tributeCompliance: number;
    /** Chance an AI vassal answers an overlord's call to arms. */
    readonly callToArmsAccept: number;
    /** 0–1 trust used by upgrade and downgrade decisions. */
    readonly overlordTrust: number;
    /** 0–1 weight for defecting to a third party at high independence. */
    readonly defectRisk: number;
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
