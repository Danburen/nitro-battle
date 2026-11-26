import type { GameState } from "../../game/types/state.ts";

/**
 * Plain-JSON view of GameState. Maps, typed arrays and terrain classes are
 * intentionally reduced to assertable fields so `page.evaluate()` can return it.
 */
export function snapshotState(state: GameState): Record<string, unknown> {
    return {
        day: state.day,
        seasonIndex: state.seasonIndex,
        settings: state.settings,
        winner: state.winner,
        autoManageArmies: state.autoManageArmies ?? false,
        selection: {
            site: state.selected,
            armyId: state.selectedArmyId,
            redeployArmyId: state.redeployArmyId,
        },
        stats: { ...state.stats },
        totals: {
            provinces: state.provinces.length,
            states: state.states.length,
            nations: state.nations.length,
            armies: state.armies.size,
        },
        nations: state.nations.map((nation) => ({
            id: nation.id,
            name: nation.name,
            isPlayer: nation.isPlayer,
            alive: nation.alive,
            capital: nation.capital,
            tendency: nation.tendency,
            funds: nation.funds,
            manpower: nation.manpower,
            industry: nation.industry,
            raw: nation.raw,
            food: nation.food,
            strategic: nation.strategic,
            politicalPower: nation.politicalPower,
            stability: nation.stability,
            overlord: nation.overlord ?? -1,
            vassalType: nation.vassalType,
            independence: nation.independence,
        })),
        armies: [...state.armies.values()].map((army) => ({
            id: army.id,
            nation: army.nation,
            name: army.name,
            province: army.province,
            org: army.org,
            regiments: army.regiments.length,
            moved: army.moved,
            acted: army.acted,
            march: army.march,
            autoManaged: army.autoManaged ?? false,
        })),
        battles: state.battles.map((battle) => ({ ...battle })),
        deployments: state.deployments.map((order) => ({ ...order })),
        construction: state.construction.map((order) => ({ ...order })),
        wars: state.wars.map((war) => ({ ...war })),
        alliances: state.alliances.map((alliance) => ({
            id: alliance.id,
            leader: alliance.leader,
            members: [...alliance.members],
        })),
        claims: state.claims.map((claim) => ({ ...claim })),
        tradeAgreements: state.tradeAgreements.map((agreement) => ({ ...agreement })),
        diplomaticRequests: state.diplomaticRequests.map((request) => ({ ...request })),
        logTail: state.log.slice(-10).map((entry) => ({
            day: entry.day,
            text: entry.text,
            tone: entry.tone,
            nationId: entry.nationId,
            major: entry.major,
            event: entry.event,
        })),
    };
}
