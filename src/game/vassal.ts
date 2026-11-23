import { ALLIANCE_INVITE_COOLDOWN, allianceOf, commonEnemy, joinAlliance, leaveAlliance } from "./alliance.ts";
import {
    borderingNations, dropOffers, isAtWar, nationPower, setWar, TRUCE_DAYS, truceDays,
} from "./diplomacy.ts";
import type { GameCore } from "./core.ts";
import { clampResources, resourceRates } from "./economy.ts";
import { isProtectedRelation, overlordOf, vassalTypeOf, vassalsOf } from "./access.ts";
import { tendencyProfileOf, vassalTuning } from "./ai/tendencies.ts";
import type { VassalTuning } from "./ai/types.ts";
import { createDiplomaticRequest } from "./requests.ts";
import { PP_CAP } from "./types.ts";
import type {
    DiplomaticRequest, DiplomaticRequestKind, GameState, Nation, VassalType,
} from "./types.ts";

export interface VassalProfile {
    readonly name: string;
    readonly short: string;
    readonly blurb: string;
    /** Default resource share; 0 for the autonomous contract. */
    readonly resourceShare: number;
    readonly resourceMin: number;
    readonly resourceMax: number;
    /** Only cooperative tribute is adjustable by the vassal. */
    readonly adjustable: boolean;
    /** Political points paid by the vassal every day. */
    readonly tributePP: number;
    /** Political points the overlord returns every day (cooperative protection). */
    readonly protectionPP: number;
    /** Independence ceiling: autonomous 100, cooperative 300, oppressive 500. */
    readonly independenceCap: number;
    /** Independence when the contract starts, as a fixed share of the cap. */
    readonly independenceStart: number;
}

/**
 * Contract values are deliberately lopsided: cooperative vassals buy protection
 * with resources, autonomous ones keep their economy and pay in influence, and
 * oppressive ones are a war settlement they cannot legally escape. The higher
 * the cap, the more pressure the contract generates before it breaks.
 */
export const VASSAL_PROFILES = {
    cooperative: {
        name: "合作型",
        short: "合作",
        blurb: "上缴可调比例的[[funds]]与[[industry]]，换取保护与[[politics]]；独立性上限 300。",
        resourceShare: 0.15,
        resourceMin: 0.05,
        resourceMax: 0.4,
        adjustable: true,
        tributePP: 0,
        protectionPP: 1,
        independenceCap: 300,
        independenceStart: 90,
    },
    autonomous: {
        name: "自治型",
        short: "自治",
        blurb: "只上缴[[politics]]，宗主国仅提供保护；经济自主，独立性上限 100。",
        resourceShare: 0,
        resourceMin: 0,
        resourceMax: 0,
        adjustable: false,
        tributePP: 2,
        protectionPP: 0,
        independenceCap: 100,
        independenceStart: 55,
    },
    oppressive: {
        name: "压迫型",
        short: "压迫",
        blurb: "战败和谈的产物：上缴[[politics]]与固定比例[[funds]]，独立性上限 500，最易反叛。",
        resourceShare: 0.3,
        resourceMin: 0.3,
        resourceMax: 0.3,
        adjustable: false,
        tributePP: 3,
        protectionPP: 0,
        independenceCap: 500,
        independenceStart: 75,
    },
} as const satisfies Record<VassalType, VassalProfile>;

export const VASSAL_OFFER_COOLDOWN = 20;
export const VASSAL_AID_COOLDOWN = 20;
export const VASSAL_UPGRADE_COST = 10;
/** Independence at or above 80% of the contract cap: high, restless territory. */
export const HIGH_INDEPENDENCE_RATIO = 0.8;
/** Overlord annexation: only a docile, low-independence vassal may be absorbed. */
export const ANNEX_INDEPENDENCE_MAX = 0.35;
export const ANNEX_FLIP_WILL_MAX = 0.3;
/** Upgrade requests need a reasonably settled (though not loyal) vassal. */
const UPGRADE_INDEPENDENCE_RATIO = 0.6;
const UPGRADE_WILL_MIN = 0.45;

/** Full player-facing rules, shown by the [i] next to the vassal status. */
export const VASSAL_HELP_BODY = [
    "附庸国与宗主国使用相同的疆域背景色，只有国旗纹章不同；宗主国对所有类型的附庸都拥有通行权，附庸也可进入宗主国领土。",
    "",
    "独立性是唯一的附庸状态值：只会随时间和对宗主有利的贡赋被动增长，宗主国的保护与馈赠会降低它。自治型上限 100，合作型 300，压迫型 500；达到 80% 进入高位，容易倒戈或起义；达到上限时自治/合作型和平独立，压迫型起兵反叛。",
    "",
    "附庸参战取决于国家倾向：进攻、扩张倾向强的附庸乐于响应宗主的进攻战争；防御倾向强的附庸在宗主主动开战时不情愿。宗主是被侵略方时各附庸更愿援助。压迫型无条件参加宗主的每一场战争；玩家作为附庸会收到待处理召唤。",
    "翻盘：恃强凌弱、机会主义扩张的附庸在宗主弱小、进攻方强大时会向进攻方求援独立，压迫型尤其如此；自治与合作型反叛倾向较低。独立性处在高位时更易发生。",
    `契约改善：当附庸独立性达到上限的 60%、国家倾向愿意改善且攒够 [[politics:${VASSAL_UPGRADE_COST}]] 时，可请求宗主国改善契约（压迫型→合作型，合作型→自治型），宗主国可以拒绝。`,
    "弱小国家可主动请求成为附庸（压迫型不可主动选择）；宗主国亦可要求弱国附庸。选中附庸后可在外交行动中调整贡赋比例与契约类型。",
].join("\n");

