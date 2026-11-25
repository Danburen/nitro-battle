import { tendencyProfileOf, tendencyTuning } from "./ai/tendencies.ts";
import type { AITuning } from "./ai/types.ts";
import { isProtectedRelation, overlordOf } from "./access.ts";
import { applyAllianceWar } from "./alliance.ts";
import { joinVassalDefense, applyVassalCallToArms } from "./vassal.ts";
import { claimedStateOwners, fortifyClaimedState } from "./defense.ts";
import type { GameCore } from "./core.ts";
import { settlePeace, warGoalProgress, enforceWarGoal } from "./settlement.ts";
import { minus, plus } from "./decision.ts";
import { MAX_HP, UNIT_PROFILES } from "./types/unit.ts";
import { STABILITY_DECLARATION_SHIFT, STABILITY_PEACE_SHIFT, STABILITY_WAR_SHIFT } from "./types/economy.ts";
import { shiftStability } from "./stability.ts";
import { NEUTRAL } from "./types/world.ts";
import type { DiplomaticAction, DiplomaticActionKind } from "./types/diplomacy.ts";
import type { DiplomaticDecision } from "./types/decision.ts";
import type { GameState } from "./types/state.ts";

export const CLAIM_COST = 8;
export const DIPLOMATIC_PROFILES = {
    conquest: { label: "夺取宣称州", cost: 12, days: 4, validDays: 12, upkeep: 1 },
    annex: { label: "全面吞并", cost: 35, days: 8, validDays: 16, upkeep: 2 },
} as const satisfies Record<DiplomaticActionKind, { label: string; cost: number; days: number; validDays: number; upkeep: number }>;

export const TRUCE_DAYS = 10;
/** Opening grace period: AI nations do not expand against the human player before this day. */
export const PLAYER_PROTECTION_DAYS = 30;
const MIN_PEACE_DAYS = 2;
const OFFER_COOLDOWN_DAYS = 5;
const WAR_MIN_DAY = 5;

/** AI thresholds for one nation; a missing tendency falls back to the neutral profile. */
function aiTuningOf(state: GameState, nation: number): AITuning {
    return tendencyTuning(tendencyProfileOf(state.nations[nation]?.tendency));
}

function livingNation(state: GameState, nation: number): boolean {
    return Number.isInteger(nation) && nation >= 0 && state.nations[nation]?.alive === true;
}

function validState(state: GameState, stateId: number | null): stateId is number {
    return stateId !== null && Number.isInteger(stateId) && stateId >= 0 && state.states[stateId] !== undefined;
}

function validKind(kind: DiplomaticActionKind): boolean {
    return kind === "conquest" || kind === "annex";
}

/** Adjacency concerns actual control, not the state's center or formal owner. */
function adjacentState(state: GameState, nation: number, stateId: number): boolean {
    return state.states[stateId].provinces.some((site) =>
        state.graph.adjacency[site].some((edge) => state.provinces[edge.site].owner === nation),
    );
}

export function hasStateClaim(state: GameState, nation: number, stateId: number): boolean {
    if (!Number.isInteger(nation) || nation < 0 || !state.nations[nation] || !validState(state, stateId)) return false;
    return state.claims.some((claim) => claim.nation === nation && claim.stateId === stateId);
}

/** True while the opening grace period shields the player from AI expansion. */
export function playerProtected(state: GameState): boolean {
    return state.day < PLAYER_PROTECTION_DAYS;
}

/** A state counts as the player's when it still holds player land or a player core. */
export function isPlayerState(state: GameState, stateId: number): boolean {
    const region = state.states[stateId];
    if (!region) return false;
    return region.provinces.some((site) => {
        const province = state.provinces[site];
        return province.owner === 0 || province.legalOwner === 0 || province.coreNation === 0;
    });
}

