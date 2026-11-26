import { t } from "../i18n/index.ts";
import type { GameCore } from "./core.ts";
import { inSameAlliance, isVassalOf } from "./access.ts";
import { isAtWar } from "./diplomacy.ts";
import { clampResources, resourceChain, resourceRates } from "./economy.ts";
import { deny, minus, plus } from "./decision.ts";
import { tendencyProfileOf } from "./ai/tendencies.ts";
import { createDiplomaticRequest, queuePlayerProposal, requestCooldownDays } from "./requests.ts";
import type { AITendencyId, AITendencyProfile } from "./ai/types.ts";
import type { DiplomaticDecision } from "./types/decision.ts";
import type { DiplomaticRequest } from "./types/diplomacy.ts";
import type { GameState } from "./types/state.ts";
import type { Nation } from "./types/entities.ts";
import type {
    TradeAgreement, TradeCadence, TradeKind, TradeOffer, TradeResource, TradeTransfer,
} from "./types/trade.ts";

/** Recurring deals run for this many turns by default; fixed transfers settle once at signing. */
export const TRADE_AGREEMENT_DAYS = 20;
/** Player-adjustable duration window for a proposed recurring deal. */
export const TRADE_AGREEMENT_MIN_DAYS = 5;
export const TRADE_AGREEMENT_MAX_DAYS = 60;
export const TRADE_AGREEMENT_DAY_STEP = 5;

export function normalizeTradeDays(days?: number): number {
    if (!Number.isFinite(days)) return TRADE_AGREEMENT_DAYS;
    const rounded = Math.round((days as number) / TRADE_AGREEMENT_DAY_STEP) * TRADE_AGREEMENT_DAY_STEP;
    return Math.max(TRADE_AGREEMENT_MIN_DAYS, Math.min(TRADE_AGREEMENT_MAX_DAYS, rounded));
}

/** Barter pool: no funds, no manpower, no political power. */
export const TRADE_RESOURCE_POOL: readonly TradeResource[] = ["industry", "raw", "food", "strategic"];
/** Free aid asks only for barter resources: never funds, manpower or political power. */
export const TRADE_AID_POOL: readonly TradeResource[] = TRADE_RESOURCE_POOL;

export const TRADE_HELP_BODY = [
    t("game.trade.help.agreement"),
    t("game.trade.help.exchange"),
    t("game.trade.help.purchase"),
    t("game.trade.help.aid"),
    t("game.trade.help.ai"),
    t("game.trade.help.cooldown"),
].join("\n");

const RESOURCE_WEIGHT: Readonly<Record<TradeResource, number>> = {
    funds: 1,
    manpower: 0.7,
    industry: 1.1,
    raw: 0.5,
    food: 0.6,
    strategic: 1.2,
};

const RESOURCE_NAME: Readonly<Record<TradeResource, string>> = {
    get funds() { return t("game.resourceVisibility.funds"); },
    get manpower() { return t("game.resourceVisibility.manpower"); },
    get industry() { return t("game.resourceVisibility.industry"); },
    get raw() { return t("game.resourceVisibility.raw"); },
    get food() { return t("game.resourceVisibility.food"); },
    get strategic() { return t("game.resourceVisibility.strategic"); },
};

interface TendencyTradeRule {
    readonly threshold: number;
    readonly aidShare: number;
    readonly label: string;
    readonly sign: 1 | -1 | 0;
}

