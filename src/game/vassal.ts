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
    /** Independence at the moment the contract starts. */
    readonly independenceStart: number;
    /** One-shot petition: political points spent for `petitionGain` independence. */
    readonly petitionCost: number;
    readonly petitionGain: number;
    /** Oppressive contracts lock petitions; their independence only drifts. */
    readonly canPetition: boolean;
}

/**
 * Contract values are deliberately lopsided: cooperative vassals buy protection
 * with resources, autonomous ones keep their economy and pay in influence, and
 * oppressive ones are a war settlement they cannot legally escape.
 */
export const VASSAL_PROFILES = {
    cooperative: {
        name: "合作型",
        short: "合作",
        blurb: "上缴可调比例的资源，换取保护与政治点；独立性较低，提升代价高。",
        resourceShare: 0.15,
        resourceMin: 0.05,
        resourceMax: 0.4,
        adjustable: true,
        tributePP: 0,
        protectionPP: 1,
        independenceStart: 30,
        petitionCost: 25,
        petitionGain: 12,
        canPetition: true,
    },
    autonomous: {
        name: "自治型",
        short: "自治",
        blurb: "只上缴政治点，宗主国仅提供保护；经济自主，独立性较高。",
        resourceShare: 0,
        resourceMin: 0,
        resourceMax: 0,
        adjustable: false,
        tributePP: 2,
        protectionPP: 0,
        independenceStart: 55,
        petitionCost: 12,
        petitionGain: 12,
        canPetition: true,
    },
    oppressive: {
        name: "压迫型",
        short: "压迫",
        blurb: "战败和谈的产物：上缴政治点与固定比例资源，独立性极低且不可主动提升。",
        resourceShare: 0.3,
        resourceMin: 0.3,
        resourceMax: 0.3,
        adjustable: false,
        tributePP: 3,
        protectionPP: 0,
        independenceStart: 15,
        petitionCost: 0,
        petitionGain: 0,
        canPetition: false,
    },
} as const satisfies Record<VassalType, VassalProfile>;

export const VASSAL_OFFER_COOLDOWN = 20;
export const VASSAL_AID_COOLDOWN = 20;
export const VASSAL_UPGRADE_COST = 10;
/** Days between independence petitions; one petition moves independence in one step. */
export const VASSAL_PETITION_COOLDOWN = 15;
/** Independence at which a vassal considers defecting to a third protector. */
const DEFECT_THRESHOLD: Readonly<Record<VassalType, number>> = {
    cooperative: 80,
    autonomous: 70,
    oppressive: 90,
};

/** Full player-facing rules, shown by the [i] next to the vassal status. */
export const VASSAL_HELP_BODY = [
    "附庸国与宗主国使用相同的疆域背景色，只有国旗纹章不同；宗主国对所有类型的附庸都拥有通行权。",
    "",
    "合作型：向宗主国上缴可调比例的资源（5%–40%，默认 15%），换取保护与每日 1 政治点；独立性初始 30。",
    "自治型：仅每日上缴 2 政治点，宗主国只提供保护，不抽取资源；独立性初始 55。",
    "压迫型：通常由战败和谈产生，胜利者偏向扩张时强加。上缴每日 3 政治点与固定 30% 资源，独立性初始 15；不可主动争取独立，只会随时间和宗主国战争被动增长。可向非宗主国求援；宗主国开战时可能宣布独立，加入对抗宗主国的战争。",
    "",
    "臣服度：每个附庸国有 1–5 的固有性格。忠顺的附庸缴纳更稳定、更愿意响应宗主召唤；桀骜的附庸会少缴、拒绝参战、更常争取独立（一次性提出主权诉求并按天冷却），并在独立性足够高时倒向第三方。",
    "契约改善：当附庸足够忠顺且攒够 10 政治点时，可请求宗主国改善契约（压迫型→合作型，合作型→自治型）。宗主国开战时按臣服度召唤附庸参战；玩家作为附庸会收到待处理请求。",
    "弱小国家可主动请求成为附庸（压迫型不可主动选择）；宗主国亦可要求弱国附庸。贡赋比例可在附庸事务中调整。",
].join("\n");

