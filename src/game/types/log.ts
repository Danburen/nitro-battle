/** Log entries, their structured event payloads and battle reports. */

export type LogTone = "info" | "combat" | "capture" | "econ" | "diplo" | "system";

export type BattleOutcome = "ongoing" | "repelled" | "captured";

/** One resolved battle round, kept on the log so the feed can digest multi-day battles. */
export interface BattleReport {
    readonly attacker: number;
    readonly defender: number;
    readonly rounds: number;
    readonly attackLoss: number;
    readonly defenseLoss: number;
    /** Battle-to-date casualties; capture reports use these so the result line is not just the last round. */
    readonly totalAttackLoss?: number;
    readonly totalDefenseLoss?: number;
    readonly breach: boolean;
    readonly outcome: BattleOutcome;
}

export type LogEventKind = "capture" | "battle-round" | "production" | "season" | "war" | "peace" | "annex" | "global" | "claim";

export interface LogItemCount {
    readonly label: string;
    readonly count: number;
}

/** Structured payload behind a log line; the feed aggregates these instead of raw text. */
export interface LogEvent {
    readonly kind: LogEventKind;
    readonly nation?: number;
    /** Controller before the capture; lets the report tell whose state was lost. */
    readonly previousOwner?: number;
    readonly site?: number;
    readonly province?: string;
    readonly stateName?: string;
    readonly stateFlipped?: boolean;
    readonly battle?: BattleReport;
    readonly action?: "train" | "build" | "deploy";
    readonly stage?: "start" | "done";
    readonly items?: readonly LogItemCount[];
    readonly places?: readonly string[];
    readonly season?: string;
}

export interface LogEntry {
    readonly day: number;
    readonly text: string;
    readonly tone: LogTone;
    readonly nationId: number;
    /** State-changing events worth surfacing in the live battle feed. */
    readonly major?: boolean;
    readonly event?: LogEvent;
}

export interface GameStats {
    battles: number;
    captures: number;
    recruited: number;
    losses: number;
}