const TENDENCY_TRADE: Readonly<Record<AITendencyId, TendencyTradeRule>> = {
    trader: { threshold: 0.85, aidShare: 0.28, get label() { return t("game.trade.tendency.trader"); }, sign: 1 },
    pacifist: { threshold: 0.95, aidShare: 0.34, get label() { return t("game.trade.tendency.pacifist"); }, sign: 1 },
    ideologue: { threshold: 1.0, aidShare: 0.26, get label() { return t("game.trade.tendency.ideologue"); }, sign: 1 },
    defensive: { threshold: 1.05, aidShare: 0.18, get label() { return t("game.trade.tendency.defensive"); }, sign: 0 },
    opportunist: { threshold: 1.02, aidShare: 0.15, get label() { return t("game.trade.tendency.opportunist"); }, sign: 0 },
    hegemon: { threshold: 1.15, aidShare: 0.1, get label() { return t("game.trade.tendency.hegemon"); }, sign: -1 },
    bully: { threshold: 1.2, aidShare: 0.08, get label() { return t("game.trade.tendency.bully"); }, sign: -1 },
    militarist: { threshold: 1.25, aidShare: 0.06, get label() { return t("game.trade.tendency.militarist"); }, sign: -1 },
    isolated: { threshold: 1.35, aidShare: 0.03, get label() { return t("game.trade.tendency.isolated"); }, sign: -1 },
};

function living(state: GameState, id: number): boolean {
    return Number.isInteger(id) && id >= 0 && state.nations[id]?.alive === true;
}

function stockOf(nation: Nation, resource: TradeResource): number {
    return nation[resource];
}

function addResource(nation: Nation, resource: TradeResource, delta: number): void {
    nation[resource] = Math.max(0, nation[resource] + delta);
}

function rateOf(state: GameState, nationId: number, resource: TradeResource): number {
    const rates = resourceChain(state, nationId).rates;
    switch (resource) {
        case "funds": return rates.fundsNet;
        case "manpower": return rates.manpower;
        case "industry": return rates.industryNet;
        case "raw": return rates.raw;
        case "food": return rates.food;
        case "strategic": return rates.strategic;
    }
}

/** Monthly obligations already promised by signed treaties. */
function committedMonthly(state: GameState, nationId: number, resource: TradeResource): number {
    let total = 0;
    for (const agreement of state.tradeAgreements) {
        const outgoing = agreement.from === nationId ? agreement.give : agreement.to === nationId ? agreement.receive : null;
        if (!outgoing) continue;
        for (const transfer of outgoing) {
            if (transfer.resource === resource && transfer.cadence === "monthly") total += transfer.amount;
        }
    }
    return total;
}

/** Total contract value; monthly flows count every installment of the chosen duration. */
function offerValue(transfers: readonly TradeTransfer[], days = TRADE_AGREEMENT_DAYS): number {
    let total = 0;
    for (const transfer of transfers) {
        total += Math.max(0, transfer.amount) * RESOURCE_WEIGHT[transfer.resource]
            * (transfer.cadence === "monthly" ? days : 1);
    }
    return total;
}

function stockValue(nation: Nation): number {
    let total = 0;
    for (const resource of Object.keys(RESOURCE_WEIGHT) as TradeResource[]) {
        total += Math.max(0, stockOf(nation, resource)) * RESOURCE_WEIGHT[resource];
    }
    return total;
}

/** Resources a side may put on the table under this treaty kind. */
export function tradeResourcesFor(kind: TradeKind, side: "give" | "receive"): readonly TradeResource[] {
    switch (kind) {
        case "exchange": return TRADE_RESOURCE_POOL;
        case "purchase": return side === "give" ? ["funds"] : TRADE_RESOURCE_POOL;
        case "mercenary": return side === "give" ? ["funds"] : ["manpower"];
        case "aid": return side === "give" ? [] : TRADE_AID_POOL;
    }
}

export function tradeTotal(transfers: readonly TradeTransfer[], cadence: TradeCadence): number {
    return transfers.reduce((sum, transfer) => sum + (transfer.cadence === cadence ? transfer.amount : 0), 0);
}

function transferTotalByResource(
    transfers: readonly TradeTransfer[], cadence: TradeCadence,
): Map<TradeResource, number> {
    const totals = new Map<TradeResource, number>();
    for (const transfer of transfers) {
        if (transfer.cadence !== cadence) continue;
        totals.set(transfer.resource, (totals.get(transfer.resource) ?? 0) + transfer.amount);
    }
    return totals;
}

