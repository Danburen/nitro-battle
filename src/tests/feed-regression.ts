import assert from "node:assert/strict";
import test from "node:test";
import { buildFeedDigest } from "../ui/feed.ts";
import type { LogEntry, LogEvent } from "../game/types.ts";

function entry(day: number, text: string, event?: LogEvent, major = false): LogEntry {
    return { day, text, tone: "combat", nationId: 0, major, event };
}

function digest(day: number, log: LogEntry[]) {
    return buildFeedDigest({ day, log });
}

const battle = (rounds: number, attackLoss: number, defenseLoss: number, outcome: "ongoing" | "repelled" | "captured") => ({
    attacker: 1,
    defender: 2,
    rounds,
    attackLoss,
    defenseLoss,
    breach: outcome === "captured",
    outcome,
});

test("state flips are stars while ordinary captures group by nation and day", () => {
    const flip = entry(9, "A 国 攻占 都城，S 州易手", {
        kind: "capture",
        nation: 2,
        site: 10,
        province: "都城",
        stateName: "S",
        stateFlipped: true,
        battle: { ...battle(3, 1, 4, "captured"), totalAttackLoss: 9, totalDefenseLoss: 30 },
    });
    const provinceA = entry(9, "B 国 占领 甲地", {
        kind: "capture", nation: 3, site: 11, province: "甲地", stateName: "T", stateFlipped: false,
    });
    const provinceB = entry(9, "B 国 占领 乙地", {
        kind: "capture", nation: 3, site: 12, province: "乙地", stateName: "T", stateFlipped: false,
    });
    const oldFlip = entry(1, "旧事件", { kind: "capture", nation: 2, stateFlipped: true });

    const { days } = digest(9, [oldFlip, flip, provinceA, provinceB]);
    assert.equal(days.length, 1, "only the last three days are digested");
    assert.equal(days[0].day, 9);
    assert.deepEqual(days[0].stars.map((item) => item.text), [flip.text]);
    assert.deepEqual(days[0].captures.map((item) => item.text), [provinceA.text, provinceB.text]);
});

test("a multi-day battle is one aggregate and its capture replaces the leading rounds", () => {
    const log = [
        entry(11, "第1日", { kind: "battle-round", site: 20, province: "前线", battle: battle(1, 4, 10, "ongoing") }),
        entry(12, "第2日", { kind: "battle-round", site: 20, province: "前线", battle: battle(2, 3, 7, "ongoing") }),
        entry(13, "第3日", { kind: "battle-round", site: 20, province: "前线", battle: battle(3, 2, 5, "ongoing") }),
        entry(12, "甲战败退", { kind: "battle-round", site: 21, province: "支线", battle: { ...battle(1, 6, 6, "repelled"), attacker: 4 } }),
        entry(13, "甲再攻", { kind: "battle-round", site: 21, province: "支线", battle: { ...battle(1, 2, 2, "ongoing"), attacker: 4 } }),
        entry(11, "乙第1日", { kind: "battle-round", site: 22, province: "目标", battle: { ...battle(1, 5, 8, "ongoing"), attacker: 5 } }),
        entry(12, "乙第2日", { kind: "battle-round", site: 22, province: "目标", battle: { ...battle(2, 4, 6, "ongoing"), attacker: 5 } }),
        entry(13, "乙攻占", {
            kind: "capture", nation: 5, site: 22, province: "目标", stateName: "州", stateFlipped: true,
            battle: { ...battle(2, 4, 6, "captured"), attacker: 5, totalAttackLoss: 9, totalDefenseLoss: 14 },
        }),
    ];

    const { days } = digest(13, log);
    const day11 = days.find((block) => block.day === 11);
    const day12 = days.find((block) => block.day === 12);
    const day13 = days.find((block) => block.day === 13);
    assert.equal(day11?.battles.length ?? 0, 0, "the ongoing battle moves to its latest day");
    assert.equal(day13?.battles.length, 2);
    const main = day13?.battles.find((item) => item.site === 20);
    assert.deepEqual([main?.rounds, main?.attackLoss, main?.defenseLoss], [3, 9, 22]);
    const reopened = day12?.battles.find((item) => item.site === 21);
    assert.equal(reopened?.outcome, "repelled");
    assert.equal(day13?.battles.find((item) => item.site === 21)?.outcome, "ongoing");
    assert.equal(day13?.battles.some((item) => item.site === 22), false, "the captured battle is folded into the star");
    assert.equal(day13?.stars.length, 1);
});

test("production collapses to one aggregate per nation and day, keeping build start and completion apart", () => {
    const log = [
        entry(6, "旧生产", {
            kind: "production", nation: 1, action: "train", items: [{ label: "步兵", count: 1 }],
        }),
        entry(8, "训练坦克", { kind: "production", nation: 1, action: "train", items: [{ label: "坦克", count: 1 }] }),
        entry(8, "训练步兵", { kind: "production", nation: 1, action: "train", items: [{ label: "步兵", count: 2 }] }),
        entry(8, "建造工厂", {
            kind: "production", nation: 1, action: "build", stage: "start",
            items: [{ label: "工厂", count: 1 }], places: ["甲城"],
        }),
        entry(8, "建成工厂", {
            kind: "production", nation: 1, action: "build", stage: "done",
            items: [{ label: "工厂", count: 1 }], places: ["乙城"],
        }),
        entry(8, "部署", {
            kind: "production", nation: 1, action: "deploy",
            items: [{ label: "步兵", count: 1 }, { label: "坦克", count: 1 }], places: ["丙城"],
        }),
        entry(8, "他国训练", { kind: "production", nation: 2, action: "train", items: [{ label: "火炮", count: 1 }] }),
    ];

    const { days } = digest(8, log);
    const day8 = days.find((block) => block.day === 8);
    assert.equal(day8?.production.length, 2, "one line per nation per day");
    const first = day8?.production.find((item) => item.nation === 1);
    assert.ok(first);
    assert.equal(first.train.get("坦克"), 1);
    assert.equal(first.train.get("步兵"), 2);
    assert.equal(first.buildStart.get("工厂"), 1);
    assert.equal(first.buildDone.get("工厂"), 1);
    assert.deepEqual(first.buildStartPlaces, ["甲城"]);
    assert.deepEqual(first.buildDonePlaces, ["乙城"]);
    assert.equal(first.deploy.get("步兵"), 1);
    assert.equal(first.deploy.get("坦克"), 1);
    assert.deepEqual(first.deployPlaces, ["丙城"]);
    assert.equal(day8?.production.find((item) => item.nation === 2)?.train.get("火炮"), 1);
    assert.equal(days.find((block) => block.day === 6)?.production.length, 1);
});

test("global events are pinned, deduplicated and separated from the day stream", () => {
    const log = [
        entry(5, "旧战争", { kind: "war", nation: 1 }, true),
        entry(8, "季节更替 夏季", { kind: "season", season: "夏季" }),
        entry(9, "宣战", { kind: "war", nation: 1 }, true),
        entry(9, "吞并 S 州", { kind: "annex", nation: 2 }, true),
        entry(10, "季节更替 夏季", { kind: "season", season: "夏季" }),
        entry(10, "普通会战", { kind: "battle-round", site: 1, battle: battle(1, 1, 1, "ongoing") }),
    ];

    const { globals, days } = digest(10, log);
    assert.deepEqual(globals.map((item) => item.text), ["季节更替 夏季", "吞并 S 州", "宣战"]);
    assert.equal(days.some((block) => block.other.some((item) => item.text === "宣战")), false, "globals are not repeated in the day stream");
});