/** Vassal-only thresholds read from the nation's own tendency and contract. */
export function vassalTuningOf(state: GameState, nationId: number): VassalTuning {
    const nation = state.nations[nationId];
    const type = vassalTypeOf(state, nationId);
    return vassalTuning(tendencyProfileOf(nation?.tendency), type);
}

export function validVassalType(type: string): type is VassalType {
    return type === "cooperative" || type === "autonomous" || type === "oppressive";
}

export function vassalProfileOf(type: VassalType | null | undefined): VassalProfile {
    return VASSAL_PROFILES[type ?? "autonomous"] ?? VASSAL_PROFILES.autonomous;
}

function living(state: GameState, nation: number): boolean {
    return Number.isInteger(nation) && nation >= 0 && state.nations[nation]?.alive === true;
}

/** Independence ceiling for a vassal; independent nations read as 100. */
export function independenceCapOf(state: GameState, nationId: number): number {
    const type = vassalTypeOf(state, nationId);
    return type ? VASSAL_PROFILES[type].independenceCap : 100;
}

/** Independence as a share of the contract cap (0 for independents). */
export function independenceRatioOf(state: GameState, nationId: number): number {
    return independenceOf(state, nationId) / independenceCapOf(state, nationId);
}

export function independenceOf(state: GameState, nationId: number): number {
    const type = vassalTypeOf(state, nationId);
    if (!type) return 100;
    const profile = VASSAL_PROFILES[type];
    const value = state.nations[nationId]?.independence;
    return Number.isFinite(value)
        ? Math.max(0, Math.min(profile.independenceCap, value as number))
        : profile.independenceStart;
}

/** Move independence within the contract cap, without crossing the boundary. */
function shiftIndependence(state: GameState, nationId: number, delta: number): void {
    const nation = state.nations[nationId];
    if (!nation) return;
    const cap = independenceCapOf(state, nationId);
    nation.independence = Math.max(0, Math.min(cap, independenceOf(state, nationId) + delta));
}

export function tributeRateOf(state: GameState, nationId: number): number {
    const type = vassalTypeOf(state, nationId);
    if (!type) return 0;
    const profile = VASSAL_PROFILES[type];
    if (!profile.adjustable) return profile.resourceShare;
    const value = state.nations[nationId]?.tributeRate;
    if (!Number.isFinite(value)) return profile.resourceShare;
    return Math.max(profile.resourceMin, Math.min(profile.resourceMax, value as number));
}

/** Voluntary offers need peace, proximity and an unattached overlord. */
export function canBecomeVassal(
    state: GameState, vassal: number, overlord: number, type: string,
): boolean {
    if (state.winner !== null || !living(state, vassal) || !living(state, overlord)) return false;
    if (vassal === overlord || !validVassalType(type)) return false;
    if (overlordOf(state, vassal) >= 0 || overlordOf(state, overlord) >= 0) return false;
    if (vassalsOf(state, vassal).length > 0) return false;
    if (isAtWar(state, vassal, overlord)) return false;
    return borderingNations(state, vassal).has(overlord);
}

/** A player overlord may annex only a calm vassal with little independence left. */
export function canAnnexVassal(state: GameState, vassalId: number, overlordId: number): boolean {
    if (state.winner !== null || !living(state, vassalId) || !living(state, overlordId)) return false;
    if (overlordOf(state, vassalId) !== overlordId) return false;
    if (independenceRatioOf(state, vassalId) > ANNEX_INDEPENDENCE_MAX) return false;
    return vassalTuningOf(state, vassalId).flipWill <= ANNEX_FLIP_WILL_MAX;
}

function canRequestVassalization(state: GameState, vassal: number, overlord: number, type: string): boolean {
    if (!canBecomeVassal(state, vassal, overlord, type)) return false;
    return vassalCooldownDays(state, vassal, overlord) === 0;
}

export function vassalCooldownDays(state: GameState, a: number, b: number): number {
    return Math.max(0, (state.vassalCooldown[a]?.[b] ?? -1) - state.day);
}

function setPairCooldown(matrix: number[][], a: number, b: number, day: number): void {
    if (matrix[a]?.[b] !== undefined) matrix[a][b] = day;
    if (matrix[b]?.[a] !== undefined) matrix[b][a] = day;
}

function clearVassalFields(nation: Nation): void {
    nation.overlord = -1;
    nation.vassalType = undefined;
    nation.independence = undefined;
    nation.tributeRate = undefined;
}

function removePairWars(state: GameState, a: number, b: number): void {
    for (let i = state.wars.length - 1; i >= 0; i--) {
        const war = state.wars[i];
        if ((war.aggressor === a && war.defender === b) || (war.aggressor === b && war.defender === a)) {
            state.wars.splice(i, 1);
        }
    }
    dropOffers(state, a, b);
}

function removePairRequests(state: GameState, a: number, b: number): void {
    for (let i = state.diplomaticRequests.length - 1; i >= 0; i--) {
        const request = state.diplomaticRequests[i];
        if ((request.from === a && request.to === b) || (request.from === b && request.to === a)) {
            state.diplomaticRequests.splice(i, 1);
        }
    }
}

/**
 * Install the contract. A war between the pair is ended first so the vassal
 * keeps its land: only the political relationship changes.
 */