/** Immediate + first-installment stock requirement for one side of an offer. */
function stockIssue(state: GameState, nationId: number, outgoing: readonly TradeTransfer[]): string | null {
    const nation = state.nations[nationId];
    if (!nation) return t("game.trade.issue.noTrader");
    const fixed = transferTotalByResource(outgoing, "fixed");
    const monthly = transferTotalByResource(outgoing, "monthly");
    for (const [resource, amount] of fixed) {
        if (stockOf(nation, resource) + 1e-9 < amount) {
            return t("game.trade.issue.stockFixedImmediate", { resource: RESOURCE_NAME[resource], amount });
        }
    }
    for (const [resource, amount] of monthly) {
        if (stockOf(nation, resource) + 1e-9 < (fixed.get(resource) ?? 0) + amount) {
            return t("game.trade.issue.stockFirstInstallment", { resource: RESOURCE_NAME[resource], amount });
        }
    }
    return null;
}

/** Structural/stock validation shared by the player UI, request acceptance and AI settlement. */
export function tradeOfferIssue(
    state: GameState, proposer: number, offer: TradeOffer, counterpart?: number,
): string | null {
    if (!living(state, proposer)) return t("game.decision.ineligible");
    if (counterpart !== undefined) {
        if (!living(state, counterpart)) return t("game.trade.issue.targetDead");
        if (proposer === counterpart) return t("game.trade.issue.selfTrade");
        if (isAtWar(state, proposer, counterpart)) return t("game.trade.issue.atWar");
    }
    if (state.winner !== null) return t("game.trade.issue.campaignEnded");
    const allowedGive = tradeResourcesFor(offer.kind, "give");
    const allowedReceive = tradeResourcesFor(offer.kind, "receive");
    for (const transfer of [...offer.give, ...offer.receive]) {
        if (!Number.isFinite(transfer.amount) || transfer.amount <= 0) return t("game.trade.issue.amountPositive");
    }
    for (const transfer of offer.give) {
        if (!allowedGive.includes(transfer.resource)) return t("game.trade.issue.proposerCantGive", { resource: RESOURCE_NAME[transfer.resource] });
    }
    for (const transfer of offer.receive) {
        if (!allowedReceive.includes(transfer.resource)) return t("game.trade.issue.targetCantGive", { resource: RESOURCE_NAME[transfer.resource] });
    }
    const seenGive = new Set<string>();
    const seenReceive = new Set<string>();
    for (const [transfers, seen] of [[offer.give, seenGive], [offer.receive, seenReceive]] as const) {
        for (const transfer of transfers) {
            const key = `${transfer.resource}:${transfer.cadence}`;
            if (seen.has(key)) return t("game.trade.issue.duplicate");
            seen.add(key);
        }
    }
    if (offer.kind === "aid") {
        if (offer.give.length > 0) return t("game.trade.issue.aidNoConsideration");
    } else if (offer.give.length === 0 || offer.receive.length === 0) {
        return t("game.trade.issue.bothNeedResource");
    }
    if (offer.receive.length === 0) return t("game.trade.issue.targetNoResource");
    const proposerIssue = stockIssue(state, proposer, offer.give);
    if (proposerIssue) return proposerIssue;
    if (counterpart !== undefined) {
        const counterpartIssue = stockIssue(state, counterpart, offer.receive);
        if (counterpartIssue) return counterpartIssue;
    }
    return null;
}

