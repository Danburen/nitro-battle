import type { GameEngine } from "../game/engine.ts";
import { DEFAULT_HINT } from "./layout.ts";

const COMMAND_HINT = "点击军团徽标切换部队 · 点击脚下地块查看地区 · 蓝色地块移动／红色地块进攻 · Esc / 右键取消";

/** Bottom-center bar: strategic redeploy targeting, or the mode-aware hint line. */
export function renderModeBar(engine: GameEngine, modeBar: HTMLElement, hintEl: HTMLElement, commandMode: boolean): void {
    const state = engine.state;
    const armyId = state.redeployArmyId;
    const active = armyId !== null;
    modeBar.classList.toggle("hidden", !active);
    hintEl.classList.toggle("hidden", active);
    if (!active) {
        modeBar.innerHTML = "";
        hintEl.textContent = commandMode ? COMMAND_HINT : DEFAULT_HINT;
        return;
    }
    const army = state.armies.get(armyId);
    modeBar.innerHTML = `
        <div class="mode-text">
            <b>${army?.name ?? "军团"} 战略转移</b>
            <span>点击绿色省份完成转移 · 组织度降至 20 · 本回合结束</span>
        </div>
        <div class="mode-actions">
            <button class="btn btn-sm" data-action="redeploy-cancel">取消 <kbd>Esc</kbd></button>
        </div>`;
}