export function setVassal(core: GameCore, vassalId: number, overlordId: number, type: VassalType): boolean {
    const state = core.state;
    if (state.winner !== null || !living(state, vassalId) || !living(state, overlordId)) return false;
    if (vassalId === overlordId || overlordOf(state, vassalId) >= 0 || overlordOf(state, overlordId) >= 0) return false;
    if (vassalsOf(state, vassalId).length > 0) return false;
    const profile = VASSAL_PROFILES[type];
    if (!profile) return false;

    if (allianceOf(state, vassalId)) leaveAlliance(core, vassalId);
    if (isAtWar(state, vassalId, overlordId)) {
        setWar(state, vassalId, overlordId, false);
        state.truce[vassalId][overlordId] = -1;
        state.truce[overlordId][vassalId] = -1;
    }
    removePairWars(state, vassalId, overlordId);
    removePairRequests(state, vassalId, overlordId);

    const vassal = state.nations[vassalId];
    vassal.overlord = overlordId;
    vassal.vassalType = type;
    vassal.independence = profile.independenceStart;
    vassal.tributeRate = profile.resourceShare;
    core.invalidateReach();
    state.supplyDirty = true;
    core.log(`${core.nationChip(vassalId)} 成为 ${core.nationChip(overlordId)} 的${profile.name}附庸`, "diplo", vassalId, true, {
        kind: "peace",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "state" });
    return true;
}

/** Peaceful release or overlord grant; rebellion uses `rebelVassal` instead. */
export function releaseVassal(core: GameCore, vassalId: number, peaceful = true): boolean {
    const state = core.state;
    const overlord = overlordOf(state, vassalId);
    if (overlord < 0) return false;
    const nation = state.nations[vassalId];
    clearVassalFields(nation);
    removePairRequests(state, vassalId, overlord);
    if (peaceful) {
        const until = state.day + TRUCE_DAYS;
        state.truce[vassalId][overlord] = until;
        state.truce[overlord][vassalId] = until;
    }
    core.invalidateReach();
    core.log(`${core.nationChip(vassalId)} 脱离 ${core.nationChip(overlord)}，恢复独立`, "diplo", vassalId, true, {
        kind: "peace",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "state" });
    return true;
}

/**
 * Overlord-side contract change: reassign one of your vassals to a different
 * type. Independence progress is preserved proportionally but clamped below the
 * new contract's secession threshold, so a harsher contract never instantly
 * pushes a calm vassal to revolt.
 */
export function changeVassalType(core: GameCore, vassalId: number, type: VassalType): boolean {
    const state = core.state;
    if (state.winner !== null || !living(state, vassalId) || !validVassalType(type)) return false;
    if (overlordOf(state, vassalId) < 0) return false;
    const current = vassalTypeOf(state, vassalId);
    if (!current || current === type) return false;
    const nation = state.nations[vassalId];
    const profile = VASSAL_PROFILES[type];
    const ratio = independenceRatioOf(state, vassalId);
    nation.vassalType = type;
    nation.tributeRate = profile.resourceShare;
    nation.independence = Math.min(
        profile.independenceCap * 0.7,
        Math.max(profile.independenceStart, ratio * profile.independenceCap),
    );
    core.log(`${core.nationChip(vassalId)} 的附庸契约由${VASSAL_PROFILES[current].name}改为${profile.name}`, "diplo", vassalId, true, {
        kind: "peace",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "state" });
    return true;
}

/** Cooperative vassals adjust their own tribute within the contract band. */
export function adjustTributeRate(core: GameCore, vassalId: number, delta: number): boolean {
    const state = core.state;
    const type = vassalTypeOf(state, vassalId);
    if (!type || type !== "cooperative") return false;
    const profile = VASSAL_PROFILES.cooperative;
    const current = tributeRateOf(state, vassalId);
    const next = Math.max(profile.resourceMin, Math.min(profile.resourceMax, current + delta));
    if (Math.abs(next - current) < 1e-9) return false;
    state.nations[vassalId].tributeRate = next;
    core.log(`${core.nationChip(vassalId)} 将贡赋调整为 ${Math.round(next * 100)}%`, "diplo", vassalId);
    core.emit({ type: "state" });
    return true;
}

/** The next, gentler contract a vassal can ask for. */
export function upgradeTargetOf(type: VassalType | null): VassalType | null {
    if (type === "oppressive") return "cooperative";
    if (type === "cooperative") return "autonomous";
    return null;
}

/**
 * A vassal only asks when its own tendency is willing and independence has
 * reached 60% of the contract cap. No subservience score is involved.
 */
export function canRequestUpgrade(state: GameState, vassalId: number): boolean {
    const type = vassalTypeOf(state, vassalId);
    const target = upgradeTargetOf(type);
    if (!target || state.winner !== null) return false;
    if (vassalTuningOf(state, vassalId).upgradeWill < UPGRADE_WILL_MIN) return false;
    if (independenceRatioOf(state, vassalId) < UPGRADE_INDEPENDENCE_RATIO) return false;
    const overlord = overlordOf(state, vassalId);
    if (overlord < 0 || vassalCooldownDays(state, vassalId, overlord) > 0) return false;
    return state.nations[vassalId].politicalPower >= VASSAL_UPGRADE_COST;
}

function applyVassalUpgrade(core: GameCore, vassalId: number, target: VassalType): boolean {
    const state = core.state;
    const current = vassalTypeOf(state, vassalId);
    if (!current || upgradeTargetOf(current) !== target) return false;
    const nation = state.nations[vassalId];
    const profile = VASSAL_PROFILES[target];
    // Preserve progress proportionally, but never drop the fresh contract
    // straight onto its secession threshold.
    const ratio = independenceRatioOf(state, vassalId);
    nation.vassalType = target;
    nation.tributeRate = profile.resourceShare;
    nation.independence = Math.min(
        profile.independenceCap * 0.7, Math.max(profile.independenceStart, ratio * profile.independenceCap),
    );
    core.log(`${core.nationChip(vassalId)} 的附庸契约改善为${profile.name}`, "diplo", vassalId, true, {
        kind: "peace",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "state" });
    return true;
}