export function canClaimState(state: GameState, nation: number, stateId: number): boolean {
    if (state.winner !== null || !livingNation(state, nation) || !validState(state, stateId)) return false;
    if (hasStateClaim(state, nation, stateId) || !(state.nations[nation].politicalPower >= CLAIM_COST)) return false;
    const provinces = state.states[stateId].provinces.map((site) => state.provinces[site]);
    if (!provinces.some((province) => province.legalOwner !== nation && province.legalOwner !== NEUTRAL &&
        state.nations[province.legalOwner] !== undefined)) return false;
    return adjacentState(state, nation, stateId) || provinces.some((province) => province.coreNation === nation);
}

/** States this nation may claim right now; drives the map's pulsing expansion highlight. */
export function claimableStateIds(state: GameState, nation: number): number[] {
    return state.states.filter((region) => canClaimState(state, nation, region.id)).map((region) => region.id);
}

export interface StateSummary {
    readonly cores: number[];
    readonly owners: number[];
    readonly control: { nation: number; percent: number }[];
    readonly claimants: number[];
}

/** One-shot aggregate for the state hover tooltip; callers snapshot it, never stream it. */
export function stateSummary(state: GameState, stateId: number): StateSummary | null {
    const region = state.states[stateId];
    if (!region) return null;
    const cores = new Set<number>();
    const owners = new Set<number>();
    const control = new Map<number, number>();
    for (const site of region.provinces) {
        const province = state.provinces[site];
        if (province.coreNation >= 0) cores.add(province.coreNation);
        if (province.legalOwner >= 0) owners.add(province.legalOwner);
        if (province.owner >= 0) control.set(province.owner, (control.get(province.owner) ?? 0) + 1);
    }
    const total = region.provinces.length;
    return {
        cores: [...cores].sort((a, b) => a - b),
        owners: [...owners].sort((a, b) => a - b),
        control: [...control.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
            .map(([nation, count]) => ({ nation, percent: Math.round((count / total) * 100) })),
        claimants: [...new Set(state.claims.filter((claim) => claim.stateId === stateId).map((claim) => claim.nation))]
            .sort((a, b) => a - b),
    };
}

export function claimState(core: GameCore, nation: number, stateId: number): boolean {
    const state = core.state;
    if (!canClaimState(state, nation, stateId)) return false;
    state.nations[nation].politicalPower -= CLAIM_COST;
    state.claims.push({ nation, stateId });
    const name = state.states[stateId].name;
    core.log(`${core.nationChip(nation)} 宣称 ${name}`, "diplo", nation);
    // Every nation with a legal/core stake receives a report. The player's is a
    // prominent warning; AI owners quietly harden the threatened state.
    const owners = new Set(claimedStateOwners(state, stateId, nation));
    if (nation !== 0 && isPlayerState(state, stateId)) owners.add(0);
    for (const owner of owners) {
        if (owner === 0) {
            core.log(`${core.nationChip(nation)} 宣称我国领土 ${name}！`, "diplo", 0, true, {
                kind: "claim", nation, stateName: name,
            });
            core.emit({ type: "claim-warning", nation, stateId, stateName: name });
        } else {
            core.log(`${core.nationChip(nation)} 宣称 ${core.nationName(owner)} 的领土 ${name}！`, "diplo", owner, false, {
                kind: "claim", nation, stateName: name,
            });
            fortifyClaimedState(core, owner, stateId);
        }
    }
    core.emit({ type: "state" });
    return true;
}

export function canCancelStateClaim(state: GameState, nation: number, stateId: number): boolean {
    if (state.winner !== null || !hasStateClaim(state, nation, stateId)) return false;
    const owners = new Set(state.states[stateId].provinces.map((site) => state.provinces[site].legalOwner));
    for (const owner of owners) {
        if (owner !== nation && owner !== NEUTRAL && state.nations[owner]?.alive && isAtWar(state, nation, owner)) return false;
    }
    return true;
}

export function cancelClaim(core: GameCore, nation: number, stateId: number): boolean {
    const state = core.state;
    if (!canCancelStateClaim(state, nation, stateId)) return false;
    const index = state.claims.findIndex((claim) => claim.nation === nation && claim.stateId === stateId);
    state.claims.splice(index, 1);
    state.nations[nation].politicalPower += CLAIM_COST;
    core.log(`${core.nationChip(nation)} 取消宣称 ${state.states[stateId].name}`, "diplo", nation);
    core.emit({ type: "state" });
    return true;
}

export function isAtWar(state: GameState, a: number, b: number): boolean {
    if (a === b || a === NEUTRAL || b === NEUTRAL) return false;
    return state.war[a]?.[b] === true;
}

export function setWar(state: GameState, a: number, b: number, atWar: boolean): void {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b ||
        !state.war[a] || !state.war[b]) return;
    state.war[a][b] = atWar;
    state.war[b][a] = atWar;
    const since = atWar ? state.day : -1;
    state.warSince[a][b] = since;
    state.warSince[b][a] = since;
    const truce = atWar ? -1 : state.day + TRUCE_DAYS;
    state.truce[a][b] = truce;
    state.truce[b][a] = truce;
    // Every war pair shakes both nations; peace lets them recover.
    const shift = atWar ? -STABILITY_WAR_SHIFT : STABILITY_PEACE_SHIFT;
    shiftStability(state.nations[a], shift);
    shiftStability(state.nations[b], shift);
    if (atWar) dropOffers(state, a, b);
}