/** Hard solvency check for what the AI itself must give; negative growth without cover is a veto. */
function abilityFactors(
    state: GameState, nationId: number, outgoing: readonly TradeTransfer[], days = TRADE_AGREEMENT_DAYS,
): { factors: ReturnType<typeof plus>[]; solvable: boolean; hardReason: string | null } {
    const factors: ReturnType<typeof plus>[] = [];
    let solvable = true;
    let hardReason: string | null = null;
    const fixed = transferTotalByResource(outgoing, "fixed");
    const monthly = transferTotalByResource(outgoing, "monthly");
    const resources = new Set<TradeResource>([...fixed.keys(), ...monthly.keys()]);
    for (const resource of resources) {
        const nation = state.nations[nationId];
        const fixedAmount = fixed.get(resource) ?? 0;
        const monthlyAmount = monthly.get(resource) ?? 0;
        const stock = stockOf(nation, resource);
        const rate = rateOf(state, nationId, resource) - committedMonthly(state, nationId, resource);
        const initial = fixedAmount + monthlyAmount;
        const total = fixedAmount + monthlyAmount * days;
        const projected = stock + rate * days;
        if (stock + 1e-9 < initial) {
            solvable = false;
            hardReason = t("game.trade.ability.stockFirst", { resource: RESOURCE_NAME[resource], amount: initial });
            factors.push(minus(hardReason));
            break;
        }
        if (projected + 1e-9 < total) {
            solvable = false;
            hardReason = rate < 0
                ? t("game.trade.ability.negativeGrowth", { resource: RESOURCE_NAME[resource] })
                : t("game.trade.ability.stockInsufficient", { resource: RESOURCE_NAME[resource] });
            factors.push(minus(hardReason));
            break;
        }
    }
    if (solvable) {
        factors.push(plus(t("game.trade.ability.solvable")));
    }
    return { factors, solvable, hardReason };
}

function relationFactor(state: GameState, decider: number, proposer: number) {
    if (isVassalOf(state, decider, proposer) || isVassalOf(state, proposer, decider)) {
        return plus(t("game.trade.relation.vassal"));
    }
    if (inSameAlliance(state, decider, proposer)) return plus(t("game.trade.relation.ally"));
    return null;
}

function tendencyFactor(id: AITendencyId) {
    const rule = TENDENCY_TRADE[id];
    return rule.sign > 0 ? plus(rule.label) : rule.sign < 0 ? minus(rule.label) : null;
}

interface AttitudeRule {
    readonly factor: ReturnType<typeof plus> | null;
    /** Added to the fairness threshold of reciprocal deals. */
    readonly threshold: number;
    /** Added to the share of stock a nation is willing to give away for free. */
    readonly aidShare: number;
}

/** Hostile temperaments hoard resources; cooperative ones trade and aid more readily. */
function attitudeFactor(profile: AITendencyProfile): AttitudeRule {
    if (profile.aggression >= 4 || profile.expansion >= 4) {
        return {
            factor: minus(t("game.trade.attitude.hostile")),
            threshold: 0.12,
            aidShare: -0.06,
        };
    }
    if (profile.alliance >= 4 && profile.aggression <= 2) {
        return { factor: plus(t("game.trade.attitude.cooperative")), threshold: -0.06, aidShare: 0.06 };
    }
    return { factor: null, threshold: 0, aidShare: 0 };
}

function verdictFor(margin: number): DiplomaticDecision["verdict"] {
    if (margin >= 0.5) return "sure";
    if (margin >= 0.2) return "likely";
    if (margin >= 0) return "maybe";
    return margin >= -0.2 ? "unlikely" : "refuse";
}