function aiAcceptsUpgrade(state: GameState, overlordId: number, vassalId: number): boolean {
    const will = vassalTuningOf(state, vassalId).upgradeWill;
    const tendency = state.nations[overlordId].tendency;
    if (tendency === "isolated") return will >= 0.7;
    if (tendency === "hegemon" || tendency === "militarist") return will >= 0.6;
    return will >= UPGRADE_WILL_MIN;
}

/**
 * A settled vassal asks to renegotiate. The player overlord receives a pending
 * request; AI overlords decide at once.
 */
export function requestVassalUpgrade(core: GameCore, vassalId: number): boolean {
    const state = core.state;
    if (!canRequestUpgrade(state, vassalId)) return false;
    const overlord = overlordOf(state, vassalId);
    const target = upgradeTargetOf(vassalTypeOf(state, vassalId));
    if (overlord < 0 || !target) return false;
    if (overlord === 0 && vassalId !== 0) {
        const request = createDiplomaticRequest(state, "upgrade", vassalId, overlord, { vassalType: target });
        if (!request) return false;
        core.log(`${core.nationChip(vassalId)} 请求改善附庸契约（${VASSAL_PROFILES[target].name}）`, "diplo", vassalId);
        core.emit({ type: "state" });
        return true;
    }
    if (aiAcceptsUpgrade(state, overlord, vassalId)) {
        const nation = state.nations[vassalId];
        nation.politicalPower = Math.max(0, nation.politicalPower - VASSAL_UPGRADE_COST);
        return applyVassalUpgrade(core, vassalId, target);
    }
    setPairCooldown(state.vassalCooldown, vassalId, overlord, state.day + VASSAL_OFFER_COOLDOWN);
    core.log(`${core.nationChip(overlord)} 拒绝 ${core.nationChip(vassalId)} 的契约改善请求`, "diplo", overlord);
    core.emit({ type: "state" });
    return false;
}

/** Was the overlord the aggressor in the war it is calling vassals into? */
function callingAsAggressor(state: GameState, overlordId: number, enemyId: number): boolean {
    const war = state.wars.find((entry) =>
        (entry.aggressor === overlordId && entry.defender === enemyId) ||
        (entry.aggressor === enemyId && entry.defender === overlordId));
    // Direct helper calls (tests, scripted events) are treated as the overlord's own war.
    return war ? war.aggressor === overlordId : true;
}

/**
 * Called from the war declaration path: an overlord calls its vassals to arms.
 * War entry follows the vassal's own tendency, not a loyalty score. Returns the
 * vassals that actually joined so the declaration can emit one consolidated
 * headline; `quiet` suppresses the per-nation war lines in that path.
 */
export function applyVassalCallToArms(core: GameCore, overlordId: number, enemyId: number, quiet = false): number[] {
    const state = core.state;
    const joined: number[] = [];
    if (!Number.isInteger(overlordId) || !Number.isInteger(enemyId) || overlordId === enemyId) return joined;
    const aggressor = callingAsAggressor(state, overlordId, enemyId);
    for (const vassalId of vassalsOf(state, overlordId)) {
        if (vassalId === enemyId || isAtWar(state, vassalId, enemyId)) continue;
        if (isProtectedRelation(state, vassalId, enemyId)) continue;
        if (vassalId === 0) {
            const request = createDiplomaticRequest(state, "call", overlordId, 0, { enemy: enemyId });
            if (request) {
                core.log(`${core.nationChip(overlordId)} 号召 ${core.nationChip(0)} 履行附庸义务，对 ${core.nationChip(enemyId)} 作战`, "diplo", overlordId);
                core.emit({ type: "state" });
            }
            continue;
        }
        const type = vassalTypeOf(state, vassalId);
        if (!type) continue;
        const tuning = vassalTuningOf(state, vassalId);
        const ratio = independenceRatioOf(state, vassalId);
        let willingness: number;
        if (type === "oppressive") {
            willingness = 1;
        } else if (aggressor) {
            // Offensive, expansionist vassals volunteer — all the more once
            // independence is high. Defensive ones dislike an aggressive war.
            willingness = 0.2 + 0.8 * tuning.callToArmsAccept;
            if (ratio >= HIGH_INDEPENDENCE_RATIO) {
                willingness += 0.4 * tuning.callToArmsAccept - 0.2;
            }
        } else {
            // The overlord was attacked: defensive vassals rally hardest.
            willingness = 0.45 + 0.4 * (1 - tuning.callToArmsAccept);
        }
        if (Math.max(0, Math.min(1, willingness)) <= core.rand.nextFloat()) {
            core.log(`${core.nationChip(vassalId)} 拒绝 ${core.nationChip(overlordId)} 的参战号召`, "diplo", vassalId);
            continue;
        }
        setWar(state, vassalId, enemyId, true);
        joined.push(vassalId);
        if (!quiet) {
            core.log(`${core.nationChip(vassalId)} 响应宗主召唤，对 ${core.nationChip(enemyId)} 宣战`, "diplo", vassalId, true, {
                kind: "war",
                nation: vassalId,
            });
            core.emit({ type: "war", aggressor: vassalId, defender: enemyId });
        }
    }
    return joined;
}

/**
 * Daily tribute. Independence rises with every payment that benefits the
 * overlord and falls when the overlord returns protection PP.
 */
