import type { GameEngine } from "../game/engine.ts";
import type { SoundManager } from "../audio/index.ts";
import type { GameState } from "../game/types.ts";
import { factoryTotals, resourceBreakdown, resourceRates } from "../game/economy.ts";
import { DIPLOMATIC_PROFILES } from "../game/diplomacy.ts";
import { policySwitchUpkeep } from "../game/policy.ts";
import { vassalsOf } from "../game/access.ts";
import { VASSAL_HELP_BODY } from "../game/vassal.ts";
import { POLICY_SWITCH_COST, POLICY_SWITCH_DAYS, PP_CAP, SEASONS } from "../game/types.ts";
import { nationOverviewBody, nationStats } from "./nation-info.ts";
import { vassalIndependenceIcon, vassalTypeIcon } from "./vassal.ts";
import { escapeHtml, renderGameText, setGameText, textToken } from "./text.ts";
import type { TextKey } from "./text.ts";
import { nationFlagHtmlFor } from "./flags.ts";
import { helpButton } from "./panel.ts";
import { tooltipAttrs } from "./tooltip.ts";

const SOUND_ON_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 4.5 4.5H2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h2.5L8 14.5a.5.5 0 0 0 .8-.4V1.9a.5.5 0 0 0-.8-.4Z"/><path d="M10.5 5a3.5 3.5 0 0 1 0 6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M12.3 3a6 6 0 0 1 0 10" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;
const SOUND_OFF_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 4.5 4.5H2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h2.5L8 14.5a.5.5 0 0 0 .8-.4V1.9a.5.5 0 0 0-.8-.4Z"/><path d="m10.5 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/** Overlord dropdown: one compact row per vassal, icons carry the full contract. */
function vassalMenuHtml(state: GameState): string {
    const vassals = vassalsOf(state, 0);
    if (vassals.length === 0) return '<p class="top-vassals-note">当前没有附庸国。</p>';
    const rows = vassals.map((id) => `
        <button type="button" class="top-vassals-row" role="menuitem" data-action="vassal-goto" data-nation="${id}"
            ${tooltipAttrs("查看附庸国", `打开外交页并选中 ${state.nations[id].name}`)}>
            ${nationFlagHtmlFor(state, id, 22)}
            <span class="top-vassals-row-name">${escapeHtml(state.nations[id].name)}</span>
            ${vassalTypeIcon(state, id)}
            <span class="top-vassals-row-ind">独立性</span>
            ${vassalIndependenceIcon(state, id)}
        </button>`).join("");
    return `<div class="top-vassals-head"><b>附庸</b><span class="status-pill ready">${vassals.length} 个附庸</span>
            ${helpButton({ title: "附庸制度", body: VASSAL_HELP_BODY })}</div>
        <p class="top-vassals-note">你对所有附庸拥有通行权，并会在它们遭到攻击时履行保护义务。</p>
        ${rows}`;
}