/** AI willingness: war veto, own solvency, fairness, tendency and relation. */
export function decideTrade(
    state: GameState, deciderId: number, proposerId: number, offer: TradeOffer, days = TRADE_AGREEMENT_DAYS,
): DiplomaticDecision {
    if (!living(state, deciderId) || !living(state, proposerId)) return deny(t("game.decision.ineligible"));
    if (deciderId === proposerId) return deny(t("game.trade.issue.selfTrade"));
    if (state.winner !== null) return deny(t("game.trade.decision.campaignEnded"));
    if (isAtWar(state, deciderId, proposerId)) return deny(t("game.trade.decision.atWar"));
    const decider = state.nations[deciderId];
    const profile = tendencyProfileOf(decider.tendency);
    const tendency = tendencyFactor(profile.id);
    const attitude = attitudeFactor(profile);
    const relation = relationFactor(state, deciderId, proposerId);
    const incoming = offerValue(offer.give, days);
    const outgoing = offerValue(offer.receive, days);

    if (offer.kind === "aid") {
        if (outgoing <= 0) return deny(t("game.trade.decision.noAid"));
        const rule = TENDENCY_TRADE[profile.id];
        const factors = [minus(t("game.trade.decision.freeAidNoConsideration"))];
        if (tendency) factors.push(tendency);
        if (attitude.factor) factors.push(attitude.factor);
        if (relation) factors.push(relation);
        const budget = stockValue(decider) * Math.max(0.02, rule.aidShare + attitude.aidShare);
        const margin = outgoing > 0 ? budget / outgoing - 1 : -1;
        const projection = abilityFactors(state, deciderId, offer.receive, days);
        factors.push(...projection.factors);
        if (!projection.solvable) {
            return { accepts: false, factors, verdict: "refuse" };
        }
        const accepts = margin >= 0;
        return { accepts, factors, verdict: verdictFor(margin) };
    }

    if (incoming <= 0 || outgoing <= 0) return deny(t("game.trade.decision.noConsideration"));
    const ability = abilityFactors(state, deciderId, offer.receive, days);
    const factors = [...ability.factors];
    if (tendency) factors.push(tendency);
    if (attitude.factor) factors.push(attitude.factor);
    if (relation) factors.push(relation);
    if (!ability.solvable) return { accepts: false, factors, verdict: "refuse" };

    const rule = TENDENCY_TRADE[profile.id];
    let threshold = rule.threshold + attitude.threshold;
    if (relation) threshold -= 0.1;
    if (state.war[deciderId]?.some(Boolean) === true) {
        threshold += 0.08;
        factors.push(minus(t("game.trade.decision.warDemand")));
    }
    const ratio = incoming / outgoing;
    const margin = ratio - threshold;
    factors.push(margin >= 0
        ? plus(t("game.trade.decision.returnGood"))
        : minus(t("game.trade.decision.returnLow")));
    return { accepts: margin >= 0, factors, verdict: verdictFor(margin) };
}

function pay(giver: Nation, receiver: Nation, resource: TradeResource, amount: number): number {
    const paid = Math.max(0, Math.min(stockOf(giver, resource), amount));
    if (paid <= 0) return 0;
    addResource(giver, resource, -paid);
    addResource(receiver, resource, paid);
    return paid;
}

function clampPair(state: GameState, a: number, b: number): void {
    for (const id of [a, b]) {
        const nation = state.nations[id];
        if (nation?.alive) clampResources(nation, resourceRates(state, id));
    }
}

/** Settle an accepted offer: fixed parts now, recurring parts as a treaty. */
export function signTrade(
    core: GameCore, from: number, to: number, offer: TradeOffer, days = TRADE_AGREEMENT_DAYS,
): boolean {
    const state = core.state;
    if (tradeOfferIssue(state, from, offer, to)) return false;
    const giver = state.nations[from];
    const receiver = state.nations[to];
    const fixed: string[] = [];
    for (const transfer of offer.give) {
        if (transfer.cadence !== "fixed") continue;
        pay(giver, receiver, transfer.resource, transfer.amount);
        fixed.push(transfer.resource);
    }
    for (const transfer of offer.receive) {
        if (transfer.cadence !== "fixed") continue;
        pay(receiver, giver, transfer.resource, transfer.amount);
    }
    const recurring = offer.give.some((transfer) => transfer.cadence === "monthly")
        || offer.receive.some((transfer) => transfer.cadence === "monthly");
    if (recurring) {
        const agreement: TradeAgreement = {
            id: state.nextTradeId++,
            kind: offer.kind,
            from,
            to,
            give: [...offer.give],
            receive: [...offer.receive],
            startedDay: state.day,
            expiresDay: state.day + normalizeTradeDays(days),
        };
        state.tradeAgreements.push(agreement);
    }
    clampPair(state, from, to);
    core.log(t("game.trade.signed", { from: core.nationChip(from), to: core.nationChip(to) }), "diplo", from, false);
    if (fixed.length) {
        core.log(t("game.trade.delivered", { from: core.nationChip(from), to: core.nationChip(to) }), "econ", from, false);
    }
    core.emit({ type: "state" });
    return true;
}

