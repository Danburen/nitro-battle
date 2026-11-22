import type { GameEngine } from "../game/engine.ts";
import type { SoundManager } from "../audio/index.ts";
import { factoryTotals, resourceBreakdown, resourceRates } from "../game/economy.ts";
import { DIPLOMATIC_PROFILES } from "../game/diplomacy.ts";
import { policySwitchUpkeep } from "../game/policy.ts";
import { POLICY_SWITCH_COST, POLICY_SWITCH_DAYS, PP_CAP, SEASONS } from "../game/types.ts";
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
        const detail = resourceBreakdown(state, 0);
        setGameText(this.dayPill, `第 ${textToken("days", state.day)}`);
        this.dayPill.dataset.tooltipTitle = "[[turn]]";
        this.dayPill.dataset.tooltipBody = `当前为第 ${textToken("days", state.day)}。\n点击「结束回合」或按 E 推进 ${textToken("turn", 1)}：结算收入、恢复、施工、行军与会战。`;
        const season = SEASONS[state.seasonIndex];
        this.seasonPill.textContent = state.seasonIndex === 3 ? `${season.name} · 积雪减速` : season.name;
        this.seasonPill.classList.toggle("winter", state.seasonIndex === 3);

        const fmt = (value: number): string => (Math.round(value * 10) / 10).toString();
        const signed = (value: number): string => `${value >= 0 ? "+" : ""}${fmt(value)}`;
        const policyBonus = (mult: number): string => {
            const percent = Math.round((mult - 1) * 100);
            return `政策加成 ${percent > 0 ? "+" : ""}${percent}%`;
        };
        const net = Math.round(rates.fundsNet);
        this.renderResource(this.resFunds, "funds", Math.floor(player.funds), `${net >= 0 ? "+" : ""}${net}/回合`);
        this.resFunds.dataset.tooltipTitle = "[[funds]]";
        this.resFunds.dataset.tooltipBody = `省份产值 [[funds:${signed(detail.funds.provinces)}]]/回合
[[farm]] [[funds:${signed(detail.funds.farms)}]]/回合
[[production]][[factory]] [[funds:${signed(detail.funds.factories)}]]/回合
[[infrastructure]]加成 [[funds:${signed(detail.funds.infrastructure)}]]/回合
${policyBonus(detail.funds.policyMult)}

军团维护 [[funds:-${fmt(detail.funds.upkeep)}]]/回合
净收入 [[funds:${signed(detail.funds.net)}]]/回合

占领省按[[occupation]]效率折算；[[occupation]]政策影响占领省税收。`;
        this.renderResource(this.resManpower, "manpower", Math.floor(player.manpower), `+${rates.manpower.toFixed(1)}`);
        this.resManpower.dataset.tooltipTitle = "[[manpower]]储备";
        this.resManpower.dataset.tooltipBody = `每日征募 [[manpower:${signed(detail.manpower.total)}]]
省份人口 [[manpower:${signed(detail.manpower.population)}]]
[[farm]] [[manpower:${signed(detail.manpower.farms)}]]
${policyBonus(detail.manpower.policyMult)}

上限 [[manpower:${Math.round(detail.manpower.cap)}]]（随人口与[[occupation]]变化）`;
        this.renderResource(this.resIndustry, "industry", Math.floor(player.industry), `+${rates.industry.toFixed(1)}`);
        this.resIndustry.dataset.tooltipTitle = "[[industry]]储备";
        this.resIndustry.dataset.tooltipBody = `每日产出 [[industry:${signed(detail.industry.total)}]]
城市 [[industry:${signed(detail.industry.cities)}]]
[[production]][[factory]] [[industry:${signed(detail.industry.factories)}]]
[[infrastructure]]加成 [[industry:${signed(detail.industry.infrastructure)}]]
${policyBonus(detail.industry.policyMult)}

上限 [[industry:${Math.round(detail.industry.cap)}]]（随城市数量变化）
[[production]][[factory]]产量受来源州[[infrastructure]]影响。`;
        this.renderResource(this.resPp, "politics", Math.floor(player.politicalPower), `+${rates.politicalPower.toFixed(0)}`);
        const diplomaticUpkeep = state.diplomaticActions
            .filter((action) => action.nation === 0)
            .reduce((sum, action) => sum + DIPLOMATIC_PROFILES[action.kind].upkeep, 0);
        const switchUpkeep = policySwitchUpkeep(player);
        this.resPp.dataset.tooltipTitle = "[[politics]]";
        this.resPp.dataset.tooltipBody = `每日 [[politics:+${fmt(detail.political.total)}]]
基础 [[politics:+${detail.political.base}]]
[[admin]] [[politics:+${detail.political.admin}]]
政策修正 [[politics:${detail.political.policy}]]
${diplomaticUpkeep > 0 ? `外交项目维护 [[politics:-${diplomaticUpkeep}]]/回合\n` : ""}${switchUpkeep > 0 ? `政策切换维护 [[politics:-${switchUpkeep}]]/回合\n` : ""}
上限 [[politics:${PP_CAP}]]。切换政策先付 [[politics:${POLICY_SWITCH_COST}]]，进行中每日维护，需 ${textToken("turn", POLICY_SWITCH_DAYS)}完成。`;

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