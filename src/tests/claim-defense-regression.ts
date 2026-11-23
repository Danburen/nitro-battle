import assert from "node:assert/strict";
import test from "node:test";
import type { AIAction } from "../game/ai/index.ts";
import { spawnArmy } from "../game/armies.ts";
import {
    PLAYER_PROTECTION_DAYS, aiWarTarget, borderingNations, canClaimState, claimState,
    isPlayerState, playerProtected, setWar,
} from "../game/diplomacy.ts";
import { GameEngine } from "../game/engine.ts";
import { MAX_HP, REGIMENT_CAP, UnitKind } from "../game/types/unit.ts";
import { NEUTRAL } from "../game/types/world.ts";
import type { EngineEvent } from "../game/types/events.ts";
import type { GameState } from "../game/types/state.ts";

function graphDistance(state: GameState, from: number, targets: Set<number>): number {
    const seen = new Set<number>([from]);
    let frontier = [from];
    let depth = 0;
    while (frontier.length > 0) {
        if (frontier.some((site) => targets.has(site))) return depth;
        const next: number[] = [];
        for (const site of frontier) {
            for (const edge of state.graph.adjacency[site]) {
                if (seen.has(edge.site)) continue;
                seen.add(edge.site);
                next.push(edge.site);
            }
        }
        frontier = next;
        depth++;
    }
    return Infinity;
}

function adjacentToNation(state: GameState, nation: number, stateId: number): boolean {
    return state.states[stateId].provinces.some((site) =>
        state.graph.adjacency[site].some((edge) => state.provinces[edge.site].owner === nation));
}

function playerArmies(state: GameState) {
    return [...state.armies.values()].filter((army) => army.nation === 0);
}

function moveDestination(action: AIAction): number | null {
    return action.kind === "move" ? action.to : null;
}

test("a rival claiming player land raises a prominent warning; the player's own claims stay quiet", () => {
    const core = GameEngine.create(42, "small", 4);
    const state = core.state;
    for (const nation of state.nations) nation.politicalPower = 200;
    const events: EngineEvent[] = [];
    core.subscribe((event) => events.push(event));

    let scenario: { nation: number; regionId: number } | null = null;
    for (const nation of state.nations) {
        if (nation.id === 0 || !nation.alive) continue;
        for (const region of state.states) {
            if (!isPlayerState(state, region.id) || !canClaimState(state, nation.id, region.id)) continue;
            scenario = { nation: nation.id, regionId: region.id };
            break;
        }
        if (scenario) break;
    }
    assert.ok(scenario, "fixture needs a player state a rival can claim");

    const logBefore = state.log.length;
    assert.ok(claimState(core, scenario.nation, scenario.regionId));
    const warnings = events.filter((event): event is Extract<EngineEvent, { type: "claim-warning" }> =>
        event.type === "claim-warning");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].nation, scenario.nation);
    assert.equal(warnings[0].stateId, scenario.regionId);
    assert.ok(state.log.slice(logBefore).some((entry) =>
        entry.major && entry.event?.kind === "claim" && entry.nationId === 0));

    // The player claiming foreign land is business as usual: no alarm.
    events.length = 0;
    const foreign = state.states.find((region) => canClaimState(state, 0, region.id) && !isPlayerState(state, region.id));
    assert.ok(foreign);
    assert.ok(claimState(core, 0, foreign.id));
    assert.equal(events.filter((event) => event.type === "claim-warning").length, 0);
});

test("the opening grace period shields the player from AI expansion, then lifts", () => {
    const core = GameEngine.create(42, "small", 4);
    const state = core.state;

    state.day = 1;
    assert.equal(playerProtected(state), true);
    state.day = PLAYER_PROTECTION_DAYS - 1;
    assert.equal(playerProtected(state), true);
    state.day = PLAYER_PROTECTION_DAYS;
    assert.equal(playerProtected(state), false);

    state.day = PLAYER_PROTECTION_DAYS + 1;
    let aiId: number | null = null;
    for (const nation of state.nations) {
        if (nation.id === 0 || !nation.alive) continue;
        if (aiWarTarget(state, nation.id) === 0) {
            aiId = nation.id;
            break;
        }
    }
    assert.ok(aiId !== null, "fixture should have a rival that would otherwise target the player");
    assert.ok(borderingNations(state, aiId).has(0));

    state.day = PLAYER_PROTECTION_DAYS - 1;
    assert.notEqual(aiWarTarget(state, aiId), 0, "protected window must skip the player as a target");
    state.day = PLAYER_PROTECTION_DAYS + 1;
    assert.equal(aiWarTarget(state, aiId), 0, "after the window the player is a valid target again");
});

test("AI corps (including 托管 corps) march toward our own state claimed by a rival", () => {
    const engine = GameEngine.create(7, "small", 4);
    engine.controllers.length = 0;
    const state = engine.state;
    state.claims.length = 0;

    const region = state.states.find((candidate) => isPlayerState(state, candidate.id) && candidate.provinces.length > 0);
    assert.ok(region);
    const claimed = new Set<number>(region.provinces);
    const army = playerArmies(state).find((candidate) => !claimed.has(candidate.province));
    assert.ok(army);

    // No war and no claim means no objective, so the planner holds position.
    assert.deepEqual(engine.playerAuto.takeArmyTurn(state, (candidate) => candidate.id === army.id), []);

    state.claims.push({ nation: 1, stateId: region.id });
    const moves = engine.playerAuto.takeArmyTurn(state, (candidate) => candidate.id === army.id)
        .map(moveDestination)
        .filter((site): site is number => site !== null);
    assert.ok(moves.length > 0, "a claimed own state should pull the managed corps toward it");
    assert.ok(moves.some((site) => graphDistance(state, site, claimed) < graphDistance(state, army.province, claimed)),
        "the destination should be closer to the claimed state");
});

test("AI corps assault hostile ground inside a state the nation has claimed", () => {
    const engine = GameEngine.create(7, "small", 4);
    engine.controllers.length = 0;
    const state = engine.state;
    state.claims.length = 0;

    let scenario: { regionId: number; enemy: number; staging: number; target: number } | null = null;
    for (const region of state.states) {
        if (!adjacentToNation(state, 0, region.id)) continue;
        for (const site of region.provinces) {
            const owner = state.provinces[site].owner;
            if (owner === 0 || owner === NEUTRAL) continue;
            const staging = state.graph.adjacency[site].find((edge) =>
                state.provinces[edge.site].owner === 0 && state.armyAt[edge.site] === null);
            if (!staging) continue;
            scenario = { regionId: region.id, enemy: owner, staging: staging.site, target: site };
            break;
        }
        if (scenario) break;
    }
    assert.ok(scenario, "fixture needs an enemy state adjacent to free player land");

    setWar(state, 0, scenario.enemy, true);
    state.claims.push({ nation: 0, stateId: scenario.regionId });
    for (const site of state.states[scenario.regionId].provinces) state.provinces[site].garrison = 0;
    const army = spawnArmy(state, 0, scenario.staging, Array<UnitKind>(REGIMENT_CAP).fill(UnitKind.TANK), 100);
    for (const regiment of army.regiments) regiment.hp = MAX_HP;
    army.org = 100;

    const attacks = engine.playerAuto.takeArmyTurn(state, (candidate) => candidate.id === army.id)
        .filter((action): action is Extract<AIAction, { kind: "attack" }> => action.kind === "attack");
    assert.ok(attacks.some((action) => state.states[scenario.regionId].provinces.includes(action.target)),
        "the corps should attack the claimed hostile state");
});
