import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import { createRequestCooldown } from "../game/requests.ts";
import {
    hasMilitaryAccess, isProtectedRelation, nationDisplayColor, overlordOf, vassalTypeOf,
} from "../game/access.ts";
import {
    VASSAL_PROFILES, VASSAL_UPGRADE_COST, adjustTributeRate, aidCandidates, applyVassalCallToArms,
    canRequestUpgrade, demandVassalization, expireDiplomaticRequests, HIGH_INDEPENDENCE_RATIO,
    independenceCapOf, independenceOf, independenceRatioOf, joinVassalDefense, releaseVassal,
    requestForeignAid, requestVassalization, requestVassalUpgrade, respondDiplomaticRequest,
    runAIVassalPolitics, setVassal, tickVassalIndependence, tickVassalTribute, tributeRateOf,
} from "../game/vassal.ts";
import { tendencyProfileOf, vassalTuning } from "../game/ai/tendencies.ts";
import {
    ALLIANCE_CREATE_COST, ALLIANCE_INVITE_COOLDOWN, allianceOf, applyAllianceWar,
    canInviteToAlliance, commonEnemy, createAlliance, inSameAlliance, inviteToAlliance,
    requestJoinAlliance,
} from "../game/alliance.ts";
import {
    advanceDiplomacy, claimState, isAtWar, nationPower, prepareDiplomaticAction, setWar, startWar,
} from "../game/diplomacy.ts";
import { reachable } from "../game/rules.ts";
import { spawnArmy } from "../game/armies.ts";
import { DEFAULT_POLICIES } from "../game/types/policy.ts";
import { MAX_HP, UnitKind } from "../game/types/unit.ts";
import type { AITendencyId } from "../game/ai/types.ts";
import type { Army } from "../game/types/organization.ts";
import type { GameState } from "../game/types/state.ts";
import type { Nation, Province, StateRegion } from "../game/types/entities.ts";

/** Four nations on a straight line: 0-1-2-3, three provinces each. */
function fixture(
    tendencies: AITendencyId[] = ["opportunist", "hegemon", "hegemon", "defensive"], seed = 42,
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

function addStrength(state: GameState, nationId: number, tanks: number): Army {
    const army = spawnArmy(state, nationId, nationId * 3, Array.from({ length: tanks }, () => UnitKind.TANK), 100);
    for (const regiment of army.regiments) regiment.hp = MAX_HP;
    return army;
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

test("declaring war on a vassal forces its overlord in and logs one consolidated headline", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 2, 3, "cooperative"), true);
    assert.equal(overlordOf(state, 2), 3);
    assert.ok(claimState(engine, 1, 2), "the aggressor claims the vassal's state");
    assert.ok(prepareDiplomaticAction(engine, 1, "conquest", 2, 2));
    const action = state.diplomaticActions.at(-1)!;
    state.day = action.readyDay;
    advanceDiplomacy(engine);
    const before = state.log.length;
    assert.equal(startWar(engine, 1, 2, action.id), true);
    assert.equal(isAtWar(state, 1, 2), true);
    assert.equal(isAtWar(state, 3, 1), true, "the overlord is forced into the defensive war");

    const added = state.log.slice(before);
    const warLines = added.filter((entry) => entry.event?.kind === "war");
    assert.equal(warLines.length, 1, "one consolidated war headline instead of one per participant");
    assert.match(warLines[0].text, /对 .* 宣战（夺取宣称州）/);
    assert.match(warLines[0].text, /也参与战争/);
    assert.ok(warLines[0].text.includes(state.nations[3].name), "the forced overlord is named");
    assert.equal(added.some((entry) => entry.text.includes("履行保护义务")), false);
});

