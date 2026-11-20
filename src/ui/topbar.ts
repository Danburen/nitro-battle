import type { GameEngine } from "../game/engine.ts";
import type { SoundManager } from "../audio.ts";
import { factoryTotals, resourceRates } from "../game/economy.ts";
import { POLICY_SWITCH_COST, SEASONS } from "../game/types.ts";
import { setGameText, textToken } from "./text.ts";
import type { TextKey } from "./text.ts";

const SOUND_ON_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 4.5 4.5H2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h2.5L8 14.5a.5.5 0 0 0 .8-.4V1.9a.5.5 0 0 0-.8-.4Z"/><path d="M10.5 5a3.5 3.5 0 0 1 0 6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M12.3 3a6 6 0 0 1 0 10" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;
const SOUND_OFF_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 4.5 4.5H2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h2.5L8 14.5a.5.5 0 0 0 .8-.4V1.9a.5.5 0 0 0-.8-.4Z"/><path d="m10.5 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/** Top resource bar: date, season, four resources, end-turn and sound buttons. */
export class TopBar {
    readonly endTurnBtn = document.querySelector<HTMLButtonElement>("#btn-endturn") as HTMLButtonElement;
    readonly soundBtn = document.querySelector<HTMLButtonElement>("#btn-sound") as HTMLButtonElement;
    private readonly engine: GameEngine;
    private readonly sound: SoundManager;
    private readonly toast: (text: string) => void;
    private readonly dayPill = document.querySelector<HTMLElement>("#day-pill") as HTMLElement;
    private readonly seasonPill = document.querySelector<HTMLElement>("#season-pill") as HTMLElement;
    private readonly resFunds = document.querySelector<HTMLElement>("#res-funds") as HTMLElement;
    private readonly resManpower = document.querySelector<HTMLElement>("#res-manpower") as HTMLElement;
    private readonly resIndustry = document.querySelector<HTMLElement>("#res-industry") as HTMLElement;
    private readonly resPp = document.querySelector<HTMLElement>("#res-pp") as HTMLElement;
    private readonly allocation = document.querySelector<HTMLElement>("#factory-allocation")!;
    private readonly production = document.querySelector<HTMLInputElement>("#factory-production")!;
    private lastWheel = -Infinity;
    private readonly resizeObserver: ResizeObserver;

    constructor(engine: GameEngine, sound: SoundManager, toast: (text: string) => void) {
        this.engine = engine;
        this.sound = sound;
        this.toast = toast;
        for (const element of [this.resFunds, this.resManpower, this.resIndustry, this.resPp]) {
            element.innerHTML = "<span></span><i></i>";
            element.tabIndex = 0;
        }
        this.setSoundIcon();
        this.allocation.addEventListener("wheel", this.onWheel, { passive: false });
        this.allocation.addEventListener("click", this.onFactoryClick);
        this.production.addEventListener("input", this.onFactoryInput);
        const bar = this.allocation.closest<HTMLElement>(".top-bar")!;
        this.resizeObserver = new ResizeObserver(() => {
            document.querySelector<HTMLElement>("#hud")!.style.setProperty("--hud-top", `${Math.ceil(bar.getBoundingClientRect().height) + 10}px`);
        });
        this.resizeObserver.observe(bar);
    }

    destroy(): void {
        this.resizeObserver.disconnect();
        this.allocation.removeEventListener("wheel", this.onWheel);
        this.allocation.removeEventListener("click", this.onFactoryClick);
        this.production.removeEventListener("input", this.onFactoryInput);
    }

    private readonly onWheel = (event: WheelEvent): void => {
        if (event.ctrlKey || event.deltaY === 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.timeStamp - this.lastWheel < 90) return;
        this.lastWheel = event.timeStamp;
        this.shiftProduction(event.deltaY < 0 ? 1 : -1);
    };

