import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import {
    CLAIM_COST, DIPLOMATIC_PROFILES, TRUCE_DAYS, advanceDiplomacy, aiWarTarget,
    canClaimState, canCancelStateClaim, canDeclareWar, canPrepareDiplomaticAction, cancelDiplomaticAction,
    cancelClaim, claimState, claimableStateIds, hasStateClaim, isAtWar, makePeace,
    prepareDiplomaticAction, runAIDiplomacy, setWar, startWar, stateSummary, tickDiplomaticUpkeep, truceDays,
} from "../game/diplomacy.ts";
import { MAX_HP, REGIMENT_CAP, UnitKind } from "../game/types.ts";
import type { DiplomaticActionKind, GameState } from "../game/types.ts";

function engine(seed = 42, mapSize: "small" | "standard" = "small", nationCount = 4): GameEngine {
    const core = GameEngine.create(seed, mapSize, nationCount);
    core.controllers.length = 0;
    for (const nation of core.state.nations) nation.politicalPower = 100;
    return core;
}

function adjacent(state: GameState, nation: number, stateId: number): boolean {
    return state.states[stateId].provinces.some((site) =>
        state.graph.adjacency[site].some((edge) => state.provinces[edge.site].owner === nation));
}

function foreignRegion(state: GameState, nation = 0) {
    const region = state.states.find((region) => adjacent(state, nation, region.id) &&
        region.provinces.some((site) => state.provinces[site].legalOwner !== nation));
    assert.ok(region);
    const target = state.provinces[region.provinces.find((site) => state.provinces[site].legalOwner !== nation)!].legalOwner;
    return { region, target };
}

function readyConquest(core: GameEngine, nation = 0) {
    const { region, target } = foreignRegion(core.state, nation);
    assert.ok(claimState(core, nation, region.id));
    assert.ok(prepareDiplomaticAction(core, nation, "conquest", target, region.id));
    const action = core.state.diplomaticActions.at(-1)!;
    core.state.day = action.readyDay;
    advanceDiplomacy(core);
    return { region, target, action };
}

function strengthen(core: GameEngine, nation: number): void {
    for (const army of core.state.armies.values()) {
        if (army.nation !== nation) continue;
        army.org = 100;
        for (const regiment of army.regiments) regiment.hp = MAX_HP;
        while (army.regiments.length < REGIMENT_CAP) {
            army.regiments.push({ id: core.state.nextRegimentId++, kind: UnitKind.TANK, hp: MAX_HP });
        }
    }
}

test("profiles, malformed commands and insufficient PP are validated without fees", () => {
    const core = engine();
    const state = core.state;
    const { region, target } = foreignRegion(state);
    assert.equal(CLAIM_COST, 8);
    assert.deepEqual(DIPLOMATIC_PROFILES, {
        conquest: { label: "夺取宣称州", cost: 12, days: 4, validDays: 12, upkeep: 1 },
        annex: { label: "全面吞并", cost: 35, days: 8, validDays: 16, upkeep: 2 },
    });
    for (const bad of [NaN, Infinity, -1, 0.5, 99999]) {
        assert.equal(claimState(core, bad, region.id), false);
        assert.equal(claimState(core, 0, bad), false);
        assert.equal(canDeclareWar(state, 0, bad), false);
    }
    for (const kind of ["unknown", "toString", "__proto__", "frontier"] as unknown as DiplomaticActionKind[]) {
        assert.equal(prepareDiplomaticAction(core, 0, kind, target, region.id), false);
    }
    assert.equal(prepareDiplomaticAction(core, 0, "annex", target, region.id), false);
    assert.equal(prepareDiplomaticAction(core, 0, "conquest", target, region.id), false);
    assert.equal(prepareDiplomaticAction(core, 0, "annex", 0, null), false);
    assert.equal(prepareDiplomaticAction(core, 0, "annex", 99999, null), false);
    assert.equal(state.nations[0].politicalPower, 100);
    state.nations[0].politicalPower = 7;
    assert.equal(claimState(core, 0, region.id), false);
    assert.equal(state.nations[0].politicalPower, 7);
    assert.equal(state.claims.length, 0);
    assert.equal(state.diplomaticActions.length, 0);
    state.winner = 0;
    state.nations[0].politicalPower = 100;
    assert.equal(claimState(core, 0, region.id), false);
    assert.equal(prepareDiplomaticAction(core, 0, "annex", target, null), false);
});