/** Vassal-only thresholds for one nation; falls back to the tendency baseline. */
export function vassalTuningOf(state: GameState, nationId: number): VassalTuning {
    const nation = state.nations[nationId];
    const type = vassalTypeOf(state, nationId);
    return vassalTuning(tendencyProfileOf(nation?.tendency), type, subservienceOf(nation));
}

/** Seeded per-nation subservience; fixtures without the field use the tendency baseline. */
export function subservienceOf(nation: Nation | undefined): number {
    if (!nation) return 3;
    const profile = tendencyProfileOf(nation.tendency);
    const value = nation.subservience;
    return Number.isFinite(value) ? Math.max(1, Math.min(5, value as number)) : profile.subservience;
}

/** Player-facing vassal temperament: green loyal, white neutral, red restless. */
export function subservienceTone(value: number): { label: string; tone: "pos" | "note" | "neg" } {
    if (value >= 4) return { label: "忠顺", tone: "pos" };
    if (value <= 2) return { label: "桀骜", tone: "neg" };
    return { label: "中立", tone: "note" };
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

export function independenceOf(state: GameState, nationId: number): number {
    const type = vassalTypeOf(state, nationId);
    if (!type) return 100;
    const value = state.nations[nationId]?.independence;
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value as number)) : VASSAL_PROFILES[type].independenceStart;
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
    nation.lastPetitionDay = undefined;
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

/** Days until the vassal may petition for independence again; 0 when ready. */
export function petitionCooldownDays(state: GameState, nationId: number): number {
    const last = state.nations[nationId]?.lastPetitionDay;
    if (last === undefined) return 0;
    return Math.max(0, last + VASSAL_PETITION_COOLDOWN - state.day);
}

/** One-shot petition: afford the contract's cost and be off cooldown. */
export function canPetitionIndependence(state: GameState, vassalId: number): boolean {
    if (state.winner !== null) return false;
    const type = vassalTypeOf(state, vassalId);
    if (!type) return false;
    const profile = VASSAL_PROFILES[type];
    if (!profile.canPetition || independenceOf(state, vassalId) >= 100) return false;
    if (petitionCooldownDays(state, vassalId) > 0) return false;
    return state.nations[vassalId].politicalPower >= profile.petitionCost;
}

/**
 * Petition for independence in one step: pay the contract's cost, gain
 * `petitionGain`, then wait out the cooldown. Reaching 100 releases the vassal.
 */
