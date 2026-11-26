export interface DebugJournalEntry {
    readonly day: number;
    readonly line: string;
}

const JOURNAL_CAP = 200;

/** Command history with game-day stamps, useful as a seed + replay journal. */
export class DebugJournal {
    private readonly entries: DebugJournalEntry[] = [];

    record(day: number, line: string): void {
        this.entries.push({ day, line });
        if (this.entries.length > JOURNAL_CAP) this.entries.shift();
    }

    tail(count: number): readonly DebugJournalEntry[] {
        return this.entries.slice(-Math.max(1, Math.min(count, JOURNAL_CAP)));
    }

    clear(): void {
        this.entries.length = 0;
    }
}
