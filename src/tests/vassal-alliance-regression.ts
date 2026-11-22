import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import {
    hasMilitaryAccess, isProtectedRelation, nationDisplayColor, overlordOf, vassalTypeOf,
} from "../game/access.ts";
import {
    VASSAL_PETITION_COOLDOWN, VASSAL_PROFILES, VASSAL_UPGRADE_COST, adjustTributeRate,
    applyVassalCallToArms, canPetitionIndependence, canRequestUpgrade, demandVassalization,
    expireDiplomaticRequests, independenceOf, joinVassalDefense, petitionCooldownDays,
    petitionIndependence, releaseVassal, requestForeignAid, requestVassalization, requestVassalUpgrade,
    respondDiplomaticRequest, setVassal, subservienceOf, subservienceTone, tickVassalIndependence,
    tickVassalTribute, tributeRateOf,
} from "../game/vassal.ts";
import { tendencyProfileOf, vassalTuning } from "../game/ai/tendencies.ts";
import {
    ALLIANCE_CREATE_COST, ALLIANCE_INVITE_COOLDOWN, allianceOf, applyAllianceWar,
    canInviteToAlliance, commonEnemy, createAlliance, inSameAlliance, inviteToAlliance,
    requestJoinAlliance,
} from "../game/alliance.ts";
import { isAtWar, nationPower, setWar } from "../game/diplomacy.ts";
import { reachable } from "../game/rules.ts";
import { spawnArmy } from "../game/armies.ts";
import { DEFAULT_POLICIES, MAX_HP, UnitKind } from "../game/types.ts";
import type { AITendencyId } from "../game/ai/types.ts";
import type { Army, GameState, Nation, Province, StateRegion } from "../game/types.ts";

/** Four nations on a straight line: 0-1-2-3, three provinces each. */
function fixture(tendencies: AITendencyId[] = ["opportunist", "hegemon", "hegemon", "defensive"]): GameEngine {
    const provinces: Province[] = [];
    const states: StateRegion[] = [];
    for (let owner = 0; owner < 4; owner++) {
        const center = owner * 3;
        const members = [center, center + 1, center + 2];
        for (const site of members) {
            provinces.push({
                site, stateId: owner, name: `P${site}`, owner, legalOwner: owner, coreNation: owner,
                occupation: 100, isCity: site === center, isCapital: site === center,
                income: 4, population: 2, defense: 1, buildings: [], garrison: 20, garrisonMax: 20,
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
        funds: 1000, manpower: 1000, industry: 1000, politicalPower: 100,
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
        settings: { seed: 42, mapSize: "small", nationCount: 4 }, graph, terrain, provinces, states, nations,
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
        nextDiplomaticActionId: 1, nextAllianceId: 1, nextRequestId: 1,
        log: [], winner: null, nextArmyId: 1, nextRegimentId: 1, nextDeploymentId: 1, nextConstructionId: 1,
        stats: { battles: 0, captures: 0, recruited: 0, losses: 0 },
    };
    const engine = new GameEngine(state);
    engine.controllers.length = 0;
    return engine;
}

function addStrength(state: GameState, nationId: number, tanks: number): Army {
    const army = spawnArmy(state, nationId, nationId * 3, Array.from({ length: tanks }, () => UnitKind.TANK), 100);
    for (const regiment of army.regiments) regiment.hp = MAX_HP;
    return army;
}

/** Test-only override for the generated field. */
function setSubservience(state: GameState, nationId: number, value: number): void {
    (state.nations[nationId] as unknown as { subservience: number }).subservience = value;
}

test("vassals share the overlord colour and passage, and the overlord defends them", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 1, 0, "cooperative"), true);
    assert.equal(overlordOf(state, 1), 0);
    assert.equal(vassalTypeOf(state, 1), "cooperative");
    assert.equal(nationDisplayColor(state, 1), state.nations[0].color);
    assert.equal(hasMilitaryAccess(state, 0, 1), true);
    assert.equal(hasMilitaryAccess(state, 1, 0), true);
    assert.equal(isProtectedRelation(state, 0, 1), true);

    const army = spawnArmy(state, 1, 3, [UnitKind.INFANTRY], 80);
    const reach = reachable(state, army);
    assert.ok(reach.cost.has(2), "a vassal may cross its overlord's empty province");

    setWar(state, 2, 1, true);
    assert.equal(isAtWar(state, 0, 2), false);
    // The declaration path adds the protector; calling the same helper models it.
    joinVassalDefense(engine, 2, 1);
    assert.equal(isAtWar(state, 0, 2), true);

    assert.equal(releaseVassal(engine, 1), true);
    assert.equal(overlordOf(state, 1), -1);
    assert.equal(nationDisplayColor(state, 1), state.nations[1].color);
});

