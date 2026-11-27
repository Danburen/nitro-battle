import { t } from "../i18n/index.ts";
import { ALLIANCE_INVITE_COOLDOWN, allianceOf, commonEnemy, joinAlliance, leaveAlliance } from "./alliance.ts";
import {
    borderingNations, dropOffers, isAtWar, nationPower, setWar, TRUCE_DAYS, truceDays,
} from "./diplomacy.ts";
import type { GameCore } from "./core.ts";
import { clampResources, resourceRates } from "./economy.ts";
import { isProtectedRelation, overlordOf, vassalTypeOf, vassalsOf } from "./access.ts";
import { tendencyProfileOf, vassalTuning } from "./ai/tendencies.ts";
import type { VassalTuning } from "./ai/types.ts";
import { createDiplomaticRequest, queuePlayerProposal, requestCooldownDays } from "./requests.ts";
import { deny, minus, plus } from "./decision.ts";
import { PP_CAP } from "./types/economy.ts";
import type { DecisionFactor, DiplomaticDecision } from "./types/decision.ts";
import type { DiplomaticRequest, DiplomaticRequestKind, VassalType } from "./types/diplomacy.ts";
import { acceptTradeRequest } from "./trade.ts";
import type { GameState } from "./types/state.ts";
import type { Nation } from "./types/entities.ts";

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
        get name() { return t("game.vassal.profile.cooperative.name"); },
        get short() { return t("game.vassal.profile.cooperative.short"); },
        get blurb() { return t("game.vassal.profile.cooperative.blurb"); },
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
        get name() { return t("game.vassal.profile.autonomous.name"); },
        get short() { return t("game.vassal.profile.autonomous.short"); },
        get blurb() { return t("game.vassal.profile.autonomous.blurb"); },
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
        get name() { return t("game.vassal.profile.oppressive.name"); },
        get short() { return t("game.vassal.profile.oppressive.short"); },
        get blurb() { return t("game.vassal.profile.oppressive.blurb"); },
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

