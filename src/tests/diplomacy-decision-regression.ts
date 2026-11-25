import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import { verdictAccepts } from "../game/decision.ts";
import type { AITendencyId } from "../game/ai/types.ts";
import type { DiplomaticDecision } from "../game/types/decision.ts";
import type { GameState } from "../game/types/state.ts";
import {
    canBecomeVassal, decideUpgrade, decideVassalDemand, decideVassalOffer, requestVassalization,
} from "../game/vassal.ts";
import {
    canCreateAlliance, canInviteToAlliance, createAlliance, decideAllianceInvite,
    decideJoinRequest, inviteToAlliance, requestJoinAlliance,
} from "../game/alliance.ts";
import { decidePeace, proposePeace, setWar } from "../game/diplomacy.ts";

const TENDENCIES: readonly AITendencyId[] = [
    "pacifist", "defensive", "bully", "opportunist", "hegemon", "trader", "ideologue", "isolated", "militarist",
];

function check(decision: DiplomaticDecision, context: string): void {
    assert.equal(verdictAccepts(decision.verdict), decision.accepts, `${context}: verdict must match the outcome`);
    assert.ok(decision.factors.length > 0, `${context}: every verdict needs at least one visible reason`);
}

function vassalPair(state: GameState): { vassal: number; overlord: number } | null {
    for (const vassal of [1, 2, 3, 4]) {
        for (const overlord of [1, 2, 3, 4]) {
            if (vassal !== overlord && canBecomeVassal(state, vassal, overlord, "cooperative")) {
                return { vassal, overlord };
            }
        }
    }
    return null;
}

function allianceLeader(state: GameState): number | null {
    for (const id of [1, 2, 3, 4]) if (canCreateAlliance(state, id)) return id;
    return null;
}

test("every willingness decision keeps verdict, factors and outcome consistent", () => {
    for (const seed of [7, 42, 2026]) {
        const state = GameEngine.create(seed, "small", 5).state;
        for (const tendency of TENDENCIES) {
            Object.assign(state.nations[2]!, { tendency });
            Object.assign(state.nations[3]!, { tendency });
            const tag = `${seed}/${tendency}`;
            check(decideVassalOffer(state, 2, 1, "cooperative"), `offer-co/${tag}`);
            check(decideVassalOffer(state, 2, 1, "autonomous"), `offer-au/${tag}`);
            check(decideVassalDemand(state, 2, 1), `demand/${tag}`);
            check(decideAllianceInvite(state, 2, 1), `invite/${tag}`);
            check(decideJoinRequest(state, 2, 1), `join/${tag}`);
            check(decideUpgrade(state, 2, 1), `upgrade/${tag}`);
            check(decidePeace(state, 2, 1), `peace/${tag}`);
        }
    }
});

test("a hard veto is a single negative reason", () => {
    const state = GameEngine.create(42, "small", 5).state;
    Object.assign(state.nations[2]!, { tendency: "isolated" });
    const isolated = decideVassalOffer(state, 2, 1, "cooperative");
    assert.equal(isolated.accepts, false);
    assert.equal(isolated.factors.length, 1);
    assert.equal(isolated.factors[0]!.sign, -1);

    setWar(state, 2, 1, true);
    assert.equal(decideVassalOffer(state, 2, 1, "cooperative").factors[0]!.label, "正与请求方交战");
});

test("vassal offer tooltip decision is the exact boolean the request consumes", () => {
    let checked = 0;
    for (const seed of [7, 42, 2026, 12345]) {
        const engine = GameEngine.create(seed, "small", 5);
        const pair = vassalPair(engine.state);
        if (!pair) continue;
        const decision = decideVassalOffer(engine.state, pair.overlord, pair.vassal, "cooperative");
        assert.equal(requestVassalization(engine, pair.vassal, pair.overlord, "cooperative"), decision.accepts);
        checked++;
    }
    assert.ok(checked > 0, "at least one seed has a valid vassal offer pair");
});

test("alliance invite and join decisions are the booleans their paths consume", () => {
    const engine = GameEngine.create(42, "small", 5);
    const state = engine.state;
    state.day = 10;
    state.nations[0]!.politicalPower = 100;
    for (const nation of state.nations) Object.assign(nation, { tendency: "pacifist" });
    assert.ok(createAlliance(engine, 0));

    const target = [1, 2, 3, 4].find((id) => canInviteToAlliance(state, 0, id));
    assert.notEqual(target, undefined);
    if (target !== undefined) {
        assert.equal(inviteToAlliance(engine, 0, target), decideAllianceInvite(state, 0, target).accepts);
    }

    const joinEngine = GameEngine.create(42, "small", 5);
    const joinState = joinEngine.state;
    joinState.day = 10;
    for (const nation of joinState.nations) Object.assign(nation, { tendency: "pacifist" });
    for (const id of [1, 2, 3, 4]) joinState.nations[id]!.politicalPower = 100;
    const leader = allianceLeader(joinState);
    assert.notEqual(leader, null);
    if (leader !== null) {
        joinState.nations[leader]!.politicalPower = 100;
        assert.ok(createAlliance(joinEngine, leader));
        assert.equal(requestJoinAlliance(joinEngine, 0, leader), decideJoinRequest(joinState, leader, 0).accepts);
    }
});

test("early peace is refused by both the tooltip decision and the acceptance path", () => {
    const engine = GameEngine.create(42, "small", 5);
    setWar(engine.state, 1, 0, true);
    const decision = decidePeace(engine.state, 1, 0);
    assert.equal(decision.accepts, false);
    assert.equal(proposePeace(engine, 1), false);
});
