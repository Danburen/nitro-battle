import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import { claimProvince } from "../game/conquest.ts";
import { setWar, isAtWar, canClaimState, claimableStateIds } from "../game/diplomacy.ts";
import { enforceWarGoal, resolveWarOutcomes, settlePeace, warGoalProgress } from "../game/settlement.ts";
import { spawnArmy } from "../game/armies.ts";
import { resolveBattles } from "../game/combat.ts";
import { DEFAULT_POLICIES, NEUTRAL, REGIMENT_CAP, UnitKind } from "../game/types.ts";
import type { GameState, Nation, Province, StateRegion, War } from "../game/types.ts";

function fixture(owners = [0, 1, 1, NEUTRAL]): GameEngine {
    const provinces: Province[] = [];
    const states: StateRegion[] = owners.map((owner, id) => {
        const center = id * 3;
        for (let i = 0; i < 3; i++) {
            const site = center + i;
            provinces.push({ site, stateId: id, name: `P${site}`, owner, legalOwner: owner, coreNation: owner,
                occupation: owner === NEUTRAL ? 0 : 100, isCity: i === 0, isCapital: false,
                income: 4, population: 2, defense: 1, buildings: [], garrison: 0, garrisonMax: 20 });
        }
        return { id, name: `S${id}`, center, provinces: [center, center + 1, center + 2], culture: 0,
            buildings: [], factories: 1, prodFactories: 0, infrastructure: 0 };
    });
    const nations: Nation[] = Array.from({ length: Math.max(...owners) + 1 }, (_, id) => {
        const capital = provinces.find((province) => province.owner === id)!.site;
        provinces[capital].isCapital = true;
        return { id, name: `N${id}`, color: "#123456", isPlayer: id === 0, capital, alive: true,
            funds: 1000, manpower: 0, industry: 100, politicalPower: 100, policies: { ...DEFAULT_POLICIES } };
    });
    const graph = { sites: provinces.map((province) => ({ id: province.site, x: province.site, y: 0 })),
        adjacency: provinces.map((province) => [province.site - 1, province.site + 1]
            .filter((site) => site >= 0 && site < provinces.length).map((site) => ({ site }))),
        domain: { width: 100, height: 100 } } as unknown as GameState["graph"];
    const terrain = { passable: new Uint8Array(provinces.length).fill(1), terrainCost: new Float32Array(provinces.length).fill(1),
        getWeatherDebuff: () => ({ moveSpeed: 1, combatPenalty: 1 }), updateWeather: () => {} } as unknown as GameState["terrain"];
    const state: GameState = {
        settings: { seed: 42, mapSize: "small", nationCount: nations.length }, graph, terrain, provinces, states, nations,
        armies: new Map(), armyAt: provinces.map(() => null), battles: [], deployments: [], construction: [],
        supply: null, supplyDirty: true, day: 1, seasonIndex: 0, selected: null, selectedArmyId: null, redeployArmyId: null,
        war: nations.map(() => nations.map(() => false)), warSince: nations.map(() => nations.map(() => -1)),
        peaceOffers: [], truce: nations.map(() => nations.map(() => -1)), peaceCooldown: nations.map(() => -1),
        claims: [], diplomaticActions: [], wars: [], nextDiplomaticActionId: 1,
        alliances: [], diplomaticRequests: [],
        allianceCooldown: nations.map(() => nations.map(() => -1)),
        vassalCooldown: nations.map(() => nations.map(() => -1)),
        nextAllianceId: 1, nextRequestId: 1,
        log: [], winner: null, nextArmyId: 1, nextRegimentId: 1, nextDeploymentId: 1, nextConstructionId: 1,
        stats: { battles: 0, captures: 0, recruited: 0, losses: 0 },
    };
    const engine = new GameEngine(state);
    engine.controllers.length = 0;
    return engine;
}

