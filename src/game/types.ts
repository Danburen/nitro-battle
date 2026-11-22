import type { VoronoiGraph } from "../terrain/voronoi/index.ts";
import type { BiomeMap } from "../terrain/biome.ts";
import type { AITendencyId } from "./ai/types.ts";

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

export const ORG_MAX = 100;
/** Org of a freshly deployed army / newly merged regiments. */
export const DEPLOY_ORG = 50;
export const START_ORG = 80;
/** Org recovered per day at full supply. */
export const ORG_REGEN = 9;
/** An army at or below this org breaks off and retreats. */
export const ORG_BREAK = 15;
export const REDEPLOY_ORG = 20;

export const START_FUNDS = 300;
export const START_MANPOWER = 500;
export const START_INDUSTRY = 30;
export const START_PP = 20;
export const MANPOWER_BASE_CAP = 500;
export const MANPOWER_CAP_PER_POP = 5;
export const INDUSTRY_BASE_CAP = 100;
export const INDUSTRY_CAP_PER_CITY = 5;
export const PP_CAP = 100;
/** Upfront political points paid when a policy switch begins. */
export const POLICY_SWITCH_COST = 8;
/** Turns a policy switch takes before the new policy is committed. */
export const POLICY_SWITCH_DAYS = 3;
/** Daily political upkeep while a policy switch is in progress. */
export const POLICY_SWITCH_UPKEEP = 3;
export const UNPAID_UPKEEP_ORG_PENALTY = 5;
export const REINFORCE_MIN_SUPPLY = 0.5;

export const OCCUPATION_BASE_GROWTH = 4;
export const OCCUPATION_FACTOR_MIN = 0.25;

export const SUPPLY_RANGE_CAPITAL = 14;
export const SUPPLY_RANGE_CITY = 10;
export const SUPPLY_RANGE_CENTER = 8;
export const SUPPLY_ORG_MIN_FACTOR = 0.5;
export const SUPPLY_ATTACK_MIN_FACTOR = 0.8;

// ---- buildings ----

export type StateBuildingKind = "factory" | "farm" | "infrastructure" | "admin";
export type ProvinceBuildingKind = "supply" | "fort";
export type BuildingKind = StateBuildingKind | ProvinceBuildingKind;

export interface BuildingProfile {
    readonly name: string;
    readonly glyph: string;
    readonly scope: "state" | "province";
    readonly costFunds: number;
    readonly costIndustry: number;
    readonly constructionPoints: number;
    readonly desc: string;
}

export const BUILDING_PROFILES: Readonly<Record<BuildingKind, BuildingProfile>> = {
    factory: { name: "工厂", glyph: "🏭", scope: "state", costFunds: 180, costIndustry: 30, constructionPoints: 8, desc: "[[production]][[funds]]/[[industry]]，或[[idle]]参与施工；上限为州内省份数" },
    farm: { name: "农场", glyph: "🌾", scope: "state", costFunds: 80, costIndustry: 15, constructionPoints: 4, desc: "州中心 [[funds:+2]]、[[manpower:+0.5]]/回合；上限为州内省份数" },
    infrastructure: { name: "基础设施", glyph: "🏗️", scope: "state", costFunds: 80, costIndustry: 15, constructionPoints: 5, desc: "提升全州[[factory]]产出、施工、[[movement]]及[[supply]]效率，最多 8 级" },
    admin: { name: "行政中心", glyph: "🏛️", scope: "state", costFunds: 100, costIndustry: 15, constructionPoints: 6, desc: "州中心为核心或[[occupation]] ≥50% 时 [[politics:+1]]/回合；每州一个" },
    supply: { name: "补给中心", glyph: "📦", scope: "province", costFunds: 250, costIndustry: 40, constructionPoints: 30, desc: "核心或[[occupation]] ≥50% 时提供范围 8 的[[supply]]源与衰减增益；每省一个，不叠加" },
    fort: { name: "要塞", glyph: "🛡️", scope: "province", costFunds: 120, costIndustry: 15, constructionPoints: 8, desc: "本省[[garrison]]容量 +50%、每日恢复 15%、伤害 +25%、承伤 ×0.8；每省一个" },
};