/** Player/AI proposal to a target; refusals are logged and leave no treaty. */
export function proposeTrade(
    core: GameCore, proposerId: number, targetId: number, offer: TradeOffer, days = TRADE_AGREEMENT_DAYS,
): boolean {
    const state = core.state;
    const issue = tradeOfferIssue(state, proposerId, offer, targetId);
    if (issue) return false;
    if (proposerId === 0) {
        if (requestCooldownDays(state, "trade", targetId) > 0) return false;
        const request = queuePlayerProposal(state, "trade", 0, targetId, {
            tradeKind: offer.kind, tradeGive: offer.give, tradeReceive: offer.receive,
            tradeDays: normalizeTradeDays(days),
        });
        if (!request) return false;
        core.log(t("game.trade.proposed", { target: core.nationChip(targetId), kind: offer.kind }), "diplo", 0);
        core.emit({ type: "state" });
        return true;
    }
    const decision = decideTrade(state, targetId, proposerId, offer, days);
    if (!decision.accepts) {
        core.log(t("game.trade.refused", { target: core.nationChip(targetId), proposer: core.nationChip(proposerId) }), "diplo", targetId);
        core.emit({ type: "state" });
        return false;
    }
    return signTrade(core, proposerId, targetId, offer, days);
}

/** Accept an AI trade proposal addressed to the player. */
export function acceptTradeRequest(core: GameCore, request: DiplomaticRequest): boolean {
    if (!request.tradeKind || !request.tradeGive || !request.tradeReceive) return false;
    if (request.from !== 0 && request.to !== 0) return false;
    return signTrade(core, request.from, request.to, {
        kind: request.tradeKind,
        give: request.tradeGive,
        receive: request.tradeReceive,
    }, request.tradeDays);
}

/** Daily settlement of recurring flows, plus expiry and war cleanup. */
export function tickTradeAgreements(core: GameCore): void {
    const state = core.state;
    const dirty = new Set<number>();
    for (let i = state.tradeAgreements.length - 1; i >= 0; i--) {
        const agreement = state.tradeAgreements[i];
        const from = state.nations[agreement.from];
        const to = state.nations[agreement.to];
        if (!from?.alive || !to?.alive) {
            state.tradeAgreements.splice(i, 1);
            core.log(t("game.trade.endedDead", { from: core.nationChip(agreement.from), to: core.nationChip(agreement.to) }), "diplo", agreement.from);
            continue;
        }
        if (isAtWar(state, agreement.from, agreement.to)) {
            state.tradeAgreements.splice(i, 1);
            core.log(t("game.trade.endedWar", { from: core.nationChip(agreement.from), to: core.nationChip(agreement.to) }), "diplo", agreement.from, true);
            continue;
        }
        if (state.day > agreement.expiresDay) {
            state.tradeAgreements.splice(i, 1);
            core.log(t("game.trade.expired", { from: core.nationChip(agreement.from), to: core.nationChip(agreement.to) }), "diplo", agreement.from);
            continue;
        }
        for (const transfer of agreement.give) {
            if (transfer.cadence !== "monthly") continue;
            pay(from, to, transfer.resource, transfer.amount);
            dirty.add(from.id);
            dirty.add(to.id);
        }
        for (const transfer of agreement.receive) {
            if (transfer.cadence !== "monthly") continue;
            pay(to, from, transfer.resource, transfer.amount);
            dirty.add(from.id);
            dirty.add(to.id);
        }
    }
    for (const id of dirty) {
        const nation = state.nations[id];
        if (nation?.alive) clampResources(nation, resourceRates(state, id));
    }
}

/** Living trade partners of one nation, in nation-id order. */
export function tradePartners(state: GameState, nationId: number): number[] {
    const partners = new Set<number>();
    for (const agreement of state.tradeAgreements) {
        if (agreement.from === nationId) partners.add(agreement.to);
        else if (agreement.to === nationId) partners.add(agreement.from);
    }
    return [...partners].sort((a, b) => a - b);
}

