import type { GameEngine } from "../../game/engine.ts";
import type { EngineEvent } from "../../game/types/events.ts";

export interface DebugEventEntry {
    readonly day: number;
    readonly event: EngineEvent;
}

const EVENT_CAP = 240;

/** Ring buffer for transient engine events, rebound whenever a new game starts. */
export class DebugEventLog {
    private readonly entries: DebugEventEntry[] = [];
    private unsubscribe: (() => void) | null = null;

    attach(engine: GameEngine): void {
        this.unsubscribe?.();
        this.unsubscribe = engine.subscribe((event) => {
            this.entries.push({ day: engine.state.day, event });
            if (this.entries.length > EVENT_CAP) this.entries.shift();
        });
    }

    tail(count: number): readonly DebugEventEntry[] {
        return this.entries.slice(-Math.max(1, Math.min(count, EVENT_CAP)));
    }

    clear(): void {
        this.entries.length = 0;
    }
}