export function truceDays(state: GameState, a: number, b: number): number {
    return Math.max(0, (state.truce[a]?.[b] ?? -1) - state.day);
}

export function warDuration(state: GameState, a: number, b: number): number {
    if (!isAtWar(state, a, b)) return 0;
    const since = state.warSince[a][b];
    return since < 0 ? 0 : state.day - since;
}

/** Nations whose controlled provinces touch this nation's controlled territory. */
export function borderingNations(state: GameState, nationId: number): Set<number> {
    const found = new Set<number>();
    if (!livingNation(state, nationId)) return found;
    for (const province of state.provinces) {
        if (province.owner !== nationId) continue;
        for (const edge of state.graph.adjacency[province.site]) {
            const owner = state.provinces[edge.site].owner;
            if (owner !== NEUTRAL && owner !== nationId) found.add(owner);
        }
    }
    return found;
}

function peacefulTarget(state: GameState, nation: number, target: number): boolean {
    return livingNation(state, nation) && livingNation(state, target) && nation !== target &&
        !isProtectedRelation(state, nation, target) &&
        !isAtWar(state, nation, target) && truceDays(state, nation, target) === 0;
}

/** Shared by preparation, authorization, declaration, and stale-action cleanup. */
function actionTargetValid(
    state: GameState, nation: number, kind: DiplomaticActionKind, target: number, stateId: number | null,
): boolean {
    if (!livingNation(state, nation) || !validKind(kind)) return false;
    if (!peacefulTarget(state, nation, target)) return false;
    if (kind === "annex") {
        return stateId === null && borderingNations(state, nation).has(target) &&
            state.provinces.some((province) => province.legalOwner === target);
    }
    return validState(state, stateId) && hasStateClaim(state, nation, stateId) &&
        adjacentState(state, nation, stateId) &&
        state.states[stateId].provinces.some((site) => state.provinces[site].legalOwner === target);
}

function activeAction(state: GameState, action: DiplomaticAction): boolean {
    return state.day < action.expiresDay &&
        actionTargetValid(state, action.nation, action.kind, action.target, action.stateId);
}

function readyAction(state: GameState, action: DiplomaticAction): boolean {
    return state.day >= action.readyDay && activeAction(state, action);
}

export function canPrepareDiplomaticAction(
    state: GameState, nation: number, kind: DiplomaticActionKind, target: number, stateId: number | null,
): boolean {
    if (state.winner !== null || !actionTargetValid(state, nation, kind, target, stateId)) return false;
    if (!(state.nations[nation].politicalPower >= DIPLOMATIC_PROFILES[kind].cost)) return false;
    return !state.diplomaticActions.some((action) => action.nation === nation && activeAction(state, action) &&
        (state.day < action.readyDay || (action.kind === kind && action.target === target && action.stateId === stateId)));
}