export function tickVassalTribute(core: GameCore): void {
    const state = core.state;
    for (const nation of state.nations) {
        if (!nation.alive) continue;
        const overlordId = overlordOf(state, nation.id);
        if (overlordId < 0) {
            if (nation.overlord !== undefined && nation.overlord >= 0) {
                clearVassalFields(nation);
                core.log(`${core.nationChip(nation.id)} 的宗主国已不存在，恢复独立`, "system", nation.id);
                core.emit({ type: "relations" });
            }
            continue;
        }
        const overlord = state.nations[overlordId];
        const type = vassalTypeOf(state, nation.id);
        if (!type || !overlord?.alive) continue;
        const profile = VASSAL_PROFILES[type];
        const rates = resourceRates(state, nation.id);
        const share = (profile.adjustable ? tributeRateOf(state, nation.id) : profile.resourceShare) *
            vassalTuningOf(state, nation.id).tributeCompliance;

        let paidFunds = 0;
        let paidManpower = 0;
        let paidIndustry = 0;
        if (share > 0) {
            paidFunds = Math.max(0, rates.fundsNet) * share;
            paidManpower = Math.max(0, rates.manpower) * share;
            paidIndustry = Math.max(0, rates.industry) * share;
            nation.funds -= paidFunds;
            nation.manpower -= paidManpower;
            nation.industry -= paidIndustry;
            overlord.funds += paidFunds;
            overlord.manpower += paidManpower;
            overlord.industry += paidIndustry;
        }

        const ppPaid = Math.min(nation.politicalPower, profile.tributePP);
        if (ppPaid > 0) {
            nation.politicalPower -= ppPaid;
            overlord.politicalPower = Math.min(PP_CAP, overlord.politicalPower + ppPaid);
        }
        const gift = Math.min(overlord.politicalPower, profile.protectionPP);
        if (gift > 0) {
            overlord.politicalPower -= gift;
            nation.politicalPower = Math.min(PP_CAP, nation.politicalPower + gift);
        }

        const contribution = (paidFunds > 0 ? 0.2 : 0) + (paidManpower > 0 ? 0.05 : 0) +
            (paidIndustry > 0 ? 0.05 : 0) + ppPaid * 0.1;
        shiftIndependence(state, nation.id, (contribution - gift * 0.1) * (profile.independenceCap / 100));

        const overlordRates = resourceRates(state, overlordId);
        overlord.manpower = Math.min(overlord.manpower, overlordRates.manpowerCap);
        overlord.industry = Math.min(overlord.industry, overlordRates.industryCap);
        clampResources(overlord, overlordRates);
    }
}

/** Independence only drifts upward; reaching the cap ends the contract. */
export function tickVassalIndependence(core: GameCore): void {
    const state = core.state;
    for (const nation of state.nations) {
        if (!nation.alive) continue;
        const overlord = overlordOf(state, nation.id);
        if (overlord < 0) continue;
        const type = vassalTypeOf(state, nation.id);
        if (!type) continue;
        const cap = VASSAL_PROFILES[type].independenceCap;
        const tuning = vassalTuningOf(state, nation.id);
        const atWar = state.war[overlord]?.some(Boolean) === true;
        let next = independenceOf(state, nation.id) + tuning.independenceDrift;
        // An overlord at war cannot police its provinces; oppressive contracts feel it most.
        if (type === "oppressive" && atWar) next += cap * 0.004;
        nation.independence = Math.max(0, Math.min(cap, next));

        const ratio = nation.independence / cap;
        if (ratio >= 1) {
            if (type === "oppressive") {
                rebelVassal(core, nation.id, overlord);
            } else if (releaseVassal(core, nation.id, true)) {
                core.log(`${core.nationChip(nation.id)} 的独立性达到上限，和平脱离 ${core.nationChip(overlord)}`, "diplo", nation.id);
            }
            continue;
        }
        if (type === "oppressive" && atWar && ratio >= HIGH_INDEPENDENCE_RATIO &&
            state.day % 5 === 0 && tuning.flipWill > core.rand.nextFloat()) {
            rebelVassal(core, nation.id, overlord);
        }
    }
}

function rebelVassal(core: GameCore, vassalId: number, overlordId: number): void {
    const state = core.state;
    const nation = state.nations[vassalId];
    clearVassalFields(nation);
    removePairRequests(state, vassalId, overlordId);
    setWar(state, vassalId, overlordId, true);
    core.invalidateReach();
    core.log(`${core.nationChip(vassalId)} 宣布独立，起兵反抗宗主 ${core.nationChip(overlordId)}`, "diplo", vassalId, true, {
        kind: "war",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "war", aggressor: vassalId, defender: overlordId });
    core.emit({ type: "state" });
}

function aiAcceptsVassalOffer(state: GameState, overlord: number, vassal: number, type: VassalType): boolean {
    if (!living(state, overlord) || !living(state, vassal) || isAtWar(state, overlord, vassal)) return false;
    const profile = state.nations[overlord].tendency;
    if (profile === "isolated") return false;
    const ratio = nationPower(state, overlord) / Math.max(1, nationPower(state, vassal));
    const minimum = type === "autonomous" ? 1.2 : 1.35;
    if (ratio < minimum) return false;
    // A protector already fighting a major war is less eager to inherit another front.
    if (state.war[overlord].some(Boolean) && ratio < 1.8) return false;
    return true;
}

/**
 * Voluntary offer: AI-to-AI resolves at once, AI-to-player becomes a pending
 * request, and player-to-AI is decided by the target's strength test.
 */
export function requestVassalization(
    core: GameCore, vassalId: number, overlordId: number, type: string,
): boolean {
    const state = core.state;
    if (!validVassalType(type) || type === "oppressive") return false;
    if (!canRequestVassalization(state, vassalId, overlordId, type)) return false;
    if (overlordId === 0 && vassalId !== 0) {
        const request = createDiplomaticRequest(state, "vassalize", vassalId, overlordId, { vassalType: type });
        if (!request) return false;
        core.log(`${core.nationChip(vassalId)} 请求成为 ${core.nationChip(overlordId)} 的${VASSAL_PROFILES[type].name}附庸`, "diplo", vassalId);
        core.emit({ type: "state" });
        return true;
    }
    if (aiAcceptsVassalOffer(state, overlordId, vassalId, type)) {
        return setVassal(core, vassalId, overlordId, type);
    }
    setPairCooldown(state.vassalCooldown, vassalId, overlordId, state.day + VASSAL_OFFER_COOLDOWN);
    core.log(`${core.nationChip(overlordId)} 拒绝 ${core.nationChip(vassalId)} 的附庸请求`, "diplo", overlordId);
    core.emit({ type: "state" });
    return false;
}