function war(engine: GameEngine, goal: "conquest" | "annex" = "conquest", stateId = 1): War {
    const state = engine.state;
    setWar(state, 0, 1, true);
    const value: War = { aggressor: 0, defender: 1, goal, stateId: goal === "annex" ? null : stateId,
        targetSites: state.provinces.filter((province) => province.legalOwner === 1 &&
            (goal === "annex" || province.stateId === stateId)).map((province) => province.site), startedDay: state.day };
    state.wars.push(value);
    return value;
}

function occupy(engine: GameEngine, sites: number[], nation = 0): void {
    for (const site of sites) claimProvince(engine, site, nation, engine.state.provinces[site].owner);
}

test("capturing a capital or state center changes one controller, never legal ownership or survival", () => {
    const engine = fixture();
    war(engine);
    occupy(engine, [3]);
    assert.deepEqual(engine.state.provinces.slice(3, 6).map((p) => [p.owner, p.legalOwner]), [[0, 1], [1, 1], [1, 1]]);
    assert.equal(engine.state.nations[1].alive, true);
    assert.equal(engine.state.winner, null);
    assert.equal(engine.state.stats.captures, 1);
});

test("conquest transfers only the declared state, returns extra occupations and relocates a ceded capital", () => {
    const engine = fixture();
    const objective = war(engine);
    occupy(engine, [3, 4, 5, 6]);
    occupy(engine, [1], 1);
    assert.deepEqual(warGoalProgress(engine.state, objective), { held: 3, total: 3, canEnforce: true });
    assert.equal(engine.enforceWarGoal(1), true);
    for (const site of [3, 4, 5]) {
        const p = engine.state.provinces[site];
        assert.equal(p.owner, 0);
        assert.equal(p.legalOwner, 0);
        assert.equal(p.coreNation, 1);
        assert.equal(p.occupation, 0);
    }
    assert.equal(engine.state.provinces[6].owner, 1);
    assert.equal(engine.state.provinces[1].owner, 0);
    assert.equal(engine.state.nations[1].capital, 6);
    assert.equal(engine.state.provinces[3].isCapital, false);
    assert.equal(engine.state.provinces[6].isCapital, true);
    assert.equal(engine.state.nations[1].alive, true);
    assert.equal(isAtWar(engine.state, 0, 1), false);
    assert.equal(engine.state.wars.length, 0);
    assert.ok(engine.state.truce[0][1] > engine.state.day);
    assert.equal(engine.enforceWarGoal(1), false);
});

test("an incomplete claim war cannot demand territory and cannot annex other states", () => {
    const engine = fixture();
    const objective = war(engine);
    occupy(engine, [3, 4, 6, 7, 8]);
    assert.equal(warGoalProgress(engine.state, objective).canEnforce, false);
    assert.equal(enforceWarGoal(engine, 0, 1), false);
    assert.equal(enforceWarGoal(engine, 1, 0), false);
    assert.ok(engine.state.provinces.slice(3, 9).every((province) => province.legalOwner === 1));
});

test("white peace restores legal borders, stops battles and clears incompatible march orders", () => {
    const engine = fixture();
    const state = engine.state;
    war(engine);
    occupy(engine, [3, 4]);
    occupy(engine, [1], 1);
    const player = spawnArmy(state, 0, 4, [UnitKind.INFANTRY], 80);
    const enemy = spawnArmy(state, 1, 1, [UnitKind.INFANTRY], 80);
    player.march = { target: 8, attack: true };
    enemy.march = { target: 0, attack: true };
    state.battles.push({ attackerId: player.id, defenderId: null, province: 5, rounds: 1 });
    engine.selectArmy(player.id);
    state.redeployArmyId = player.id;
    state.peaceOffers.push(1);
    settlePeace(engine, 0, 1);
    assert.ok(state.provinces.every((province) => province.owner === province.legalOwner));
    assert.equal(state.battles.length, 0);
    assert.equal(state.peaceOffers.length, 0);
    assert.equal(state.provinces[player.province].owner, 0);
    assert.equal(state.provinces[enemy.province].owner, 1);
    assert.equal(state.armyAt[player.province], player.id);
    assert.equal(state.armyAt[enemy.province], enemy.id);
    assert.equal(player.march, null);
    assert.equal(enemy.march, null);
    assert.equal(state.selected, player.province);
    assert.equal(state.redeployArmyId, null);
    assert.ok(player.acted && enemy.acted);
});

