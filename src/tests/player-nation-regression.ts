import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import { generateWorld } from "../game/generator/index.ts";
import { setPlayerNation } from "../game/player.ts";

test("generated nations use unique random names and colors, including eight-player worlds", () => {
    for (const seed of [42, 20261122]) {
        const state = generateWorld({ seed, mapSize: "small", nationCount: 8 });
        assert.equal(state.nations.length, 8);
        assert.equal(new Set(state.nations.map((nation) => nation.name)).size, 8);
        assert.equal(new Set(state.nations.map((nation) => nation.color)).size, 8);
        assert.ok(state.nations.every((nation) => /^#[0-9a-f]{6}$/i.test(nation.color)));
        assert.ok(state.nations.every((nation) => nation.isPlayer === (nation.id === 0)));
    }
});

test("promoting a generated nation rewrites every nation-indexed structure", () => {
    const state = generateWorld({ seed: 2026, mapSize: "small", nationCount: 5 });
    const chosen = 3;
    const chosenName = state.nations[chosen].name;
    const firstNationName = state.nations[0].name;
    const army = [...state.armies.values()].find((entry) => entry.nation === chosen);
    assert.ok(army);
    const armyId = army.id;
    const chosenSites = state.provinces.filter((province) => province.owner === chosen).map((province) => province.site);
    const firstSites = state.provinces.filter((province) => province.owner === 0).map((province) => province.site);

    state.war[chosen][0] = true;
    state.war[0][chosen] = true;
    state.warSince[chosen][0] = 11;
    state.warSince[0][chosen] = 11;
    state.truce[chosen][0] = 7;
    state.truce[0][chosen] = 7;
    state.claims.push({ nation: chosen, stateId: 1 });
    state.diplomaticActions.push({
        id: 1, nation: chosen, target: 0, kind: "annex", stateId: null,
        startedDay: 1, readyDay: 9, expiresDay: 25,
    });
    state.wars.push({ aggressor: chosen, defender: 0, goal: "annex", stateId: null, targetSites: [], startedDay: 1 });

    assert.equal(setPlayerNation(state, chosen), true);
    assert.equal(state.nations[0].id, 0);
    assert.equal(state.nations[0].isPlayer, true);
    assert.equal(state.nations[0].name, chosenName);
    assert.equal(state.nations[chosen].id, chosen);
    assert.equal(state.nations[chosen].isPlayer, false);
    assert.equal(state.nations[chosen].name, firstNationName);
    assert.equal(state.nations[0].capital, state.provinces[state.nations[0].capital].site);

    assert.equal(state.war[0][chosen], true);
    assert.equal(state.war[chosen][0], true);
    assert.equal(state.warSince[0][chosen], 11);
    assert.equal(state.truce[0][chosen], 7);
    assert.equal(state.armies.get(armyId)!.nation, 0);
    assert.equal(state.claims[0].nation, 0);
    assert.equal(state.diplomaticActions[0].nation, 0);
    assert.equal(state.diplomaticActions[0].target, chosen);
    assert.equal(state.wars[0].aggressor, 0);
    assert.equal(state.wars[0].defender, chosen);
    assert.ok(chosenSites.length > 0 && chosenSites.every((site) =>
        state.provinces[site].owner === 0 && state.provinces[site].legalOwner === 0 && state.provinces[site].coreNation === 0));
    assert.ok(firstSites.length > 0 && firstSites.every((site) =>
        state.provinces[site].owner === chosen && state.provinces[site].legalOwner === chosen &&
        state.provinces[site].coreNation === chosen));
    assert.equal(state.selected, null);
    assert.equal(state.selectedArmyId, null);

    const engine = new GameEngine(state);
    assert.equal(engine.controllers.length, state.nations.length - 1);
    assert.ok(engine.controllers.every((controller) => controller.nationId !== 0));
});