test("cooperative, autonomous and oppressive contracts move the documented resources", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 1, 0, "cooperative"), true);
    assert.equal(setVassal(engine, 2, 0, "autonomous"), true);
    assert.equal(setVassal(engine, 3, 0, "oppressive"), true);
    state.nations[0].funds = 0;
    state.nations[0].politicalPower = 10;
    state.nations[0].manpower = 0;
    state.nations[0].industry = 0;
    for (let id = 1; id <= 3; id++) state.nations[id].politicalPower = 50;

    const before = state.nations.map((nation) => ({ funds: nation.funds, pp: nation.politicalPower }));
    tickVassalTribute(engine);

    assert.ok(state.nations[0].funds > 0, "the overlord receives resource shares");
    assert.ok(state.nations[1].funds < before[1].funds, "cooperative pays resources");
    assert.ok(state.nations[3].funds < before[3].funds, "oppressive pays resources");
    assert.equal(state.nations[2].funds, before[2].funds, "autonomous keeps its economy");
    // Cooperative gets +1 protection PP; autonomous pays 2; oppressive pays 3.
    assert.equal(state.nations[1].politicalPower, before[1].pp + 1);
    assert.equal(state.nations[2].politicalPower, before[2].pp - 2);
    assert.equal(state.nations[3].politicalPower, before[3].pp - 3);
});

test("one petition buys a chunk of independence, then cools down; 100 releases the vassal", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 1, 0, "cooperative"), true);
    state.nations[1].politicalPower = 100;
    assert.equal(canPetitionIndependence(state, 1), true);
    assert.equal(petitionIndependence(engine, 1), true);
    assert.equal(
        independenceOf(state, 1),
        VASSAL_PROFILES.cooperative.independenceStart + VASSAL_PROFILES.cooperative.petitionGain,
    );
    assert.equal(state.nations[1].politicalPower, 100 - VASSAL_PROFILES.cooperative.petitionCost);
    assert.equal(petitionIndependence(engine, 1), false, "the cooldown blocks a second petition");
    assert.equal(petitionCooldownDays(state, 1), VASSAL_PETITION_COOLDOWN);
    state.day += VASSAL_PETITION_COOLDOWN;
    assert.equal(canPetitionIndependence(state, 1), true);

    assert.equal(adjustTributeRate(engine, 1, 0.2), true);
    assert.ok(Math.abs(tributeRateOf(state, 1) - 0.35) < 1e-9);
    assert.equal(adjustTributeRate(engine, 1, -1), true);
    assert.ok(Math.abs(tributeRateOf(state, 1) - VASSAL_PROFILES.cooperative.resourceMin) < 1e-9);

    state.nations[1].independence = 99;
    state.nations[1].politicalPower = 100;
    assert.equal(petitionIndependence(engine, 1), true);
    assert.equal(overlordOf(state, 1), -1);
    assert.equal(vassalTypeOf(state, 1), null);
});

test("petition cost follows the contract and oppressive vassals cannot petition", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 2, 0, "autonomous"), true);
    state.nations[2].politicalPower = 100;
    assert.equal(petitionIndependence(engine, 2), true);
    assert.equal(state.nations[2].politicalPower, 100 - VASSAL_PROFILES.autonomous.petitionCost);
    assert.ok(VASSAL_PROFILES.autonomous.petitionCost < VASSAL_PROFILES.cooperative.petitionCost);

    const second = fixture();
    assert.equal(setVassal(second, 3, 0, "oppressive"), true);
    second.state.nations[3].politicalPower = 100;
    assert.equal(canPetitionIndependence(second.state, 3), false);
    assert.equal(petitionIndependence(second, 3), false);
});

test("aid requests and expired offers resolve through the handler table", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 1, 3, "oppressive"), true);
    state.nations[1].funds = 0;
    state.nations[0].funds = 100;
    state.nations[0].politicalPower = 100;
    assert.equal(requestForeignAid(engine, 1, 0), true);
    const aid = state.diplomaticRequests.find((entry) => entry.kind === "aid");
    assert.ok(aid);
    assert.equal(respondDiplomaticRequest(engine, aid.id, true), true);
    assert.ok(state.nations[1].funds > 0, "the helper pays the vassal");
    assert.ok(state.nations[0].funds < 100);

    assert.equal(releaseVassal(engine, 1), true);
    assert.equal(requestVassalization(engine, 1, 0, "autonomous"), true);
    state.day += 11;
    expireDiplomaticRequests(engine);
    assert.equal(state.diplomaticRequests.length, 0);
    assert.ok(state.vassalCooldown[0][1] > state.day, "an expired offer starts the refusal cooldown");
});

