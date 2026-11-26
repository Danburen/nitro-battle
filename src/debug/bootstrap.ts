import { CommandRegistry } from "./registry.ts";
import type { DebugBridge, DebugContext } from "./types.ts";
import { registerWorldCommands } from "./commands/world.ts";
import { registerGameCommands } from "./commands/game.ts";
import { registerUICommands } from "./commands/ui.ts";
import { registerRenderCommands } from "./commands/render.ts";

export interface DebugInstall {
    readonly registry: CommandRegistry<DebugContext>;
    readonly bridge: DebugBridge;
}

/** One registry, many consumers: terminal, Playwright bridge and URL launcher. */
export function createDebug(ctx: DebugContext): DebugInstall {
    const registry = new CommandRegistry<DebugContext>();
    registerWorldCommands(registry);
    registerGameCommands(registry);
    registerUICommands(registry);
    registerRenderCommands(registry);

    const bridge: DebugBridge = {
        run(line) {
            const result = registry.run(line, ctx);
            if (result.ok && line.trim()) ctx.journal.record(ctx.engine?.state.day ?? 0, line.trim());
            return result;
        },
        help: () => registry.help(),
        history: () => registry.history(),
    };
    return { registry, bridge };
}