export function prepareDiplomaticAction(
    core: GameCore, nation: number, kind: DiplomaticActionKind, target: number, stateId: number | null,
): boolean {
    const state = core.state;
    if (!canPrepareDiplomaticAction(state, nation, kind, target, stateId)) return false;
    advanceDiplomacy(core);
    const profile = DIPLOMATIC_PROFILES[kind];
    const readyDay = state.day + profile.days;
    state.nations[nation].politicalPower -= profile.cost;
    state.diplomaticActions.push({
        id: state.nextDiplomaticActionId++, nation, target, kind, stateId,
        startedDay: state.day, readyDay, expiresDay: readyDay + profile.validDays, upkeepSpent: 0,
    });
    const destination = stateId === null ? state.nations[target].name : state.states[stateId].name;
    core.log(`${core.nationChip(nation)} 制造${profile.label}借口 ${destination}`, "diplo", nation);
    core.emit({ type: "state" });
    return true;
}

/** Cancelling a still-preparing project returns its creation cost; daily upkeep already spent is kept. */
export function cancelRefund(state: GameState, action: DiplomaticAction): number {
    return state.day < action.readyDay ? DIPLOMATIC_PROFILES[action.kind].cost : 0;
}

export function cancelDiplomaticAction(core: GameCore, nation: number, id: number): boolean {
    const state = core.state;
    if (state.winner !== null || !livingNation(state, nation) || !Number.isInteger(id)) return false;
    const index = state.diplomaticActions.findIndex((action) => action.id === id && action.nation === nation);
    if (index < 0) return false;
    const [action] = state.diplomaticActions.splice(index, 1);
    const refund = cancelRefund(state, action);
    if (refund > 0) state.nations[nation].politicalPower += refund;
    core.log(`${core.nationChip(nation)} 取消借口 ${DIPLOMATIC_PROFILES[action.kind].label}${refund > 0 ? `（返还 ${refund} 政治点）` : ""}`, "diplo", nation);
    core.invalidateReach();
    core.emit({ type: "state" });
    return true;
}

/** Once-per-day political upkeep for projects still preparing; ready projects cost nothing extra. */
export function tickDiplomaticUpkeep(core: GameCore): void {
    const state = core.state;
    for (const action of state.diplomaticActions) {
        if (state.day >= action.readyDay) continue;
        const nation = state.nations[action.nation];
        if (!nation?.alive) continue;
        const due = DIPLOMATIC_PROFILES[action.kind].upkeep;
        const paid = Math.min(nation.politicalPower, due);
        nation.politicalPower -= paid;
        action.upkeepSpent = (action.upkeepSpent ?? 0) + paid;
    }
}

// Only notification deduplication lives outside GameState; authorization always derives from saved data.
const notifiedReady = new WeakMap<GameCore, Set<number>>();

export function advanceDiplomacy(core: GameCore): void {
    const state = core.state;
    let notified = notifiedReady.get(core);
    if (!notified) {
        notified = new Set();
        notifiedReady.set(core, notified);
    }
    let changed = false;
    for (let i = state.diplomaticActions.length - 1; i >= 0; i--) {
        const action = state.diplomaticActions[i];
        const label = DIPLOMATIC_PROFILES[action.kind].label;
        const chip = core.nationChip(action.nation);
        if (!activeAction(state, action)) {
            state.diplomaticActions.splice(i, 1);
            notified.delete(action.id);
            core.log(`${chip} 借口失效 ${label}`, "diplo", action.nation);
            changed = true;
        } else if (state.day >= action.readyDay && !notified.has(action.id)) {
            notified.add(action.id);
            core.log(`${chip} 借口就绪 ${label}`, "diplo", action.nation);
            changed = true;
        }
    }
    const ids = new Set(state.diplomaticActions.map((action) => action.id));
    for (const id of notified) if (!ids.has(id)) notified.delete(id);
    if (changed) {
        core.invalidateReach();
        core.emit({ type: "state" });
    }
}