/** Coercive demand (oppressive): only a hopelessly weaker target submits. */
export function demandVassalization(core: GameCore, overlordId: number, vassalId: number): boolean {
    const state = core.state;
    if (state.winner !== null || !canBecomeVassal(state, vassalId, overlordId, "oppressive")) return false;
    if (vassalId === 0) {
        const request = createDiplomaticRequest(state, "vassalize", overlordId, vassalId, {
            vassalType: "oppressive", demand: true,
        });
        if (!request) return false;
        core.log(`${core.nationChip(overlordId)} 要求 ${core.nationChip(vassalId)} 成为压迫型附庸`, "diplo", overlordId);
        core.emit({ type: "state" });
        return true;
    }
    const ratio = nationPower(state, overlordId) / Math.max(1, nationPower(state, vassalId));
    const losing = state.war[vassalId]?.some(Boolean) === true;
    if (ratio >= 1.8 || (losing && ratio >= 1.25)) {
        return setVassal(core, vassalId, overlordId, "oppressive");
    }
    setPairCooldown(state.vassalCooldown, overlordId, vassalId, state.day + VASSAL_OFFER_COOLDOWN);
    core.log(`${core.nationChip(vassalId)} 拒绝 ${core.nationChip(overlordId)} 的附庸要求`, "diplo", vassalId);
    core.emit({ type: "state" });
    return false;
}

/** Candidate helpers for a vassal seeking outside help: not itself, not its overlord, not already fighting it. */
export function aidCandidates(state: GameState, vassalId: number): number[] {
    const overlord = overlordOf(state, vassalId);
    if (overlord < 0) return [];
    const rivals = state.nations
        .filter((nation) => nation.alive && nation.id !== vassalId && nation.id !== overlord &&
            !isAtWar(state, vassalId, nation.id))
        .map((nation) => nation.id);
    rivals.sort((a, b) => {
        const aw = isAtWar(state, a, overlord) ? 1 : 0;
        const bw = isAtWar(state, b, overlord) ? 1 : 0;
        if (aw !== bw) return bw - aw;
        const ac = commonEnemy(state, a, vassalId) !== null ? 1 : 0;
        const bc = commonEnemy(state, b, vassalId) !== null ? 1 : 0;
        if (ac !== bc) return bc - ac;
        return nationPower(state, b) - nationPower(state, a) || a - b;
    });
    return rivals;
}

export function canRequestAid(state: GameState, vassalId: number): boolean {
    if (state.winner !== null || overlordOf(state, vassalId) < 0) return false;
    const last = state.nations[vassalId].lastAidDay ?? -999;
    if (state.day - last < VASSAL_AID_COOLDOWN) return false;
    return aidCandidates(state, vassalId).length > 0;
}

function aiAcceptsAid(state: GameState, helperId: number, vassalId: number): boolean {
    const overlord = overlordOf(state, vassalId);
    if (overlord < 0 || !living(state, helperId)) return false;
    if (isAtWar(state, helperId, overlord)) return true;
    if (commonEnemy(state, helperId, vassalId) !== null) return true;
    const profile = state.nations[helperId].tendency;
    const ratio = nationPower(state, helperId) / Math.max(1, nationPower(state, overlord));
    if (profile === "militarist" || profile === "hegemon" || profile === "bully" ||
        profile === "opportunist") return ratio >= 0.7;
    if (profile === "ideologue" || profile === "trader") return ratio >= 0.8;
    return false;
}

function applyAid(core: GameCore, helperId: number, vassalId: number): void {
    const state = core.state;
    const helper = state.nations[helperId];
    const vassal = state.nations[vassalId];
    const overlord = overlordOf(state, vassalId);
    if (!helper?.alive || !vassal?.alive || overlord < 0) return;
    const funds = Math.max(0, Math.round(helper.funds * 0.15));
    helper.funds = Math.max(0, helper.funds - funds);
    vassal.funds += funds;
    const pp = Math.min(15, helper.politicalPower);
    helper.politicalPower -= pp;
    vassal.politicalPower = Math.min(PP_CAP, vassal.politicalPower + pp);
    vassal.lastAidDay = state.day;

    const profile = state.nations[helperId].tendency;
    const willingToFight = isAtWar(state, helperId, overlord) ||
        ((profile === "militarist" || profile === "hegemon" || profile === "bully" ||
            profile === "opportunist" || profile === "ideologue") && truceDays(state, helperId, overlord) === 0);
    if (!isAtWar(state, helperId, overlord) && willingToFight) setWar(state, helperId, overlord, true);
    core.log(`${core.nationChip(helperId)} 援助 ${core.nationChip(vassalId)}（[[funds:${funds}]] · [[politics:${pp}]]）`, "diplo", helperId);
    core.emit({ type: "state" });
}