/** Distinct resources covered by treaties between two nations. */
export function tradeResourceKinds(state: GameState, a: number, b: number): TradeResource[] {
    const kinds = new Set<TradeResource>();
    for (const agreement of state.tradeAgreements) {
        if ((agreement.from === a && agreement.to === b) || (agreement.from === b && agreement.to === a)) {
            for (const transfer of [...agreement.give, ...agreement.receive]) kinds.add(transfer.resource);
        }
    }
    return [...kinds];
}

export function tradeRemainingDays(state: GameState, agreement: TradeAgreement): number {
    return Math.max(0, agreement.expiresDay - state.day);
}

function partnerAvailable(state: GameState, nationId: number, resource: TradeResource): number {
    const nation = state.nations[nationId];
    const rate = rateOf(state, nationId, resource) - committedMonthly(state, nationId, resource);
    return Math.max(0, stockOf(nation, resource) + rate * TRADE_AGREEMENT_DAYS);
}

/** AI agenda: buy what it lacks when it has cash, otherwise ask for aid from a willing partner. */
export function runAITrade(core: GameCore, nationId: number): void {
    const state = core.state;
    if (state.winner !== null || !living(state, nationId) || state.day < 6) return;
    if (state.day % 4 !== nationId % 4) return;
    const chain = resourceChain(state, nationId);
    const nation = state.nations[nationId];
    const needs: { resource: TradeResource; score: number }[] = [];
    const consider = (resource: TradeResource, net: number, stock: number): void => {
        const score = (net < 0 ? -net * 6 : 0) + (stock < 10 ? 10 - stock : 0);
        if (score > 0) needs.push({ resource, score });
    };
    consider("raw", chain.rates.raw, nation.raw);
    consider("food", chain.rates.food, nation.food);
    consider("strategic", chain.rates.strategic, nation.strategic);
    consider("industry", chain.rates.industryNet, nation.industry);
    if (!needs.length) return;
    needs.sort((a, b) => b.score - a.score || a.resource.localeCompare(b.resource));
    const need = needs[0].resource;
    const partners = state.nations
        .filter((other) => other.alive && other.id !== nationId && !isAtWar(state, nationId, other.id)
            && (other.id !== 0 || state.winner === null))
        .sort((a, b) => {
            const aa = isVassalOf(state, a.id, nationId) || inSameAlliance(state, a.id, nationId) ? 1 : 0;
            const ba = isVassalOf(state, b.id, nationId) || inSameAlliance(state, b.id, nationId) ? 1 : 0;
            return ba - aa || partnerAvailable(state, b.id, need) - partnerAvailable(state, a.id, need) || a.id - b.id;
        });
    const partner = partners.find((other) => partnerAvailable(state, other.id, need) >= 15);
    if (!partner) return;

    const monthly = 2.5;
    const supplierValue = monthly * TRADE_AGREEMENT_DAYS * RESOURCE_WEIGHT[need] * 1.4;
    const funds = Math.ceil(supplierValue);
    let offer: TradeOffer;
    if (nation.funds >= funds + 20) {
        offer = {
            kind: "purchase",
            give: [{ resource: "funds", amount: funds, cadence: "fixed" }],
            receive: [{ resource: need, amount: monthly, cadence: "monthly" }],
        };
    } else {
        offer = {
            kind: "aid",
            give: [],
            receive: [{ resource: need, amount: 20, cadence: "fixed" }],
        };
    }
    if (partner.id === 0) {
        const request = createDiplomaticRequest(state, "trade", nationId, partner.id, {
            tradeKind: offer.kind, tradeGive: offer.give, tradeReceive: offer.receive,
        });
        if (request) {
            core.log(t("game.trade.proposedToPlayer", { nation: core.nationChip(nationId), player: core.nationChip(0) }), "diplo", nationId);
            core.emit({ type: "state" });
        }
        return;
    }
    if (tradeOfferIssue(state, nationId, offer, partner.id)) return;
    if (decideTrade(state, partner.id, nationId, offer).accepts) {
        signTrade(core, nationId, partner.id, offer);
    }
}