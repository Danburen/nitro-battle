import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import { createRequestCooldown } from "../game/requests.ts";
import { overlordOf, vassalTypeOf } from "../game/access.ts";
import {
    ANNEX_FLIP_WILL_MAX, VASSAL_PROFILES, canAnnexVassal, setVassal, vassalTuningOf,
} from "../game/vassal.ts";
import { spawnArmy } from "../game/armies.ts";
import { DEFAULT_POLICIES } from "../game/types/policy.ts";
import { UnitKind } from "../game/types/unit.ts";
import type { AITendencyId } from "../game/ai/types.ts";
import type { GameState } from "../game/types/state.ts";
import type { Nation, Province, StateRegion } from "../game/types/entities.ts";

/** Four nations on a straight line: 0-1-2-3, three provinces each. */
function fixture(
    tendencies: AITendencyId[] = ["hegemon", "defensive", "defensive", "defensive"], seed = 7,
): GameEngine {
    const provinces: Province[] = [];
    const states: StateRegion[] = [];
    for (let owner = 0; owner < 4; owner++) {
        const center = owner * 3;
        const members = [center, center + 1, center + 2];
        for (const site of members) {
            provinces.push({
                site, stateId: owner, name: `P${site}`, owner, legalOwner: owner, coreNation: owner,
                occupation: 100, isCity: site === center, isCapital: site === center,
                income: 4, population: 2, defense: 1, buildings: [], deposits: { raw: 0, strategic: 0 },
                garrison: 20, garrisonMax: 20,
            });
        }
        states.push({
            id: owner, name: `S${owner}`, center, provinces: members, culture: 0,
            buildings: [], factories: 1, prodFactories: 0, infrastructure: 0,
        });
    }
    const nations: Nation[] = Array.from({ length: 4 }, (_, id) => ({
        id, name: `N${id}`, color: ["#1f6feb", "#da3633", "#3fb950", "#d29922"][id],
        isPlayer: id === 0, capital: id * 3, alive: true,
        funds: 1000, manpower: 1000, industry: 1000, raw: 0, food: 0, strategic: 0, politicalPower: 100,
        policies: { ...DEFAULT_POLICIES }, tendency: tendencies[id],
    }));
    const count = provinces.length;
    const graph = {
        sites: provinces.map((province) => ({ id: province.site, x: province.site, y: 0 })),
        adjacency: provinces.map((province) => [province.site - 1, province.site + 1]
            .filter((site) => site >= 0 && site < count).map((site) => ({ site }))),
        domain: { width: count + 1, height: 10 },
        cells: [],
    } as unknown as GameState["graph"];
    const terrain = {
        passable: new Uint8Array(count).fill(1), terrainCost: new Float32Array(count).fill(1),
        getWeatherDebuff: () => ({ moveSpeed: 1, combatPenalty: 1 }), updateWeather: () => {},
    } as unknown as GameState["terrain"];
    const state: GameState = {
        settings: { seed, mapSize: "small", nationCount: 4 }, graph, terrain, provinces, states, nations,
        armies: new Map(), armyAt: Array(count).fill(null), battles: [], deployments: [], construction: [],
        supply: null, supplyDirty: true, day: 1, seasonIndex: 0, selected: null, selectedArmyId: null,
        redeployArmyId: null, war: [[false, false, false, false], [false, false, false, false],
            [false, false, false, false], [false, false, false, false]],
        warSince: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
        peaceOffers: [], truce: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
        peaceCooldown: [-1, -1, -1, -1], claims: [], diplomaticActions: [], wars: [],
        alliances: [], diplomaticRequests: [],
        allianceCooldown: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
        vassalCooldown: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
        requestCooldown: createRequestCooldown(4),
        nextDiplomaticActionId: 1, nextAllianceId: 1, nextRequestId: 1,
        tradeAgreements: [], nextTradeId: 1,
        log: [], winner: null, nextArmyId: 1, nextRegimentId: 1, nextDeploymentId: 1, nextConstructionId: 1,
        stats: { battles: 0, captures: 0, recruited: 0, losses: 0 },
    };
    const engine = new GameEngine(state);
    engine.controllers.length = 0;
    return engine;
}

function docileVassal(): GameEngine {
    const engine = fixture();
    assert.equal(setVassal(engine, 1, 0, "cooperative"), true);
    engine.state.nations[1].independence = VASSAL_PROFILES.cooperative.independenceStart / 9;
    assert.equal(canAnnexVassal(engine.state, 1, 0), true);
    return engine;
}

test("annexing a docile vassal transfers its land and armies, then retires it", () => {
    const engine = docileVassal();
    const state = engine.state;
    const vassalSites = state.provinces.filter((province) => province.legalOwner === 1).map((province) => province.site);
    const army = spawnArmy(state, 1, 3, [UnitKind.INFANTRY], 100);
    assert.equal(vassalSites.length, 3);

    assert.equal(engine.annexVassal(1), true);

    assert.equal(state.nations[1].alive, false);
    assert.equal(overlordOf(state, 1), -1);
    assert.equal(vassalTypeOf(state, 1), null);
    assert.equal(state.provinces.some((province) => province.legalOwner === 1), false);
    for (const site of vassalSites) {
        assert.equal(state.provinces[site].legalOwner, 0);
        assert.equal(state.provinces[site].owner, 0);
    }
    const transferred = state.armies.get(army.id);
    assert.ok(transferred, "the vassal's army should survive as an overlord army");
    assert.equal(transferred.nation, 0);
});

test("a restless vassal with high independence cannot be annexed", () => {
    const engine = docileVassal();
    const state = engine.state;
    state.nations[1].independence = VASSAL_PROFILES.cooperative.independenceCap * 0.36;

    assert.equal(canAnnexVassal(state, 1, 0), false);
    assert.equal(engine.annexVassal(1), false);
    assert.equal(state.nations[1].alive, true);
    assert.equal(overlordOf(state, 1), 0);
});

test("a vassal likely to flip cannot be annexed even when independence is low", () => {
    const engine = fixture(["hegemon", "hegemon", "defensive", "defensive"]);
    assert.equal(setVassal(engine, 1, 0, "cooperative"), true);
    const state = engine.state;
    state.nations[1].independence = 10;
    assert.ok(vassalTuningOf(state, 1).flipWill > ANNEX_FLIP_WILL_MAX);

    assert.equal(canAnnexVassal(state, 1, 0), false);
    assert.equal(engine.annexVassal(1), false);
    assert.equal(state.nations[1].alive, true);
});

test("an independent nation cannot be annexed as a vassal", () => {
    const engine = fixture();
    const state = engine.state;

    assert.equal(canAnnexVassal(state, 1, 0), false);
    assert.equal(engine.annexVassal(1), false);
    assert.equal(state.nations[1].alive, true);
    assert.equal(state.provinces.some((province) => province.legalOwner === 1), true);
});