test("non-core claims cost once and never change historical cores, control or legal ownership", () => {
    const core = engine();
    const state = core.state;
    const { region, target } = foreignRegion(state);
    assert.ok(region.provinces.every((site) => state.provinces[site].coreNation !== 0));
    const before = state.provinces.map((p) => [p.owner, p.legalOwner, p.coreNation]);
    assert.ok(claimState(core, 0, region.id));
    assert.equal(state.nations[0].politicalPower, 92);
    assert.ok(hasStateClaim(state, 0, region.id));
    assert.equal(claimState(core, 0, region.id), false);
    assert.equal(canClaimState(state, 0, region.id), false);
    assert.equal(state.nations[0].politicalPower, 92);
    assert.deepEqual(state.provinces.map((p) => [p.owner, p.legalOwner, p.coreNation]), before);
    assert.equal(canClaimState(state, target, region.id), false);

    // A second nation may retain an independent historical claim even without adjacency.
    const second = state.nations.find((n) => n.id !== 0 && n.id !== target && !adjacent(state, n.id, region.id))!;
    assert.ok(second);
    state.provinces[region.provinces[0]].coreNation = second.id;
    assert.ok(claimState(core, second.id, region.id));
    assert.ok(hasStateClaim(state, 0, region.id));
    assert.ok(hasStateClaim(state, second.id, region.id));
    assert.equal(prepareDiplomaticAction(core, second.id, "conquest", target, region.id), false);
});

test("claimableStateIds mirrors canClaimState and shrinks as claims are paid", () => {
    const core = engine();
    const state = core.state;
    state.nations[0].politicalPower = 1000;
    const ids = claimableStateIds(state, 0);
    assert.ok(ids.length > 0);
    for (const region of state.states) assert.equal(ids.includes(region.id), canClaimState(state, 0, region.id));
    assert.ok(claimState(core, 0, ids[0]));
    const after = claimableStateIds(state, 0);
    assert.equal(after.includes(ids[0]), false);
    assert.equal(after.length, ids.length - 1);
    state.nations[0].politicalPower = 0;
    assert.deepEqual(claimableStateIds(state, 0), []);
    state.winner = 0;
    state.nations[0].politicalPower = 1000;
    assert.deepEqual(claimableStateIds(state, 0), []);
});

test("stateSummary aggregates cores, owners, control shares and claimants as a frozen snapshot", () => {
    const core = engine();
    const state = core.state;
    const { region, target } = foreignRegion(state);
    assert.ok(claimState(core, 0, region.id));
    const third = state.nations.find((n) => n.id !== 0 && n.id !== target)!.id;
    const site = region.provinces[0];
    state.provinces[site].owner = third;
    state.provinces[site].coreNation = third;
    const summary = stateSummary(state, region.id)!;
    assert.ok(summary.cores.includes(target) && summary.cores.includes(third));
    assert.deepEqual(summary.owners, [target]);
    const percent = Math.round(100 / region.provinces.length);
    assert.deepEqual(summary.control.find((entry) => entry.nation === third), { nation: third, percent });
    assert.equal(summary.control.reduce((sum, entry) => sum + entry.percent, 0) >= 99, true);
    assert.deepEqual(summary.claimants, [0]);
    assert.equal(stateSummary(state, 99999), null);
    // The snapshot must not track later mutations of the live state.
    state.provinces[site].owner = target;
    assert.deepEqual(summary.control.find((entry) => entry.nation === third), { nation: third, percent });
});

