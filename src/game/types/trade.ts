/** Trade treaties: what each side offers, how often, and how long the deal runs. */

/** Tradable resources. Funds and manpower are gated per treaty kind; political power is never tradable. */
export type TradeResource = "funds" | "manpower" | "industry" | "raw" | "food" | "strategic";

export type TradeKind = "exchange" | "purchase" | "mercenary" | "aid";

/** `monthly` repeats every turn for the treaty duration; `fixed` settles once at signing. */
export type TradeCadence = "monthly" | "fixed";

export interface TradeTransfer {
    readonly resource: TradeResource;
    readonly amount: number;
    readonly cadence: TradeCadence;
}

/** `give` flows from the proposer to the target; `receive` flows back. */
export interface TradeOffer {
    readonly kind: TradeKind;
    readonly give: readonly TradeTransfer[];
    readonly receive: readonly TradeTransfer[];
}

/** Signed recurring deal. Fixed transfers have already settled and are kept only for the record. */
export interface TradeAgreement {
    readonly id: number;
    readonly kind: TradeKind;
    readonly from: number;
    readonly to: number;
    readonly give: readonly TradeTransfer[];
    readonly receive: readonly TradeTransfer[];
    readonly startedDay: number;
    readonly expiresDay: number;
}