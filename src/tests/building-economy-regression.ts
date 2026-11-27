import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import { createRequestCooldown } from "../game/requests.ts";
import {
    buildingCount, canBuild, canBuildProvince, constructionPlan, factoryTotals,
    infrastructureLevel, infrastructureOutputMultiplier, infrastructureBuildMultiplier,
    infrastructureMoveMultiplier, infrastructureSupplyMultiplier, occupationGrowth,
    provinceBuildingCapacity, provinceDefense, resourceRates,
} from "../game/economy.ts";
import { enqueueBuild, processConstruction, setFactoryProduction } from "../game/production.ts";
import { claimProvince } from "../game/conquest.ts";
import { computeSupply, supplyAttackFactor, supplyDistance, supplyLevel, supplyOrgFactor } from "../game/supply.ts";
import { entryCost } from "../game/rules.ts";
import {
    battleForecast, garrisonCapacity, garrisonRecoveryRate, refreshGarrisonCapacity, resolveBattleRound,
} from "../game/battle.ts";
import { generateWorld } from "../game/generator/index.ts";
import { spawnArmy } from "../game/armies.ts";
import { LCGRandom } from "../utils/LCGRandom.ts";
import { BUILDING_PROFILES, STATE_BUILDING_KINDS, PROVINCE_BUILDING_KINDS } from "../game/types/building.ts";
import { CONSCRIPTION_POLICIES, DEFAULT_POLICIES } from "../game/types/policy.ts";
import { UnitKind } from "../game/types/unit.ts";
import type { BuildingKind } from "../game/types/building.ts";
import type { GameState } from "../game/types/state.ts";
import type { Nation, Province, StateRegion } from "../game/types/entities.ts";

