import { NEUTRAL, NEUTRAL_COLOR } from "./types/world.ts";
import type { GameState } from "./types/state.ts";
import type { VassalType } from "./types/diplomacy.ts";

/**
 * Read-only relation queries shared by diplomacy, movement and rendering.
 *
 * Keeping them out of `vassal.ts` / `alliance.ts` avoids import cycles: these
 * helpers only inspect `nation.overlord` and `state.alliances`.
 */

function living(state: GameState, nation: number): boolean {
    return Number.isInteger(nation) && nation >= 0 && state.nations[nation]?.alive === true;
}

/** Overlord id, or -1 when independent, dead or malformed. */
export function overlordOf(state: GameState, nationId: number): number {
    if (!living(state, nationId)) return -1;
    const overlord = state.nations[nationId].overlord ?? -1;
    if (!Number.isInteger(overlord) || overlord < 0 || overlord === nationId) return -1;
    return living(state, overlord) ? overlord : -1;
}

export function vassalTypeOf(state: GameState, nationId: number): VassalType | null {
    if (overlordOf(state, nationId) < 0) return null;
    const type = state.nations[nationId].vassalType;
    return type === "cooperative" || type === "autonomous" || type === "oppressive" ? type : null;
}

/** Living vassals, in nation-id order. */
export function vassalsOf(state: GameState, overlordId: number): number[] {
    if (!living(state, overlordId)) return [];
    return state.nations
        .filter((nation) => nation.alive && overlordOf(state, nation.id) === overlordId)
        .map((nation) => nation.id);
}

export function isVassalOf(state: GameState, vassal: number, overlord: number): boolean {
    return overlordOf(state, vassal) === overlord;
}

export function inSameAlliance(state: GameState, a: number, b: number): boolean {
    if (a === b || !living(state, a) || !living(state, b)) return false;
    return state.alliances.some((alliance) => alliance.members.includes(a) && alliance.members.includes(b));
}

/** Vassal and overlord both get passage through each other; allies share it too. */
export function hasMilitaryAccess(state: GameState, nationId: number, territoryOwner: number): boolean {
    if (nationId === territoryOwner) return true;
    if (territoryOwner === NEUTRAL || !living(state, nationId) || !living(state, territoryOwner)) return false;
    if (isVassalOf(state, nationId, territoryOwner) || isVassalOf(state, territoryOwner, nationId)) return true;
    return inSameAlliance(state, nationId, territoryOwner);
}

/** Relations that forbid a declaration of war (vassalage, overlord, alliance). */
export function isProtectedRelation(state: GameState, a: number, b: number): boolean {
    if (a === b) return true;
    if (overlordOf(state, a) === b || overlordOf(state, b) === a) return true;
    return inSameAlliance(state, a, b);
}

/** Vassals fly the overlord's colour; only the flag emblem marks the difference. */
export function nationDisplayColor(state: GameState, nationId: number): string {
    if (nationId === NEUTRAL) return NEUTRAL_COLOR;
    const nation = state.nations[nationId];
    if (!nation) return NEUTRAL_COLOR;
    const overlord = overlordOf(state, nationId);
    return overlord >= 0 ? state.nations[overlord].color : nation.color;
}