function declarationAction(state: GameState, from: number, to: number, actionId?: number): DiplomaticAction | undefined {
    if (state.winner !== null || !peacefulTarget(state, from, to)) return undefined;
    if (actionId !== undefined && !Number.isInteger(actionId)) return undefined;
    return state.diplomaticActions.find((action) => action.nation === from && action.target === to &&
        (actionId === undefined || action.id === actionId) && readyAction(state, action));
}

export function canDeclareWar(state: GameState, from: number, to: number, actionId?: number): boolean {
    return declarationAction(state, from, to, actionId) !== undefined;
}

/** Rough military weight: regiment quality plus controlled territory. */
export function nationPower(state: GameState, nationId: number): number {
    let power = 0;
    for (const army of state.armies.values()) {
        if (army.nation !== nationId) continue;
        const orgMult = 0.4 + 0.6 * (army.org / 100);
        for (const regiment of army.regiments) {
            const profile = UNIT_PROFILES[regiment.kind];
            power += (regiment.hp / MAX_HP) * (profile.atk + profile.def) * orgMult;
        }
    }
    for (const province of state.provinces) if (province.owner === nationId) power += 5;
    return power;
}

export function dropOffers(state: GameState, a: number, b: number): void {
    for (let i = state.peaceOffers.length - 1; i >= 0; i--) {
        const from = state.peaceOffers[i];
        if (from === a || from === b) state.peaceOffers.splice(i, 1);
    }
}

/** Whether the AI accepts a white peace; the same object feeds the player's tooltip. */
export function decidePeace(state: GameState, aiId: number, otherId: number): DiplomaticDecision {
    if (!isAtWar(state, aiId, otherId)) {
        return { accepts: false, factors: [minus("双方并未交战")], verdict: "refuse" };
    }
    const tuning = aiTuningOf(state, aiId);
    const duration = warDuration(state, aiId, otherId);
    if (duration < MIN_PEACE_DAYS) {
        return { accepts: false, factors: [minus("战争尚未持续足够久")], verdict: "refuse" };
    }
    if (duration >= tuning.fatigueDays) {
        return { accepts: true, factors: [plus("战争疲劳已达上限")], verdict: "sure" };
    }
    const outmatched = nationPower(state, aiId) < nationPower(state, otherId) * tuning.peacePowerRatio;
    return {
        accepts: outmatched,
        factors: [outmatched ? plus("己方实力已处劣势") : minus("己方实力仍然占优")],
        verdict: outmatched ? "likely" : "refuse",
    };
}

export function aiOffersPlayerPeace(state: GameState, aiId: number): boolean {
    if (!isAtWar(state, aiId, 0) || state.peaceOffers.includes(aiId)) return false;
    const rejectedDay = state.peaceCooldown[aiId] ?? -1;
    if (rejectedDay >= 0 && state.day - rejectedDay < OFFER_COOLDOWN_DAYS) return false;
    const tuning = aiTuningOf(state, aiId);
    const duration = warDuration(state, aiId, 0);
    if (duration < tuning.offerMinDays) return false;
    return nationPower(state, aiId) < Math.max(1, nationPower(state, 0)) * tuning.offerPowerRatio ||
        duration >= tuning.fatigueDays;
}

/** Strategic target selection is not permission to declare war. */
export function aiWarTarget(state: GameState, aiId: number): number | null {
    if (!livingNation(state, aiId) || state.day < WAR_MIN_DAY || state.war[aiId].some(Boolean)) return null;
    const own = nationPower(state, aiId);
    const tuning = aiTuningOf(state, aiId);
    let best: number | null = null;
    let bestPower = Infinity;
    for (const otherId of borderingNations(state, aiId)) {
        if (otherId === 0 && playerProtected(state)) continue; // opening grace period shields the player
        if (!peacefulTarget(state, aiId, otherId) || !state.provinces.some((p) => p.legalOwner === otherId)) continue;
        const power = nationPower(state, otherId);
        if (power < bestPower) {
            bestPower = power;
            best = otherId;
        }
    }
    return best !== null && own >= bestPower * tuning.warPowerRatio ? best : null;
}

