import type { GameEngine } from "../game/engine.ts";
import { t } from "../i18n/index.ts";
import { defaultHint } from "./layout.ts";
import { setGameHtml, setGameText } from "./text.ts";

const COMMAND_HINT = t("misc.modeBar.commandHint");

/** Bottom-center bar: strategic redeploy targeting, or the mode-aware hint line. */
export function renderModeBar(engine: GameEngine, modeBar: HTMLElement, hintEl: HTMLElement, commandMode: boolean): void {
    const state = engine.state;
    const armyId = state.redeployArmyId;
    const active = armyId !== null;
    modeBar.classList.toggle("hidden", !active);
    hintEl.classList.toggle("hidden", active);
    if (!active) {
        setGameHtml(modeBar, "");
        setGameText(hintEl, commandMode ? COMMAND_HINT : defaultHint(), "plain");
        return;
    }
    const army = state.armies.get(armyId);
    setGameHtml(modeBar, `
        <div class="mode-text">
            <b>${army?.name ?? t("misc.common.army")} ${t("misc.modeBar.redeploy")}</b>
            <span>${t("misc.modeBar.redeployHint", { org: 20 })}</span>
        </div>
        <div class="mode-actions">
            <button class="btn btn-sm" data-action="redeploy-cancel">${t("misc.common.cancel")} <kbd>Esc</kbd></button>
        </div>`);
}