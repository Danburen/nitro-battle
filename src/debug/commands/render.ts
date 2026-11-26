import type { CommandRegistry } from "../registry.ts";
import type { DebugContext } from "../types.ts";
import { requireEngine, requireRenderer } from "../helpers.ts";

export function registerRenderCommands(registry: CommandRegistry<DebugContext>): void {
    registry.register({
        name: "camera",
        usage: "camera <省份索引|capital|fit>",
        help: "把镜头移到指定位置",
        run(args, ctx) {
            const renderer = requireRenderer(ctx);
            const target = args[0]?.toLowerCase();
            if (target === "fit") renderer.fitMap();
            else if (target === "capital" || target === undefined) renderer.centerOnCapital();
            else {
                const site = Number(target);
                if (!Number.isInteger(site) || site < 0 || site >= requireEngine(ctx).state.provinces.length) {
                    throw new Error("省份索引无效");
                }
                renderer.centerOnSite(site);
            }
            return "镜头已移动";
        },
    });

    registry.register({
        name: "zoom",
        usage: "zoom <in|out>",
        help: "缩放地图",
        run(args, ctx) {
            const renderer = requireRenderer(ctx);
            const direction = args[0]?.toLowerCase();
            if (direction === "in") renderer.zoomBy(1.3);
            else if (direction === "out") renderer.zoomBy(1 / 1.3);
            else throw new Error("方向只能是 in 或 out");
            return `已缩放：${direction}`;
        },
    });

    registry.register({
        name: "claims",
        usage: "claims <on|off>",
        help: "切换地图上的宣称覆盖层",
        run(args, ctx) {
            const on = args[0]?.toLowerCase() === "on";
            requireRenderer(ctx).setClaimsOverlay(on);
            return `宣称覆盖层：${on ? "开" : "关"}`;
        },
    });

    registry.register({
        name: "highlight",
        usage: "highlight <国家ID|off>",
        help: "高亮某国疆域，off 取消",
        run(args, ctx) {
            const raw = args[0]?.toLowerCase();
            const nation = raw === undefined || raw === "off" ? null : Number(raw);
            if (nation !== null && !Number.isInteger(nation)) throw new Error("国家 ID 无效");
            requireRenderer(ctx).setNationHighlight(nation);
            return `高亮：${nation ?? "无"}`;
        },
    });
}