export function startWar(core: GameCore, aggressor: number, defender: number, actionId?: number): boolean {
    const state = core.state;
    const action = declarationAction(state, aggressor, defender, actionId);
    if (!action) return false;
    const targetSites = state.provinces.filter((province) => province.legalOwner === defender &&
        (action.kind === "annex" || province.stateId === action.stateId)).map((province) => province.site);
    if (targetSites.length === 0) return false;
    state.diplomaticActions.splice(state.diplomaticActions.indexOf(action), 1);
    state.wars.push({ aggressor, defender, goal: action.kind, stateId: action.stateId, targetSites, startedDay: state.day });
    setWar(state, aggressor, defender, true);
    // Declaring adds a further hit on top of the shared war-pair penalty.
    shiftStability(state.nations[aggressor], -STABILITY_DECLARATION_SHIFT);
    const protector = overlordOf(state, defender);
    // Attacking a vassal forces its overlord into the defensive war; allies and
    // called vassals join on both sides. Collect them all for one log headline.
    const participants = new Set<number>();
    const defenderProtector = joinVassalDefense(core, aggressor, defender, true);
    if (defenderProtector >= 0) participants.add(defenderProtector);
    if (protector >= 0) for (const id of applyAllianceWar(core, aggressor, protector, true)) participants.add(id);
    for (const id of applyAllianceWar(core, aggressor, defender, true)) participants.add(id);
    // A war summons both sides' vassals: the defender's protector answers first,
    // then each overlord calls its own dependants.
    if (protector >= 0) for (const id of applyVassalCallToArms(core, protector, aggressor, true)) participants.add(id);
    for (const id of applyVassalCallToArms(core, aggressor, defender, true)) participants.add(id);
    participants.delete(aggressor);
    participants.delete(defender);
    // Existing peacetime orders must not pin armies to an obsolete front.
    for (const army of state.armies.values()) {
        if (army.nation === aggressor || army.nation === defender) army.march = null;
    }
    core.invalidateReach();
    const joined = [...participants];
    const named = joined.slice(0, 3).map((id) => core.nationChip(id)).join("、");
    const suffix = joined.length === 0 ? ""
        : joined.length > 3 ? `，${named} 等 ${joined.length} 个国家也参与战争`
            : `，${named} 也参与战争`;
    core.log(`${core.nationChip(aggressor)} 对 ${core.nationChip(defender)} 宣战（${DIPLOMATIC_PROFILES[action.kind].label}）${suffix}`, "diplo", aggressor, true, {
        kind: "war",
        nation: aggressor,
    });
    core.emit({ type: "war", aggressor, defender });
    core.emit({ type: "state" });
    return true;
}

/** White peace returns occupations; only an enforced war goal may cede territory. */
export function makePeace(core: GameCore, a: number, b: number): void {
    settlePeace(core, a, b);
}

export function proposePeace(core: GameCore, targetId: number): boolean {
    const state = core.state;
    if (state.winner !== null || !isAtWar(state, 0, targetId) || !livingNation(state, targetId)) return false;
    if (decidePeace(state, targetId, 0).accepts) {
        dropOffers(state, targetId, targetId);
        makePeace(core, 0, targetId);
        return true;
    }
    core.log(`${core.nationChip(targetId)} 拒绝求和 ${core.nationChip(0)}`, "diplo", targetId);
    core.emit({ type: "state" });
    return false;
}

