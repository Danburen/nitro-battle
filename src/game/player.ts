import { NEUTRAL } from "./types.ts";
import type { GameState, LogEvent, Nation } from "./types.ts";

/**
 * Promote the chosen generated nation to player id 0.
 * Every nation-indexed structure is swapped so the rest of the game can keep
 * assuming the player is always nation 0.
 */
export function setPlayerNation(state: GameState, chosen: number): boolean {
    if (!Number.isInteger(chosen) || chosen < 0 || chosen >= state.nations.length) return false;
    if (chosen === 0) return true;

    const mapId = (id: number): number => id === 0 ? chosen : id === chosen ? 0 : id;

    swapAxes(state.war, chosen);
    swapAxes(state.warSince, chosen);
    swapAxes(state.truce, chosen);
    swapPair(state.peaceCooldown, chosen);
    for (let i = 0; i < state.peaceOffers.length; i++) state.peaceOffers[i] = mapId(state.peaceOffers[i]);

    for (const province of state.provinces) {
        province.owner = mapId(province.owner);
        province.legalOwner = mapId(province.legalOwner);
        province.coreNation = mapId(province.coreNation);
    }
    for (const army of [...state.armies.values()]) {
        state.armies.set(army.id, { ...army, nation: mapId(army.nation) });
    }
    for (let i = 0; i < state.deployments.length; i++) {
        const order = state.deployments[i];
        state.deployments[i] = { ...order, nation: mapId(order.nation) };
    }
    for (let i = 0; i < state.construction.length; i++) {
        const order = state.construction[i];
        state.construction[i] = { ...order, nation: mapId(order.nation) };
    }
    for (const claim of state.claims) claim.nation = mapId(claim.nation);
    for (const action of state.diplomaticActions) {
        action.nation = mapId(action.nation);
        action.target = mapId(action.target);
    }
    for (const war of state.wars) {
        war.aggressor = mapId(war.aggressor);
        war.defender = mapId(war.defender);
    }

    const nations = [...state.nations];
    nations[0] = rebuildNation(state.nations[chosen], 0);
    nations[chosen] = rebuildNation(state.nations[0], chosen);
    for (let i = 0; i < nations.length; i++) state.nations[i] = nations[i];

    for (let i = 0; i < state.log.length; i++) {
        const entry = state.log[i];
        const nationId = entry.nationId === NEUTRAL ? NEUTRAL : mapId(entry.nationId);
        const event = remapEvent(entry.event, mapId);
        state.log[i] = { ...entry, nationId, event };
    }

    state.selected = null;
    state.selectedArmyId = null;
    state.redeployArmyId = null;
    return true;
}

function rebuildNation(nation: Nation, id: number): Nation {
    return { ...nation, id, isPlayer: id === 0 };
}

function swapAxes(matrix: (boolean | number)[][], chosen: number): void {
    swapPair(matrix, chosen);
    for (const row of matrix) swapPair(row, chosen);
}

function swapPair<T>(values: T[], chosen: number): void {
    const first = values[0];
    values[0] = values[chosen];
    values[chosen] = first;
}

function remapEvent(event: LogEvent | undefined, mapId: (id: number) => number): LogEvent | undefined {
    if (!event) return undefined;
    return {
        ...event,
        nation: event.nation === undefined || event.nation === NEUTRAL ? event.nation : mapId(event.nation),
        battle: event.battle
            ? {
                ...event.battle,
                attacker: mapId(event.battle.attacker),
                defender: mapId(event.battle.defender),
            }
            : undefined,
    };
}