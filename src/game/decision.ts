/**
 * Constructors for the shared `DiplomaticDecision` shape (defined in `types.ts`).
 * The execution path consumes `accepts`; tooltips render `factors` and `verdict`
 * from the same object, so a hover can never promise a different outcome.
 *
 * No probabilities, no hidden score — decisions stay deterministic.
 */
import type { DecisionFactor, DiplomaticDecision, DecisionVerdict } from "./types/decision.ts";

export function plus(label: string): DecisionFactor {
    return { sign: 1, label };
}

export function minus(label: string): DecisionFactor {
    return { sign: -1, label };
}

/** A hard veto: one negative reason, one unambiguous outcome. */
export function deny(label: string): DiplomaticDecision {
    return { accepts: false, factors: [minus(label)], verdict: "refuse" };
}

/** Green verdicts must imply acceptance; shared by UI colouring and tests. */
export function verdictAccepts(verdict: DecisionVerdict): boolean {
    return verdict === "sure" || verdict === "likely" || verdict === "maybe";
}