/** Top resource bar: country name, date, season, resources, end-turn and sound buttons. */
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
    private readonly countryName = document.querySelector<HTMLElement>("#top-country-name") as HTMLElement;
    private readonly countryFlag = document.querySelector<HTMLElement>("#top-country-flag") as HTMLElement;
    private readonly countryLabel = document.querySelector<HTMLElement>("#top-country-label") as HTMLElement;
    private readonly vassals = document.querySelector<HTMLElement>("#top-vassals") as HTMLElement;
    private readonly vassalsTrigger = document.querySelector<HTMLButtonElement>("#top-vassals-trigger") as HTMLButtonElement;
    private readonly vassalsSummary = document.querySelector<HTMLElement>("#top-vassals-summary") as HTMLElement;
    private readonly vassalsMenu = document.querySelector<HTMLElement>("#top-vassals-menu") as HTMLElement;
    private readonly allocation = document.querySelector<HTMLElement>("#factory-allocation")!;
    private readonly production = document.querySelector<HTMLInputElement>("#factory-production")!;
    private lastWheel = -Infinity;
    private vassalsOpen = false;
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
        this.vassalsTrigger.addEventListener("click", this.onVassalsToggle);
        document.addEventListener("pointerdown", this.onVassalsOutside, true);
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
        this.vassalsTrigger.removeEventListener("click", this.onVassalsToggle);
        document.removeEventListener("pointerdown", this.onVassalsOutside, true);
        this.allocation.removeEventListener("wheel", this.onWheel);
        this.allocation.removeEventListener("click", this.onFactoryClick);
        this.production.removeEventListener("input", this.onFactoryInput);
    }

    private readonly onVassalsToggle = (): void => {
        // Only an overlord has vassals to list in the dropdown.
        if (this.vassals.classList.contains("hidden")) return;
        this.vassalsOpen = !this.vassalsOpen;
        if (this.vassalsOpen) this.vassalsMenu.innerHTML = vassalMenuHtml(this.engine.state);
        this.syncVassalsMenu();
        this.sound.play("select");
    };

    private readonly onVassalsOutside = (event: PointerEvent): void => {
        if (this.vassalsOpen && !this.vassals.contains(event.target as Node)) this.closeCountryMenu();
    };

    private syncVassalsMenu(): void {
        this.vassals.classList.toggle("open", this.vassalsOpen);
        this.vassalsMenu.classList.toggle("hidden", !this.vassalsOpen);
        this.vassalsTrigger.setAttribute("aria-expanded", String(this.vassalsOpen));
    }

    closeCountryMenu(): void {
        if (!this.vassalsOpen) return;
        this.vassalsOpen = false;
        this.syncVassalsMenu();
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
        setGameText(delta, change);
        const plain = renderGameText(change, "plain");
        delta.classList.toggle("neg", plain.startsWith("-"));
        delta.classList.toggle("zero", /^[+-]?0(?:\.0+)?(?:\/.*)?$/.test(plain));
    }

    render(): void {
        const state = this.engine.state;
        const player = state.nations[0];
        this.countryFlag.innerHTML = nationFlagHtmlFor(state, 0, 22);
        this.countryLabel.textContent = player.name;
        this.countryName.dataset.tooltipTitle = player.name;
        this.countryName.dataset.tooltipHtml = nationOverviewBody(state, nationStats(state, 0));
        this.countryName.setAttribute("aria-label", `${player.name} · 本国概况`);
        // Only an overlord keeps the "附庸 N 个附庸" dropdown. A vassal's contract
        // lives in the country hover, and a lone independent shows nothing.
        const vassals = vassalsOf(state, 0);
        this.vassals.classList.toggle("hidden", vassals.length === 0);
        this.vassalsSummary.textContent = `${vassals.length} 个附庸`;
        if (vassals.length === 0 && this.vassalsOpen) this.closeCountryMenu();
        if (this.vassalsOpen) this.vassalsMenu.innerHTML = vassalMenuHtml(state);
        const rates = resourceRates(state, 0);
        const detail = resourceBreakdown(state, 0);
        setGameText(this.dayPill, `第 ${textToken("turn", state.day)}`);
        this.dayPill.dataset.tooltipTitle = "[[turn]]";
        this.dayPill.dataset.tooltipBody = `当前为第 ${textToken("turn", state.day)}。\n点击「结束[[turn]]」或按 E 推进 ${textToken("turn", 1)}：结算收入、恢复、施工、行军与会战。`;
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
        this.renderResource(this.resFunds, "funds", Math.floor(player.funds), `${net >= 0 ? "+" : ""}${net}/[[turn]]`);
        this.resFunds.dataset.tooltipTitle = "[[funds]]";
        this.resFunds.dataset.tooltipBody = `省份产值 [[funds:${signed(detail.funds.provinces)}]]/[[turn]]
[[farm]] [[funds:${signed(detail.funds.farms)}]]/[[turn]]
[[production]][[factory]] [[funds:${signed(detail.funds.factories)}]]/[[turn]]
[[infrastructure]]加成 [[funds:${signed(detail.funds.infrastructure)}]]/[[turn]]
${policyBonus(detail.funds.policyMult)}

军团维护 [[funds:-${fmt(detail.funds.upkeep)}]]/[[turn]]
净收入 [[funds:${signed(detail.funds.net)}]]/[[turn]]

占领省按[[occupation]]效率折算；[[occupation]]政策影响占领省税收。`;
        this.renderResource(this.resManpower, "manpower", Math.floor(player.manpower), `+${rates.manpower.toFixed(1)}`);
        this.resManpower.dataset.tooltipTitle = "[[manpower]]储备";
        this.resManpower.dataset.tooltipBody = `每[[turn]]征募 [[manpower:${signed(detail.manpower.total)}]]
省份人口 [[manpower:${signed(detail.manpower.population)}]]
[[farm]] [[manpower:${signed(detail.manpower.farms)}]]
${policyBonus(detail.manpower.policyMult)}

上限 [[manpower:${Math.round(detail.manpower.cap)}]]（随人口与[[occupation]]变化）`;
        this.renderResource(this.resIndustry, "industry", Math.floor(player.industry), `+${rates.industry.toFixed(1)}`);
        this.resIndustry.dataset.tooltipTitle = "[[industry]]储备";
        this.resIndustry.dataset.tooltipBody = `每[[turn]]产出 [[industry:${signed(detail.industry.total)}]]
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
        this.resPp.dataset.tooltipBody = `每[[turn]] [[politics:+${fmt(detail.political.total)}]]
基础 [[politics:+${detail.political.base}]]
[[admin]] [[politics:+${detail.political.admin}]]
政策修正 [[politics:${detail.political.policy}]]
${diplomaticUpkeep > 0 ? `外交项目维护 [[politics:-${diplomaticUpkeep}]]/[[turn]]\n` : ""}${switchUpkeep > 0 ? `政策切换维护 [[politics:-${switchUpkeep}]]/[[turn]]\n` : ""}
上限 [[politics:${PP_CAP}]]。切换政策先付 [[politics:${POLICY_SWITCH_COST}]]，进行中每[[turn]]维护，需 ${textToken("turn", POLICY_SWITCH_DAYS)}完成。`;

        const factories = factoryTotals(state, 0);
        this.production.max = String(factories.total);
        this.production.value = String(factories.prod);
        this.production.disabled = state.winner !== null || factories.total === 0;
        this.production.setAttribute("aria-valuetext", `生产 ${factories.prod}，闲置 ${factories.idle}`);
        this.production.style.setProperty("--production-share", `${factories.total ? factories.prod / factories.total * 100 : 0}%`);
        document.querySelector("#factory-prod")!.textContent = String(factories.prod);
        document.querySelector("#factory-idle")!.textContent = String(factories.idle);
        this.allocation.dataset.tooltipTitle = "全国[[factory]]调配";
        this.allocation.dataset.tooltipBody = `[[production]] ${factories.prod} · [[idle]] ${factories.idle} · 总计 ${factories.total}\n\n滚轮向上：转为[[production]]；向下：转为[[idle]]。\n也可拖动滑杆、按方向键或使用两侧 − / +。\n\n[[production]][[factory]]产出[[funds]]与[[industry]]；[[idle]][[factory]]按队列顺序投入施工，每项至多 5 座，每厂基础 [[construction:0.5]]/[[turn]]。\n产出同时受来源州[[infrastructure]]影响，施工再乘目标州速度；优先把高产能工厂分配给生产。\n无[[idle]][[factory]]时，施工暂停。`;
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