/** A vassal asks a third party for help. Player helpers get a pending request. */
export function requestForeignAid(core: GameCore, vassalId: number, helperId?: number): boolean {
    const state = core.state;
    if (!canRequestAid(state, vassalId)) return false;
    const candidates = aidCandidates(state, vassalId);
    const helper = helperId !== undefined && candidates.includes(helperId) ? helperId : candidates[0];
    if (helper === undefined) return false;
    if (helper === 0 && vassalId !== 0) {
        const request = createDiplomaticRequest(state, "aid", vassalId, 0);
        if (!request) return false;
        core.log(`${core.nationChip(vassalId)} 请求 ${core.nationChip(0)} 提供外援`, "diplo", vassalId);
        core.emit({ type: "state" });
        return true;
    }
    if (aiAcceptsAid(state, helper, vassalId)) {
        applyAid(core, helper, vassalId);
        return true;
    }
    state.nations[vassalId].lastAidDay = state.day;
    core.log(`${core.nationChip(helper)} 拒绝 ${core.nationChip(vassalId)} 的求援`, "diplo", helper);
    core.emit({ type: "state" });
    return false;
}

/**
 * Called from the war declaration path: an attacking a vassal forces its
 * overlord into the same defensive war. Returns the overlord that joined (or
 * -1); `quiet` lets `startWar` fold every participant into one headline.
 */
export function joinVassalDefense(core: GameCore, aggressor: number, defender: number, quiet = false): number {
    const state = core.state;
    const overlord = overlordOf(state, defender);
    if (overlord < 0 || overlord === aggressor || isAtWar(state, overlord, aggressor)) return -1;
    if (isProtectedRelation(state, overlord, aggressor)) return -1;
    setWar(state, overlord, aggressor, true);
    if (!quiet) {
        core.log(`${core.nationChip(overlord)} 履行保护义务，对 ${core.nationChip(aggressor)} 宣战`, "diplo", overlord, true, {
            kind: "war",
            nation: overlord,
        });
        core.emit({ type: "war", aggressor: overlord, defender: aggressor });
    }
    return overlord;
}

/** One row per request kind; adding a kind is one entry, not another branch. */
interface RequestHandler {
    /** Consume an accepted request; false means the deal is no longer possible. */
    readonly accept: (core: GameCore, request: DiplomaticRequest) => boolean;
    readonly decline: (core: GameCore, request: DiplomaticRequest) => void;
    /** Cooldown applied when the offer expires unanswered. */
    readonly expire?: (state: GameState, request: DiplomaticRequest) => void;
}

/** Shared refusal: pair cooldown, one log line, one state refresh. */
function refuse(
    core: GameCore, request: DiplomaticRequest, matrix: number[][], days: number, offer: string,
): void {
    const state = core.state;
    setPairCooldown(matrix, request.from, request.to, state.day + days);
    core.log(`${core.nationChip(request.to)} 拒绝 ${core.nationChip(request.from)} 的${offer}`, "diplo", request.to);
    core.emit({ type: "state" });
}

const REQUEST_HANDLERS: Record<DiplomaticRequestKind, RequestHandler> = {
    vassalize: {
        accept: (core, request) => setVassal(
            core,
            request.demand ? request.to : request.from,
            request.demand ? request.from : request.to,
            request.vassalType ?? "autonomous",
        ),
        decline: (core, request) => refuse(core, request, core.state.vassalCooldown, VASSAL_OFFER_COOLDOWN, "附庸提议"),
        expire: (state, request) => setPairCooldown(
            state.vassalCooldown, request.from, request.to, state.day + VASSAL_OFFER_COOLDOWN,
        ),
    },
    alliance: {
        accept: (core, request) => {
            const alliance = core.state.alliances.find((entry) => entry.id === request.allianceId);
            return alliance !== undefined && joinAlliance(core, alliance, request.to);
        },
        decline: (core, request) => refuse(core, request, core.state.allianceCooldown, ALLIANCE_INVITE_COOLDOWN, "结盟邀请"),
        expire: (state, request) => setPairCooldown(
            state.allianceCooldown, request.from, request.to, state.day + ALLIANCE_INVITE_COOLDOWN,
        ),
    },
    upgrade: {
        accept: (core, request) => {
            const state = core.state;
            const target = request.vassalType ?? upgradeTargetOf(vassalTypeOf(state, request.from));
            const vassal = state.nations[request.from];
            if (!target || upgradeTargetOf(vassalTypeOf(state, request.from)) !== target) return false;
            if (!vassal?.alive || overlordOf(state, request.from) !== request.to) return false;
            if (vassal.politicalPower < VASSAL_UPGRADE_COST) return false;
            vassal.politicalPower -= VASSAL_UPGRADE_COST;
            return applyVassalUpgrade(core, request.from, target);
        },
        decline: (core, request) => refuse(core, request, core.state.vassalCooldown, VASSAL_OFFER_COOLDOWN, "契约改善请求"),
        expire: (state, request) => setPairCooldown(
            state.vassalCooldown, request.from, request.to, state.day + VASSAL_OFFER_COOLDOWN,
        ),
    },
    call: {
        accept: (core, request) => {
            const state = core.state;
            const enemy = request.enemy;
            if (typeof enemy !== "number" || enemy < 0) return false;
            if (overlordOf(state, 0) !== request.from || isAtWar(state, 0, enemy)) return false;
            setWar(state, 0, enemy, true);
            core.log(`${core.nationChip(0)} 响应宗主召唤，对 ${core.nationChip(enemy)} 宣战`, "diplo", 0, true, {
                kind: "war",
                nation: 0,
            });
            core.invalidateReach();
            core.emit({ type: "war", aggressor: 0, defender: enemy });
            core.emit({ type: "state" });
            return true;
        },
        decline: (core, request) => {
            const state = core.state;
            const cap = independenceCapOf(state, 0);
            shiftIndependence(state, 0, cap * 0.05);
            core.log(`${core.nationChip(0)} 拒绝 ${core.nationChip(request.from)} 的召唤，独立性上升`, "diplo", 0);
            core.emit({ type: "state" });
        },
    },
    aid: {
        accept: (core, request) => {
            applyAid(core, request.to, request.from);
            return true;
        },
        decline: (core, request) => {
            const state = core.state;
            if (state.nations[request.from]) state.nations[request.from].lastAidDay = state.day;
            core.log(`${core.nationChip(request.to)} 拒绝 ${core.nationChip(request.from)} 的求援`, "diplo", request.to);
            core.emit({ type: "state" });
        },
        expire: (state, request) => {
            if (state.nations[request.from]) state.nations[request.from].lastAidDay = state.day;
        },
    },
};

