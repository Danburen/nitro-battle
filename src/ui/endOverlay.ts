import type { GameEngine } from "../game/engine.ts";
import type { SoundManager } from "../audio.ts";
import { nationProvinceCount } from "../game/rules.ts";

/** Victory / defeat overlay with campaign statistics. */
export function showEndOverlay(engine: GameEngine, sound: SoundManager, winner: number): void {
    const el = document.querySelector<HTMLElement>("#end-overlay") as HTMLElement;
    const state = engine.state;
    const won = winner >= 0;
    sound.play(won ? "victory" : "defeat");
    const stats = [
        ["历时", `${state.day} 天`],
        ["占领", `${state.stats.captures} 省`],
        ["会战", `${state.stats.battles} 次`],
        ["部署", `${state.stats.recruited} 团`],
        ["损失", `${state.stats.losses} 团`],
        ["领土", `${nationProvinceCount(state, 0)} 省`],
    ].map(([label, value]) => `<div class="end-stat"><dt>${label}</dt><dd>${value}</dd></div>`).join("");

    el.innerHTML = `
        <div class="end-card ${won ? "won" : "lost"}">
            <div class="end-badge">${won ? "★" : "✕"}</div>
            <h2>${won ? "战役胜利" : "战役失败"}</h2>
            <p>${won
                ? "所有敌方首都均已攻克，蔚蓝联邦统一了这片大陆。"
                : "首都陷落，蔚蓝联邦的旗帜从大陆上消失了。"}</p>
            <dl class="end-stats">${stats}</dl>
            <div class="end-actions">
                <button class="btn btn-primary btn-lg" data-end="restart">再来一局</button>
                <button class="btn btn-lg" data-end="menu">返回主菜单</button>
            </div>
        </div>`;
    el.classList.remove("hidden");
}