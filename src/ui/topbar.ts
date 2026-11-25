import type { GameEngine } from "../game/engine.ts";
import type { SoundManager } from "../audio/index.ts";
import type { GameState } from "../game/types/state.ts";
import { resourceBreakdown, resourceRates } from "../game/economy.ts";
import { DIPLOMATIC_PROFILES } from "../game/diplomacy.ts";
import { policySwitchUpkeep } from "../game/policy.ts";
import { stabilityManpower, stabilityPolitics, stabilityProduction } from "../game/stability.ts";
import { vassalsOf } from "../game/access.ts";
import { VASSAL_HELP_BODY } from "../game/vassal.ts";
import { POLICY_SWITCH_COST, POLICY_SWITCH_DAYS } from "../game/types/policy.ts";
import { FOOD_SURPLUS_RATIO, MANPOWER_PER_POINT, PP_CAP } from "../game/types/economy.ts";
import { DAYS_PER_SEASON, SEASONS } from "../game/types/world.ts";
import { nationOverviewBody, nationStats } from "./nation-info.ts";
import { vassalIndependenceIcon, vassalTypeIcon } from "./vassal.ts";
import { compactNumber, escapeHtml, peopleCount, renderGameText, setGameText, signedCompact, textToken } from "./text.ts";
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
    private readonly resFunds = document.querySelector<HTMLElement>("#res-funds") as HTMLElement;
    private readonly resManpower = document.querySelector<HTMLElement>("#res-manpower") as HTMLElement;
    private readonly resIndustry = document.querySelector<HTMLElement>("#res-industry") as HTMLElement;
    private readonly resRaw = document.querySelector<HTMLElement>("#res-raw") as HTMLElement;
    private readonly resFood = document.querySelector<HTMLElement>("#res-food") as HTMLElement;
    private readonly resStrategic = document.querySelector<HTMLElement>("#res-strategic") as HTMLElement;
    private readonly resPp = document.querySelector<HTMLElement>("#res-pp") as HTMLElement;
    private readonly resStability = document.querySelector<HTMLElement>("#res-stability") as HTMLElement;
    private readonly countryName = document.querySelector<HTMLElement>("#top-country-name") as HTMLElement;
    private readonly countryFlag = document.querySelector<HTMLElement>("#top-country-flag") as HTMLElement;
    private readonly countryLabel = document.querySelector<HTMLElement>("#top-country-label") as HTMLElement;
    private readonly vassals = document.querySelector<HTMLElement>("#top-vassals") as HTMLElement;
    private readonly vassalsTrigger = document.querySelector<HTMLButtonElement>("#top-vassals-trigger") as HTMLButtonElement;
    private readonly vassalsSummary = document.querySelector<HTMLElement>("#top-vassals-summary") as HTMLElement;
    private readonly vassalsMenu = document.querySelector<HTMLElement>("#top-vassals-menu") as HTMLElement;
    private vassalsOpen = false;
    private readonly resizeObserver: ResizeObserver;

    constructor(engine: GameEngine, sound: SoundManager, toast: (text: string) => void) {
        this.engine = engine;
        this.sound = sound;
        this.toast = toast;
        for (const element of [this.resStability, this.resFunds, this.resManpower, this.resIndustry, this.resRaw, this.resFood, this.resStrategic, this.resPp]) {
            element.innerHTML = "<span></span><i></i>";
            element.tabIndex = 0;
        }
        this.setSoundIcon();
        this.vassalsTrigger.addEventListener("click", this.onVassalsToggle);
        document.addEventListener("pointerdown", this.onVassalsOutside, true);
        const bar = document.querySelector<HTMLElement>(".top-bar")!;
        this.resizeObserver = new ResizeObserver(() => {
            document.querySelector<HTMLElement>("#hud")!.style.setProperty("--hud-top", `${Math.ceil(bar.getBoundingClientRect().height) + 10}px`);
        });
        this.resizeObserver.observe(bar);
    }

    destroy(): void {
        this.resizeObserver.disconnect();
        this.vassalsTrigger.removeEventListener("click", this.onVassalsToggle);
        document.removeEventListener("pointerdown", this.onVassalsOutside, true);
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
        const season = SEASONS[state.seasonIndex];
        setGameText(this.dayPill, `第 ${textToken("turn", state.day)}`);
        this.dayPill.dataset.tooltipTitle = "[[turn]]";
        this.dayPill.dataset.tooltipBody = `当前为第 ${textToken("turn", state.day)}，${season.name}${state.seasonIndex === 3 ? "（积雪减速）" : ""}。
每 ${DAYS_PER_SEASON} [[turn]]更替季节；冬季积雪提高[[movement]]成本。

点击「结束[[turn]]」或按 E 推进 ${textToken("turn", 1)}：先结算[[raw]]/[[food]]/[[strategic]]产出与短缺，再更新库存、人口、恢复、施工、行军与会战。`;

        const fmt = (value: number): string => (Math.round(value * 10) / 10).toString();
        const signed = (value: number): string => `${value >= 0 ? "+" : ""}${fmt(value)}`;
        const policyBonus = (mult: number): string => {
            const percent = Math.round((mult - 1) * 100);
            return `政策加成 ${percent > 0 ? "+" : ""}${percent}%`;
        };
        const net = Math.round(rates.fundsNet);
        const snap = detail.stability;
        const economyFactor = stabilityProduction(player);
        const adminBonus = Math.min(15, 1.5 * snap.admin);
        const occupiedPenalty = Math.min(10, 0.3 * snap.occupiedProvinces);
        const foodStance = snap.food > 0 ? `盈余 +5` : snap.food < 0 ? `短缺 -10` : "持平 0";
        // Only occupied land drags stability; a nation ruling its own cores sees no line.
        const occupiedLine = snap.occupiedProvinces > 0
            ? `\n[[occupation]] -${occupiedPenalty.toFixed(1)}（${snap.occupiedProvinces} 个非核心省，上限 -10）`
            : "";
        this.renderResource(this.resStability, "stability", Math.round(snap.value), `→${Math.round(snap.target)}`);
        this.resStability.dataset.tooltipTitle = "[[stability]]";
        this.resStability.dataset.tooltipBody = `当前 [[stability:${Math.round(snap.value)}]] / 100，每日最多变动 1.2，向目标 [[stability:${Math.round(snap.target)}]] 靠拢。
构成：
基础 +55
[[admin]] +${adminBonus.toFixed(1)}（上限 +15）
战争 -${5 * snap.wars}
兵役 ${snap.conscription >= 0 ? "+" : ""}${snap.conscription}${occupiedLine}
[[food]] ${foodStance}

效果：
[[funds]]/[[industry]]/[[raw]]/[[strategic]]/[[food]] ×${economyFactor.toFixed(2)}
[[politics]] ×${stabilityPolitics(player).toFixed(2)}
[[manpower]]补充 ×${stabilityManpower(player).toFixed(2)}

宣战双方下降，议和回升；长期战争、占领区过多与缺粮都会压低目标。`;
        this.renderResource(this.resFunds, "funds", Math.floor(player.funds), signedCompact(net));
        this.resFunds.dataset.tooltipTitle = "[[funds]]";
        this.resFunds.dataset.tooltipBody = `省份产值 [[funds:${signed(detail.funds.provinces)}]]/[[turn]]
[[farm]] [[funds:${signed(detail.funds.farms)}]]/[[turn]]
[[production]][[factory]] [[funds:${signed(detail.funds.factories)}]]/[[turn]]
[[infrastructure]]加成 [[funds:${signed(detail.funds.infrastructure)}]]/[[turn]]
${policyBonus(detail.funds.policyMult)}
[[stability]]修正 ×${economyFactor.toFixed(2)}

军团维护 [[funds:-${fmt(detail.funds.upkeep)}]]/[[turn]]
净收入 [[funds:${signed(detail.funds.net)}]]/[[turn]]

城市省份税收全额计入，非城市省份只按两成计入；占领省再按[[occupation]]效率折算，[[occupation]]政策影响占领省税收。`;
        const intake = rates.manpower;
        const sharePercent = Math.round(detail.manpower.share * 1000) / 10;
        this.renderResource(this.resManpower, "manpower", Math.floor(player.manpower), signedCompact(intake));
        this.resManpower.dataset.tooltipTitle = "[[manpower]]储备";
        this.resManpower.dataset.tooltipBody = `可招募比例 ${sharePercent}%（由兵役政策决定）
适役人口上限 [[manpower:${Math.round(detail.manpower.cap)}]]（约 ${peopleCount(detail.manpower.cap * MANPOWER_PER_POINT)} 人）
当前储备 [[manpower:${Math.floor(player.manpower)}]]
每日补充 [[manpower:${signed(intake)}]]
[[stability]]修正 ×${stabilityManpower(player).toFixed(2)}

各省人口先按核心（全额）或占领（0.1 × [[occupation]]）折算，再乘可招募比例。
补充不会超过适役上限；训练与补员消耗储备，稳定度越低补充越慢。`;
        this.renderResource(this.resIndustry, "industry", Math.floor(player.industry), `+${compactNumber(rates.industryNet)}`);
        this.resIndustry.dataset.tooltipTitle = "[[industry]]储备";
        this.resIndustry.dataset.tooltipBody = `每[[turn]]产出 [[industry:${signed(detail.industry.total)}]]
城市 [[industry:${signed(detail.industry.cities)}]]
[[production]][[factory]] [[industry:${signed(detail.industry.factories)}]]
[[infrastructure]]加成 [[industry:${signed(detail.industry.infrastructure)}]]
${policyBonus(detail.industry.policyMult)}
[[stability]]修正 ×${economyFactor.toFixed(2)}
军团维护 [[industry:-${fmt(detail.chain.industryArmyUse)}]]/[[turn]]

上限 [[industry:${Math.round(detail.industry.cap)}]]（随城市数量变化）
[[production]][[factory]]产量受来源州[[infrastructure]]影响。
${detail.chain.industryFactor < 1 ? `\n[[raw]]短缺 本日[[industry]]产量 ${Math.round((detail.chain.industryFactor - 1) * 100)}%` : ""}`;

        const chain = detail.chain;
        const rawFlow = chain.raw;
        this.renderResource(this.resRaw, "raw", Math.floor(player.raw), signedCompact(rates.raw));
        this.resRaw.dataset.tooltipTitle = "[[raw]]储备";
        this.resRaw.dataset.tooltipBody = `[[raw]]矿产出 [[raw:${signed(rawFlow.mines)}]]/[[turn]]
[[production]][[factory]]消耗 [[raw:-${fmt(rawFlow.factoryUse)}]]/[[turn]]
净变化 [[raw:${signed(rawFlow.net)}]]/[[turn]]
矿产受来源省[[infrastructure]]（基础 60%，每级 +10%）与[[occupation]]影响；缺[[food]]时矿产最多 -99%。
上限 [[raw:${rawFlow.cap}]]。`;

        const foodFlow = chain.food;
        this.renderResource(this.resFood, "food", Math.floor(player.food), signedCompact(rates.food));
        this.resFood.dataset.tooltipTitle = "[[food]]储备";
        this.resFood.dataset.tooltipBody = `每[[turn]]产出 [[food:${signed(foodFlow.gross)}]]
省份 [[food:${signed(foodFlow.provinces)}]]
[[farm]] [[food:${signed(foodFlow.farms)}]]
[[stability]]修正 ×${economyFactor.toFixed(2)}
人口消耗 [[food:-${fmt(foodFlow.consumption - foodFlow.armyUse)}]]
军团口粮 [[food:-${fmt(foodFlow.armyUse)}]]
净变化 [[food:${signed(foodFlow.net)}]]/[[turn]]
${foodFlow.shortage ? "短缺：人口缓慢减少、[[stability]]下降，矿产降低。" : foodFlow.surplus ? `盈余：人口增长 +${Math.round(foodFlow.surplusBonus * 100)}%，[[stability]]目标 +5。` : `粮食充足；人口增长随余粮比例变化，净盈余超过产量的 ${Math.round(FOOD_SURPLUS_RATIO * 100)}% 时额外 +20%。`}
上限 [[food:${foodFlow.cap}]]。`;

        const strategicFlow = chain.strategic;
        this.renderResource(this.resStrategic, "strategic", Math.floor(player.strategic), signedCompact(rates.strategic));
        this.resStrategic.dataset.tooltipTitle = "[[strategic]]储备";
        this.resStrategic.dataset.tooltipBody = `[[strategic]]矿产出 [[strategic:${signed(strategicFlow.mines)}]]/[[turn]]
[[production]][[factory]]消耗 [[strategic:-${fmt(strategicFlow.factoryUse)}]]/[[turn]]
军团维护消耗 [[strategic:-${fmt(strategicFlow.armyUse)}]]/[[turn]]
净变化 [[strategic:${signed(strategicFlow.net)}]]/[[turn]]
${strategicFlow.shortage ? "短缺：全军[[organization]]每日下降。" : "储备充足。"}
上限 [[strategic:${strategicFlow.cap}]]。`;

        this.renderResource(this.resPp, "politics", Math.floor(player.politicalPower), `+${compactNumber(Math.round(rates.politicalPower))}`);
        const diplomaticUpkeep = state.diplomaticActions
            .filter((action) => action.nation === 0)
            .reduce((sum, action) => sum + DIPLOMATIC_PROFILES[action.kind].upkeep, 0);
        const switchUpkeep = policySwitchUpkeep(player);
        this.resPp.dataset.tooltipTitle = "[[politics]]";
        this.resPp.dataset.tooltipBody = `每[[turn]] [[politics:+${fmt(detail.political.total)}]]
基础 [[politics:+${detail.political.base}]]
[[admin]] [[politics:+${detail.political.admin}]]
政策修正 [[politics:${detail.political.policy}]]
[[stability]]修正 ×${detail.political.stability.toFixed(2)}
${diplomaticUpkeep > 0 ? `外交项目维护 [[politics:-${diplomaticUpkeep}]]/[[turn]]\n` : ""}${switchUpkeep > 0 ? `政策切换维护 [[politics:-${switchUpkeep}]]/[[turn]]\n` : ""}
上限 [[politics:${PP_CAP}]]。切换政策先付 [[politics:${POLICY_SWITCH_COST}]]，进行中每[[turn]]维护，需 ${textToken("turn", POLICY_SWITCH_DAYS)}完成。`;

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