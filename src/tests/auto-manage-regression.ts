import assert from "node:assert/strict";
import test from "node:test";
import { autoMergeManagedArmies, isArmyAutoManaged } from "../game/auto.ts";
import { spawnArmy } from "../game/armies.ts";
import { GameEngine } from "../game/engine.ts";
import { generateWorld } from "../game/generator/index.ts";
import type { GameState } from "../game/types.ts";

function fixture(): GameEngine {
    const engine = new GameEngine(generateWorld({ seed: 7, mapSize: "small", nationCount: 4 }));
    engine.controllers.length = 0; // isolate the player's auto pass from AI nations
    return engine;
}

function playerArmies(state: GameState) {
    return [...state.armies.values()].filter((army) => army.nation === 0);
}

/** Two adjacent, army-free provinces inside the player's own land. */
function adjacentFreeSites(state: GameState): [number, number] {
    for (const province of state.provinces) {
        if (province.owner !== 0 || state.armyAt[province.site] !== null) continue;
        for (const edge of state.graph.adjacency[province.site]) {
            if (state.provinces[edge.site].owner === 0 && state.armyAt[edge.site] === null
                && state.terrain.passable[edge.site]) return [province.site, edge.site];
        }
    }
    throw new Error("fixture has no adjacent free player provinces");
}

test("global trusteeship assigns all player corps and per-corps overrides opt back out", () => {
    const engine = fixture();
    const state = engine.state;
    const armies = playerArmies(state);
    const foreign = [...state.armies.values()].find((army) => army.nation !== 0);
    assert.ok(armies.length >= 2 && foreign);
    assert.ok(armies.every((army) => !isArmyAutoManaged(state, army)));

    engine.setAutoManageArmies(true);
    assert.equal(state.autoManageArmies, true);
    assert.ok(armies.every((army) => isArmyAutoManaged(state, army)));
    assert.equal(isArmyAutoManaged(state, foreign), false);

    assert.equal(engine.toggleArmyAutoManaged(armies[0].id), true);
    assert.equal(isArmyAutoManaged(state, armies[0]), false);
    assert.ok(armies.slice(1).every((army) => isArmyAutoManaged(state, army)));
    assert.equal(engine.toggleArmyAutoManaged(armies[0].id), true);
    assert.equal(isArmyAutoManaged(state, armies[0]), true);
    assert.equal(engine.toggleArmyAutoManaged(foreign.id), false);

    engine.setAutoManageArmies(false);
    assert.ok(armies.every((army) => !isArmyAutoManaged(state, army)));

    // With the master switch off, individual corps can still be opted in for
    // partial trusteeship, and toggled back out.
    assert.equal(engine.toggleArmyAutoManaged(armies[1].id), true);
    assert.equal(isArmyAutoManaged(state, armies[1]), true);
    assert.equal(isArmyAutoManaged(state, armies[0]), false);
    assert.equal(engine.toggleArmyAutoManaged(armies[1].id), true);
    assert.equal(isArmyAutoManaged(state, armies[1]), false);
    assert.equal(engine.toggleArmyAutoManaged(foreign.id), false);
});

test("manual commands are refused for managed corps and resume after opting out", () => {
    const engine = fixture();
    const state = engine.state;
    const [first, second] = playerArmies(state);
    assert.ok(first && second);
    const target = [...engine.reachFor(first).cost.keys()].find((site) => site !== first.province);
    assert.notEqual(target, undefined);

    engine.setAutoManageArmies(true);
    assert.equal(engine.moveArmy(first.id, target!), false);
    assert.equal(engine.waitArmy(first.id), false);
    assert.equal(engine.orderMarch(first.id, target!, false), false);
    assert.equal(engine.orderMerge([first.id, second.id]), false);
    assert.equal(engine.splitArmy(first.id, [first.regiments[0].id]), null);
    assert.equal(first.province !== target!, true);

    engine.toggleArmyAutoManaged(first.id);
    assert.equal(engine.moveArmy(first.id, target!), true);
    assert.equal(first.province, target!);
});

test("auto-merge consolidates only nearby managed corps, never manual ones", () => {
    const engine = fixture();
    const state = engine.state;
    for (const army of playerArmies(state)) army.autoManaged = false;
    state.autoManageArmies = true;
    const [a, b] = adjacentFreeSites(state);
    const anchor = spawnArmy(state, 0, a, [0, 0], 100);
    const mover = spawnArmy(state, 0, b, [0], 100);
    const manual = playerArmies(state).find((army) => army.id !== anchor.id && army.id !== mover.id);
    assert.ok(manual);
    const manualSite = manual.province;

    const merges = autoMergeManagedArmies(engine);
    assert.equal(merges, 1);
    assert.equal(state.armies.has(mover.id), false);
    assert.equal(state.armies.has(anchor.id), true);
    assert.equal(anchor.regiments.length, 3);
    assert.equal(manual.province, manualSite);
    assert.equal(isArmyAutoManaged(state, manual), false);
});

test("end turn runs the player's AI pass and new corps inherit the master switch", () => {
    const engine = fixture();
    const state = engine.state;
    for (const army of playerArmies(state)) army.autoManaged = false;
    state.autoManageArmies = true;
    const [a, b] = adjacentFreeSites(state);
    const anchor = spawnArmy(state, 0, a, [0, 0], 100);
    const mover = spawnArmy(state, 0, b, [0], 100);
    assert.ok(isArmyAutoManaged(state, anchor) && isArmyAutoManaged(state, mover));

    engine.endTurn();
    assert.equal(state.armies.has(mover.id), false);
    assert.equal(state.armies.has(anchor.id), true);

    engine.setAutoManageArmies(false);
    const [c, d] = adjacentFreeSites(state);
    const fresh = spawnArmy(state, 0, c, [0], 100);
    assert.equal(fresh.autoManaged, false);
    assert.equal(isArmyAutoManaged(state, fresh), false);
    assert.notEqual(d, c);
});

test("partial trusteeship still drives managed corps when the master switch is off", () => {
    const engine = fixture();
    const state = engine.state;
    state.autoManageArmies = false;
    for (const army of playerArmies(state)) army.autoManaged = false;
    const [a, b] = adjacentFreeSites(state);
    const anchor = spawnArmy(state, 0, a, [0, 0], 100);
    const mover = spawnArmy(state, 0, b, [0], 100);
    // Only the two fresh corps are managed; the starting corps stay manual.
    assert.equal(isArmyAutoManaged(state, anchor), false);
    assert.equal(isArmyAutoManaged(state, mover), false);
    engine.toggleArmyAutoManaged(anchor.id);
    engine.toggleArmyAutoManaged(mover.id);
    assert.ok(isArmyAutoManaged(state, anchor) && isArmyAutoManaged(state, mover));

    engine.endTurn();
    assert.equal(state.armies.has(mover.id), false);
    assert.equal(state.armies.has(anchor.id), true);
    assert.equal(anchor.regiments.length, 3);
});
