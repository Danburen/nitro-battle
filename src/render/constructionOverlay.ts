import { provinceBuildingCapacity, stateBuildingCapacity } from "../game/economy.ts";
import type { BuildingKind, GameState } from "../game/types.ts";

export const PROVINCE_CAPACITY_MIN_ZOOM = 1.6;

export const CONSTRUCTION_COLORS = {
    empty: "#d9e8c0",
    low: "#a8c887",
    high: "#628451",
    full: "#263849",
} as const;

/** Land outside the player's buildable area is uniformly grey while the tool is open. */
export const CONSTRUCTION_BLOCKED_COLOR = "#454b52";
/** Translucent tint marking a plot that already has an order in the queue. */
export const CONSTRUCTION_PENDING_TINT = "rgba(46, 160, 67, 0.38)";

export function constructionColor(used: number, limit: number): string {
    if (used >= limit) return CONSTRUCTION_COLORS.full;
    if (used === 0) return CONSTRUCTION_COLORS.empty;
    return used / limit < 0.5 ? CONSTRUCTION_COLORS.low : CONSTRUCTION_COLORS.high;
}

export interface ConstructionAreaOverlay {
    readonly id: number;
    readonly center: number;
    readonly name: string;
    readonly sites: readonly number[];
    readonly built: number;
    readonly pending: number;
    readonly used: number;
    readonly limit: number;
    readonly color: string;
}

export interface ConstructionOverlay {
    readonly scope: "state" | "province";
    readonly areas: readonly ConstructionAreaOverlay[];
    /** Passable land the player cannot build in right now (foreign, neutral or wrong center). */
    readonly blocked: readonly number[];
    readonly signature: string;
}

export function buildConstructionOverlay(state: GameState, kind: BuildingKind): ConstructionOverlay {
    const { provinces, terrain } = state;
    const areas: ConstructionAreaOverlay[] = [];
    const scope = kind === "supply" || kind === "fort" ? "province" : "state";
    if (kind === "supply" || kind === "fort") {
        for (const province of provinces) {
            if (province.owner !== 0 || !terrain.passable[province.site]) continue;
            const capacity = provinceBuildingCapacity(state, province, kind);
            areas.push({
                id: province.site,
                center: province.site,
                name: province.name,
                sites: [province.site],
                ...capacity,
                color: constructionColor(capacity.used, capacity.limit),
            });
        }
    } else {
        for (const region of state.states) {
            if (provinces[region.center].owner !== 0 || !terrain.passable[region.center]) continue;
            const capacity = stateBuildingCapacity(state, region, kind);
            areas.push({
                id: region.id,
                center: region.center,
                name: region.name,
                sites: region.provinces.filter((site) => provinces[site].owner === 0 && terrain.passable[site]),
                ...capacity,
                color: constructionColor(capacity.used, capacity.limit),
            });
        }
    }
    const buildable = new Set(areas.flatMap((area) => area.sites));
    const blocked = provinces
        .filter((province) => terrain.passable[province.site] && !buildable.has(province.site))
        .map((province) => province.site);
    // Ownership also affects the ordinary political fills beneath this overlay.
    const owners = provinces.map((province) => terrain.passable[province.site] ? province.owner : "x").join(",");
    const counts = areas.map((area) =>
        `${area.id}:${area.center}:${area.built}:${area.pending}:${area.limit}`).join(";");
    return { scope, areas, blocked, signature: `${kind}|${owners}|${counts}|${blocked.join(",")}` };
}
