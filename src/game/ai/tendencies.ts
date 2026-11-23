import { LCGRandom } from "../../utils/LCGRandom.ts";
import type { VassalType } from "../types/diplomacy.ts";
import type { AITendencyId, AITendencyProfile, AITuning, VassalTuning } from "./types.ts";

/**
 * Fixed AI temperaments.
 *
 * Behaviour stays rule-driven and seeded-random: a tendency only moves the
 * thresholds and dice weights, never the rules themselves. The five axes are
 * 1–5, so 3 is neutral and 1/5 are the extremes. Vassals use these same axes —
 * no separate temperament is stored on a nation.
 */
export const AI_TENDENCIES: Readonly<Record<AITendencyId, AITendencyProfile>> = {
    pacifist: {
        id: "pacifist",
        name: "和平主义",
        blurb: "这个国家专注内政与经济，不主动挑起战争，只有在遭到入侵时才会动员全国。",
        aggression: 1,
        defense: 3,
        expansion: 1,
        alliance: 4,
        warTolerance: 1,
    },
    defensive: {
        id: "defensive",
        name: "专注防御",
        blurb: "这个国家把资源投向边境工事与守备军，不谋求扩张，但会坚决反击任何入侵。",
        aggression: 1,
        defense: 5,
        expansion: 1,
        alliance: 3,
        warTolerance: 2,
    },
    bully: {
        id: "bully",
        name: "恃强凌弱",
        blurb: "这个国家只对明显弱于自己的邻国动手，面对强国则退让、结盟或拖延。",
        aggression: 3,
        defense: 2,
        expansion: 3,
        alliance: 2,
        warTolerance: 3,
    },
    opportunist: {
        id: "opportunist",
        name: "机会主义扩张",
        blurb: "这个国家没有固定的敌人，专挑邻国内乱、战败或经济崩溃时夺取领土。",
        aggression: 3,
        defense: 2,
        expansion: 4,
        alliance: 2,
        warTolerance: 3,
    },
    hegemon: {
        id: "hegemon",
        name: "霸权争雄",
        blurb: "这个国家以区域霸权为目标，积极扩军并压制潜在挑战者，不放过扩张机会。",
        aggression: 4,
        defense: 3,
        expansion: 5,
        alliance: 3,
        warTolerance: 4,
    },
    trader: {
        id: "trader",
        name: "贸易立国",
        blurb: "这个国家专注商路与港口，用军事力量保护贸易线，对封锁商路者抱有强烈敌意。",
        aggression: 2,
        defense: 3,
        expansion: 2,
        alliance: 4,
        warTolerance: 2,
    },
    ideologue: {
        id: "ideologue",
        name: "意识形态输出",
        blurb: "这个国家主动干涉他国内政，支持与自己相近的势力，战争目标常是推翻对方政权。",
        aggression: 3,
        defense: 2,
        expansion: 3,
        alliance: 4,
        warTolerance: 3,
    },
    isolated: {
        id: "isolated",
        name: "孤立堡垒",
        blurb: "这个国家不结盟、不扩张、也不干涉他国，只在边境重兵设防，坚持武装中立。",
        aggression: 1,
        defense: 5,
        expansion: 1,
        alliance: 1,
        warTolerance: 2,
    },
    militarist: {
        id: "militarist",
        name: "军国动员",
        blurb: "这个国家围绕战争运转，偏好先发制人与快速决战，对和平的耐心很低。",
        aggression: 5,
        defense: 3,
        expansion: 4,
        alliance: 2,
        warTolerance: 5,
    },
};

export const AI_TENDENCY_IDS: readonly AITendencyId[] = [
    "pacifist",
    "defensive",
    "bully",
    "opportunist",
    "hegemon",
    "trader",
    "ideologue",
    "isolated",
    "militarist",
];

/** Hand-built test fixtures omit the field; treat them as opportunistic. */
export const DEFAULT_AI_TENDENCY: AITendencyId = "opportunist";

export function tendencyProfileOf(id: AITendencyId | undefined): AITendencyProfile {
    return AI_TENDENCIES[id ?? DEFAULT_AI_TENDENCY] ?? AI_TENDENCIES[DEFAULT_AI_TENDENCY];
}

/**
 * A shuffled deck keeps generated worlds varied without consuming the shared
 * world RNG: the same seed always deals the same tendencies.
 */