test("independence caps and starting values follow the contract", () => {
    const engine = fixture();
    const state = engine.state;
    for (const [id, type] of [[1, "cooperative"], [2, "autonomous"], [3, "oppressive"]] as const) {
        assert.equal(setVassal(engine, id, 0, type), true);
        assert.equal(independenceCapOf(state, id), VASSAL_PROFILES[type].independenceCap);
        assert.equal(independenceOf(state, id), VASSAL_PROFILES[type].independenceStart);
        // Same 30% / 55% / 15% share of each cap as before the量程 change.
        assert.ok(Math.abs(independenceRatioOf(state, id) -
            VASSAL_PROFILES[type].independenceStart / VASSAL_PROFILES[type].independenceCap) < 1e-9);
    }
    assert.deepEqual(
        [VASSAL_PROFILES.autonomous.independenceCap, VASSAL_PROFILES.cooperative.independenceCap,
            VASSAL_PROFILES.oppressive.independenceCap], [100, 300, 500],
    );

    state.nations[3].independence = 9999;
    assert.equal(independenceOf(state, 3), 500, "independence is clamped to the contract cap");
    state.nations[3].independence = -20;
    assert.equal(independenceOf(state, 3), 0);
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
    const before = state.nations.map((nation) => ({
        funds: nation.funds, pp: nation.politicalPower, independence: independenceOf(state, nation.id),
    }));

    tickVassalTribute(engine);

    assert.ok(state.nations[0].funds > 0, "the overlord receives resource shares");
    assert.ok(state.nations[1].funds < before[1].funds, "cooperative pays resources");
    assert.ok(state.nations[3].funds < before[3].funds, "oppressive pays resources");
    assert.equal(state.nations[2].funds, before[2].funds, "autonomous keeps its economy");
    // Cooperative gets +1 protection PP; autonomous pays 2; oppressive pays 3.
    assert.equal(state.nations[1].politicalPower, before[1].pp + 1);
    assert.equal(state.nations[2].politicalPower, before[2].pp - 2);
    assert.equal(state.nations[3].politicalPower, before[3].pp - 3);
    for (let id = 1; id <= 3; id++) {
        assert.ok(independenceOf(state, id) > before[id].independence, `vassal ${id} gains independence`);
    }
});

test("tribute benefits raise independence and the overlord's protection gift lowers it", () => {
    const withoutGift = fixture();
    assert.equal(setVassal(withoutGift, 1, 0, "cooperative"), true);
    withoutGift.state.nations[0].politicalPower = 0;
    const beforeA = independenceOf(withoutGift.state, 1);
    tickVassalTribute(withoutGift);
    const deltaWithoutGift = independenceOf(withoutGift.state, 1) - beforeA;

    const withGift = fixture();
    assert.equal(setVassal(withGift, 1, 0, "cooperative"), true);
    withGift.state.nations[0].politicalPower = 50;
    const beforeB = independenceOf(withGift.state, 1);
    tickVassalTribute(withGift);
    const deltaWithGift = independenceOf(withGift.state, 1) - beforeB;

    assert.ok(deltaWithoutGift > 0, "paying tribute raises independence");
    assert.ok(deltaWithGift < deltaWithoutGift, "the overlord's protection gift lowers independence");
});