test("white peace preserves a third nation's occupation and war", () => {
    const engine = fixture([0, 1, 1, NEUTRAL, 2]);
    war(engine);
    setWar(engine.state, 1, 2, true);
    occupy(engine, [3]);
    occupy(engine, [7], 2);
    settlePeace(engine, 0, 1);
    assert.equal(engine.state.provinces[3].owner, 1);
    assert.equal(engine.state.provinces[7].owner, 2);
    assert.equal(engine.state.provinces[7].legalOwner, 1);
    assert.equal(isAtWar(engine.state, 1, 2), true);
});

test("a mixed claimed state transfers only the target country's declared legal territory", () => {
    const engine = fixture([0, 1, 1, NEUTRAL, 2]);
    engine.state.provinces[5].owner = 2;
    engine.state.provinces[5].legalOwner = 2;
    war(engine);
    occupy(engine, [3, 4]);
    assert.equal(engine.enforceWarGoal(1), true);
    assert.equal(engine.state.provinces[5].owner, 2);
    assert.equal(engine.state.provinces[5].legalOwner, 2);
    assert.equal(isAtWar(engine.state, 0, 2), false);
});

test("a target transferred to a third party cannot be taken using an old war objective", () => {
    const engine = fixture([0, 1, 1, NEUTRAL, 2]);
    war(engine);
    occupy(engine, [3, 4, 5]);
    engine.state.provinces[5].legalOwner = 2;
    assert.equal(engine.enforceWarGoal(1), false);
    assert.equal(engine.state.provinces[5].legalOwner, 2);
});

test("annexation needs more than a captured capital and yields all formal land without converting cores", () => {
    const engine = fixture();
    const objective = war(engine, "annex");
    occupy(engine, [3]);
    resolveWarOutcomes(engine);
    assert.equal(engine.state.nations[1].alive, true);
    assert.equal(warGoalProgress(engine.state, objective).canEnforce, false);
    occupy(engine, [4, 5, 6]);
    assert.equal(warGoalProgress(engine.state, objective).canEnforce, true);
    const enemy = spawnArmy(engine.state, 1, 8, [UnitKind.INFANTRY], 80);
    engine.state.diplomaticActions.push({ id: engine.state.nextDiplomaticActionId++, nation: 1,
        target: 0, kind: "conquest", stateId: 0, startedDay: 1, readyDay: 3, expiresDay: 15 });
    resolveWarOutcomes(engine);
    assert.equal(engine.state.diplomaticActions.length, 0);
    assert.ok(engine.state.log.some((entry) => entry.text.includes("借口失效")));
    assert.equal(engine.state.nations[1].alive, false);
    assert.equal(engine.state.armies.has(enemy.id), false);
    assert.ok(engine.state.provinces.slice(3, 9).every((p) => p.owner === 0 && p.legalOwner === 0 && p.coreNation === 1));
    assert.equal(engine.state.winner, 0);
});

test("annexation cannot distribute territories still occupied by a third country", () => {
    const engine = fixture([0, 1, 1, NEUTRAL, 2]);
    const objective = war(engine, "annex");
    occupy(engine, [3, 4, 5, 6]);
    occupy(engine, [7], 2);
    assert.equal(warGoalProgress(engine.state, objective).canEnforce, false);
    assert.equal(engine.enforceWarGoal(1), false);
    assert.equal(engine.state.nations[1].alive, true);
});