test("an oppressive vassal rebels when independence fills or the overlord is at war", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 1, 0, "oppressive"), true);
    state.nations[1].independence = 100;
    tickVassalIndependence(engine);
    assert.equal(overlordOf(state, 1), -1);
    assert.equal(isAtWar(state, 1, 0), true);

    const second = fixture();
    const secondState = second.state;
    assert.equal(setVassal(second, 2, 0, "oppressive"), true);
    secondState.nations[2].independence = 55;
    secondState.day = 5;
    setWar(secondState, 0, 3, true);
    tickVassalIndependence(second);
    assert.equal(overlordOf(secondState, 2), -1);
    assert.equal(isAtWar(secondState, 2, 0), true);
});

test("AI-to-player vassal offers become pending requests and the player can accept", () => {
    const engine = fixture();
    const state = engine.state;
    addStrength(state, 0, 4);
    assert.equal(requestVassalization(engine, 1, 0, "autonomous"), true);
    assert.equal(state.diplomaticRequests.length, 1);
    const request = state.diplomaticRequests[0];
    assert.equal(request.demand, undefined);
    assert.equal(respondDiplomaticRequest(engine, request.id, true), true);
    assert.equal(overlordOf(state, 1), 0);
    assert.equal(vassalTypeOf(state, 1), "autonomous");
});

test("coercive demands work in both directions and the demand flag keeps the vassal/overlord roles", () => {
    const engine = fixture();
    const state = engine.state;
    addStrength(state, 0, 12);
    assert.equal(demandVassalization(engine, 0, 1), true);
    assert.equal(overlordOf(state, 1), 0);
    assert.equal(vassalTypeOf(state, 1), "oppressive");

    const second = fixture();
    const secondState = second.state;
    addStrength(secondState, 1, 12);
    assert.equal(demandVassalization(second, 1, 0), true);
    assert.equal(secondState.diplomaticRequests.length, 1);
    const demand = secondState.diplomaticRequests[0];
    assert.equal(demand.demand, true);
    assert.equal(demand.from, 1);
    assert.equal(demand.to, 0);
    assert.equal(respondDiplomaticRequest(second, demand.id, true), true);
    assert.equal(overlordOf(secondState, 0), 1);
    assert.equal(vassalTypeOf(secondState, 0), "oppressive");
});

test("alliance creation, shared enemies, passage and joining wars use one camp", () => {
    const engine = fixture();
    const state = engine.state;
    state.day = 8;
    setWar(state, 1, 3, true);
    setWar(state, 2, 3, true);
    assert.equal(commonEnemy(state, 1, 2), 3);
    assert.equal(createAlliance(engine, 1) !== null, true);
    assert.equal(state.nations[1].politicalPower, 100 - ALLIANCE_CREATE_COST);
    assert.equal(canInviteToAlliance(state, 1, 2), true);
    assert.equal(inviteToAlliance(engine, 1, 2), true);
    assert.equal(inSameAlliance(state, 1, 2), true);
    assert.equal(hasMilitaryAccess(state, 1, 2), true);
    assert.equal(allianceOf(state, 2)?.leader, 1);

    setWar(state, 2, 0, true);
    applyAllianceWar(engine, 2, 0);
    assert.equal(isAtWar(state, 1, 0), true, "the ally joins the new war");
});

test("a rejected player alliance invite starts a cooldown and blocks joining", () => {
    const engine = fixture();
    const state = engine.state;
    state.day = 8;
    setWar(state, 0, 3, true);
    setWar(state, 1, 3, true);
    assert.equal(createAlliance(engine, 1) !== null, true);
    assert.equal(canInviteToAlliance(state, 1, 0), true);
    assert.equal(inviteToAlliance(engine, 1, 0), true);
    assert.equal(state.diplomaticRequests.length, 1);
    const request = state.diplomaticRequests[0];
    assert.equal(respondDiplomaticRequest(engine, request.id, false), true);
    assert.ok(state.allianceCooldown[0][1] > state.day);
    assert.equal(state.day + ALLIANCE_INVITE_COOLDOWN >= state.allianceCooldown[0][1], true);
    assert.equal(requestJoinAlliance(engine, 0, 1), false);
});