test("cooperative tribute stays inside the contract band", () => {
    const engine = fixture();
    const state = engine.state;
    assert.equal(setVassal(engine, 1, 0, "cooperative"), true);
    assert.equal(adjustTributeRate(engine, 1, 0.2), true);
    assert.ok(Math.abs(tributeRateOf(state, 1) - 0.35) < 1e-9);
    assert.equal(adjustTributeRate(engine, 1, -1), true);
    assert.ok(Math.abs(tributeRateOf(state, 1) - VASSAL_PROFILES.cooperative.resourceMin) < 1e-9);
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

test("reaching the cap secedes peaceful contracts and rebels against oppressive ones", () => {
    const peaceful = fixture();
    assert.equal(setVassal(peaceful, 1, 0, "cooperative"), true);
    peaceful.state.nations[1].independence = VASSAL_PROFILES.cooperative.independenceCap;
    tickVassalIndependence(peaceful);
    assert.equal(overlordOf(peaceful.state, 1), -1);
    assert.equal(isAtWar(peaceful.state, 1, 0), false);

    const rebel = fixture();
    assert.equal(setVassal(rebel, 1, 0, "oppressive"), true);
    rebel.state.nations[1].independence = VASSAL_PROFILES.oppressive.independenceCap;
    tickVassalIndependence(rebel);
    assert.equal(overlordOf(rebel.state, 1), -1);
    assert.equal(isAtWar(rebel.state, 1, 0), true);
});

test("a high-independence oppressive vassal may rise early while the overlord is at war", () => {
    let revolts = 0;
    for (let seed = 1; seed <= 20; seed++) {
        const engine = fixture(undefined, seed);
        const state = engine.state;
        assert.equal(setVassal(engine, 1, 0, "oppressive"), true);
        state.nations[1].independence = VASSAL_PROFILES.oppressive.independenceCap * HIGH_INDEPENDENCE_RATIO;
        state.day = 5;
        setWar(state, 0, 3, true);
        tickVassalIndependence(engine);
        if (overlordOf(state, 1) < 0 && isAtWar(state, 1, 0)) revolts++;
    }
    assert.ok(revolts > 0, "an oppressive vassal can revolt before the cap in wartime");
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

test("tendency axes drive vassal thresholds, with no subservience field anywhere", () => {
    const offensive = vassalTuning(tendencyProfileOf("militarist"), "cooperative");
    const defensive = vassalTuning(tendencyProfileOf("defensive"), "cooperative");
    const opportunist = vassalTuning(tendencyProfileOf("opportunist"), "oppressive");
    const pacifist = vassalTuning(tendencyProfileOf("pacifist"), "oppressive");
    assert.ok(offensive.callToArmsAccept > defensive.callToArmsAccept);
    assert.ok(opportunist.flipWill > pacifist.flipWill);
    assert.ok(offensive.upgradeWill < vassalTuning(tendencyProfileOf("trader"), "cooperative").upgradeWill);
    for (const id of ["pacifist", "bully", "militarist", "defensive"] as const) {
        for (const type of ["autonomous", "cooperative", "oppressive"] as const) {
            const tuning = vassalTuning(tendencyProfileOf(id), type);
            assert.ok(tuning.independenceDrift >= 0, `${id}/${type} independence never falls passively`);
        }
    }
    for (const seed of [42, 2026]) {
        for (const nation of GameEngine.create(seed, "small", 8).state.nations) {
            assert.equal((nation as unknown as { subservience?: number }).subservience, undefined);
            assert.ok(nation.tendency);
        }
    }
});

test("contract upgrades need tendency plus high independence, not subservience", () => {
    const engine = fixture(["trader", "trader", "hegemon", "defensive"]);
    const state = engine.state;
    state.nations[1].politicalPower = 100;
    assert.equal(setVassal(engine, 1, 0, "cooperative"), true);
    assert.equal(canRequestUpgrade(state, 1), false, "30% independence is too low");
    state.nations[1].independence = 180;
    assert.equal(canRequestUpgrade(state, 1), true);
    assert.equal(requestVassalUpgrade(engine, 1), true);
    assert.equal(state.diplomaticRequests.length, 1);
    const request = state.diplomaticRequests[0];
    assert.equal(request.kind, "upgrade");
    assert.equal(request.vassalType, "autonomous");
    assert.equal(respondDiplomaticRequest(engine, request.id, true), true);
    assert.equal(vassalTypeOf(state, 1), "autonomous");
    assert.equal(state.nations[1].politicalPower, 100 - VASSAL_UPGRADE_COST);
    assert.ok(independenceOf(state, 1) < VASSAL_PROFILES.autonomous.independenceCap,
        "an upgrade never lands the vassal straight on the secession threshold");

    const second = fixture(["trader", "trader", "trader", "defensive"]);
    setVassal(second, 2, 3, "cooperative");
    second.state.nations[2].independence = 180;
    second.state.nations[2].politicalPower = 100;
    assert.equal(requestVassalUpgrade(second, 2), true);
    assert.equal(vassalTypeOf(second.state, 2), "autonomous", "AI overlords answer immediately");
});

test("war entry follows tendency and independence; oppressive vassals always join", () => {
    let offensiveJoins = 0;
    let defensiveJoins = 0;
    for (let seed = 1; seed <= 12; seed++) {
        const engine = fixture(["opportunist", "militarist", "defensive", "defensive"], seed);
        const state = engine.state;
        setVassal(engine, 1, 0, "cooperative"); // militarist: offensive
        setVassal(engine, 2, 0, "cooperative"); // defensive: reluctant in an aggressive war
        // No war record: the caller is treated as the aggressor.
        applyVassalCallToArms(engine, 0, 3);
        if (isAtWar(state, 1, 3)) offensiveJoins++;
        if (isAtWar(state, 2, 3)) defensiveJoins++;
    }
    assert.ok(offensiveJoins > defensiveJoins, "offensive vassals answer aggressive wars more often");

    const high = fixture(["opportunist", "militarist", "defensive", "defensive"]);
    setVassal(high, 1, 0, "cooperative");
    high.state.nations[1].independence = 250; // >80% of 300
    applyVassalCallToArms(high, 0, 3);
    assert.equal(isAtWar(high.state, 1, 3), true, "high independence + offensive tendency + aggressor joins");

    const oppressive = fixture(["opportunist", "defensive", "defensive", "defensive"]);
    setVassal(oppressive, 1, 0, "oppressive");
    applyVassalCallToArms(oppressive, 0, 3);
    assert.equal(isAtWar(oppressive.state, 1, 3), true, "oppressive contracts join unconditionally");

    const playerVassal = fixture();
    const playerState = playerVassal.state;
    assert.equal(setVassal(playerVassal, 0, 1, "cooperative"), true);
    applyVassalCallToArms(playerVassal, 1, 2);
    const request = playerState.diplomaticRequests.find((entry) => entry.kind === "call");
    assert.ok(request);
    assert.equal(request.enemy, 2);
    assert.equal(respondDiplomaticRequest(playerVassal, request.id, true), true);
    assert.equal(isAtWar(playerState, 0, 2), true);
});

test("a restless vassal seeks the strong attacker when its overlord looks weak", () => {
    const engine = fixture(["opportunist", "opportunist", "hegemon", "defensive"]);
    const state = engine.state;
    assert.equal(setVassal(engine, 1, 0, "oppressive"), true);
    addStrength(state, 2, 8);
    setWar(state, 2, 0, true);
    assert.equal(aidCandidates(state, 1)[0], 2, "the attacker is the first aid candidate");

    let defections = 0;
    let loyalDefections = 0;
    for (let seed = 1; seed <= 20; seed++) {
        const restless = fixture(["opportunist", "opportunist", "hegemon", "defensive"], seed);
        const rs = restless.state;
        setVassal(restless, 1, 0, "oppressive");
        rs.nations[1].independence = 420; // 84% of 500
        addStrength(rs, 2, 8);
        setWar(rs, 2, 0, true);
        runAIVassalPolitics(restless, 1);
        if (overlordOf(rs, 1) === 2) defections++;

        const loyal = fixture(["opportunist", "pacifist", "hegemon", "defensive"], seed);
        const ls = loyal.state;
        setVassal(loyal, 1, 0, "autonomous");
        ls.nations[1].independence = 84; // same ratio, gentler contract and temperament
        addStrength(ls, 2, 8);
        setWar(ls, 2, 0, true);
        runAIVassalPolitics(loyal, 1);
        if (overlordOf(ls, 1) === 2) loyalDefections++;
    }
    assert.ok(defections > 0, "a high-independence oppressive vassal can flip to the attacker");
    assert.ok(defections > loyalDefections, "oppressive / aggressive vassals flip more than loyal ones");
});