test("a defending victory restores borders without granting an unprepared annexation", () => {
    const engine = fixture();
    war(engine, "annex");
    occupy(engine, [0, 1], 1);
    resolveWarOutcomes(engine);
    assert.equal(isAtWar(engine.state, 0, 1), false);
    assert.ok(engine.state.provinces.slice(0, 3).every((p) => p.legalOwner === 0 && p.owner === 0));
    assert.equal(engine.state.nations[0].alive, true);
    assert.equal(engine.state.winner, null);
});

test("repatriation releases both sides' slots before relocating mutual occupations", () => {
    const engine = fixture();
    war(engine);
    occupy(engine, [3, 4, 5]);
    occupy(engine, [0, 1, 2], 1);
    const ours = spawnArmy(engine.state, 0, 3, [UnitKind.INFANTRY], 80);
    const theirs = spawnArmy(engine.state, 1, 0, [UnitKind.INFANTRY], 80);
    settlePeace(engine, 0, 1);
    assert.ok(engine.state.armies.has(ours.id) && engine.state.armies.has(theirs.id));
    assert.equal(engine.state.provinces[ours.province].owner, 0);
    assert.equal(engine.state.provinces[theirs.province].owner, 1);
    assert.equal(engine.state.armyAt[ours.province], ours.id);
    assert.equal(engine.state.armyAt[theirs.province], theirs.id);
});

test("overflow repatriation never exceeds regiment capacity and refunds surviving manpower", () => {
    const engine = fixture();
    war(engine);
    occupy(engine, [3]);
    for (const site of [0, 1, 2]) spawnArmy(engine.state, 0, site, Array(REGIMENT_CAP).fill(UnitKind.INFANTRY), 80);
    const displaced = spawnArmy(engine.state, 0, 3, [UnitKind.INFANTRY], 80);
    displaced.regiments[0].hp = 5;
    settlePeace(engine, 0, 1);
    assert.equal(engine.state.armies.has(displaced.id), false);
    assert.equal(engine.state.nations[0].manpower, 50);
    assert.ok([...engine.state.armies.values()].every((army) => army.regiments.length <= REGIMENT_CAP));
});

test("the neutral sentinel is never attackable or claimable, keeping mode B guards intact", () => {
    const engine = fixture([0, NEUTRAL, 1]);
    const army = spawnArmy(engine.state, 0, 2, [UnitKind.INFANTRY], 80);
    assert.equal(engine.attack(army.id, 3), false);
    assert.equal(canClaimState(engine.state, 0, 1), false);
    assert.equal(claimableStateIds(engine.state, 0).includes(1), false);
    assert.equal(engine.state.provinces[3].owner, NEUTRAL);
    assert.equal(engine.state.provinces[3].legalOwner, NEUTRAL);
});

test("white peace dissolves ongoing battles and peace blocks further attacks", () => {
    const engine = fixture();
    const state = engine.state;
    war(engine);
    const army = spawnArmy(state, 0, 2, [UnitKind.INFANTRY, UnitKind.INFANTRY], 80);
    state.provinces[3].garrison = 1;
    assert.equal(engine.attack(army.id, 3), true);
    assert.equal(state.battles.length, 1);
    settlePeace(engine, 0, 1);
    assert.equal(state.battles.length, 0);
    assert.equal(state.provinces[3].owner, 1);
    army.acted = false;
    army.moved = false;
    assert.equal(engine.attack(army.id, 3), false);
});

test("resolveBattles drops battles whose war ended and never touches the new controller", () => {
    const engine = fixture();
    const state = engine.state;
    war(engine);
    const army = spawnArmy(state, 0, 2, [UnitKind.INFANTRY, UnitKind.INFANTRY], 80);
    state.provinces[3].garrison = 1;
    assert.equal(engine.attack(army.id, 3), true);
    setWar(state, 0, 1, false);
    state.provinces[3].owner = 1;
    resolveBattles(engine);
    assert.equal(state.battles.length, 0);
    assert.equal(state.provinces[3].owner, 1);
    assert.equal(state.provinces[3].legalOwner, 1);
});
