import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import {
    advancePolicySwitches,
    cancelPolicySwitch,
    categoryModifiers,
    policyModifiers,
    policySwitchUpkeep,
    policyTransitionProgress,
    startPolicySwitch,
    tickPolicyUpkeep,
} from "../game/policy.ts";
import { DEFAULT_POLICIES, POLICY_SWITCH_COST, POLICY_SWITCH_DAYS, POLICY_SWITCH_UPKEEP } from "../game/types.ts";
import type { GameState, Nation, Province, StateRegion } from "../game/types.ts";

function near(actual: number, expected: number, epsilon = 1e-6): void {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

/** Two-nation line map; the policy module only needs state, log and emit. */
function fixture(politicalPower = 20): GameState {
    const provinces: Province[] = [];
    const states: StateRegion[] = [];
    for (const owner of [0, 1]) {
        const members: number[] = [];
        for (let i = 0; i < 2; i++) {
            const site = provinces.length;
            members.push(site);
            provinces.push({
                site, name: `P${site}`, owner, legalOwner: owner, isCity: false, isCapital: false,
                garrison: 10, garrisonMax: 10, income: 4, defense: 1, population: 2,
                coreNation: owner, occupation: 100, buildings: [], stateId: owner,
            });
        }
        states.push({ id: owner, name: `S${owner}`, center: members[0], provinces: members, culture: 0,
            buildings: [], factories: 0, prodFactories: 0, infrastructure: 0 });
    }
    const nations: Nation[] = [0, 1].map((id) => ({
        id, name: `N${id}`, color: "#000000", isPlayer: id === 0, capital: states[id].center,
        alive: true, funds: 1000, industry: 100, manpower: 1000, politicalPower,
        policies: { ...DEFAULT_POLICIES }, policyTransitions: {},
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
        settings: { seed: 7, mapSize: "small", nationCount: 2 }, graph, terrain, provinces, states, nations,
        armies: new Map(), armyAt: Array(count).fill(null), battles: [], deployments: [], construction: [],
        supply: null, supplyDirty: true, day: 1, seasonIndex: 0, selected: null, selectedArmyId: null,
        redeployArmyId: null, war: [[false, false], [false, false]], warSince: [[-1, -1], [-1, -1]],
        peaceOffers: [], truce: [[-1, -1], [-1, -1]], peaceCooldown: [-1, -1], log: [], winner: null,
        claims: [], diplomaticActions: [], wars: [], nextDiplomaticActionId: 1,
        nextArmyId: 1, nextRegimentId: 1, nextDeploymentId: 1, nextConstructionId: 1,
        stats: { battles: 0, captures: 0, recruited: 0, losses: 0 },
    };
}

function engine(politicalPower = 20): GameEngine {
    const result = new GameEngine(fixture(politicalPower));
    result.controllers.length = 0;
    return result;
}

test("starting a switch pays the upfront cost and records the transition", () => {
    const core = engine();
    const nation = core.state.nations[0];

    assert.equal(startPolicySwitch(core, "economy", "balanced"), false);
    assert.equal(startPolicySwitch(core, "economy", "bogus"), false);
    assert.equal(nation.politicalPower, 20);

    assert.equal(startPolicySwitch(core, "economy", "market"), true);
    assert.equal(nation.politicalPower, 20 - POLICY_SWITCH_COST);
    assert.equal(nation.policies.economy, "balanced");
    const transition = nation.policyTransitions?.economy;
    assert.ok(transition);
    assert.deepEqual(
        [transition.category, transition.from, transition.to, transition.startedDay, transition.readyDay, transition.upkeepSpent],
        ["economy", "balanced", "market", 1, 1 + POLICY_SWITCH_DAYS, 0],
    );
    assert.equal(core.state.log.at(-1)?.tone, "system");

    assert.equal(startPolicySwitch(core, "economy", "planned"), false);
    assert.equal(nation.politicalPower, 20 - POLICY_SWITCH_COST);

    const poor = engine(POLICY_SWITCH_COST - 1);
    assert.equal(startPolicySwitch(poor, "economy", "market"), false);
    assert.equal(poor.state.nations[0].politicalPower, POLICY_SWITCH_COST - 1);
    assert.equal(poor.state.nations[0].policyTransitions?.economy, undefined);
});

test("live modifiers ramp each turn and the policy commits when the ramp ends", () => {
    const core = engine();
    const state = core.state;
    const nation = state.nations[0];
    assert.equal(startPolicySwitch(core, "economy", "market"), true);

    const fundsAt = (day: number): number => {
        state.day = day;
        return categoryModifiers(nation, "economy", day).fundsMult;
    };
    const transition = nation.policyTransitions?.economy;
    assert.ok(transition);
    near(policyTransitionProgress(transition, 1), 0);
    near(fundsAt(1), 1);
    near(fundsAt(2), 1 + (1.2 - 1) / POLICY_SWITCH_DAYS);
    near(fundsAt(3), 1 + 2 * (1.2 - 1) / POLICY_SWITCH_DAYS);
    near(policyModifiers(nation, 2).fundsMult, 1.1 * (1 + (1.2 - 1) / POLICY_SWITCH_DAYS));

    state.day = 3;
    advancePolicySwitches(core);
    assert.equal(nation.policies.economy, "balanced");
    assert.ok(nation.policyTransitions?.economy);

    near(fundsAt(1 + POLICY_SWITCH_DAYS), 1.2);
    state.day = 1 + POLICY_SWITCH_DAYS;
    advancePolicySwitches(core);
    assert.equal(nation.policies.economy, "market");
    assert.equal(nation.policyTransitions?.economy, undefined);
    near(categoryModifiers(nation, "economy", state.day).fundsMult, 1.2);
    assert.match(state.log.at(-1)?.text ?? "", /经济政策生效/);
});

test("cancelling reverts to the committed policy without refunding spent points", () => {
    const core = engine();
    const state = core.state;
    const nation = state.nations[0];
    assert.equal(startPolicySwitch(core, "occupation", "harsh"), true);
    state.day = 2;
    assert.equal(tickPolicyUpkeep(core), undefined);
    const spent = nation.politicalPower;

    assert.equal(cancelPolicySwitch(core, "occupation"), true);
    assert.equal(nation.politicalPower, spent);
    assert.equal(nation.policies.occupation, "balanced");
    assert.equal(nation.policyTransitions?.occupation, undefined);
    assert.equal(cancelPolicySwitch(core, "occupation"), false);

    state.day = 10;
    advancePolicySwitches(core);
    assert.equal(nation.policies.occupation, "balanced");
});

test("daily upkeep charges only while ramping and never below zero", () => {
    const core = engine();
    const state = core.state;
    const nation = state.nations[0];
    assert.equal(startPolicySwitch(core, "conscription", "total"), true);
    assert.equal(startPolicySwitch(core, "economy", "market"), true);
    assert.equal(nation.politicalPower, 20 - 2 * POLICY_SWITCH_COST);
    assert.equal(policySwitchUpkeep(nation), 2 * POLICY_SWITCH_UPKEEP);

    state.day = 2;
    tickPolicyUpkeep(core);
    assert.equal(nation.politicalPower, 0);
    assert.equal(nation.policyTransitions?.conscription?.upkeepSpent, POLICY_SWITCH_UPKEEP);
    assert.equal(nation.policyTransitions?.economy?.upkeepSpent, 1);

    state.day = 1 + POLICY_SWITCH_DAYS;
    const done = nation.politicalPower;
    tickPolicyUpkeep(core);
    assert.equal(nation.politicalPower, done);

    const poor = engine(POLICY_SWITCH_COST + 1);
    assert.equal(startPolicySwitch(poor, "economy", "market"), true);
    poor.state.day = 2;
    tickPolicyUpkeep(poor);
    assert.equal(poor.state.nations[0].politicalPower, 0);
    tickPolicyUpkeep(poor);
    assert.equal(poor.state.nations[0].politicalPower, 0);
    assert.equal(poor.state.nations[0].policyTransitions?.economy?.upkeepSpent, 1);
});