test("conquest pays for claim and preparation, waits, snapshots legal targets and consumes only justification", () => {
    const core = engine();
    const state = core.state;
    const { region, target } = foreignRegion(state);
    assert.ok(claimState(core, 0, region.id));
    assert.ok(prepareDiplomaticAction(core, 0, "conquest", target, region.id));
    const action = state.diplomaticActions[0];
    assert.equal(state.nations[0].politicalPower, 80);
    assert.deepEqual([action.startedDay, action.readyDay, action.expiresDay], [1, 5, 17]);
    assert.equal(startWar(core, 0, target), false);
    state.day = action.readyDay - 1;
    assert.equal(canDeclareWar(state, 0, target, action.id), false);
    state.day++;
    assert.ok(canDeclareWar(state, 0, target));
    assert.equal(canDeclareWar(state, 0, target, action.id + 100), false);
    assert.equal(canDeclareWar(state, 0, target, NaN), false);
    assert.equal(startWar(core, target, 0, action.id), false);
    assert.equal(state.diplomaticActions.length, 1);
    // A third party receives one province before declaration: it must not enter the snapshot.
    const third = state.nations.find((n) => n.id !== 0 && n.id !== target)!.id;
    state.provinces[region.provinces[0]].legalOwner = third;
    const targets = region.provinces.filter((site) => state.provinces[site].legalOwner === target);
    assert.ok(targets.length > 0);
    const ownership = state.provinces.map((p) => [p.owner, p.legalOwner, p.coreNation]);
    for (const army of state.armies.values()) army.march = { target: army.province, attack: false };
    const events: string[] = [];
    core.subscribe((event) => events.push(event.type));
    assert.ok(startWar(core, 0, target, action.id));
    assert.ok(isAtWar(state, target, 0));
    assert.equal(state.warSince[0][target], 5);
    assert.equal(state.diplomaticActions.length, 0);
    assert.deepEqual(state.wars, [{ aggressor: 0, defender: target, goal: "conquest", stateId: region.id,
        targetSites: [...targets].sort((a, b) => a - b), startedDay: 5 }]);
    assert.ok(hasStateClaim(state, 0, region.id));
    assert.deepEqual(state.provinces.map((p) => [p.owner, p.legalOwner, p.coreNation]), ownership);
    assert.ok([...state.armies.values()].filter((a) => a.nation === 0 || a.nation === target).every((a) => a.march === null));
    assert.deepEqual(events, ["war", "state"]);
    assert.equal(startWar(core, 0, target, action.id), false);
    assert.equal(state.nations[0].politicalPower, 80);
    assert.equal(state.wars.length, 1);
});

test("only one unfinished preparation per nation; ready distinct actions coexist, duplicates never charge", () => {
    const core = engine();
    const state = core.state;
    const { region, target } = foreignRegion(state);
    assert.ok(claimState(core, 0, region.id));
    assert.ok(prepareDiplomaticAction(core, 0, "conquest", target, region.id));
    assert.equal(prepareDiplomaticAction(core, 0, "conquest", target, region.id), false);
    assert.equal(prepareDiplomaticAction(core, 0, "annex", target, null), false);
    const other = foreignRegion(state, 1);
    assert.ok(claimState(core, 1, other.region.id));
    assert.ok(prepareDiplomaticAction(core, 1, "conquest", other.target, other.region.id));
    state.day = 5;
    advanceDiplomacy(core);
    assert.equal(prepareDiplomaticAction(core, 0, "conquest", target, region.id), false);
    assert.ok(prepareDiplomaticAction(core, 0, "annex", target, null));
    assert.equal(state.nations[0].politicalPower, 45);
    assert.equal(state.diplomaticActions.filter((a) => a.nation === 0).length, 2);
});

test("truce blocks both preparations and declarations, including ready justifications", () => {
    const core = engine();
    const state = core.state;
    const { region, target } = foreignRegion(state);
    assert.ok(claimState(core, 0, region.id));
    setWar(state, 0, target, false);
    assert.equal(truceDays(state, 0, target), TRUCE_DAYS);
    for (const kind of ["conquest", "annex"] as const) {
        assert.equal(prepareDiplomaticAction(core, 0, kind, target, kind === "annex" ? null : region.id), false);
    }
    assert.equal(state.nations[0].politicalPower, 92);
    state.day += TRUCE_DAYS;
    assert.ok(prepareDiplomaticAction(core, 0, "conquest", target, region.id));
    const action = state.diplomaticActions[0];
    state.day = action.readyDay;
    assert.ok(canDeclareWar(state, 0, target));
    state.truce[0][target] = state.truce[target][0] = state.day + 1;
    assert.equal(startWar(core, 0, target, action.id), false);
    assert.equal(state.nations[0].politicalPower, 80);
    advanceDiplomacy(core);
    assert.equal(state.diplomaticActions.length, 0);
});

test("conquest expiration rejects commands before cleanup and permits a newly paid preparation", () => {
    const core = engine();
    const { action, region, target } = readyConquest(core);
    const state = core.state;
    state.day = action.expiresDay - 1;
    assert.ok(canDeclareWar(state, 0, target));
    state.day++;
    assert.equal(startWar(core, 0, target, action.id), false);
    assert.ok(canPrepareDiplomaticAction(state, 0, "conquest", target, region.id));
    assert.ok(prepareDiplomaticAction(core, 0, "conquest", target, region.id));
    assert.equal(state.diplomaticActions.length, 1);
    assert.notEqual(state.diplomaticActions[0].id, action.id);
    assert.equal(state.nations[0].politicalPower, 68);
    assert.ok(hasStateClaim(state, 0, region.id));
});

