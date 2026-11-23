/** Shape of an AI willingness judgment; constructors live in `game/decision.ts`. */

/** One reason in an AI willingness judgment; `sign` is the only tint the UI needs. */
export interface DecisionFactor {
    readonly sign: 1 | -1;
    readonly label: string;
}

/** Qualitative tone only — never a probability. Green verdicts imply acceptance. */
export type DecisionVerdict = "sure" | "likely" | "maybe" | "unlikely" | "refuse";

/** Shared result of an AI acceptance judgment: one boolean for the request path, reasons for the tooltip. */
export interface DiplomaticDecision {
    readonly accepts: boolean;
    readonly factors: readonly DecisionFactor[];
    readonly verdict: DecisionVerdict;
}
