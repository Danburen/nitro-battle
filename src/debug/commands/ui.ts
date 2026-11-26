import type { CommandRegistry } from "../registry.ts";
import { parseOptions } from "../registry.ts";
import type { DebugContext } from "../types.ts";
import type { TabId } from "../../ui/context.ts";
import { getLocale, isLocale, setLocale } from "../../i18n/index.ts";
import { requireUI } from "../helpers.ts";

const PANELS: readonly TabId[] = ["deploy", "construction", "policy", "diplomacy", "trade", "expansion"];

export function registerUICommands(registry: CommandRegistry<DebugContext>): void {
    registry.register({
        name: "panel",
        usage: "panel <deploy|construction|policy|diplomacy|trade|expansion|armies> [nation=2] [declare] [manage] [kind=farm] [site=12]",
        help: "唤起面板及常见子状态；子动作复用真实 UI 分发路径",
        run(args, ctx) {
            const ui = requireUI(ctx);
            const panel = args[0]?.toLowerCase();
            const options = parseOptions(args.slice(1));
            const flags = new Set(args.slice(1));

            if (panel === "armies") {
                ui.dispatchAction("army-toggle");
                return "已切换军团列表展开状态";
            }
            if (!panel || !PANELS.includes(panel as TabId)) throw new Error(`未知面板：${panel ?? "空"}`);
            ui.openPanel(panel as TabId);

            if (options.nation !== undefined) {
                if (panel === "trade") ui.dispatchAction("trade-goto", { nation: options.nation });
                else if (panel === "diplomacy") ui.dispatchAction("diplo-target", { nation: options.nation });
                else if (panel === "expansion" && options.state !== undefined) {
                    ui.dispatchAction("claim-focus", { state: options.state });
                }
            }
            if (flags.has("declare")) {
                if (options.nation === undefined) throw new Error("declare 需要 nation=<国家ID>");
                ui.dispatchAction("declare-open", { nation: options.nation });
            }
            if (flags.has("manage")) ui.dispatchAction("claim-manage");
            if (options.kind !== undefined) ui.dispatchAction("construction-kind", { kind: options.kind });
            if (options.site !== undefined) {
                ui.dispatchAction("construction-jump", { site: options.site, mode: options.mode ?? "province" });
            }
            return `已打开面板 ${panel}`;
        },
    });

    registry.register({
        name: "map",
        usage: "map <province|state>",
        help: "切换省份/州地图模式",
        run(args, ctx) {
            const mode = args[0]?.toLowerCase();
            if (mode !== "province" && mode !== "state") throw new Error("地图模式只能是 province 或 state");
            requireUI(ctx).dispatchAction("map-mode", { mode });
            return `地图模式：${mode}`;
        },
    });

    registry.register({
        name: "color",
        usage: "color <gradient|uniform|resource>",
        help: "切换地图染色模式",
        run(args, ctx) {
            const color = args[0]?.toLowerCase();
            if (color !== "gradient" && color !== "uniform" && color !== "resource") {
                throw new Error("染色模式只能是 gradient / uniform / resource");
            }
            requireUI(ctx).dispatchAction("color-mode", { color });
            return `染色模式：${color}`;
        },
    });

    registry.register({
        name: "dock",
        usage: "dock [expand|collapse]",
        help: "展开或收起左侧面板",
        run(args, ctx) {
            const ui = requireUI(ctx);
            const target = args[0]?.toLowerCase();
            if (target === "expand") ui.dispatchAction("dock-expand");
            else if (target === "collapse") ui.dispatchAction("dock-collapse");
            else ui.dispatchAction("dock-toggle");
            return "面板布局已更新";
        },
    });

    registry.register({
        name: "guide",
        usage: "guide",
        help: "打开作战手册",
        run(_args, ctx) {
            ctx.openGuide();
            return "作战手册已打开";
        },
    });

    registry.register({
        name: "lang",
        usage: "lang <zh-CN|en-US>",
        help: "切换界面语言并立即刷新 UI",
        run(args, ctx) {
            const requested = args[0];
            if (!requested) return `当前语言：${getLocale()}`;
            const match = ["zh-CN", "en-US"].find((locale) => locale.toLowerCase() === requested.toLowerCase());
            if (!match || !isLocale(match)) throw new Error(`未知语言：${requested}（可用：zh-CN / en-US）`);
            setLocale(match);
            requireUI(ctx).refresh();
            return `语言已切换：${getLocale()}`;
        },
    });
}
