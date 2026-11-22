import assert from "node:assert/strict";
import test from "node:test";
import {
    AI_TENDENCIES, AI_TENDENCY_IDS, aiTendencyDeck, tendencyHelpBody, tendencyProfileOf, tendencyTraits,
    tendencyTuningOf,
} from "../game/ai/tendencies.ts";
import { generateWorld } from "../game/generator/index.ts";

test("every generated nation gets a stable, valid temperament", () => {
    const first = generateWorld({ seed: 42, mapSize: "small", nationCount: 4 });
    const second = generateWorld({ seed: 42, mapSize: "small", nationCount: 4 });
    assert.deepEqual(first.nations.map((nation) => nation.tendency),
        second.nations.map((nation) => nation.tendency));
    for (const nation of first.nations) {
        assert.ok(nation.tendency, `${nation.name} has no tendency`);
        assert.ok(AI_TENDENCY_IDS.includes(nation.tendency));
    }
    // The shuffled deck spreads temperaments instead of repeating one blindly.
    assert.equal(new Set(first.nations.map((nation) => nation.tendency)).size, 4);
});

test("the tendency deck is seeded, complete and stable", () => {
    const deck = aiTendencyDeck(2026);
    assert.deepEqual(deck, aiTendencyDeck(2026));
    assert.equal(deck.length, AI_TENDENCY_IDS.length);
    assert.equal(new Set(deck).size, AI_TENDENCY_IDS.length);
    assert.notDeepEqual(deck, aiTendencyDeck(2027));
});

test("temperament axes move the decision thresholds in the documented direction", () => {
    const pacifist = tendencyTuningOf("pacifist");
    const militarist = tendencyTuningOf("militarist");
    const defensive = tendencyTuningOf("defensive");
    const opportunist = tendencyTuningOf("opportunist");
    assert.ok(pacifist.attackRatio > opportunist.attackRatio);
    assert.ok(opportunist.attackRatio > militarist.attackRatio);
    assert.ok(pacifist.warPowerRatio > militarist.warPowerRatio);
    assert.ok(pacifist.fatigueDays < militarist.fatigueDays);
    assert.ok(defensive.fortAppetite > militarist.fortAppetite);
    assert.ok(pacifist.warMinDay > militarist.warMinDay);
    // Neutral defaults stay inside the old hand-tuned band.
    assert.equal(tendencyProfileOf(undefined).id, "opportunist");
    assert.ok(opportunist.attackRatio > 0.8 && opportunist.attackRatio < 1.4);
    assert.equal(AI_TENDENCIES.opportunist.warTolerance, 3);
});

test("the [i] description stays player-facing: blurb, blank line, signed traits", () => {
    const trader = tendencyHelpBody(tendencyProfileOf("trader"));
    assert.ok(trader.startsWith("这个国家专注商路与港口"));
    // A blank line separates the blurb from the modifier-like trait list.
    assert.match(trader, /。\n\n\[\[pos:|。\n\n\[\[neg:|。\n\n\[\[note:/);
    assert.match(trader, /\[\[pos:愿意与他国结盟/);
    // Peaceful / non-expansionist traits are neutral facts, not penalties.
    assert.match(trader, /\[\[note:不愿主动开战，更倾向维持现状/);
    assert.match(trader, /\[\[note:对扩张领土兴趣不大/);
    // No raw axis scores, thresholds or unimplemented-mechanism notes.
    assert.ok(!/\d\/5/.test(trader));
    assert.ok(!/阈值|权重|尚未实现/.test(trader));
    assert.equal(trader.split("\n").filter(Boolean).length, 4);
    const militarist = tendencyHelpBody(tendencyProfileOf("militarist"));
    assert.match(militarist, /\[\[pos:倾向于主动进攻他国/);
    assert.match(militarist, /长期战争/);
    const pacifist = tendencyHelpBody(tendencyProfileOf("pacifist"));
    assert.match(pacifist, /\[\[neg:难以忍受长期战争/);
    assert.match(pacifist, /\[\[note:/);
});

test("traits follow the strongest axes, carry a tone and stay short", () => {
    const tones = new Set(["pos", "neg", "note"]);
    for (const id of AI_TENDENCY_IDS) {
        const traits = tendencyTraits(tendencyProfileOf(id));
        assert.ok(traits.length >= 1 && traits.length <= 3, `${id} has ${traits.length} traits`);
        assert.equal(new Set(traits.map((trait) => trait.text)).size, traits.length);
        for (const trait of traits) {
            assert.ok(trait.text.length <= 24);
            assert.ok(tones.has(trait.tone));
        }
        // Every tone kind is exercised by the roster.
    }
    const used = new Set(AI_TENDENCY_IDS.flatMap((id) => tendencyTraits(tendencyProfileOf(id)).map((t) => t.tone)));
    assert.deepEqual([...used].sort(), ["neg", "note", "pos"]);
    const pacifist = tendencyTraits(tendencyProfileOf("pacifist"));
    assert.deepEqual(pacifist[0], { text: "不愿主动开战，更倾向维持现状", tone: "note" });
    assert.equal(tendencyTraits(tendencyProfileOf("militarist"))[0].tone, "pos");
    assert.equal(pacifist.find((trait) => trait.tone === "neg")?.text, "难以忍受长期战争，倾向尽快议和");
});
