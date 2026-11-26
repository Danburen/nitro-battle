/**
 * Read-only current-value resolver for `~` tokens.
 *
 * This is a derived view over `GameState`, never a second mutable store. The
 * active context is installed by `GameUI` for one game lifetime and cleared on
 * destroy. Derived costs (economy chains, supply, diplomacy) are intentionally
 * not mirrored here: expensive values stay explicit `game\`[[id:${value}]]\``
 * at the call site until real caching is added.
 */
import type { GameState } from "../game/types/state.ts";
import { isTokenScope } from "../utils/spec.ts";

export interface TokenValueContext {
    readonly state: GameState;
    readonly player: number;
    readonly selectedSite?: number | null;
    readonly selectedState?: number | null;
    readonly selectedArmyId?: number | null;
}

export type TokenValue = number | string | null;
export type TokenValueResolver = (id: string, scope: string | null) => TokenValue;

/** @USER / @PLAYER map to the human player; @<n> is a nation id. */
export function resolveTokenNation(scope: string | null, player: number): number | null {
    if (scope === null || scope === "@USER" || scope === "@PLAYER") return player;
    if (!isTokenScope(scope) || scope.startsWith("@USER") || scope.startsWith("@PLAYER")) return null;
    const id = Number(scope.slice(1));
    return Number.isInteger(id) ? id : null;
}

export function createTokenValueResolver(context: TokenValueContext): TokenValueResolver {
    return (id, scope) => {
        const nationId = resolveTokenNation(scope, context.player);
        if (nationId === null) return null;
        const state = context.state;
        const nation = state.nations[nationId];
        if (!nation) return null;

        switch (id) {
            case "funds":
            case "fund":
                return nation.funds;
            case "manpower":
                return nation.manpower;
            case "industry":
                return nation.industry;
            case "raw":
                return nation.raw;
            case "food":
                return nation.food;
            case "strategic":
                return nation.strategic;
            case "politics":
            case "politicalPower":
                return nation.politicalPower;
            case "stability":
                return nation.stability ?? null;
            case "turn":
            case "day":
                return state.day;
            case "construction":
                return state.construction.reduce((total, order) => total + (order.nation === nationId ? 1 : 0), 0);
            default:
                break;
        }

        // Province / state / army scopes follow the current HUD selection and
        // fall back to the nation capital, so panel and map hover stay in sync.
        const site = context.selectedSite ?? state.selected ?? nation.capital;
        const province = site === null || site === undefined ? undefined : state.provinces[site];
        const regionId = context.selectedState ?? province?.stateId ?? null;
        const region = regionId === null ? undefined : state.states[regionId];

        switch (id) {
            case "garrison":
                return province?.garrison ?? null;
            case "occupation":
                return province?.occupation ?? null;
            case "infrastructure":
                return region?.infrastructure ?? null;
            case "factory":
                return region?.factories ?? null;
            case "farm":
                return region?.buildings.reduce((total, kind) => total + (kind === "farm" ? 1 : 0), 0) ?? null;
            case "admin":
                return region?.buildings.reduce((total, kind) => total + (kind === "admin" ? 1 : 0), 0) ?? null;
            case "organization": {
                const armyId = context.selectedArmyId ?? state.selectedArmyId;
                return armyId === null || armyId === undefined ? null : state.armies.get(armyId)?.org ?? null;
            }
            default:
                return null;
        }
    };
}

let activeResolver: TokenValueResolver | null = null;

/** Installs the resolver for the current game; pass null only during teardown. */
export function setActiveTokenContext(context: TokenValueContext | null): void {
    activeResolver = context ? createTokenValueResolver(context) : null;
}

export function clearActiveTokenContext(): void {
    activeResolver = null;
}

export function getActiveTokenValueResolver(): TokenValueResolver | null {
    return activeResolver;
}