for (const when of ["preparing", "ready"] as const) {
    test(`transferred legal targets invalidate ${when} conquest without charging or altering control`, () => {
        const core = engine();
        const { action, region, target } = readyConquest(core);
        const state = core.state;
        state.day = when === "preparing" ? action.startedDay + 1 : action.readyDay;
        const third = state.nations.find((n) => n.id !== 0 && n.id !== target)!.id;
        for (const site of region.provinces) if (state.provinces[site].legalOwner === target) state.provinces[site].legalOwner = third;
        assert.equal(canPrepareDiplomaticAction(state, 0, "conquest", target, region.id), false);
        assert.equal(startWar(core, 0, target, action.id), false);
        advanceDiplomacy(core);
        assert.equal(state.diplomaticActions.length, 0);
        assert.equal(state.nations[0].politicalPower, 80);
        assert.ok(hasStateClaim(state, 0, region.id));
        assert.ok(state.log.some((entry) => entry.text.includes("借口失效")));
    });
}

test("target death cancels unfinished preparations without refund", () => {
    const core = engine();
    const { target } = foreignRegion(core.state);
    assert.ok(prepareDiplomaticAction(core, 0, "annex", target, null));
    core.state.nations[target].alive = false;
    advanceDiplomacy(core);
    assert.equal(core.state.diplomaticActions.length, 0);
    assert.equal(core.state.nations[0].politicalPower, 65);
});

test("cancellation is nation-bound, refunds creation cost and allows a fresh paid task", () => {
    const core = engine();
    const { region, target } = foreignRegion(core.state);
    assert.ok(claimState(core, 0, region.id));
    assert.ok(prepareDiplomaticAction(core, 0, "conquest", target, region.id));
    const action = core.state.diplomaticActions[0];
    assert.equal(cancelDiplomaticAction(core, 1, action.id), false);
    assert.equal(cancelDiplomaticAction(core, 0, NaN), false);
    assert.ok(cancelDiplomaticAction(core, 0, action.id));
    assert.equal(cancelDiplomaticAction(core, 0, action.id), false);
    assert.equal(core.state.nations[0].politicalPower, 92);
    assert.ok(core.state.log.some((entry) => entry.text.includes("取消借口")));
    assert.ok(prepareDiplomaticAction(core, 0, "conquest", target, region.id));
    assert.equal(core.state.nations[0].politicalPower, 80);
    assert.notEqual(core.state.diplomaticActions[0].id, action.id);
});

test("preparation upkeep drains daily PP and is not refunded on cancellation", () => {
    const core = engine();
    const { region, target } = foreignRegion(core.state);
    assert.ok(claimState(core, 0, region.id));
    assert.ok(prepareDiplomaticAction(core, 0, "conquest", target, region.id));
    const action = core.state.diplomaticActions[0];
    assert.equal(core.state.nations[0].politicalPower, 80);
    tickDiplomaticUpkeep(core);
    tickDiplomaticUpkeep(core);
    assert.equal(core.state.nations[0].politicalPower, 78);
    assert.equal(action.upkeepSpent, 2);
    assert.ok(cancelDiplomaticAction(core, 0, action.id));
    assert.equal(core.state.nations[0].politicalPower, 90);
});

test("annexation needs no claim but requires a neighbor, 35 PP and eight full days", () => {
    const core = engine(0, "standard", 4);
    const state = core.state;
    const { target } = foreignRegion(state);
    const distant = state.nations.find((nation) => nation.id !== 0 && nation.id !== target &&
        !state.states.some((entry) => entry.provinces.some((site) =>
            state.provinces[site].legalOwner === nation.id &&
            state.graph.adjacency[site].some((edge) => state.provinces[edge.site].owner === 0))));
    assert.ok(distant, "expected at least one non-neighboring nation");
    assert.equal(prepareDiplomaticAction(core, 0, "annex", distant.id, null), false);
    state.nations[0].politicalPower = 34;
    assert.equal(prepareDiplomaticAction(core, 0, "annex", target, null), false);
    state.nations[0].politicalPower++;
    assert.ok(prepareDiplomaticAction(core, 0, "annex", target, null));
    const action = state.diplomaticActions[0];
    assert.deepEqual([action.readyDay, action.expiresDay], [9, 25]);
    assert.equal(state.nations[0].politicalPower, 0);
    state.day = 8;
    assert.equal(startWar(core, 0, target), false);
    state.day = 9;
    const territory = state.provinces.filter((p) => p.legalOwner === target).map((p) => p.site);
    assert.ok(startWar(core, 0, target));
    assert.deepEqual(state.wars[0].targetSites, territory);
    assert.equal(state.wars[0].goal, "annex");
    assert.equal(state.wars[0].stateId, null);
    assert.equal(state.claims.length, 0);
});