/** Clear or answer offers; called once per day and after player responses. */
export function expireDiplomaticRequests(core: GameCore): void {
    const state = core.state;
    for (let i = state.diplomaticRequests.length - 1; i >= 0; i--) {
        const request = state.diplomaticRequests[i];
        const stale = state.day >= request.expiresDay || !living(state, request.from) ||
            !living(state, request.to);
        if (!stale) continue;
        state.diplomaticRequests.splice(i, 1);
        REQUEST_HANDLERS[request.kind]?.expire?.(state, request);
    }
}

/**
 * Resolve a pending request addressed to the player. Returns false when the id
 * is unknown/already resolved, or when an acceptance can no longer be applied.
 */
export function respondDiplomaticRequest(core: GameCore, requestId: number, accept: boolean): boolean {
    const state = core.state;
    const index = state.diplomaticRequests.findIndex((request) => request.id === requestId && request.to === 0);
    if (index < 0) return false;
    const [request] = state.diplomaticRequests.splice(index, 1);
    const handler = REQUEST_HANDLERS[request.kind];
    if (!handler) return true;
    if (!accept) {
        handler.decline(core, request);
        return true;
    }
    if (handler.accept(core, request)) return true;
    handler.decline(core, request);
    return false;
}

/**
 * A restless vassal defects to a stronger attacker when its own overlord looks
 * weak. This is the "翻盘" path: bully / opportunist / expansionist tendencies
 * and high independence make it likely, oppressive contracts especially so.
 * The player is never silently installed as a new overlord.
 */
function defectVassal(core: GameCore, vassalId: number, overlordId: number): boolean {
    const state = core.state;
    const vassal = state.nations[vassalId];
    if (!vassal?.alive) return false;
    const overlordPower = nationPower(state, overlordId);
    const candidates = state.nations
        .filter((nation) => nation.alive && nation.id !== vassalId && nation.id !== overlordId && nation.id !== 0 &&
            !isAtWar(state, vassalId, nation.id) &&
            (isAtWar(state, nation.id, overlordId) || borderingNations(state, vassalId).has(nation.id)) &&
            nationPower(state, nation.id) >= overlordPower * 1.1)
        .map((nation) => nation.id)
        .sort((a, b) => {
            const aw = isAtWar(state, a, overlordId) ? 1 : 0;
            const bw = isAtWar(state, b, overlordId) ? 1 : 0;
            return bw - aw || nationPower(state, b) - nationPower(state, a) || a - b;
        });
    const protector = candidates[0];
    if (protector === undefined) return false;

    clearVassalFields(vassal);
    removePairRequests(state, vassalId, overlordId);
    vassal.overlord = protector;
    vassal.vassalType = "cooperative";
    vassal.independence = VASSAL_PROFILES.cooperative.independenceStart;
    vassal.tributeRate = VASSAL_PROFILES.cooperative.resourceShare;
    if (isAtWar(state, protector, overlordId)) {
        setWar(state, vassalId, overlordId, true);
        core.emit({ type: "war", aggressor: vassalId, defender: overlordId });
    }
    core.invalidateReach();
    core.log(`${core.nationChip(vassalId)} 倒向 ${core.nationChip(protector)}，不再效忠 ${core.nationChip(overlordId)}`, "diplo", vassalId, true, {
        kind: "peace",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "state" });
    return true;
}

/** AI agenda: weak nations seek protection, vassals buy freedom, the oppressed ask for help. */
export function runAIVassalPolitics(core: GameCore, nationId: number): void {
    const state = core.state;
    if (!living(state, nationId) || state.winner !== null) return;
    const overlord = overlordOf(state, nationId);
    if (overlord >= 0) {
        const type = vassalTypeOf(state, nationId);
        if (!type) return;
        const tuning = vassalTuningOf(state, nationId);

        if (canRequestAid(state, nationId) && state.day % 4 === nationId % 4) {
            requestForeignAid(core, nationId);
        }
        if (canRequestUpgrade(state, nationId) && state.day % 6 === nationId % 6) {
            requestVassalUpgrade(core, nationId);
        }
        if (independenceRatioOf(state, nationId) >= HIGH_INDEPENDENCE_RATIO &&
            tuning.flipWill > core.rand.nextFloat() && state.day % 3 === nationId % 3) {
            defectVassal(core, nationId, overlord);
        }
        return;
    }
    if (state.day < 8) return;

    const ownPower = nationPower(state, nationId);
    const enemies = state.nations.filter((nation) => nation.alive && isAtWar(state, nationId, nation.id));
    const losingWar = enemies.length > 0 &&
        Math.max(...enemies.map((enemy) => nationPower(state, enemy.id))) > ownPower * 1.4;
    const neighbours = [...borderingNations(state, nationId)]
        .filter((id) => living(state, id) && !isAtWar(state, nationId, id) && overlordOf(state, id) < 0)
        .sort((a, b) => nationPower(state, b) - nationPower(state, a) || a - b);
    const protector = neighbours[0];
    if (protector === undefined) return;
    const strongEnough = nationPower(state, protector) >= ownPower * 1.5;
    const noAlliance = !allianceOf(state, nationId);
    if (!strongEnough || !noAlliance) return;
    if (!losingWar && nationPower(state, protector) < ownPower * 2.2) return;
    requestVassalization(core, nationId, protector, losingWar ? "cooperative" : "autonomous");
}
