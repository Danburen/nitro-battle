import { canBuildProvince } from "./economy.ts";
import { enqueueProvinceBuild } from "./production.ts";
import type { GameCore } from "./core.ts";
import type { GameState } from "./types.ts";

/**
 * Reaction to a territorial claim. The claimant is recorded as a threat; the
 * legal owner gets a report line and, when it is an AI, hardens the threatened
 * provinces. The player's version of this is the prominent claim warning
 * emitted from `diplomacy.ts`, not a free defensive bonus.
 */

/** Share of a province's maximum garrison rushed into a freshly claimed state. */
const CLAIM_GARRISON_BOOST = 0.5;

/** Living nations with a legal or core stake in the state, excluding the claimant. */
export function claimedStateOwners(state: GameState, stateId: number, claimer: number): number[] {
    const region = state.states[stateId];
    if (!region) return [];
    const owners = new Set<number>();
    for (const site of region.provinces) {
        const province = state.provinces[site];
        for (const owner of [province.legalOwner, province.coreNation]) {
            if (owner < 0 || owner === claimer || !state.nations[owner]?.alive) continue;
            owners.add(owner);
        }
    }
    return [...owners].sort((a, b) => a - b);
}

/**
 * Own provinces inside states a rival has claimed. These are the ground an
 * AI reinforces and the border the player's managed corps try to fill.
 */
export function claimedDefenseSites(state: GameState, owner: number): Set<number> {
    const sites = new Set<number>();
    for (const claim of state.claims) {
        if (claim.nation === owner) continue;
        const region = state.states[claim.stateId];
        if (!region) continue;
        for (const site of region.provinces) {
            if (state.provinces[site].owner === owner) sites.add(site);
        }
    }
    return sites;
}

/** AI "加紧布防": top up garrisons and queue a fort on the threatened center. */
export function fortifyClaimedState(core: GameCore, owner: number, stateId: number): number {
    const state = core.state;
    const region = state.states[stateId];
    if (!region || !state.nations[owner]?.alive) return 0;
    let hardened = 0;
    for (const site of region.provinces) {
        const province = state.provinces[site];
        if (province.owner !== owner || province.garrisonMax <= 0) continue;
        if (province.garrison >= province.garrisonMax) continue;
        province.garrison = Math.min(province.garrisonMax,
            province.garrison + Math.ceil(province.garrisonMax * CLAIM_GARRISON_BOOST));
        hardened++;
    }
    const center = state.provinces[region.center];
    const queued = state.construction.some((order) =>
        order.nation === owner && order.site === region.center && order.kind === "fort");
    if (center?.owner === owner && !center.buildings.includes("fort") && !queued &&
        canBuildProvince(state, owner, region.center, "fort")) {
        enqueueProvinceBuild(core, owner, region.center, "fort");
    }
    return hardened;
}