test("AI cannot declare directly or prepare without PP; a bare claim budget buys only the claim", () => {
    const core = engine();
    const state = core.state;
    strengthen(core, 1);
    state.day = 8;
    const target = aiWarTarget(state, 1);
    assert.notEqual(target, null);
    state.nations[1].politicalPower = 0;
    assert.equal(startWar(core, 1, target!), false);
    runAIDiplomacy(core, 1);
    assert.equal(state.wars.length, 0);
    assert.equal(state.diplomaticActions.length, 0);
    assert.equal(state.claims.length, 0);
    state.nations[1].politicalPower = CLAIM_COST;
    runAIDiplomacy(core, 1);
    assert.equal(state.wars.length, 0);
    assert.equal(state.diplomaticActions.length, 0);
    assert.equal(state.claims.length, 1);
    assert.equal(state.nations[1].politicalPower, 0);
    runAIDiplomacy(core, 1);
    assert.equal(state.diplomaticActions.length, 0);
    assert.equal(state.claims.length, 1);
});

for (const kind of ["conquest", "annex"] as const) {
    test(`AI pays and waits for ${kind}, then consumes a ready justification`, () => {
        const core = engine();
        const state = core.state;
        const nation = kind === "conquest" ? 1 : 2;
        strengthen(core, nation);
        state.day = 8;
        const budget = DIPLOMATIC_PROFILES[kind].cost + (kind === "conquest" ? CLAIM_COST : 0);
        state.nations[nation].politicalPower = budget;
        runAIDiplomacy(core, nation);
        const action = state.diplomaticActions.find((a) => a.nation === nation && a.kind === kind);
        assert.ok(action);
        assert.equal(state.nations[nation].politicalPower, 0);
        assert.equal(state.wars.length, 0);
        state.day = action.readyDay - 1;
        runAIDiplomacy(core, nation);
        assert.equal(state.wars.length, 0);
        state.day = action.readyDay;
        runAIDiplomacy(core, nation);
        assert.ok(isAtWar(state, nation, action.target));
        assert.equal(state.wars[0].goal, kind);
        assert.equal(state.diplomaticActions.some((a) => a.id === action.id), false);
    });
}

test("AI renews expired justifications through the same paid preparation APIs, never direct war", () => {
    const core = engine();
    const state = core.state;
    strengthen(core, 1);
    state.day = 8;
    state.nations[1].politicalPower = CLAIM_COST + DIPLOMATIC_PROFILES.conquest.cost;
    runAIDiplomacy(core, 1);
    const old = state.diplomaticActions.find((action) => action.kind === "conquest")!;
    assert.ok(old);
    state.day = old.expiresDay;
    state.nations[1].politicalPower = DIPLOMATIC_PROFILES.conquest.cost;
    runAIDiplomacy(core, 1);
    assert.equal(state.wars.length, 0);
    assert.equal(state.diplomaticActions.some((action) => action.id === old.id), false);
    const renewed = state.diplomaticActions.find((action) => action.kind === "conquest")!;
    assert.ok(renewed);
    assert.notEqual(renewed.id, old.id);
    assert.equal(renewed.target, old.target);
    assert.equal(renewed.stateId, old.stateId);
    assert.equal(state.nations[1].politicalPower, 0);
    assert.equal(state.wars.length, 0);
    assert.equal(startWar(core, 1, renewed.target, renewed.id), false);
});

