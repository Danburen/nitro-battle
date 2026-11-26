import type { CommandRegistry } from "../registry.ts";
import { parseOptions } from "../registry.ts";
import type { DebugContext } from "../types.ts";
import type { GameSettings } from "../../types/settings.ts";
import { mapSizeForCells } from "../../types/settings.ts";

function numberFrom(value: string | undefined, fallback: number): number {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function settingsFrom(options: Record<string, string>): GameSettings {
    const cells = clamp(numberFrom(options.cells, 600), 200, 4000);
    return {
        seed: numberFrom(options.seed, 42) >>> 0,
        mapSize: mapSizeForCells(cells),
        nationCount: clamp(numberFrom(options.nations, 4), 2, 12),
        mapCells: cells,
        balanceNations: options.balance === "on" || options.balance === "true",
    };
}

/** `?debug=1&seed=42&cells=600&nations=4&nation=0` starts a campaign on load. */
export function readLaunchSettings(): { settings: GameSettings; nation: number } | null {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") !== "1") return null;
    const options: Record<string, string> = {};
    for (const key of ["seed", "cells", "nations", "nation", "balance"] as const) {
        const value = params.get(key);
        if (value !== null) options[key] = value;
    }
    return { settings: settingsFrom(options), nation: clamp(numberFrom(options.nation, 0), 0, 11) };
}

export function registerWorldCommands(registry: CommandRegistry<DebugContext>): void {
    registry.register({
        name: "new",
        usage: "new [seed=42] [cells=600] [nations=4] [nation=0] [balance=off]",
        help: "跳过所有遮罩，按指定种子直接生成并进入战役",
        run(args, ctx) {
            const options = parseOptions(args);
            const settings = settingsFrom(options);
            const nation = clamp(numberFrom(options.nation, 0), 0, 11);
            ctx.newGame(settings, nation);
            return `新战局已就绪 · 种子 ${settings.seed} · ${settings.mapCells} 省 · ${settings.nationCount} 国 · 玩家 ${nation}`;
        },
    });
}