export function respondPeace(core: GameCore, fromId: number, accept: boolean): boolean {
    const state = core.state;
    if (state.winner !== null || !livingNation(state, fromId) || !isAtWar(state, 0, fromId) ||
        !state.peaceOffers.includes(fromId)) return false;
    dropOffers(state, fromId, fromId);
    if (!accept) {
        state.peaceCooldown[fromId] = state.day;
        core.log(`${core.nationChip(0)} 拒绝求和 ${core.nationChip(fromId)}`, "diplo", 0);
        core.emit({ type: "state" });
        return false;
    }
    makePeace(core, 0, fromId);
    return true;
}

function prepareAIExpansion(core: GameCore, nationId: number): void {
    const state = core.state;
    if (state.diplomaticActions.some((action) => action.nation === nationId &&
        state.day < action.readyDay && activeAction(state, action))) return;
    const target = aiWarTarget(state, nationId);
    if (target === null) return;
    // More aggressive nations (or overwhelming strength) may pay for full annexation.
    const preferAnnex = nationId % 2 === 0 || nationPower(state, nationId) >= nationPower(state, target) * 2;
    if (preferAnnex && prepareDiplomaticAction(core, nationId, "annex", target, null)) return;
    const regions = state.states.filter((region) => adjacentState(state, nationId, region.id) &&
        region.provinces.some((site) => state.provinces[site].legalOwner === target))
        .sort((a, b) => Number(hasStateClaim(state, nationId, b.id)) - Number(hasStateClaim(state, nationId, a.id)) || a.id - b.id);
    for (const region of regions) {
        if (playerProtected(state) && isPlayerState(state, region.id)) continue;
        if (!hasStateClaim(state, nationId, region.id) && !claimState(core, nationId, region.id)) continue;
        if (prepareDiplomaticAction(core, nationId, "conquest", target, region.id)) return;
        // Save up for this existing claim instead of spending PP on every adjacent state.
        if (state.nations[nationId].politicalPower < DIPLOMATIC_PROFILES.conquest.cost) return;
    }
    if (!preferAnnex) prepareDiplomaticAction(core, nationId, "annex", target, null);
}

export function runAIDiplomacy(core: GameCore, nationId: number): void {
    const state = core.state;
    if (state.winner !== null || !livingNation(state, nationId)) return;
    advanceDiplomacy(core);
    const wasAtWar = state.war[nationId].some(Boolean);
    // Victory terms precede fatigue/white peace so the AI does not throw away achieved goals.
    for (const war of [...state.wars]) {
        if (war.aggressor === nationId && isAtWar(state, nationId, war.defender) && warGoalProgress(state, war).canEnforce) {
            enforceWarGoal(core, nationId, war.defender);
        }
    }
    if (state.winner !== null) return;
    for (const other of state.nations) {
        if (other.id === nationId || other.isPlayer || !other.alive || !isAtWar(state, nationId, other.id)) continue;
        if (decidePeace(state, nationId, other.id).accepts && decidePeace(state, other.id, nationId).accepts) {
            makePeace(core, nationId, other.id);
        }
    }
    const player = state.nations[0];
    if (player.alive && isAtWar(state, nationId, player.id)) {
        if (aiOffersPlayerPeace(state, nationId)) {
            state.peaceOffers.push(nationId);
            core.log(`${core.nationChip(nationId)} 求和 ${core.nationChip(0)}`, "diplo", nationId);
            core.emit({ type: "state" });
        }
        return;
    }
    if (wasAtWar || state.war[nationId].some(Boolean)) return;
    const tuning = aiTuningOf(state, nationId);
    if (state.day >= Math.max(WAR_MIN_DAY, tuning.warMinDay)) {
        const action = state.diplomaticActions.find((candidate) => candidate.nation === nationId &&
            !(playerProtected(state) && candidate.target === 0) &&
            canDeclareWar(state, nationId, candidate.target, candidate.id) &&
            nationPower(state, nationId) >= nationPower(state, candidate.target) * tuning.warPowerRatio);
        if (action && startWar(core, nationId, action.target, action.id)) return;
    }
    prepareAIExpansion(core, nationId);
}