export function petitionIndependence(core: GameCore, vassalId: number): boolean {
    const state = core.state;
    if (!canPetitionIndependence(state, vassalId)) return false;
    const type = vassalTypeOf(state, vassalId);
    if (!type) return false;
    const profile = VASSAL_PROFILES[type];
    const nation = state.nations[vassalId];
    nation.politicalPower -= profile.petitionCost;
    nation.lastPetitionDay = state.day;
    nation.independence = Math.min(100, independenceOf(state, vassalId) + profile.petitionGain);
    if (nation.independence >= 100) {
        const overlord = overlordOf(state, vassalId);
        if (overlord >= 0) releaseVassal(core, vassalId, true);
    } else {
        core.log(`${core.nationChip(vassalId)} 提出主权诉求，独立性升至 ${Math.round(nation.independence)}（-${profile.petitionCost} 政治点）`, "diplo", vassalId);
        core.emit({ type: "state" });
    }
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

/** Only a genuinely loyal vassal asks for a better contract, and it must pay for it. */
export function canRequestUpgrade(state: GameState, vassalId: number): boolean {
    const type = vassalTypeOf(state, vassalId);
    const target = upgradeTargetOf(type);
    if (!target || state.winner !== null) return false;
    if (subservienceOf(state.nations[vassalId]) < 4) return false;
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
    nation.vassalType = target;
    nation.tributeRate = profile.resourceShare;
    nation.independence = Math.max(independenceOf(state, vassalId), profile.independenceStart);
    core.log(`${core.nationChip(vassalId)} 的附庸契约改善为${profile.name}`, "diplo", vassalId, true, {
        kind: "peace",
        nation: vassalId,
    });
    core.emit({ type: "relations" });
    core.emit({ type: "state" });
    return true;
}

function aiAcceptsUpgrade(state: GameState, overlordId: number, vassalId: number): boolean {
    const trust = vassalTuningOf(state, vassalId).overlordTrust;
    const profile = state.nations[overlordId].tendency;
    if (profile === "isolated") return trust >= 0.9;
    return trust >= 0.75;
}

/**
 * A loyal vassal asks to renegotiate. The player overlord receives a pending
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

/** Called from the war declaration path: an overlord calls its vassals to arms. */
export function applyVassalCallToArms(core: GameCore, overlordId: number, enemyId: number): void {
    const state = core.state;
    if (!Number.isInteger(overlordId) || !Number.isInteger(enemyId) || overlordId === enemyId) return;
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
        const tuning = vassalTuningOf(state, vassalId);
        if (tuning.callToArmsAccept <= core.rand.nextFloat()) {
            core.log(`${core.nationChip(vassalId)} 拒绝 ${core.nationChip(overlordId)} 的参战号召`, "diplo", vassalId);
            continue;
        }
        setWar(state, vassalId, enemyId, true);
        core.log(`${core.nationChip(vassalId)} 响应宗主召唤，对 ${core.nationChip(enemyId)} 宣战`, "diplo", vassalId, true, {
            kind: "war",
            nation: vassalId,
        });
        core.emit({ type: "war", aggressor: vassalId, defender: enemyId });
    }
}

/**
 * Daily tribute. Resource shares use net funds and gross manpower/industry so
 * an unpaid army never pushes the vassal below zero.
 */export function tickVassalTribute(core: GameCore): void {
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
        // Loyal vassals round their share up, restless ones quietly hold some back.
        const compliance = vassalTuningOf(state, nation.id).tributeCompliance;
        const share = (profile.adjustable ? tributeRateOf(state, nation.id) : profile.resourceShare) * compliance;

        if (share > 0) {
            const funds = Math.max(0, rates.fundsNet) * share;
            const manpower = Math.max(0, rates.manpower) * share;
            const industry = Math.max(0, rates.industry) * share;
            nation.funds -= funds;
            nation.manpower -= manpower;
            nation.industry -= industry;
            overlord.funds += funds;
            overlord.manpower += manpower;
            overlord.industry += industry;
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

        const overlordRates = resourceRates(state, overlordId);
        overlord.manpower = Math.min(overlord.manpower, overlordRates.manpowerCap);
        overlord.industry = Math.min(overlord.industry, overlordRates.industryCap);
        clampResources(overlord, overlordRates);
    }
}