export const STATE_BUILDING_KINDS: readonly StateBuildingKind[] = ["factory", "farm", "infrastructure", "admin"];
export const PROVINCE_BUILDING_KINDS: readonly ProvinceBuildingKind[] = ["supply", "fort"];
export const BUILDING_KINDS: readonly BuildingKind[] = [...STATE_BUILDING_KINDS, ...PROVINCE_BUILDING_KINDS];
export const INFRASTRUCTURE_MAX = 8;

// ---- states (州) & factories ----

/** 州: a contiguous province group built around a city center. */
export interface StateRegion {
    readonly id: number;
    readonly name: string;
    /** Controls access to state buildings, not ownership of the other provinces. */
    readonly center: number;
    readonly provinces: number[];
    readonly culture: number;
    buildings: ("farm" | "admin")[];
    factories: number;
    /** Factories assigned to production; the rest are construction workers. */
    prodFactories: number;
    /** 0–8; applies to members controlled by the center's owner. */
    infrastructure: number;
}

/** Per-turn output of one production factory, before infrastructure. */
export const FACTORY_PROD_FUNDS = 2;
export const FACTORY_PROD_INDUSTRY = 2;

// ---- policies ----

export type EconomyPolicy = "balanced" | "market" | "planned";
export type ConscriptionPolicy = "volunteer" | "service" | "total";
export type OccupationPolicy = "lenient" | "balanced" | "harsh";
export type PolicyCategory = "economy" | "conscription" | "occupation";

export interface Policies {
    economy: EconomyPolicy;
    conscription: ConscriptionPolicy;
    occupation: OccupationPolicy;
}

/** A policy switch in progress: gain modifiers ramp from `from` toward `to` over `readyDay - startedDay`. */
export interface PolicyTransition {
    readonly category: PolicyCategory;
    readonly from: string;
    readonly to: string;
    readonly startedDay: number;
    readonly readyDay: number;
    upkeepSpent: number;
}

export interface PolicyModifiers {
    fundsMult: number;
    industryMult: number;
    manpowerMult: number;
    growthMult: number;
    occupiedIncomeMult: number;
    ppModifier: number;
}

