import type { GameEngine } from "../game/engine.ts";
import type { SoundManager } from "../audio/index.ts";
import { nationProvinceCount } from "../game/rules.ts";
import { t } from "../i18n/index.ts";
import { gameText, setGameHtml, game } from "./text.ts";

/** Victory / defeat overlay with campaign statistics. */
export function showEndOverlay(engine: GameEngine, sound: SoundManager, winner: number): void {
    const el = document.querySelector<HTMLElement>("#end-overlay") as HTMLElement;
    const state = engine.state;
    const won = winner >= 0;
    sound.play(won ? "victory" : "defeat");
    const stats = [
        [t("misc.endOverlay.stat.duration"), gameText(game`[[turn:${state.day}]]`)],
        [t("misc.endOverlay.stat.captured"), t("misc.endOverlay.count.provinces", { count: state.stats.captures })],
        [t("misc.endOverlay.stat.battles"), t("misc.endOverlay.count.times", { count: state.stats.battles })],
        [t("misc.endOverlay.stat.deployed"), t("misc.endOverlay.count.regiments", { count: state.stats.recruited })],
        [t("misc.endOverlay.stat.losses"), t("misc.endOverlay.count.regiments", { count: state.stats.losses })],
        [t("misc.endOverlay.stat.territory"), t("misc.endOverlay.count.provinces", { count: nationProvinceCount(state, 0) })],
    ].map(([label, value]) => `<div class="end-stat"><dt>${label}</dt><dd>${value}</dd></div>`).join("");

    setGameHtml(el, `
        <div class="end-card ${won ? "won" : "lost"}">
            <div class="end-badge">${won ? "★" : "✕"}</div>
            <h2>${won ? t("misc.endOverlay.victory") : t("misc.endOverlay.defeat")}</h2>
            <p>${won
                ? t("misc.endOverlay.victoryDesc")
                : t("misc.endOverlay.defeatDesc")}</p>
            <dl class="end-stats">${stats}</dl>
            <div class="end-actions">
                <button class="btn btn-primary btn-lg" data-end="restart">${t("misc.endOverlay.restart")}</button>
                <button class="btn btn-lg" data-end="menu">${t("misc.endOverlay.menu")}</button>
            </div>
        </div>`);
    el.classList.remove("hidden");
}