export const VASSAL_OFFER_COOLDOWN = 5;
export const VASSAL_AID_COOLDOWN = 5;
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
    t("game.vassal.help.territory"),
    "",
    t("game.vassal.help.independence"),
    "",
    t("game.vassal.help.war"),
    t("game.vassal.help.defection"),
    t("game.vassal.help.upgrade", { cost: VASSAL_UPGRADE_COST }),
    t("game.vassal.help.request"),
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
    state.supplyDirty = true;
    core.log(t("game.vassal.became", { vassal: core.nationChip(vassalId), overlord: core.nationChip(overlordId), type: profile.name }), "diplo", vassalId, true, {
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
    core.log(t("game.vassal.independent", { vassal: core.nationChip(vassalId), overlord: core.nationChip(overlord) }), "diplo", vassalId, true, {
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
    core.log(t("game.vassal.contractChanged", { vassal: core.nationChip(vassalId), oldType: VASSAL_PROFILES[current].name, newType: profile.name }), "diplo", vassalId, true, {
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
    core.log(t("game.vassal.tributeAdjusted", { vassal: core.nationChip(vassalId), rate: Math.round(next * 100) }), "diplo", vassalId);
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
    core.log(t("game.vassal.contractUpgraded", { vassal: core.nationChip(vassalId), type: profile.name }), "diplo", vassalId, true, {
        kind: "peace",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "state" });
    return true;
}

/** The overlord's side of a contract upgrade; the vassal's own gate is `canRequestUpgrade`. */
export function decideUpgrade(state: GameState, overlordId: number, vassalId: number): DiplomaticDecision {
    if (!living(state, overlordId) || !living(state, vassalId)) return deny(t("game.vassal.decision.ineligible"));
    const tendency = state.nations[overlordId].tendency;
    const minimum = tendency === "isolated" ? 0.7
        : tendency === "hegemon" || tendency === "militarist" ? 0.6
            : UPGRADE_WILL_MIN;
    const will = vassalTuningOf(state, vassalId).upgradeWill;
    const tendencyFactor = tendency === "isolated"
        ? minus(t("game.vassal.upgrade.isolatedCautious"))
        : tendency === "hegemon" || tendency === "militarist"
            ? minus(t("game.vassal.upgrade.hegemonCautious"))
            : plus(t("game.vassal.upgrade.noConcern"));
    const willFactor = will >= minimum
        ? plus(t("game.vassal.upgrade.willMet"))
        : minus(t("game.vassal.upgrade.willUnmet"));
    const accepts = will >= minimum;
    return {
        accepts,
        factors: [tendencyFactor, willFactor],
        verdict: accepts ? (will >= 0.7 ? "sure" : "likely") : "refuse",
    };
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
    if (vassalId === 0) {
        if (requestCooldownDays(state, "upgrade", overlord) > 0) return false;
        const request = queuePlayerProposal(state, "upgrade", 0, overlord, { vassalType: target });
        if (!request) return false;
        core.log(t("game.vassal.upgrade.playerRequested", { overlord: core.nationChip(overlord) }), "diplo", 0);
        core.emit({ type: "state" });
        return true;
    }
    if (overlord === 0 && vassalId !== 0) {
        const request = createDiplomaticRequest(state, "upgrade", vassalId, overlord, { vassalType: target });
        if (!request) return false;
        core.log(t("game.vassal.upgrade.requested", { vassal: core.nationChip(vassalId), type: VASSAL_PROFILES[target].name }), "diplo", vassalId);
        core.emit({ type: "state" });
        return true;
    }
    if (decideUpgrade(state, overlord, vassalId).accepts) {
        const nation = state.nations[vassalId];
        nation.politicalPower = Math.max(0, nation.politicalPower - VASSAL_UPGRADE_COST);
        return applyVassalUpgrade(core, vassalId, target);
    }
    setPairCooldown(state.vassalCooldown, vassalId, overlord, state.day + VASSAL_OFFER_COOLDOWN);
    core.log(t("game.vassal.upgrade.rejected", { overlord: core.nationChip(overlord), vassal: core.nationChip(vassalId) }), "diplo", overlord);
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
                core.log(t("game.vassal.call.player", { overlord: core.nationChip(overlordId), player: core.nationChip(0), enemy: core.nationChip(enemyId) }), "diplo", overlordId);
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
            core.log(t("game.vassal.call.refused", { vassal: core.nationChip(vassalId), overlord: core.nationChip(overlordId) }), "diplo", vassalId);
            continue;
        }
        setWar(state, vassalId, enemyId, true);
        joined.push(vassalId);
        if (!quiet) {
            core.log(t("game.vassal.call.joined", { vassal: core.nationChip(vassalId), enemy: core.nationChip(enemyId) }), "diplo", vassalId, true, {
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
                core.log(t("game.vassal.overlordGone", { nation: core.nationChip(nation.id) }), "system", nation.id);
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
            paidIndustry = Math.max(0, rates.industryNet) * share;
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
                core.log(t("game.vassal.independenceCap", { nation: core.nationChip(nation.id), overlord: core.nationChip(overlord) }), "diplo", nation.id);
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
    core.log(t("game.vassal.rebelled", { vassal: core.nationChip(vassalId), overlord: core.nationChip(overlordId) }), "diplo", vassalId, true, {
        kind: "war",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "war", aggressor: vassalId, defender: overlordId });
    core.emit({ type: "state" });
}

/** The overlord's willingness to accept a voluntary vassal offer. */
export function decideVassalOffer(state: GameState, overlord: number, vassal: number, type: VassalType): DiplomaticDecision {
    if (!living(state, overlord) || !living(state, vassal)) return deny(t("game.decision.ineligible"));
    if (isAtWar(state, overlord, vassal)) return deny(t("game.vassal.offer.atWar"));
    if (state.nations[overlord].tendency === "isolated") return deny(t("game.vassal.offer.isolated"));
    const ratio = nationPower(state, overlord) / Math.max(1, nationPower(state, vassal));
    const minimum = type === "autonomous" ? 1.2 : 1.35;
    const factors: DecisionFactor[] = [
        ratio >= minimum
            ? plus(t("game.vassal.offer.powerMet"))
            : minus(t("game.vassal.offer.powerUnmet")),
    ];
    // A protector already fighting a major war is less eager to inherit another front.
    const atWar = state.war[overlord]?.some(Boolean) === true;
    if (atWar) {
        factors.push(ratio >= 1.8
            ? plus(t("game.vassal.offer.warPowerMet"))
            : minus(t("game.vassal.offer.warPowerUnmet")));
    }
    const accepts = ratio >= minimum && (!atWar || ratio >= 1.8);
    return {
        accepts,
        factors,
        verdict: accepts ? (ratio >= 1.8 ? "sure" : "likely") : (ratio >= minimum ? "unlikely" : "refuse"),
    };
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
    if (vassalId === 0) {
        if (requestCooldownDays(state, "vassalize", overlordId) > 0) return false;
        const request = queuePlayerProposal(state, "vassalize", 0, overlordId, { vassalType: type });
        if (!request) return false;
        core.log(t("game.vassal.offer.playerRequested", { overlord: core.nationChip(overlordId), type: VASSAL_PROFILES[type].name }), "diplo", 0);
        core.emit({ type: "state" });
        return true;
    }
    if (overlordId === 0 && vassalId !== 0) {
        const request = createDiplomaticRequest(state, "vassalize", vassalId, overlordId, { vassalType: type });
        if (!request) return false;
        core.log(t("game.vassal.offer.requested", { vassal: core.nationChip(vassalId), overlord: core.nationChip(overlordId), type: VASSAL_PROFILES[type].name }), "diplo", vassalId);
        core.emit({ type: "state" });
        return true;
    }
    if (decideVassalOffer(state, overlordId, vassalId, type).accepts) {
        return setVassal(core, vassalId, overlordId, type);
    }
    setPairCooldown(state.vassalCooldown, vassalId, overlordId, state.day + VASSAL_OFFER_COOLDOWN);
    core.log(t("game.vassal.offer.rejected", { overlord: core.nationChip(overlordId), vassal: core.nationChip(vassalId) }), "diplo", overlordId);
    core.emit({ type: "state" });
    return false;
}

/** Willingness of a coerced target to submit; the player-side gate is `canBecomeVassal`. */
export function decideVassalDemand(state: GameState, overlord: number, vassal: number): DiplomaticDecision {
    if (!living(state, overlord) || !living(state, vassal)) return deny(t("game.decision.ineligible"));
    const ratio = nationPower(state, overlord) / Math.max(1, nationPower(state, vassal));
    const losing = state.war[vassal]?.some(Boolean) === true;
    if (ratio >= 1.8) {
        return { accepts: true, factors: [plus(t("game.vassal.demand.overwhelming"))], verdict: "sure" };
    }
    if (losing && ratio >= 1.25) {
        return {
            accepts: true,
            factors: [plus(t("game.vassal.demand.targetAtWar")), plus(t("game.vassal.demand.powerCoerce"))],
            verdict: "likely",
        };
    }
    const factors: DecisionFactor[] = [minus(t("game.vassal.demand.powerInsufficient"))];
    if (!losing) factors.push(minus(t("game.vassal.demand.targetPeaceful")));
    return { accepts: false, factors, verdict: "refuse" };
}

/** Coercive demand (oppressive): only a hopelessly weaker target submits. */
export function demandVassalization(core: GameCore, overlordId: number, vassalId: number): boolean {
    const state = core.state;
    if (state.winner !== null || !canBecomeVassal(state, vassalId, overlordId, "oppressive")) return false;
    if (overlordId === 0) {
        if (requestCooldownDays(state, "vassalize", vassalId) > 0) return false;
        const request = queuePlayerProposal(state, "vassalize", 0, vassalId, {
            vassalType: "oppressive", demand: true,
        });
        if (!request) return false;
        core.log(t("game.vassal.demand.playerRequested", { vassal: core.nationChip(vassalId), type: VASSAL_PROFILES.oppressive.name }), "diplo", 0);
        core.emit({ type: "state" });
        return true;
    }
    if (vassalId === 0) {
        const request = createDiplomaticRequest(state, "vassalize", overlordId, vassalId, {
            vassalType: "oppressive", demand: true,
        });
        if (!request) return false;
        core.log(t("game.vassal.demand.requested", { overlord: core.nationChip(overlordId), vassal: core.nationChip(vassalId), type: VASSAL_PROFILES.oppressive.name }), "diplo", overlordId);
        core.emit({ type: "state" });
        return true;
    }
    if (decideVassalDemand(state, overlordId, vassalId).accepts) {
        return setVassal(core, vassalId, overlordId, "oppressive");
    }
    setPairCooldown(state.vassalCooldown, overlordId, vassalId, state.day + VASSAL_OFFER_COOLDOWN);
    core.log(t("game.vassal.demand.rejected", { vassal: core.nationChip(vassalId), overlord: core.nationChip(overlordId) }), "diplo", vassalId);
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

/**
 * Single source of truth for the AI's aid decision. `verdict` only colours the
 * wording ("大概率会支持" vs "大概率会拒绝"); `factors` explain which threshold
 * produced it. No roll, no numbers exposed — the outcome stays deterministic.
 */
export function decideAid(state: GameState, vassalId: number, helperId: number): DiplomaticDecision {
    const overlord = overlordOf(state, vassalId);
    if (overlord < 0 || !living(state, helperId)) return deny(t("game.vassal.aid.ineligible"));
    const decisive: DecisionFactor[] = [];
    if (isAtWar(state, helperId, overlord)) decisive.push(plus(t("game.vassal.aid.atWar")));
    if (commonEnemy(state, helperId, vassalId) !== null) decisive.push(plus(t("game.vassal.aid.commonEnemy")));
    if (decisive.length > 0) return { accepts: true, factors: decisive, verdict: "sure" };
    const profile = state.nations[helperId].tendency;
    const eager = profile === "militarist" || profile === "hegemon" || profile === "bully" ||
        profile === "opportunist";
    const open = profile === "ideologue" || profile === "trader";
    const tendencyFactor: DecisionFactor = eager
        ? plus(t("game.vassal.aid.eagerTendency"))
        : open
            ? plus(t("game.vassal.aid.openTendency"))
            : minus(t("game.vassal.aid.reluctantTendency"));
    if (!eager && !open) return { accepts: false, factors: [tendencyFactor], verdict: "refuse" };

    const threshold = eager ? 0.7 : 0.8;
    const ratio = nationPower(state, helperId) / Math.max(1, nationPower(state, overlord));
    const powerFactor: DecisionFactor = ratio >= threshold
        ? plus(t("game.vassal.aid.powerStrong"))
        : minus(t("game.vassal.aid.powerWeak"));
    const accepts = ratio >= threshold;
    return {
        accepts,
        factors: [tendencyFactor, powerFactor],
        verdict: accepts ? (eager ? "likely" : "maybe") : (eager ? "unlikely" : "refuse"),
    };
}

function aiAcceptsAid(state: GameState, helperId: number, vassalId: number): boolean {
    return decideAid(state, vassalId, helperId).accepts;
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
    core.log(t("game.vassal.aid.granted", { helper: core.nationChip(helperId), vassal: core.nationChip(vassalId), funds, pp }), "diplo", helperId);
    core.emit({ type: "state" });
}

/** A vassal asks a third party for help. Player helpers get a pending request. */
export function requestForeignAid(core: GameCore, vassalId: number, helperId?: number): boolean {
    const state = core.state;
    if (!canRequestAid(state, vassalId)) return false;
    const candidates = aidCandidates(state, vassalId);
    const helper = helperId !== undefined && candidates.includes(helperId) ? helperId : candidates[0];
    if (helper === undefined) return false;
    if (vassalId === 0) {
        if (requestCooldownDays(state, "aid", helper) > 0) return false;
        const request = queuePlayerProposal(state, "aid", 0, helper);
        if (!request) return false;
        core.log(t("game.vassal.aid.playerRequested", { helper: core.nationChip(helper) }), "diplo", 0);
        core.emit({ type: "state" });
        return true;
    }
    if (helper === 0 && vassalId !== 0) {
        const request = createDiplomaticRequest(state, "aid", vassalId, 0);
        if (!request) return false;
        core.log(t("game.vassal.aid.requested", { vassal: core.nationChip(vassalId), helper: core.nationChip(0) }), "diplo", vassalId);
        core.emit({ type: "state" });
        return true;
    }
    if (aiAcceptsAid(state, helper, vassalId)) {
        applyAid(core, helper, vassalId);
        return true;
    }
    state.nations[vassalId].lastAidDay = state.day;
    core.log(t("game.vassal.aid.rejected", { helper: core.nationChip(helper), vassal: core.nationChip(vassalId) }), "diplo", helper);
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
        core.log(t("game.vassal.defense.declared", { overlord: core.nationChip(overlord), aggressor: core.nationChip(aggressor) }), "diplo", overlord, true, {
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
    core.log(t("game.vassal.request.refused", { to: core.nationChip(request.to), from: core.nationChip(request.from), offer }), "diplo", request.to);
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
        decline: (core, request) => refuse(core, request, core.state.vassalCooldown, VASSAL_OFFER_COOLDOWN, t("game.requests.vassalize")),
        expire: (state, request) => setPairCooldown(
            state.vassalCooldown, request.from, request.to, state.day + VASSAL_OFFER_COOLDOWN,
        ),
    },
    alliance: {
        accept: (core, request) => {
            const alliance = core.state.alliances.find((entry) => entry.id === request.allianceId);
            return alliance !== undefined && joinAlliance(core, alliance, request.to);
        },
        decline: (core, request) => refuse(core, request, core.state.allianceCooldown, ALLIANCE_INVITE_COOLDOWN, t("game.requests.alliance")),
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
        decline: (core, request) => refuse(core, request, core.state.vassalCooldown, VASSAL_OFFER_COOLDOWN, t("game.requests.upgrade")),
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
            core.log(t("game.vassal.call.joined", { vassal: core.nationChip(0), enemy: core.nationChip(enemy) }), "diplo", 0, true, {
                kind: "war",
                nation: 0,
            });
            core.emit({ type: "war", aggressor: 0, defender: enemy });
            core.emit({ type: "state" });
            return true;
        },
        decline: (core, request) => {
            const state = core.state;
            const cap = independenceCapOf(state, 0);
            shiftIndependence(state, 0, cap * 0.05);
            core.log(t("game.vassal.call.playerRefused", { player: core.nationChip(0), overlord: core.nationChip(request.from) }), "diplo", 0);
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
            core.log(t("game.vassal.aid.rejected", { helper: core.nationChip(request.to), vassal: core.nationChip(request.from) }), "diplo", request.to);
            core.emit({ type: "state" });
        },
        expire: (state, request) => {
            if (state.nations[request.from]) state.nations[request.from].lastAidDay = state.day;
        },
    },
    trade: {
        accept: (core, request) => acceptTradeRequest(core, request),
        decline: (core, request) => {
            core.log(t("game.vassal.request.refused", { to: core.nationChip(request.to), from: core.nationChip(request.from), offer: t("game.requests.trade") }), "diplo", request.to);
            core.emit({ type: "state" });
        },
    },
};

/** Apply the accept half of a request; shared by player replies and queued proposals. */
export function acceptDiplomaticRequest(core: GameCore, request: DiplomaticRequest): boolean {
    return REQUEST_HANDLERS[request.kind]?.accept(core, request) ?? false;
}

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
    core.log(t("game.vassal.defection.defected", { vassal: core.nationChip(vassalId), protector: core.nationChip(protector), overlord: core.nationChip(overlordId) }), "diplo", vassalId, true, {
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