/** Independence drifts every day; oppressive vassals revolt when it fills. */
export function tickVassalIndependence(core: GameCore): void {
    const state = core.state;
    for (const nation of state.nations) {
        if (!nation.alive) continue;
        const overlord = overlordOf(state, nation.id);
        if (overlord < 0) continue;
        const type = vassalTypeOf(state, nation.id);
        if (!type) continue;
        const tuning = vassalTuningOf(state, nation.id);
        const atWar = state.war[overlord]?.some(Boolean) === true;
        let next = independenceOf(state, nation.id) + tuning.independenceDrift;
        // A宗主 at war cannot watch every restless province; oppressive contracts feel it most.
        if (type === "oppressive" && atWar) next += 0.5;
        nation.independence = Math.max(0, Math.min(100, next));

        if (nation.independence >= 100) {
            if (type === "oppressive") rebelVassal(core, nation.id, overlord);
            else if (releaseVassal(core, nation.id, true)) {
                core.log(`${core.nationChip(nation.id)} 的独立性达到 100，和平脱离 ${core.nationChip(overlord)}`, "diplo", nation.id);
            }
            continue;
        }
        if (type === "oppressive" && atWar && nation.independence >= 55 && state.day % 5 === 0) {
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

/** Candidate helpers for an oppressive vassal: not the overlord, not itself. */
export function aidCandidates(state: GameState, vassalId: number): number[] {
    const overlord = overlordOf(state, vassalId);
    if (overlord < 0 || vassalTypeOf(state, vassalId) !== "oppressive") return [];
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
    if (state.winner !== null || vassalTypeOf(state, vassalId) !== "oppressive") return false;
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
    if (profile === "militarist" || profile === "hegemon") return ratio >= 0.7;
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
        ((profile === "militarist" || profile === "hegemon" || profile === "ideologue") &&
            truceDays(state, helperId, overlord) === 0);
    if (!isAtWar(state, helperId, overlord) && willingToFight) setWar(state, helperId, overlord, true);
    core.log(`${core.nationChip(helperId)} 援助 ${core.nationChip(vassalId)}（${funds} 财政 · ${pp} 政治点）`, "diplo", helperId);
    core.emit({ type: "state" });
}

/**
 * Oppressive vassal asks a third party for help. Player helpers receive a
 * pending request; AI helpers decide immediately.
 */
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

/** Called from the war declaration path: an overlord defends a vassal. */
export function joinVassalDefense(core: GameCore, aggressor: number, defender: number): void {
    const state = core.state;
    const overlord = overlordOf(state, defender);
    if (overlord < 0 || overlord === aggressor || isAtWar(state, overlord, aggressor)) return;
    if (isProtectedRelation(state, overlord, aggressor)) return;
    setWar(state, overlord, aggressor, true);
    core.log(`${core.nationChip(overlord)} 履行保护义务，对 ${core.nationChip(aggressor)} 宣战`, "diplo", overlord, true, {
        kind: "war",
        nation: overlord,
    });
    core.emit({ type: "war", aggressor: overlord, defender: aggressor });
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
            const nation = state.nations[0];
            if (nation) nation.independence = Math.min(100, independenceOf(state, 0) + 3);
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
 * A vassal whose independence has grown looks for a stronger protector. It
 * defects to a third party that is already fighting the old overlord (or can
 * physically protect it) and, if that party is at war, joins against the old
 * overlord. The player is never silently installed as a new overlord.
 */
function defectVassal(core: GameCore, vassalId: number, overlordId: number): boolean {
    const state = core.state;
    const vassal = state.nations[vassalId];
    if (!vassal?.alive) return false;
    const candidates = state.nations
        .filter((nation) => nation.alive && nation.id !== vassalId && nation.id !== overlordId && nation.id !== 0 &&
            !isAtWar(state, vassalId, nation.id) &&
            (isAtWar(state, nation.id, overlordId) || borderingNations(state, vassalId).has(nation.id)) &&
            nationPower(state, nation.id) >= nationPower(state, overlordId) * 0.6)
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

        if (type === "oppressive" && canRequestAid(state, nationId) && state.day % 4 === nationId % 4) {
            requestForeignAid(core, nationId);
        }
        if (canRequestUpgrade(state, nationId) && state.day % 6 === nationId % 6) {
            requestVassalUpgrade(core, nationId);
        }
        if (tuning.raiseIndependenceWill > core.rand.nextFloat() && canPetitionIndependence(state, nationId)) {
            petitionIndependence(core, nationId);
        }
        // A successful petition may already have released this nation.
        if (overlordOf(state, nationId) !== overlord) return;
        if (independenceOf(state, nationId) >= DEFECT_THRESHOLD[type] &&
            tuning.defectRisk > core.rand.nextFloat() && state.day % 3 === nationId % 3) {
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