export function aiTendencyDeck(seed: number): AITendencyId[] {
    const rand = new LCGRandom(seed ^ 0x7f4a7c15);
    const deck = [...AI_TENDENCY_IDS];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = rand.nextInt(0, i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/** Convert the five axes into concrete thresholds used by diplomacy and the controller. */
export function tendencyTuning(profile: AITendencyProfile): AITuning {
    const aggression = profile.aggression - 3;
    const defense = profile.defense - 3;
    const expansion = profile.expansion - 3;
    const alliance = profile.alliance - 3;
    const tolerance = profile.warTolerance - 3;
    return {
        attackRatio: clamp(1.1 - aggression * 0.08 - expansion * 0.03 + defense * 0.02, 0.75, 1.6),
        attackMinOrg: clamp(30 - aggression * 3 + defense * 4, 18, 46),
        warPowerRatio: clamp(1.15 - aggression * 0.07 - expansion * 0.05 + alliance * 0.04, 0.9, 1.8),
        warMinDay: clamp(5 - aggression - Math.round(expansion / 2), 2, 10),
        fatigueDays: clamp(10 + tolerance * 2 + defense, 4, 22),
        peacePowerRatio: clamp(0.85 - tolerance * 0.05 - defense * 0.02, 0.55, 1.05),
        offerMinDays: clamp(5 + tolerance, 2, 10),
        offerPowerRatio: clamp(0.65 - tolerance * 0.05 - defense * 0.02, 0.4, 0.95),
        fortAppetite: clamp((profile.defense - 1) / 4, 0, 1),
        ...vassalTuning(profile, null),
    };
}

/**
 * Vassal-only thresholds, derived purely from the nation's five tendency axes
 * and its contract type. Independence never falls passively: tribute paid to
 * the overlord pushes it up and the overlord's protection gifts push it down.
 * Offensive/expansionist nations answer offensive calls more readily, while
 * defensive ones hang back; bully/opportunist/expansionist nations flip more
 * easily, especially under an oppressive contract.
 */
export function vassalTuning(profile: AITendencyProfile, vassalType?: VassalType | null): VassalTuning {
    const offense = profile.aggression - 3 + profile.expansion - 3;
    const fortify = profile.defense - 3;
    const sociable = profile.alliance - 3;
    const endurance = profile.warTolerance - 3;
    // Independence caps are 100 / 300 / 500, so the drift is scaled by the cap
    // to keep all three contracts comparably unstable.
    const capScale = vassalType === "oppressive" ? 5 : vassalType === "cooperative" ? 3 : 1;
    const flipBonus = vassalType === "oppressive" ? 0.25 : vassalType === "autonomous" ? -0.12 : -0.05;
    return {
        independenceDrift: clamp(
            (0.12 + 0.04 * Math.max(0, offense) + (vassalType === "oppressive" ? 0.06 : 0)) * capScale,
            0.05, 2,
        ),
        tributeCompliance: clamp(
            1 - 0.05 * Math.max(0, offense) + 0.04 * Math.max(0, fortify) + 0.03 * sociable, 0.8, 1.2,
        ),
        callToArmsAccept: clamp(
            0.55 + 0.1 * offense + 0.06 * endurance - 0.12 * Math.max(0, fortify) + 0.03 * sociable, 0.05, 1,
        ),
        flipWill: clamp(
            0.18 + 0.1 * offense - 0.1 * Math.max(0, fortify) - 0.06 * sociable + flipBonus, 0, 1,
        ),
        upgradeWill: clamp(
            0.55 + 0.08 * sociable - 0.05 * Math.max(0, profile.aggression - 3)
            - 0.04 * Math.max(0, profile.expansion - 3) + (vassalType === "oppressive" ? 0.15 : 0), 0, 1,
        ),
    };
}

export function tendencyTuningOf(id: AITendencyId | undefined): AITuning {
    return tendencyTuning(tendencyProfileOf(id));
}

/** Trait tone: an edge (green `+`), a shortcoming (red `-`) or a neutral trait (white `~`). */
export type AITraitTone = "pos" | "neg" | "note";

/** One player-facing trait line; the tone decides sign and colour. */
export interface AITrait {
    readonly text: string;
    readonly tone: AITraitTone;
}

type TraitPhrase = { readonly text: string; readonly tone: AITraitTone };

/** Strongest axes, in player-facing words: no numbers, thresholds or unimplemented mechanics. */
const TRAIT_PHRASES: ReadonlyArray<{
    readonly axis: "aggression" | "defense" | "expansion" | "alliance" | "warTolerance";
    readonly high: TraitPhrase;
    readonly low: TraitPhrase;
}> = [
    {
        axis: "aggression",
        high: { text: "倾向于主动进攻他国、以战争扩张", tone: "pos" },
        low: { text: "不愿主动开战，更倾向维持现状", tone: "note" },
    },
    {
        axis: "defense",
        high: { text: "重视边防与工事，遭到入侵时坚决反击", tone: "pos" },
        low: { text: "防务投入较少，更依赖机动兵力", tone: "neg" },
    },
    {
        axis: "expansion",
        high: { text: "积极夺取邻国领土、扩大势力范围", tone: "pos" },
        low: { text: "对扩张领土兴趣不大", tone: "note" },
    },
    {
        axis: "alliance",
        high: { text: "愿意与他国结盟，并在外交上让步", tone: "pos" },
        low: { text: "不愿结盟，倾向独自行事", tone: "note" },
    },
    {
        axis: "warTolerance",
        high: { text: "能承受长期战争与军备竞赛", tone: "pos" },
        low: { text: "难以忍受长期战争，倾向尽快议和", tone: "neg" },
    },
];

/** Edges read first, then neutral characteristics, then shortcomings. */
const TONE_ORDER: Readonly<Record<AITraitTone, number>> = { pos: 2, note: 1, neg: 0 };

/** Up to three short traits describing what this nation leans toward. */
export function tendencyTraits(profile: AITendencyProfile): AITrait[] {
    return TRAIT_PHRASES
        .map((entry, order) => {
            const value = profile[entry.axis];
            return { order, weight: Math.abs(value - 3), ...(value >= 3 ? entry.high : entry.low) };
        })
        .filter((entry) => entry.weight > 0)
        .sort((a, b) => b.weight - a.weight || TONE_ORDER[b.tone] - TONE_ORDER[a.tone] || a.order - b.order)
        .slice(0, 3)
        .map(({ text, tone }) => ({ text, tone }));
}

const ESCAPED_TOKEN_CHAR = /[\\[]/g;

/**
 * Player-facing tooltip: the temperament in one sentence, a blank line, then
 * the strongest traits as signed game-text lines (`[[pos:…]]` / `[[neg:…]]` /
 * `[[note:…]]`), which the UI renders green, red or white.
 */
export function tendencyHelpBody(profile: AITendencyProfile): string {
    const traits = tendencyTraits(profile)
        .map((trait) => `[[${trait.tone}:${trait.text.replace(ESCAPED_TOKEN_CHAR, "\\$&")}]]`);
    return traits.length ? `${profile.blurb}\n\n${traits.join("\n")}` : profile.blurb;
}