test("white peace delegates territorial restoration and AI enforces achieved conquest before fatigue", () => {
    const core = engine();
    const { region, target, action } = readyConquest(core, 1);
    assert.ok(startWar(core, 1, target, action.id));
    const province = core.state.provinces[region.provinces[0]];
    province.owner = 1;
    makePeace(core, 1, target);
    assert.equal(province.owner, target);
    assert.equal(province.legalOwner, target);
    assert.equal(core.state.wars.length, 0);
    assert.equal(truceDays(core.state, 1, target), TRUCE_DAYS);
    core.state.day += TRUCE_DAYS;
    assert.ok(prepareDiplomaticAction(core, 1, "conquest", target, region.id));
    core.state.day = core.state.diplomaticActions[0].readyDay;
    assert.ok(startWar(core, 1, target));
    for (const site of core.state.wars[0].targetSites) core.state.provinces[site].owner = 1;
    core.state.day += 10;
    runAIDiplomacy(core, 1);
    assert.equal(isAtWar(core.state, 1, target), false);
    for (const site of region.provinces) assert.equal(core.state.provinces[site].legalOwner, 1);
    assert.ok(hasStateClaim(core.state, 1, region.id));
});

test("multiple state claims coexist as plain nation/state records and each emits a state event", () => {
    const core = engine();
    const state = core.state;
    state.nations[0].politicalPower = 1000;
    const regions = state.states.filter((region) => region.provinces.some((site) => state.provinces[site].legalOwner !== 0));
    assert.ok(regions.length >= 2);
    for (const region of regions) {
        for (const site of region.provinces) state.provinces[site].coreNation = 0;
    }
    let stateEvents = 0;
    const unsubscribe = core.subscribe((event) => { if (event.type === "state") stateEvents += 1; });
    regions.forEach((region) => {
        assert.ok(claimState(core, 0, region.id));
        assert.deepEqual(state.claims.at(-1), { nation: 0, stateId: region.id });
    });
    assert.equal(stateEvents, regions.length);
    assert.equal(state.nations[0].politicalPower, 1000 - regions.length * CLAIM_COST);
    assert.equal(state.claims.length, regions.length);
    assert.equal(claimState(core, 0, regions[0].id), false);
    assert.equal(stateEvents, regions.length);
    unsubscribe();
});

test("cancelClaim refunds the cost, removes the record and emits a state event", () => {
    const core = engine();
    const state = core.state;
    const { region } = foreignRegion(state);
    assert.equal(canCancelStateClaim(state, 0, region.id), false);
    assert.equal(cancelClaim(core, 0, region.id), false);
    assert.ok(claimState(core, 0, region.id));
    const ppAfterClaim = state.nations[0].politicalPower;
    let stateEvents = 0;
    const unsubscribe = core.subscribe((event) => { if (event.type === "state") stateEvents += 1; });
    assert.equal(canCancelStateClaim(state, 0, region.id), true);
    assert.ok(cancelClaim(core, 0, region.id));
    assert.equal(stateEvents, 1);
    assert.equal(state.claims.length, 0);
    assert.equal(hasStateClaim(state, 0, region.id), false);
    assert.equal(state.nations[0].politicalPower, ppAfterClaim + CLAIM_COST);
    assert.equal(cancelClaim(core, 0, region.id), false);
    assert.equal(stateEvents, 1);
    unsubscribe();
});

test("cancelClaim is blocked while at war with the owner or after the campaign ends", () => {
    const core = engine();
    const state = core.state;
    const { region, target } = foreignRegion(state);
    assert.ok(claimState(core, 0, region.id));
    setWar(state, 0, target, true);
    assert.equal(canCancelStateClaim(state, 0, region.id), false);
    assert.equal(cancelClaim(core, 0, region.id), false);
    assert.ok(hasStateClaim(state, 0, region.id));
    setWar(state, 0, target, false);
    assert.ok(cancelClaim(core, 0, region.id));
    assert.ok(claimState(core, 0, region.id));
    state.winner = 0;
    assert.equal(cancelClaim(core, 0, region.id), false);
    assert.ok(hasStateClaim(state, 0, region.id));
});

test("cancelling a claim invalidates ready conquest casus belli for that state", () => {
    const core = engine();
    const state = core.state;
    const { region, target, action } = readyConquest(core);
    assert.ok(canDeclareWar(state, 0, target, action.id));
    assert.ok(cancelClaim(core, 0, region.id));
    assert.equal(canDeclareWar(state, 0, target, action.id), false);
    assert.equal(core.declareWar(target, action.id), false);
    assert.equal(isAtWar(state, 0, target), false);
});