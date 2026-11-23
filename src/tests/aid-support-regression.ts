import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "../game/engine.ts";
import { setWar } from "../game/diplomacy.ts";
import { aidCandidates, decideAid, requestForeignAid } from "../game/vassal.ts";
import { verdictAccepts } from "../game/decision.ts";
import type { AITendencyId } from "../game/ai/types.ts";

/** Make nation 1 a vassal of the player without relying on generated starting relations. */
function vassalFixture(seed = 42): GameEngine {
    const engine = GameEngine.create(seed, "small", 5);
    const vassal = engine.state.nations[1]!;
    vassal.overlord = 0;
    vassal.vassalType = "cooperative";
    return engine;
}

test("aid tooltip reasons and verdict never diverge from the real outcome", () => {
    for (const seed of [7, 42, 2026]) {
        for (const helper of [2, 3, 4]) {
            const engine = vassalFixture(seed);
            const state = engine.state;
            if (!aidCandidates(state, 1).includes(helper)) continue;
            const support = decideAid(state, 1, helper);
            assert.equal(verdictAccepts(support.verdict), support.accepts, `${seed}/${helper}: verdict colour must match the outcome`);
            assert.ok(support.factors.length > 0, "every verdict has at least one visible reason");
            assert.equal(requestForeignAid(engine, 1, helper), support.accepts);
        }
    }
});

test("an existing war with the overlord is certain support", () => {
    const engine = vassalFixture();
    setWar(engine.state, 2, 0, true);
    const support = decideAid(engine.state, 1, 2);
    assert.equal(support.accepts, true);
    assert.equal(support.verdict, "sure");
    assert.ok(support.factors.some((factor) => factor.label === "正与宗主国交战"));
    assert.ok(support.factors.every((factor) => factor.sign === 1));
});

test("a reluctant tendency is a negative reason and refuses", () => {
    const reluctant: AITendencyId[] = ["isolated", "pacifist", "defensive"];
    for (const tendency of reluctant) {
        const engine = vassalFixture();
        engine.state.nations[2]!.tendency = tendency;
        const support = decideAid(engine.state, 1, 2);
        assert.equal(support.accepts, false);
        assert.equal(support.verdict, "refuse");
        assert.deepEqual(support.factors, [{ sign: -1, label: "倾向不愿介入他国冲突" }]);
    }
});
