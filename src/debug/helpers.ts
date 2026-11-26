import type { GameEngine } from "../game/engine.ts";
import type { MapRenderer } from "../render/renderer.ts";
import type { GameUI } from "../ui/index.ts";
import type { DebugContext } from "./types.ts";

export function requireEngine(ctx: DebugContext): GameEngine {
    if (!ctx.engine) throw new Error("尚无战局，请先执行 new");
    return ctx.engine;
}

export function requireUI(ctx: DebugContext): GameUI {
    if (!ctx.ui) throw new Error("UI 尚未装配");
    return ctx.ui;
}

export function requireRenderer(ctx: DebugContext): MapRenderer {
    if (!ctx.renderer) throw new Error("渲染器尚未装配");
    return ctx.renderer;
}