    private readonly onFactoryClick = (event: MouseEvent): void => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-factory-step]");
        if (button && !button.disabled) this.shiftProduction(Number(button.dataset.factoryStep));
    };

    private readonly onFactoryInput = (): void => { this.engine.setFactoryProduction(Number(this.production.value)); };

    private shiftProduction(delta: number): void {
        this.engine.setFactoryProduction(factoryTotals(this.engine.state, 0).prod + delta);
    }

    private renderResource(element: HTMLElement, key: TextKey, amount: number, change: string): void {
        setGameText(element.firstElementChild as HTMLElement, textToken(key, amount));
        const delta = element.lastElementChild as HTMLElement;
        if (delta.textContent !== change) delta.textContent = change;
        delta.classList.toggle("neg", change.startsWith("-"));
        delta.classList.toggle("zero", /^[+-]?0(?:\.0+)?\//.test(change) || /^[+-]?0(?:\.0+)?$/.test(change));
    }

    render(): void {
        const state = this.engine.state;
        const player = state.nations[0];
        const rates = resourceRates(state, 0);
        this.dayPill.textContent = `第 ${state.day} 天`;
        const season = SEASONS[state.seasonIndex];
        this.seasonPill.textContent = state.seasonIndex === 3 ? `${season.name} · 积雪减速` : season.name;
        this.seasonPill.classList.toggle("winter", state.seasonIndex === 3);

        const net = Math.round(rates.fundsNet);
        this.renderResource(this.resFunds, "funds", Math.floor(player.funds), `${net >= 0 ? "+" : ""}${net}/天`);
        this.resFunds.dataset.tooltipTitle = "[[funds]]";
        this.resFunds.dataset.tooltipBody = `税收 [[funds:+${Math.round(rates.fundsGross)}]]/回合\n军团维护 [[funds:-${Math.round(rates.upkeep)}]]/回合`;
        this.renderResource(this.resManpower, "manpower", Math.floor(player.manpower), `+${rates.manpower.toFixed(1)}`);
        this.resManpower.dataset.tooltipTitle = "[[manpower]]储备";
        this.resManpower.dataset.tooltipBody = `上限 [[manpower:${Math.round(rates.manpowerCap)}]]（随人口与[[occupation]]变化）`;
        this.renderResource(this.resIndustry, "industry", Math.floor(player.industry), `+${rates.industry.toFixed(1)}`);
        this.resIndustry.dataset.tooltipTitle = "[[industry]]储备";
        this.resIndustry.dataset.tooltipBody = `上限 [[industry:${Math.round(rates.industryCap)}]]（随城市数量变化）\n[[production]][[factory]]产量受来源州[[infrastructure]]影响。`;
        this.renderResource(this.resPp, "politics", Math.floor(player.politicalPower), `+${rates.politicalPower.toFixed(0)}`);
        this.resPp.dataset.tooltipTitle = "[[politics]]";
        this.resPp.dataset.tooltipBody = `切换政策消耗 [[politics:${POLICY_SWITCH_COST}]]\n有效[[admin]]每座 [[politics:+1]]/回合。`;

        const factories = factoryTotals(state, 0);
        this.production.max = String(factories.total);
        this.production.value = String(factories.prod);
        this.production.disabled = state.winner !== null || factories.total === 0;
        this.production.setAttribute("aria-valuetext", `生产 ${factories.prod}，闲置 ${factories.idle}`);
        this.production.style.setProperty("--production-share", `${factories.total ? factories.prod / factories.total * 100 : 0}%`);
        document.querySelector("#factory-prod")!.textContent = String(factories.prod);
        document.querySelector("#factory-idle")!.textContent = String(factories.idle);
        this.allocation.dataset.tooltipTitle = "全国[[factory]]调配";
        this.allocation.dataset.tooltipBody = `[[production]] ${factories.prod} · [[idle]] ${factories.idle} · 总计 ${factories.total}\n\n滚轮向上：转为[[production]]；向下：转为[[idle]]。\n也可拖动滑杆、按方向键或使用两侧 − / +。\n\n[[production]][[factory]]产出[[funds]]与[[industry]]；[[idle]][[factory]]按队列顺序投入施工，每项至多 5 座，每厂基础 [[construction:0.5]]/回合。\n产出同时受来源州[[infrastructure]]影响，施工再乘目标州速度；优先把高产能工厂分配给生产。\n无[[idle]][[factory]]时，施工暂停。`;
        for (const button of this.allocation.querySelectorAll<HTMLButtonElement>("[data-factory-step]")) {
            button.disabled = state.winner !== null || (Number(button.dataset.factoryStep) > 0 ? factories.idle === 0 : factories.prod === 0);
        }
        this.endTurnBtn.disabled = state.winner !== null;
    }

    toggleSound(): void {
        const muted = this.sound.toggle();
        this.setSoundIcon();
        this.toast(muted ? "音效已关闭" : "音效已开启");
    }

    setSoundIcon(): void {
        this.soundBtn.innerHTML = this.sound.muted ? SOUND_OFF_ICON : SOUND_ON_ICON;
        this.soundBtn.setAttribute("aria-label", this.sound.muted ? "开启音效" : "关闭音效");
        this.soundBtn.classList.toggle("muted", this.sound.muted);
    }
}