export const ECONOMY_POLICIES: Readonly<Record<EconomyPolicy, { name: string; desc: string } & PolicyModifiers>> = {
    balanced: { name: "平衡", desc: "无修正", fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    market: { name: "自由市场", desc: "[[funds:+20%]]，[[industry:-10%]]", fundsMult: 1.2, industryMult: 0.9, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    planned: { name: "国家计划", desc: "[[industry:+20%]]，[[funds:-10%]]", fundsMult: 0.9, industryMult: 1.2, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
};

export const CONSCRIPTION_POLICIES: Readonly<Record<ConscriptionPolicy, { name: string; desc: string } & PolicyModifiers>> = {
    volunteer: { name: "志愿兵", desc: "[[manpower:-20%]]，[[funds:+10%]]", fundsMult: 1.1, industryMult: 1, manpowerMult: 0.8, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    service: { name: "义务兵", desc: "[[manpower:+10%]]，[[funds:-5%]]", fundsMult: 0.95, industryMult: 1, manpowerMult: 1.1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    total: { name: "全面动员", desc: "[[manpower:+30%]]，[[funds:-15%]]，[[occupation]]增长 -20%", fundsMult: 0.85, industryMult: 1, manpowerMult: 1.3, growthMult: 0.8, occupiedIncomeMult: 1, ppModifier: 0 },
};

export const OCCUPATION_POLICIES: Readonly<Record<OccupationPolicy, { name: string; desc: string } & PolicyModifiers>> = {
    lenient: { name: "宽容", desc: "[[occupation]]增长 +50%，占领省税收 [[funds:-20%]]", fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1.5, occupiedIncomeMult: 0.8, ppModifier: 0 },
    balanced: { name: "均衡", desc: "无修正", fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    harsh: { name: "严苛", desc: "占领省税收 [[funds:+30%]]，[[occupation]]增长 -50%，[[politics:-1]]/天", fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 0.5, occupiedIncomeMult: 1.3, ppModifier: -1 },
};

export const DEFAULT_POLICIES: Policies = { economy: "balanced", conscription: "volunteer", occupation: "balanced" };

// ---- entities ----

export interface Nation {
    readonly id: number;
    readonly name: string;
    readonly color: string;
    readonly isPlayer: boolean;
    /** Fixed per-nation AI temperament; omitted by hand-built test fixtures, defaults at read time. */
    readonly tendency?: AITendencyId;
    /** Seeded 1–5 vassal temperament, generated with the nation; omitted fixtures fall back to the tendency baseline. */
    readonly subservience?: number;
    capital: number;
    funds: number;
    manpower: number;
    industry: number;
    politicalPower: number;
    policies: Policies;
    /** In-progress switches per category; the committed value lives in `policies`. */
    policyTransitions?: Partial<Record<PolicyCategory, PolicyTransition>>;
    alive: boolean;
    /** Overlord nation id; -1 or omitted when independent. */
    overlord?: number;
    vassalType?: VassalType;
    /** 0–100. Petitions end at 100; oppressive vassals rebel at 100. */
    independence?: number;
    /** Resource share paid to the overlord; only cooperative vassals may adjust it. */
    tributeRate?: number;
    /** Day of the last foreign-aid request (oppressive vassals only). */
    lastAidDay?: number;
    /** Day of the last independence petition; gates `VASSAL_PETITION_COOLDOWN`. */
    lastPetitionDay?: number;
}

export interface Province {
    readonly site: number;
    name: string;
    /** Actual controller; changes province by province in war. */
    owner: number;
    legalOwner: number;
    isCity: boolean;
    isCapital: boolean;
    garrison: number;
    garrisonMax: number;
    income: number;
    defense: number;
    /** 1–6; feeds manpower income and caps. */
    population: number;
    /** Original owner at world gen; NEUTRAL for neutral land. */
    coreNation: number;
    /** 0–100 integration of non-core provinces; cores are always 100. */
    occupation: number;
    /** Local buildings remain with this province on capture. */
    buildings: ProvinceBuildingKind[];
    /** Owning state (州), or -1 for water. */
    stateId: number;
}

/** One small unit inside an army. Has no independent position. */
export interface Regiment {
    readonly id: number;
    readonly kind: UnitKind;
    hp: number;
}

/** 军团: the only movable military entity. At most one per province. */
export interface Army {
    readonly id: number;
    readonly nation: number;
    name: string;
    province: number;
    regiments: Regiment[];
    org: number;
    moved: boolean;
    acted: boolean;
    /** Multi-day march order; attack=true means assault the target on arrival. */
    march: { target: number; attack: boolean } | null;
}

/** A persistent battle: one attacking army vs a province's defense, round per day. */
export interface Battle {
    readonly province: number;
    readonly attackerId: number;
    /** Defending army id, or null when only the garrison defends. */
    defenderId: number | null;
    rounds: number;
    /** Cumulative casualties across every round of this battle. */
    attackLoss?: number;
    defenseLoss?: number;
}

export type DeploymentStatus = "training" | "ready" | "blocked";

export interface DeploymentOrder {
    readonly id: number;
    readonly nation: number;
    readonly kind: UnitKind;
    daysLeft: number;
    destination: number | null;
    readonly paidFunds: number;
    readonly paidManpower: number;
    readonly paidIndustry: number;
    status: DeploymentStatus;
    readonly createdDay: number;
}

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

export interface SupplyMap {
    /** Effective supply per province; infrastructure/centers may exceed 1. */
    level: Float32Array;
    /** 0 at a source, 1 at range edge, 2 when unreachable. */
    distance: Float32Array;
    sources: number[];
}

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

export type MapSizeId = "small" | "standard" | "large";

export interface MapSizeProfile {
    readonly label: string;
    readonly cells: number;
    readonly width: number;
    readonly height: number;
}

export const MAP_SIZES: Readonly<Record<MapSizeId, MapSizeProfile>> = {
    small: { label: "小型 · 900 省", cells: 900, width: 1400, height: 900 },
    standard: { label: "标准 · 1500 省", cells: 1500, width: 1800, height: 1100 },
    large: { label: "大型 · 2400 省", cells: 2400, width: 2200, height: 1400 },
};

export const NATION_COUNT_MAX = 12;

/** Optional terrain tuning exposed by the new-game dialog (advanced section). */
export interface TerrainTuning {
    readonly seaLevel?: number;
    readonly basePeriod?: number;
    readonly elevationExponent?: number;
    readonly moistureContrast?: number;
    readonly freqMultiplier?: number;
}

export interface GameSettings {
    readonly seed: number;
    readonly mapSize: MapSizeId;
    readonly nationCount: number;
    /** Exact cell count; overrides the map-size profile while keeping its aspect ratio. */
    readonly mapCells?: number;
    /** Omitted fields fall back to the terrain defaults. */
    readonly terrain?: TerrainTuning;
    /** Optional start compensation: weaker/smaller nations get extra farms and infrastructure. */
    readonly balanceNations?: boolean;
}

export type LogTone = "info" | "combat" | "capture" | "econ" | "diplo" | "system";

export type BattleOutcome = "ongoing" | "repelled" | "captured";

/** One resolved battle round, kept on the log so the feed can digest multi-day battles. */
export interface BattleReport {
    readonly attacker: number;
    readonly defender: number;
    readonly rounds: number;
    readonly attackLoss: number;
    readonly defenseLoss: number;
    /** Battle-to-date casualties; capture reports use these so the result line is not just the last round. */
    readonly totalAttackLoss?: number;
    readonly totalDefenseLoss?: number;
    readonly breach: boolean;
    readonly outcome: BattleOutcome;
}

export type LogEventKind = "capture" | "battle-round" | "production" | "season" | "war" | "peace" | "annex" | "global";

export interface LogItemCount {
    readonly label: string;
    readonly count: number;
}

/** Structured payload behind a log line; the feed aggregates these instead of raw text. */
export interface LogEvent {
    readonly kind: LogEventKind;
    readonly nation?: number;
    /** Controller before the capture; lets the report tell whose state was lost. */
    readonly previousOwner?: number;
    readonly site?: number;
    readonly province?: string;
    readonly stateName?: string;
    readonly stateFlipped?: boolean;
    readonly battle?: BattleReport;
    readonly action?: "train" | "build" | "deploy";
    readonly stage?: "start" | "done";
    readonly items?: readonly LogItemCount[];
    readonly places?: readonly string[];
    readonly season?: string;
}

export interface LogEntry {
    readonly day: number;
    readonly text: string;
    readonly tone: LogTone;
    readonly nationId: number;
    /** State-changing events worth surfacing in the live battle feed. */
    readonly major?: boolean;
    readonly event?: LogEvent;
}

export interface GameStats {
    battles: number;
    captures: number;
    recruited: number;
    losses: number;
}

export type WarGoalKind = "conquest" | "annex";
export type DiplomaticActionKind = WarGoalKind;

export interface StateClaim {
    nation: number;
    stateId: number;
}

export interface DiplomaticAction {
    id: number;
    nation: number;
    target: number;
    kind: DiplomaticActionKind;
    stateId: number | null;
    startedDay: number;
    readyDay: number;
    expiresDay: number;
    upkeepSpent?: number;
}

export interface War {
    aggressor: number;
    defender: number;
    goal: WarGoalKind;
    stateId: number | null;
    targetSites: number[];
    startedDay: number;
}

/** Three vassal contracts; their full player-facing rules live in `vassal.ts`. */
export type VassalType = "cooperative" | "autonomous" | "oppressive";

/** A one-leader defensive/offensive camp. Membership is unique per nation. */
export interface Alliance {
    readonly id: number;
    leader: number;
    readonly members: number[];
    readonly createdDay: number;
}

export type DiplomaticRequestKind = "vassalize" | "alliance" | "aid" | "upgrade" | "call";

/** A pending offer addressed to the player; AI-to-AI offers resolve immediately. */
export interface DiplomaticRequest {
    readonly id: number;
    readonly kind: DiplomaticRequestKind;
    readonly from: number;
    readonly to: number;
    readonly vassalType?: VassalType;
    readonly allianceId?: number;
    /** Enemy of the overlord for a call-to-arms request. */
    readonly enemy?: number;
    /** A coercive vassal demand: `from` is the overlord, `to` the would-be vassal. */
    readonly demand?: boolean;
    readonly createdDay: number;
    readonly expiresDay: number;
}

export interface GameState {
    readonly settings: GameSettings;
    readonly graph: VoronoiGraph;
    readonly terrain: BiomeMap;
    readonly provinces: Province[];
    readonly states: StateRegion[];
    readonly nations: Nation[];
    readonly armies: Map<number, Army>;
    /** province site -> army id stationed there, or null. One army per province. */
    readonly armyAt: (number | null)[];
    readonly battles: Battle[];
    readonly deployments: DeploymentOrder[];
    readonly construction: ConstructionOrder[];
    supply: SupplyMap | null;
    supplyDirty: boolean;
    day: number;
    seasonIndex: number;
    selected: number | null;
    selectedArmyId: number | null;
    /** Army awaiting a strategic redeployment destination, if any. */
    redeployArmyId: number | null;
    /** Symmetric war matrix; every pair starts at peace. */
    readonly war: boolean[][];
    readonly warSince: number[][];
    readonly peaceOffers: number[];
    readonly truce: number[][];
    readonly peaceCooldown: number[];
    readonly claims: StateClaim[];
    readonly diplomaticActions: DiplomaticAction[];
    readonly wars: War[];
    readonly alliances: Alliance[];
    readonly diplomaticRequests: DiplomaticRequest[];
    /** Symmetric rejection cooldown matrix for alliance invitations; -1 when free. */
    readonly allianceCooldown: number[][];
    /** Symmetric cooldown matrix for vassalization offers; -1 when free. */
    readonly vassalCooldown: number[][];
    nextDiplomaticActionId: number;
    nextAllianceId: number;
    nextRequestId: number;
    readonly log: LogEntry[];
    /** null while playing; nation id of winner, or -1 when the player lost. */
    winner: number | null;
    nextArmyId: number;
    nextRegimentId: number;
    nextDeploymentId: number;
    nextConstructionId: number;
    readonly stats: GameStats;
}

export type CombatOutcome = "ongoing" | "repelled" | "broken" | "captured";

export type EngineEvent =
    | { type: "state" }
    | { type: "move"; armyId: number; path: number[] }
    | { type: "battle-start"; province: number; attackerNation: number; defenderNation: number }
    | {
          type: "combat";
          province: number;
          attackerNation: number;
          defenderNation: number;
          outcome: CombatOutcome;
          attackerLoss: number;
          defenderLoss: number;
          garrisonBefore: number;
          garrisonAfter: number;
          attackerOrg: number;
          defenderOrg: number;
      }
    | { type: "capture"; province: number; nationId: number; eliminated: number | null; stateFlipped?: boolean }
    | { type: "army-lost"; armyId: number; province: number; nationId: number }
    | { type: "deploy"; province: number; armyId: number; nationId: number; kind: UnitKind }
    | { type: "build"; province: number; kind: BuildingKind; nationId: number }
    | { type: "war"; aggressor: number; defender: number }
    | { type: "peace"; a: number; b: number }
    | { type: "relations" }
    | { type: "day"; day: number; seasonIndex: number }
    | { type: "gameover"; winner: number };

export const NEUTRAL = -1;

export const NEUTRAL_COLOR = "#6e7781";