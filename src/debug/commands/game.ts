import type { CommandRegistry } from "../registry.ts";
import type { DebugContext } from "../types.ts";
import { requireEngine, requireUI } from "../helpers.ts";
import { snapshotState } from "../services/snapshot.ts";

function countArg(args: readonly string[], fallback: number): number {
    const raw = args[0];
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.trunc(parsed))) : fallback;
}

export function registerGameCommands(registry: CommandRegistry<DebugContext>): void {
    registry.register({
        name: "snapshot",
        usage: "snapshot",
        help: "输出可序列化的战局摘要（JSON）",
        run(_args, ctx) {
            return JSON.stringify(snapshotState(requireEngine(ctx).state), null, 2);
        },
    });

    registry.register({
        name: "turn",
        usage: "turn [天数=1]",
        help: "走真实回合入口，连续结束 N 个回合",
        run(args, ctx) {
            const engine = requireEngine(ctx);
            const ui = requireUI(ctx);
            const count = countArg(args, 1);
            let done = 0;
            for (let i = 0; i < count && engine.state.winner === null; i++) {
                ui.endTurn();
                done++;
            }
            return `已结束 ${done} 个回合 · 当前第 ${engine.state.day} 天${engine.state.winner !== null ? " · 战局已结束" : ""}`;
        },
    });

    registry.register({
        name: "click",
        usage: "click <省份索引>",
        help: "按省份索引走真实点击路由（等同玩家点地图）",
        run(args, ctx) {
            const site = Number(args[0]);
            if (!Number.isInteger(site) || site < 0 || site >= requireEngine(ctx).state.provinces.length) {
                throw new Error("省份索引无效");
            }
            ctx.tapSite(site);
            return `已点击省份 ${site}`;
        },
    });

    registry.register({
        name: "select",
        usage: "select <省份索引|off>",
        help: "直接选中省份（不改军团命令）",
        run(args, ctx) {
            const engine = requireEngine(ctx);
            if (args[0] === "off") engine.select(null);
            else {
                const site = Number(args[0]);
                if (!Number.isInteger(site) || site < 0 || site >= engine.state.provinces.length) throw new Error("省份索引无效");
                engine.select(site);
            }
            requireUI(ctx).refresh();
            return `选中：${engine.state.selected ?? "无"}`;
        },
    });

    registry.register({
        name: "army",
        usage: "army <军团ID>",
        help: "选中军团所在的省份",
        run(args, ctx) {
            const engine = requireEngine(ctx);
            const id = Number(args[0]);
            const army = engine.state.armies.get(id);
            if (!army) throw new Error("军团 ID 无效");
            engine.select(army.province);
            requireUI(ctx).refresh();
            return `已选中军团 ${id} 所在省份 ${army.province}`;
        },
    });

    registry.register({
        name: "armies",
        usage: "armies",
        help: "列出全部军团的简表",
        run(_args, ctx) {
            const state = requireEngine(ctx).state;
            const lines = [...state.armies.values()].map((army) =>
                `#${army.id} 国${army.nation} ${army.name} @${army.province} 团${army.regiments.length} 组织${army.org}`);
            return lines.length ? lines.join("\n") : "当前没有军团";
        },
    });

    registry.register({
        name: "war",
        usage: "war <国家ID>",
        help: "以玩家身份直接宣战（跳过外交确认）",
        run(args, ctx) {
            const engine = requireEngine(ctx);
            const id = Number(args[0]);
            if (!engine.declareWar(id)) throw new Error(`无法对 ${id} 宣战`);
            requireUI(ctx).refresh();
            return `已对 ${engine.state.nations[id]?.name ?? id} 宣战`;
        },
    });

    registry.register({
        name: "peace",
        usage: "peace <国家ID>",
        help: "向目标提出白和平",
        run(args, ctx) {
            const id = Number(args[0]);
            if (!requireEngine(ctx).proposePeace(id)) throw new Error(`无法与 ${id} 议和`);
            requireUI(ctx).refresh();
            return `已向 ${id} 提出白和平`;
        },
    });

    registry.register({
        name: "events",
        usage: "events [条数=20]",
        help: "查看最近的引擎事件（含游戏日）",
        run(args, ctx) {
            const entries = ctx.events.tail(countArg(args, 20));
            return entries.length
                ? entries.map((entry) => `D${entry.day} ${JSON.stringify(entry.event)}`).join("\n")
                : "暂无引擎事件";
        },
    });

    registry.register({
        name: "log",
        usage: "log [条数=20]",
        help: "查看战报日志尾部",
        run(args, ctx) {
            const entries = requireEngine(ctx).state.log.slice(-countArg(args, 20));
            return entries.length
                ? entries.map((entry) => `D${entry.day} [${entry.tone}] ${entry.text}`).join("\n")
                : "暂无战报";
        },
    });

    registry.register({
        name: "journal",
        usage: "journal [条数=20] | journal clear",
        help: "查看/清空调试指令日志（种子 + 指令回放的基础）",
        run(args, ctx) {
            if (args[0] === "clear") {
                ctx.journal.clear();
                return "指令日志已清空";
            }
            const entries = ctx.journal.tail(countArg(args, 20));
            return entries.length
                ? entries.map((entry) => `D${entry.day} ${entry.line}`).join("\n")
                : "暂无指令记录";
        },
    });
}