test("nation power and protection relations keep vassals out of alliance wars against their overlord", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 1, 0, "autonomous"), true);
    assert.ok(nationPower(state, 0) > 0);
    assert.equal(isProtectedRelation(state, 0, 1), true);
    assert.equal(isProtectedRelation(state, 1, 0), true);
    assert.equal(allianceOf(state, 1), null);
});

test("subservience moves the vassal thresholds in the documented direction", () => {
    const profile = tendencyProfileOf("opportunist");
    const loyal = vassalTuning(profile, "cooperative", 5);
    const restless = vassalTuning(profile, "cooperative", 1);
    assert.equal(loyal.independenceDrift, -1);
    assert.equal(restless.independenceDrift, 1);
    assert.equal(loyal.raiseIndependenceWill, 0);
    assert.ok(restless.raiseIndependenceWill > 0);
    assert.equal(loyal.tributeCompliance, 1.2);
    assert.equal(restless.tributeCompliance, 0.8);
    assert.equal(loyal.callToArmsAccept, 1);
    assert.ok(restless.callToArmsAccept < loyal.callToArmsAccept);
    assert.equal(loyal.overlordTrust, 1);
    assert.ok(restless.defectRisk > loyal.defectRisk);
    // Oppressive contracts never allow a manual raise, regardless of temperament.
    assert.equal(vassalTuning(tendencyProfileOf("hegemon"), "oppressive", 1).raiseIndependenceWill, 0);
    assert.deepEqual(subservienceTone(5), { label: "忠顺", tone: "pos" });
    assert.deepEqual(subservienceTone(1), { label: "桀骜", tone: "neg" });
    assert.deepEqual(subservienceTone(3), { label: "中立", tone: "note" });
});

test("loyal vassals can request a better contract, with the player deciding as overlord", () => {
    const engine = fixture();
    const state = engine.state;
    setSubservience(state, 1, 5);
    state.nations[1].politicalPower = 100;
    assert.equal(setVassal(engine, 1, 0, "cooperative"), true);
    assert.equal(canRequestUpgrade(state, 1), true);
    assert.equal(requestVassalUpgrade(engine, 1), true);
    assert.equal(state.diplomaticRequests.length, 1);
    const request = state.diplomaticRequests[0];
    assert.equal(request.kind, "upgrade");
    assert.equal(request.vassalType, "autonomous");
    assert.equal(respondDiplomaticRequest(engine, request.id, true), true);
    assert.equal(vassalTypeOf(state, 1), "autonomous");
    assert.equal(state.nations[1].politicalPower, 100 - VASSAL_UPGRADE_COST);
    assert.ok(independenceOf(state, 1) >= VASSAL_PROFILES.autonomous.independenceStart);

    const second = fixture();
    setSubservience(second.state, 2, 5);
    second.state.nations[2].politicalPower = 100;
    assert.equal(setVassal(second, 2, 3, "cooperative"), true);
    assert.equal(requestVassalUpgrade(second, 2), true);
    assert.equal(vassalTypeOf(second.state, 2), "autonomous", "AI overlords answer immediately");
});

test("an overlord calls its vassals to arms and the player vassal chooses", () => {
    const engine = fixture();
    const state = engine.state;
    setSubservience(state, 2, 5);
    setSubservience(state, 3, 5);
    assert.equal(setVassal(engine, 2, 1, "cooperative"), true);
    assert.equal(setVassal(engine, 3, 1, "oppressive"), true);
    applyVassalCallToArms(engine, 1, 0);
    assert.equal(isAtWar(state, 2, 0), true);
    assert.equal(isAtWar(state, 3, 0), true);

    const playerVassal = fixture();
    const playerState = playerVassal.state;
    setSubservience(playerState, 0, 4);
    assert.equal(setVassal(playerVassal, 0, 1, "cooperative"), true);
    applyVassalCallToArms(playerVassal, 1, 2);
    const request = playerState.diplomaticRequests.find((entry) => entry.kind === "call");
    assert.ok(request);
    assert.equal(request.enemy, 2);
    assert.equal(respondDiplomaticRequest(playerVassal, request.id, true), true);
    assert.equal(isAtWar(playerState, 0, 2), true);
});

test("subservience is generated for every nation and clamps to 1–5", () => {
    for (const seed of [42, 2026]) {
        const stateGameEngine = GameEngine.create(seed, "small", 8);
        for (const nation of stateGameEngine.state.nations) {
            const value = subservienceOf(nation);
            assert.ok(value >= 1 && value <= 5, `${nation.name}: ${value}`);
            assert.equal(nation.subservience, value);
        }
    }
});
