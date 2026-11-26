import type { GameEngine } from "../game/engine.ts";
import type { MapRenderer } from "../render/renderer.ts";
import type { GameUI } from "../ui/index.ts";
import type { GameSettings } from "../types/settings.ts";
import type { DebugRunResult } from "./registry.ts";
import type { DebugEventLog } from "./services/eventLog.ts";
import type { DebugJournal } from "./services/journal.ts";

/** Services and app-level hooks that debug commands are allowed to touch. */
export interface DebugContext {
    readonly engine: GameEngine | null;
    readonly renderer: MapRenderer | null;
    readonly ui: GameUI | null;
    readonly events: DebugEventLog;
    readonly journal: DebugJournal;
    /** Skip every overlay and start a campaign directly. */
    newGame(settings: GameSettings, nation?: number): void;
    /** Reuse the real canvas click router without needing screen coordinates. */
    tapSite(site: number): void;
    openGuide(): void;
}

/** Stable surface used by the terminal view and by Playwright. */
export interface DebugBridge {
    run(line: string): DebugRunResult;
    help(): readonly string[];
    history(): readonly string[];
}

export interface NitroDebugHandle {
    readonly engine: GameEngine | null;
    readonly renderer: MapRenderer | null;
    readonly ui: GameUI | null;
    readonly debug: DebugBridge;
}

declare global {
    interface Window {
        __nitro?: NitroDebugHandle;
    }
}
