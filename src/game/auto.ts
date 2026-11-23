import { orderMerge, splitArmy } from "./armies.ts";
import { claimedDefenseSites } from "./defense.ts";
import type { GameCore } from "./core.ts";
import { REGIMENT_CAP } from "./types.ts";
import type { Army, GameState } from "./types.ts";

/**
 * Army trusteeship for the human player. The global switch hands every player
 * corps to the AI at once; each corps also carries its own flag so the player
 * can manage just a few corps while the master switch is off. All commands from
 * the UI are gated by `isArmyAutoManaged`; the AI calls domain functions directly
 * and is therefore unaffected.
 */

/**
 * Effective state of one corps. Only player armies can be managed. The master
 * switch opts every corps in by default; when it is off, only corps explicitly
 * flagged `autoManaged === true` stay managed (partial trusteeship).
 */
export function isArmyAutoManaged(state: GameState, army: Army | null | undefined): boolean {
    if (!army || army.nation !== 0) return false;
    return state.autoManageArmies === true ? army.autoManaged !== false : army.autoManaged === true;
}

/** Bulk assign (or reclaim) every player corps, and set the default for corps spawned later. */
export function setArmyAutoManage(state: GameState, enabled: boolean): void {
    state.autoManageArmies = enabled;
    for (const army of state.armies.values()) {
        if (army.nation === 0) army.autoManaged = enabled;
    }
}

/** Single-corps override, available with the master switch either on or off. */
export function toggleArmyAutoManage(state: GameState, armyId: number): boolean {
    const army = state.armies.get(armyId);
    if (!army || army.nation !== 0) return false;
    army.autoManaged = !isArmyAutoManaged(state, army);
    return true;
}

/**
 * Consolidate idle managed corps: the largest stays put and a neighbour within
 * one turn's reach marches into it. Manual corps are never touched, and the
 * REGIMENT_CAP guard is shared with the player's own merge command. Corps
 * already sitting on a claimed border site are kept in place as garrisons.
 */
export function autoMergeManagedArmies(core: GameCore, preserveSites?: ReadonlySet<number>): number {
    const state = core.state;
    let merges = 0;
    for (let pass = 0; pass < 8; pass++) {
        const armies = [...state.armies.values()]
            .filter((army) => isArmyAutoManaged(state, army) && !army.moved && !army.acted && !core.inBattle(army.id))
            .sort((a, b) => b.regiments.length - a.regiments.length || a.id - b.id);
        let merged = false;
        for (const anchor of armies) {
            if (!state.armies.has(anchor.id)) continue;
            for (const mover of armies) {
                if (mover.id === anchor.id || !state.armies.has(mover.id)) continue;
                if (preserveSites?.has(mover.province)) continue;
                if (anchor.regiments.length + mover.regiments.length > REGIMENT_CAP) continue;
                if (!core.reachFor(mover).cost.has(anchor.province)) continue;
                if (orderMerge(core, [anchor.id, mover.id])) {
                    merges++;
                    merged = true;
                    break;
                }
            }
            if (merged) break;
        }
        if (!merged) break;
    }
    return merges;
}

/**
 * When a rival claims our land, split idle managed corps into any threatened
 * border province still vacant. Best effort: a fresh garrison needs a managed
 * neighbour with spare regiments; the AI planner then keeps it on the border.
 */
export function autoFillClaimedBorder(core: GameCore): number {
    const state = core.state;
    const border = claimedDefenseSites(state, 0);
    if (border.size === 0) return 0;
    let filled = 0;
    for (const site of border) {
        if (state.armyAt[site] !== null || core.battleAt(site)) continue;
        for (const army of [...state.armies.values()]) {
            if (!isArmyAutoManaged(state, army) || army.province === site) continue;
            if (army.moved || army.acted || core.inBattle(army.id)) continue;
            if (army.regiments.length < 2) continue;
            if (!state.graph.adjacency[site].some((edge) => edge.site === army.province)) continue;
            const take = Math.max(1, Math.floor(army.regiments.length / 2));
            const ids = army.regiments.slice(0, take).map((regiment) => regiment.id);
            if (splitArmy(core, army.id, ids, site) !== null) {
                filled++;
                break;
            }
        }
    }
    return filled;
}
