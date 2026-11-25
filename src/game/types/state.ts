/** The single mutable game state aggregate. Composed from the feature type modules. */
import type { BiomeMap } from "../../terrain/biome.ts";
import type { VoronoiGraph } from "../../terrain/voronoi/index.ts";
import type { GameSettings } from "../../types/settings.ts";
import type { ConstructionOrder } from "./building.ts";
import type {
    Alliance, DiplomaticAction, DiplomaticRequest, DiplomaticRequestKind, StateClaim, War,
} from "./diplomacy.ts";
import type { SupplyMap } from "./economy.ts";
import type { Nation, Province, StateRegion } from "./entities.ts";
import type { GameStats, LogEntry } from "./log.ts";
import type { Army, Battle, DeploymentOrder } from "./organization.ts";
import type { TradeAgreement } from "./trade.ts";

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
    /** Master switch for player army trusteeship; per-corps overrides live on `Army.autoManaged`. */
    autoManageArmies?: boolean;
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
    /** Signed recurring trade treaties; fixed-only deals settle at signing and never appear here. */
    readonly tradeAgreements: TradeAgreement[];
    nextTradeId: number;
    /** Symmetric rejection cooldown matrix for alliance invitations; -1 when free. */
    readonly allianceCooldown: number[][];
    /** Symmetric cooldown matrix for vassalization offers; -1 when free. */
    readonly vassalCooldown: number[][];
    /** Per request kind, symmetric player-to-nation rejection cooldowns; -1 when free. */
    readonly requestCooldown: Record<DiplomaticRequestKind, number[][]>;
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