function near(actual: number, expected: number, epsilon = 1e-6): void {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

/** Small deterministic line map; real engine commands, no renderer or DOM. */
function fixture(sizes = [16, 16], owners = [0, 1]): GameState {
    const provinces: Province[] = [];
    const states: StateRegion[] = [];
    for (let id = 0; id < sizes.length; id++) {
        const center = provinces.length;
        const members: number[] = [];
        for (let j = 0; j < sizes[id]; j++) {
            const site = provinces.length;
            members.push(site);
            provinces.push({
                site, name: `P${site}`, owner: owners[id], legalOwner: owners[id], isCity: false, isCapital: false,
                garrison: 20, garrisonMax: 20, income: 4, defense: 1, population: 2,
                coreNation: owners[id], occupation: 100, buildings: [], deposits: { raw: 0, strategic: 0 }, stateId: id,
            });
        }
        states.push({ id, name: `S${id}`, center, provinces: members, culture: 0,
            buildings: [], factories: 1, prodFactories: 0, infrastructure: 0 });
    }
    const nations: Nation[] = [0, 1].map((id) => ({
        id, name: `N${id}`, color: "#000000", isPlayer: id === 0,
        capital: states.find((region) => provinces[region.center].owner === id)?.center ?? 0,
        alive: true, funds: 10000, industry: 10000, manpower: 10000,
        raw: 0, food: 0, strategic: 0, politicalPower: 20,
        policies: { ...DEFAULT_POLICIES },
    }));
    const count = provinces.length;
    const graph = {
        sites: provinces.map((p) => ({ x: p.site, y: 0, id: p.site })),
        domain: { width: count + 1, height: 10 },
        adjacency: provinces.map((p) => [p.site - 1, p.site + 1]
            .filter((site) => site >= 0 && site < count).map((site) => ({ site }))),
    } as unknown as GameState["graph"];
    const terrain = {
        passable: new Uint8Array(count).fill(1), terrainCost: new Float32Array(count).fill(1),
        getWeatherDebuff: () => ({ moveSpeed: 1, combatPenalty: 1 }), updateWeather: () => {},
    } as unknown as GameState["terrain"];
    return {
        settings: { seed: 42, mapSize: "small", nationCount: 2 }, graph, terrain, provinces, states, nations,
        armies: new Map(), armyAt: Array(count).fill(null), battles: [], deployments: [], construction: [],
        supply: null, supplyDirty: true, day: 1, seasonIndex: 0, selected: null, selectedArmyId: null,
        redeployArmyId: null, war: [[false, false], [false, false]], warSince: [[-1, -1], [-1, -1]],
        peaceOffers: [], truce: [[-1, -1], [-1, -1]], peaceCooldown: [-1, -1], log: [], winner: null,
        claims: [], diplomaticActions: [], wars: [], nextDiplomaticActionId: 1,
        alliances: [], diplomaticRequests: [], allianceCooldown: [[-1, -1], [-1, -1]],
        vassalCooldown: [[-1, -1], [-1, -1]], requestCooldown: createRequestCooldown(2),
        nextAllianceId: 1, nextRequestId: 1,
        tradeAgreements: [], nextTradeId: 1,
        nextArmyId: 1, nextRegimentId: 1, nextDeploymentId: 1, nextConstructionId: 1,
        stats: { battles: 0, captures: 0, recruited: 0, losses: 0 },
    };
}

function engine(state = fixture()): GameEngine {
    const result = new GameEngine(state);
    result.controllers.length = 0;
    return result;
}

test("unified scoped building profiles and exact costs", () => {
    assert.deepEqual(STATE_BUILDING_KINDS, ["factory", "farm", "infrastructure", "admin"]);
    assert.deepEqual(PROVINCE_BUILDING_KINDS, ["supply", "fort"]);
    assert.equal(BUILDING_PROFILES.fort.glyph, "防");
    const costs: Record<BuildingKind, number[]> = {
        factory: [180, 30, 8], farm: [80, 15, 4], infrastructure: [80, 15, 5],
        admin: [100, 15, 6], supply: [250, 40, 30], fort: [120, 15, 8],
    };
    for (const kind of [...STATE_BUILDING_KINDS, ...PROVINCE_BUILDING_KINDS]) {
        const profile = BUILDING_PROFILES[kind];
        assert.deepEqual([profile.costFunds, profile.costIndustry, profile.constructionPoints], costs[kind]);
        assert.equal(profile.scope, kind === "supply" || kind === "fort" ? "province" : "state");
        assert.match(profile.icon, /^building-[a-z-]+$/u);
        assert.ok(!/\p{Extended_Pictographic}/u.test(profile.glyph));
        assert.ok(!("turns" in profile));
    }
});

test("L0/L8 coefficients, center ownership, target movement cost", () => {
    near(infrastructureOutputMultiplier(0), 0.8);
    near(infrastructureBuildMultiplier(0), 0.8);
    near(infrastructureMoveMultiplier(0), 1);
    near(infrastructureSupplyMultiplier(0), 1);
    near(infrastructureOutputMultiplier(8), 1.2);
    near(infrastructureBuildMultiplier(8), 1.2);
    near(infrastructureMoveMultiplier(8), 0.6);
    near(infrastructureSupplyMultiplier(8), 1.4);
    near(infrastructureOutputMultiplier(NaN), 0.8);
    near(infrastructureMoveMultiplier(99), 0.6);
    const state = fixture();
    state.states[0].infrastructure = 8;
    near(entryCost(state, 1), 0.6);
    state.provinces[1].owner = 1;
    assert.equal(infrastructureLevel(state, 1), 0);
    near(entryCost(state, 1), 1);
    state.terrain.terrainCost[1] = 2;
    near(entryCost(state, 1), 2);
});

test("center-based resource yields, repeated farms and admin threshold without occupation bonus", () => {
    const state = fixture();
    const region = state.states[0];
    const fundsPolicy = CONSCRIPTION_POLICIES[DEFAULT_POLICIES.conscription].fundsMult;
    const base = resourceRates(state, 0);
    region.prodFactories = 1;
    let rates = resourceRates(state, 0);
    near(rates.fundsGross - base.fundsGross, 1.6 * fundsPolicy);
    near(rates.industry - base.industry, 1.6);
    region.infrastructure = 8;
    rates = resourceRates(state, 0);
    near(rates.industry - base.industry, 2.4);
    near(rates.fundsGross - base.fundsGross, 2.4 * fundsPolicy);
    region.buildings.push("farm", "farm", "admin");
    const built = resourceRates(state, 0);
    near(built.manpower - rates.manpower, 0);
    near(built.fundsGross - rates.fundsGross, 4 * fundsPolicy);
    assert.equal(built.politicalPower, 3);
    state.provinces[0].coreNation = 1;
    state.provinces[0].occupation = 49;
    assert.equal(resourceRates(state, 0).politicalPower, 2);
    assert.equal(occupationGrowth(state, state.provinces[0], 0), 4);
    state.provinces[0].occupation = 50;
    assert.equal(resourceRates(state, 0).politicalPower, 3);
    state.provinces[0].coreNation = 0;
    state.provinces[0].occupation = 0;
    assert.equal(resourceRates(state, 0).politicalPower, 3);
    assert.equal(buildingCount(region, "farm"), 2);
});

test("national production clamp prefers high infrastructure, never edits enemies", () => {
    const core = engine(fixture([8, 8, 8, 8], [0, 0, 0, 1]));
    const state = core.state;
    for (const region of state.states) region.factories = 3;
    state.states[1].infrastructure = state.states[2].infrastructure = 8;
    assert.ok(core.setFactoryProduction(4.4));
    assert.deepEqual(state.states.map((s) => s.prodFactories), [0, 3, 1, 0]);
    assert.ok(core.setFactoryProduction(2.6));
    assert.deepEqual(state.states.map((s) => s.prodFactories), [0, 3, 0, 0]);
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(core.setFactoryProduction(value), false);
    assert.equal(setFactoryProduction(core, 99, 1), false);
    assert.ok(core.setFactoryProduction(999));
    assert.deepEqual(state.states.map((s) => s.prodFactories), [3, 3, 3, 0]);
    assert.ok(core.setFactoryProduction(-5));
    assert.equal(factoryTotals(state, 0).prod, 0);
    assert.ok(setFactoryProduction(core, 1, 2));
    assert.deepEqual(state.states.map((s) => s.prodFactories), [0, 0, 0, 2]);
    state.winner = 0;
    assert.equal(core.setFactoryProduction(5), false);
});

for (const idle of [0, 1, 5, 6, 11]) {
    test(`allocation and waiting ETA with ${idle} idle factories`, () => {
        const core = engine();
        core.state.states[0].factories = idle;
        for (let i = 0; i < 3; i++) assert.ok(core.queueBuild(0, "farm"));
        const expected = [Math.min(5, idle), Math.max(0, Math.min(5, idle - 5)), Math.max(0, idle - 10)];
        const plan = constructionPlan(core.state, 0);
        assert.deepEqual(plan.map((p) => p.factories), expected);
        plan.forEach((entry, i) => near(entry.pointsPerTurn, expected[i] * 0.32));
        const etas = new Map<number, (number | null)[]>([[0, [null, null, null]], [1, [13, 26, 39]],
            [5, [3, 6, 9]], [6, [3, 5, 8]], [11, [3, 3, 5]]]);
        assert.deepEqual(plan.map((p) => p.eta), etas.get(idle));
        const finished = new Map<number, number>();
        let turn = 0;
        core.subscribe((event) => {
            if (event.type === "build") {
                const activeIds = new Set(core.state.construction.map((o) => o.id));
                for (const item of plan) if (!activeIds.has(item.orderId) && !finished.has(item.orderId)) finished.set(item.orderId, turn);
            }
        });
        if (idle === 0) {
            for (turn = 1; turn <= 5; turn++) processConstruction(core);
            assert.ok(core.state.construction.every((o) => o.remainingPoints === 4));
        } else {
            for (turn = 1; core.state.construction.length && turn <= 50; turn++) processConstruction(core);
            assert.deepEqual(plan.map((p) => finished.get(p.orderId)), plan.map((p) => p.eta));
        }
    });
}

test("source-weighted allocation and virtual hover plan do not mutate state", () => {
    const core = engine(fixture([10, 10, 10], [0, 0, 1]));
    core.state.states[0].factories = core.state.states[1].factories = 4;
    core.state.states[1].infrastructure = 8;
    assert.ok(core.queueBuild(0, "farm"));
    assert.ok(core.queueBuild(1, "farm"));
    const before = JSON.stringify(core.state);
    const plan = constructionPlan(core.state, 0);
    near(plan[0].pointsPerTurn, (4 * 0.4 + 0.6) * 0.8);
    near(plan[1].pointsPerTurn, 3 * 0.6 * 1.2);
    assert.deepEqual(plan.map((p) => p.factories), [5, 3]);
    const virtual = { ...core.state, construction: [...core.state.construction.map((o) => ({ ...o })),
        { ...core.state.construction[0], id: 999, remainingPoints: 30 }] };
    assert.ok(constructionPlan(virtual, 0).at(-1)!.eta! > 0);
    assert.equal(JSON.stringify(core.state), before);
});

test("reorder changes own assignment immediately and preserves enemy slots", () => {
    const core = engine();
    core.state.states[0].factories = 5;
    core.queueBuild(0, "farm");
    enqueueBuild(core, 1, 1, "farm");
    core.queueBuild(0, "farm");
    enqueueBuild(core, 1, 1, "farm");
    core.queueBuild(0, "farm");
    const enemy = constructionPlan(core.state, 1);
    assert.ok(core.reorderConstruction(5, 1));
    assert.deepEqual(core.state.construction.map((o) => o.id), [5, 2, 1, 4, 3]);
    assert.equal(constructionPlan(core.state, 0)[0].orderId, 5);
    assert.equal(constructionPlan(core.state, 0)[0].factories, 5);
    assert.deepEqual(constructionPlan(core.state, 1), enemy);
    assert.equal(core.reorderConstruction(2, 1), false);
    assert.equal(core.reorderConstruction(1, 2), false);
    assert.equal(core.reorderConstruction(99, null), false);
    assert.equal(core.reorderConstruction(1, 1), false);
    assert.ok(core.reorderConstruction(5, null));
    assert.deepEqual(core.state.construction.map((o) => o.id), [1, 2, 3, 4, 5]);
    core.state.winner = 1;
    assert.equal(core.reorderConstruction(5, 1), false);
});

for (const kind of ["factory", "infrastructure"] as const) {
    test(`${kind} completion cannot boost work in its completion turn`, () => {
        const core = engine();
        core.state.states[0].factories = 6;
        core.queueBuild(0, kind);
        core.queueBuild(0, "farm");
        core.state.construction[0].remainingPoints = 0.01;
        const second = core.state.construction[1];
        processConstruction(core);
        near(second.remainingPoints, 4 - 0.32);
        assert.equal(core.state.construction.length, 1);
        assert.equal(core.state.states[0].prodFactories, 0);
        const next = constructionPlan(core.state, 0)[0];
        near(next.pointsPerTurn, kind === "factory" ? 1.6 : 5 * 0.5 * 0.85 * 0.85);
    });
}

test("ETA freezes future factories/upgrades and workers never spill over the same turn", () => {
    for (const kind of ["factory", "infrastructure"] as const) {
        const core = engine();
        core.queueBuild(0, kind);
        core.queueBuild(0, "farm");
        core.state.construction[0].remainingPoints = 0.01;
        core.state.construction[1].remainingPoints = 0.66;
        assert.deepEqual(constructionPlan(core.state, 0).map((p) => p.eta), [1, 4]);
        processConstruction(core);
        near(core.state.construction[0].remainingPoints, 0.66);
        processConstruction(core);
        assert.equal(core.state.construction.length, 1);
        processConstruction(core);
        assert.equal(core.state.construction.length, 0);
    }
});

test("all nations snapshot assignments before completion and batch events", () => {
    const core = engine();
    core.state.states.forEach((region) => { region.factories = 6; });
    for (const nation of [0, 1]) {
        assert.ok(enqueueBuild(core, nation, nation, "infrastructure"));
        assert.ok(enqueueBuild(core, nation, nation, "farm"));
        core.state.construction.at(-2)!.remainingPoints = 0.01;
    }
    let events = 0;
    core.subscribe((event) => {
        if (event.type !== "build") return;
        events++;
        assert.ok(core.state.states.every((region) => region.infrastructure === 1));
    });
    processConstruction(core);
    assert.equal(events, 2);
    core.state.construction.forEach((order) => near(order.remainingPoints, 3.68));
    assert.ok(core.state.supplyDirty);
});

test("separate caps include all pending orders, cancellation refunds exact halves", () => {
    const core = engine(fixture([2, 2]));
    const state = core.state;
    assert.ok(core.queueBuild(0, "factory"));
    assert.equal(core.queueBuild(0, "factory"), false);
    assert.ok(core.queueBuild(0, "farm"));
    assert.ok(core.queueBuild(0, "farm"));
    assert.equal(core.queueBuild(0, "farm"), false);
    for (let i = 0; i < 8; i++) assert.ok(core.queueBuild(0, "infrastructure"));
    assert.equal(core.queueBuild(0, "infrastructure"), false);
    assert.ok(core.queueBuild(0, "admin"));
    assert.equal(core.queueBuild(0, "admin"), false);
    for (const site of [0, 1]) for (const kind of PROVINCE_BUILDING_KINDS) {
        assert.ok(core.queueProvinceBuild(site, kind));
        assert.equal(core.queueProvinceBuild(site, kind), false);
    }
    assert.equal(core.queueBuild(1, "farm"), false);
    assert.equal(core.queueProvinceBuild(2, "fort"), false);
    assert.equal(core.queueBuild(0, "fort" as never), false);
    assert.equal(core.queueProvinceBuild(0, "farm" as never), false);
    assert.equal(core.queueBuild(99, "farm"), false);
    const order = state.construction.find((o) => o.kind === "farm")!;
    const { funds, industry } = state.nations[0];
    assert.ok(core.cancelBuild(order.id));
    near(state.nations[0].funds, funds + 40);
    near(state.nations[0].industry, industry + 7.5);
    assert.ok(core.queueBuild(0, "farm"));
    assert.equal(core.cancelBuild(order.id), false);
    enqueueBuild(core, 1, 1, "farm");
    assert.equal(core.cancelBuild(state.construction.at(-1)!.id), false);
    state.winner = 0;
    assert.equal(core.cancelBuild(state.construction[0].id), false);
    assert.equal(canBuild(state, 0, 0, "farm"), false);
    assert.equal(canBuildProvince(state, 0, 0, "fort"), false);
});

test("province capacity uses local control and reserves pending slots independently", () => {
    for (const kind of PROVINCE_BUILDING_KINDS) {
        const core = engine(fixture([3, 3]));
        const state = core.state;
        const province = state.provinces[4];
        province.owner = 0;
        state.terrain.passable[2] = 0;
        state.provinces[5].owner = -1;
        assert.deepEqual(provinceBuildingCapacity(state, province, kind), { built: 0, pending: 0, used: 0, limit: 1 });
        assert.ok(canBuildProvince(state, 0, province.site, kind));
        assert.ok(core.queueProvinceBuild(province.site, kind));
        assert.deepEqual(provinceBuildingCapacity(state, province, kind), { built: 0, pending: 1, used: 1, limit: 1 });
        assert.equal(core.queueProvinceBuild(province.site, kind), false);
        assert.ok(canBuildProvince(state, 0, province.site, kind === "fort" ? "supply" : "fort"));
        for (const site of [2, 3, 5]) assert.equal(core.queueProvinceBuild(site, kind), false);
        assert.ok(core.cancelBuild(state.construction[0].id));
        assert.ok(canBuildProvince(state, 0, province.site, kind));
        state.nations[0].funds = 0;
        assert.equal(core.queueProvinceBuild(province.site, kind), false);
        assert.equal(provinceBuildingCapacity(state, province, kind).used, 0);
        province.buildings.push(kind);
        assert.deepEqual(provinceBuildingCapacity(state, province, kind), { built: 1, pending: 0, used: 1, limit: 1 });
        assert.equal(canBuildProvince(state, 0, province.site, kind), false);
    }
});

test("build completion respects caps, province scope and supply invalidation", () => {
    const core = engine(fixture([2, 2]));
    core.queueBuild(0, "factory");
    core.queueBuild(0, "farm");
    core.queueBuild(0, "farm");
    core.queueBuild(0, "admin");
    for (let i = 0; i < 8; i++) core.queueBuild(0, "infrastructure");
    core.queueProvinceBuild(1, "fort");
    core.queueProvinceBuild(1, "supply");
    const neighborMax = core.state.provinces[0].garrisonMax;
    for (let i = 0; i < 250 && core.state.construction.length; i++) processConstruction(core);
    assert.equal(core.state.construction.length, 0);
    assert.equal(core.state.states[0].factories, 2);
    assert.equal(core.state.states[0].infrastructure, 8);
    assert.deepEqual(core.state.states[0].buildings, ["farm", "farm", "admin"]);
    assert.deepEqual(core.state.provinces[1].buildings, ["fort", "supply"]);
    assert.equal(core.state.provinces[0].garrisonMax, neighborMax);
    assert.equal(core.state.provinces[1].garrisonMax, 30);
    assert.ok(core.state.supplyDirty);
});

test("capture transfers center outputs/roads, leaves local buildings, refunds interrupted orders", () => {
    const core = engine(fixture([4, 4]));
    const state = core.state;
    state.states[0].infrastructure = 8;
    state.states[0].prodFactories = 1;
    state.states[0].buildings.push("farm", "admin");
    state.provinces[1].buildings.push("fort");
    core.queueBuild(0, "farm");
    core.queueProvinceBuild(1, "supply");
    const before = { ...state.nations[0] };
    claimProvince(core, 1, 1, 0);
    assert.equal(infrastructureLevel(state, 1), 0);
    assert.equal(factoryTotals(state, 0).total, 1);
    assert.deepEqual(state.provinces[1].buildings, ["fort"]);
    assert.equal(state.provinces[1].garrisonMax, 30);
    near(state.nations[0].funds - before.funds, 125);
    near(state.nations[0].industry - before.industry, 20);
    claimProvince(core, 0, 1, 0);
    assert.deepEqual(state.states[0].provinces.map((site) => state.provinces[site].owner), [1, 1, 0, 0]);
    assert.ok(state.states[0].provinces.every((site) => state.provinces[site].legalOwner === 0));
    assert.equal(infrastructureLevel(state, 1), 8);
    assert.equal(factoryTotals(state, 0).total, 0);
    assert.equal(factoryTotals(state, 1).total, 2);
    assert.equal(state.construction.length, 0);
    near(state.nations[0].funds - before.funds, 165);
    near(state.nations[0].industry - before.industry, 27.5);
    assert.deepEqual(state.states[0].buildings, ["farm", "admin"]);
    assert.equal(resourceRates(state, 0).industry, 0);
    near(resourceRates(state, 1).industry, 2.4 * 0.25);
    assert.equal(resourceRates(state, 1).politicalPower, 2);
    state.provinces[0].occupation = 50;
    assert.equal(resourceRates(state, 1).politicalPower, 3);
    assert.ok(state.supplyDirty);
});

test("supply center terrain-radius falloff, target infrastructure and capped combat factors", () => {
    const state = fixture([20], [0]);
    state.provinces[0].buildings.push("supply");
    let supply = computeSupply(state);
    near(supply.level[0], 1.32);
    near(supply.level[4], (0.5 + 0.1 * 0.5) * (1 + 0.2 * 0.5));
    near(supply.level[8], 0);
    assert.equal(supply.distance[8], 1);
    assert.equal(supply.distance[9], 2);
    state.states[0].infrastructure = 8;
    supply = computeSupply(state);
    near(supply.level[0], 1.32 * 1.4);
    near(supply.level[4], 0.605 * 1.4);
    assert.equal(supplyAttackFactor(state, 0), 1);
    assert.equal(supplyOrgFactor(state, 0), 1);
    near(supplyLevel(state, 0), 1.32 * 1.4);
    state.terrain.terrainCost[1] = 3;
    state.supplyDirty = true;
    near(supplyLevel(state, 4), (0.25 + 0.025) * 1.05 * 1.4);
    near(supplyDistance(state, 4), 0.75);
});

test("overlapping supply centers use max, including city-supplied base", () => {
    const state = fixture([20], [0]);
    state.provinces[0].buildings.push("supply");
    const solo = computeSupply(state).level[4];
    state.provinces[8].buildings.push("supply");
    near(computeSupply(state).level[4], solo);
    state.provinces[4].isCity = true;
    near(computeSupply(state).level[4], (1 + 0.05) * 1.1);
});

test("supply never crosses enemy/water, occupied source threshold and core override", () => {
    for (const barrier of ["enemy", "water"] as const) {
        const state = fixture([20], [0]);
        state.provinces[0].buildings.push("supply");
        if (barrier === "enemy") state.provinces[1].owner = 1;
        else state.terrain.passable[1] = 0;
        near(computeSupply(state).level[2], 0);
        assert.equal(computeSupply(state).distance[2], 2);
    }
    const state = fixture([20], [0]);
    state.provinces[0].buildings.push("supply");
    state.provinces[0].coreNation = 1;
    state.provinces[0].occupation = 49;
    assert.deepEqual(computeSupply(state).sources, []);
    state.provinces[0].occupation = 50;
    assert.deepEqual(computeSupply(state).sources, [0]);
    state.provinces[0].occupation = 0;
    state.provinces[0].coreNation = 0;
    near(computeSupply(state).level[0], 1.32);
});

test("daily occupation and terrain/weather refresh activates newly integrated supply centers", () => {
    const core = engine(fixture([20], [0]));
    const state = core.state;
    state.provinces[0].coreNation = 1;
    state.provinces[0].occupation = 49;
    state.provinces[0].buildings.push("supply");
    near(supplyLevel(state, 1), 0);
    state.terrain.updateWeather = () => { state.terrain.terrainCost[1] = 2; };
    core.endTurn();
    assert.equal(state.provinces[0].occupation, 53);
    near(supplyLevel(state, 1), (0.75 + 0.075) * 1.15);
    assert.equal(state.supplyDirty, false);
});

test("near short-range city cannot suppress farther capital traversal", () => {
    const state = fixture([20], [0]);
    state.provinces[0].isCapital = true;
    state.provinces[2].isCity = true;
    state.provinces[2].coreNation = 1;
    state.provinces[2].occupation = 0; // Range 2.5; the capital must traverse this source.
    const supply = computeSupply(state);
    near(supply.level[10], 1 - 10 / 14);
    near(supply.distance[10], 10 / 14);
    near(supply.level[2], 1);
    state.provinces[0].isCapital = false;
    state.provinces[0].isCity = true;
    near(computeSupply(state).level[5], 0.5);
});

test("fort local capacity/recovery, accurate forecast and incoming garrison damage", () => {
    const core = engine();
    const state = core.state;
    const province = state.provinces[16];
    const before = garrisonCapacity(province);
    province.buildings.push("fort");
    refreshGarrisonCapacity(state, province);
    assert.equal(province.garrisonMax, Math.round(before * 1.5));
    assert.equal(provinceDefense(state, province), province.defense);
    assert.equal(garrisonRecoveryRate(province), 0.08);
    assert.equal(garrisonRecoveryRate(state.provinces[17]), 0.05);
    province.garrison = state.provinces[17].garrison = 0;
    core.endTurn();
    assert.equal(province.garrison, Math.ceil(province.garrisonMax * 0.08));
    assert.equal(state.provinces[17].garrison, 2);
    const attacker = spawnArmy(state, 0, 15, Array(8).fill(UnitKind.INFANTRY), 100);
    const defender = spawnArmy(state, 1, 16, [UnitKind.INFANTRY], 100);
    province.garrison = 20;
    const fort = battleForecast(state, attacker, 16);
    province.buildings.length = 0;
    const plain = battleForecast(state, attacker, 16);
    near(fort.garrisonPower, plain.garrisonPower * 1.25);
    near(fort.defenderArmyPower, plain.defenderArmyPower);
    near(fort.defensePower - plain.defensePower, plain.garrisonPower * 0.25 * province.defense);
    near(fort.garrisonIncomingMultiplier, 0.8);
    province.buildings.push("fort");
    const forecast = battleForecast(state, attacker, 16);
    const share = forecast.garrisonPower / (forecast.garrisonPower + forecast.defenderArmyPower);
    const rand = { nextFloat: () => 0.5 } as LCGRandom;
    const round = resolveBattleRound(state, { province: 16, attackerId: attacker.id, defenderId: defender.id, rounds: 0 }, rand);
    assert.equal(round.garrisonBefore - round.garrisonAfter, Math.round(forecast.attackPower * 0.5 * share * 0.8));
});

test("ETA event simulation handles billion-turn horizons without per-turn loops", () => {
    const state = fixture([1000], [0]);
    for (let id = 1; id <= 1000; id++) state.construction.push({
        id, nation: 0, site: 0, kind: "farm", remainingPoints: 320000,
        paidFunds: 80, paidIndustry: 15,
    });
    const start = performance.now();
    const plan = constructionPlan(state, 0);
    assert.equal(plan.at(-1)!.eta, 1_000_000_000);
    assert.ok(performance.now() - start < 5000, "ETA should jump completion events, not simulate turns");
});

test("seeded worlds start with capped farms/factories, capital admin, infra1 and national idle", () => {
    for (const seed of [42, 12345]) {
        const state = generateWorld({ seed, mapSize: "small", nationCount: 4 });
        for (const region of state.states) {
            assert.ok(region.factories <= region.provinces.length);
            assert.ok(buildingCount(region, "farm") <= region.provinces.length);
            assert.equal(region.infrastructure, 1);
            assert.ok(!("buildingSlots" in region) && !("factorySlots" in region));
        }
        for (const province of state.provinces) {
            assert.deepEqual(province.buildings, []);
            assert.ok(!("infrastructure" in province));
        }
        for (const nation of state.nations) {
            const totals = factoryTotals(state, nation.id);
            assert.ok(totals.total >= 1);
            assert.equal(totals.idle, Math.max(1, Math.ceil(totals.total / 3)));
            const capitalState = state.states[state.provinces[nation.capital].stateId];
            assert.equal(capitalState.center, nation.capital);
            assert.ok(capitalState.buildings.includes("admin"));
        }
    }
});

test("standard 1500-cell world completes construction across 24 real AI turns", () => {
    const core = GameEngine.create(2026, "standard", 4);
    let completed = 0;
    core.subscribe((event) => { if (event.type === "build") completed++; });
    for (let turn = 0; turn < 24 && core.state.winner === null; turn++) {
        core.endTurn();
        for (const region of core.state.states) {
            assert.ok(region.factories <= region.provinces.length);
            assert.ok(region.prodFactories >= 0 && region.prodFactories <= region.factories);
            assert.ok(region.infrastructure <= 8);
        }
    }
    assert.equal(core.state.provinces.length, 1500);
    assert.equal(core.state.day, 25);
    assert.ok(completed > 0);
});

test("AI runs 40 turns, restores idle workers from all-production, completes its own queue", () => {
    const state = fixture([16, 16]);
    state.states[1].factories = 3;
    state.states[1].prodFactories = 3;
    const core = new GameEngine(state);
    assert.ok(enqueueBuild(core, 1, 1, "factory"));
    let completions = 0;
    core.subscribe((event) => { if (event.type === "build" && event.nationId === 1) completions++; });
    for (let i = 0; i < 40; i++) {
        core.endTurn();
        const totals = factoryTotals(state, 1);
        if (state.construction.some((order) => order.nation === 1) && totals.total > 0) assert.ok(totals.idle >= 1);
        for (const region of state.states) {
            assert.ok(region.prodFactories >= 0 && region.prodFactories <= region.factories);
            assert.ok(region.factories <= region.provinces.length);
            assert.ok(region.infrastructure <= 8);
        }
        state.nations.forEach((nation) => {
            assert.ok(Number.isFinite(nation.funds) && Number.isFinite(nation.industry));
        });
    }
    assert.equal(state.day, 41);
    assert.ok(completions >= 2, `AI completed only ${completions} orders`);
});
