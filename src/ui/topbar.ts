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
import { DAYS_PER_SEASON } from "../game/types/world.ts";
import { t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/index.ts";
import { nationOverviewBody, nationStats } from "./nation-info.ts";
import { vassalIndependenceIcon, vassalTypeIcon } from "./vassal.ts";
import { compactNumber, peopleCount, gameText, setGameText, signedCompact, setGameHtml, game, html, rawHtml } from "./text.ts";
import type { TextKey } from "./text.ts";
import { nationFlagHtmlFor } from "./flags.ts";
import { helpButton } from "./panel.ts";
import { tooltipAttrs } from "./tooltip.ts";

const SOUND_ON_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 4.5 4.5H2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h2.5L8 14.5a.5.5 0 0 0 .8-.4V1.9a.5.5 0 0 0-.8-.4Z"/><path d="M10.5 5a3.5 3.5 0 0 1 0 6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M12.3 3a6 6 0 0 1 0 10" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;
const SOUND_OFF_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 4.5 4.5H2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h2.5L8 14.5a.5.5 0 0 0 .8-.4V1.9a.5.5 0 0 0-.8-.4Z"/><path d="m10.5 6 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const SEASON_KEYS: readonly MessageKey[] = [
    "ui.season.spring", "ui.season.summer", "ui.season.autumn", "ui.season.winter",
];

/** Overlord dropdown: one compact row per vassal, icons carry the full contract. */
function vassalMenuHtml(state: GameState): string {
    const vassals = vassalsOf(state, 0);
    if (vassals.length === 0) return html`<p class="top-vassals-note">${t("ui.topbar.vassals.empty")}</p>`;
    const rows = vassals.map((id) => {
        const name = state.nations[id].name;
        return html`
        <button type="button" class="top-vassals-row" role="menuitem" data-action="vassal-goto" data-nation="${id}"
            ${rawHtml(tooltipAttrs(t("ui.topbar.vassals.view"), t("ui.topbar.vassals.openDiplo", { name })))}>
            ${rawHtml(nationFlagHtmlFor(state, id, 22))}
            <span class="top-vassals-row-name">${name}</span>
            ${rawHtml(vassalTypeIcon(state, id))}
            <span class="top-vassals-row-ind">${t("ui.topbar.vassals.independence")}</span>
            ${rawHtml(vassalIndependenceIcon(state, id))}
        </button>`;
    }).join("");
    return html`<div class="top-vassals-head"><b>${t("ui.topbar.vassals.head")}</b><span class="status-pill ready">${t("ui.topbar.vassals.count", { count: vassals.length })}</span>
            ${rawHtml(helpButton({ title: t("ui.topbar.vassals.helpTitle"), body: VASSAL_HELP_BODY }))}</div>
        <p class="top-vassals-note">${t("ui.topbar.vassals.note")}</p>
        ${rawHtml(rows)}`;
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
            setGameHtml(element, "<span></span><i></i>");
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
        if (this.vassalsOpen) setGameHtml(this.vassalsMenu, vassalMenuHtml(this.engine.state));
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
        setGameText(element.firstElementChild as HTMLElement, game`[[${key}:${amount}]]`);
        const delta = element.lastElementChild as HTMLElement;
        setGameText(delta, change);
        const plain = gameText(change, "plain");
        delta.classList.toggle("neg", plain.startsWith("-"));
        delta.classList.toggle("zero", /^[+-]?0(?:\.0+)?(?:\/.*)?$/.test(plain));
    }

    render(): void {
        const state = this.engine.state;
        const player = state.nations[0];
        setGameHtml(this.countryFlag, nationFlagHtmlFor(state, 0, 22));
        setGameText(this.countryLabel, player.name, "plain");
        this.countryName.dataset.tooltipTitle = player.name;
        this.countryName.dataset.tooltipHtml = nationOverviewBody(state, nationStats(state, 0));
        this.countryName.setAttribute("aria-label", t("ui.topbar.country.ariaLabel", { name: player.name }));
        // Only an overlord keeps the "附庸 N 个附庸" dropdown. A vassal's contract
        // lives in the country hover, and a lone independent shows nothing.
        const vassals = vassalsOf(state, 0);
        this.vassals.classList.toggle("hidden", vassals.length === 0);
        setGameText(this.vassalsSummary, t("ui.topbar.vassals.count", { count: vassals.length }), "plain");
        if (vassals.length === 0 && this.vassalsOpen) this.closeCountryMenu();
        if (this.vassalsOpen) setGameHtml(this.vassalsMenu, vassalMenuHtml(state));
        const rates = resourceRates(state, 0);
        const detail = resourceBreakdown(state, 0);
        setGameText(this.dayPill, t("ui.topbar.day.label", { day: state.day }));
        this.dayPill.dataset.tooltipTitle = "[[turn]]";
        this.dayPill.dataset.tooltipBody = t("ui.topbar.turn.body", {
            day: state.day,
            season: t(SEASON_KEYS[state.seasonIndex] ?? "ui.season.spring"),
            winterNote: state.seasonIndex === 3 ? t("ui.topbar.turn.winterNote") : "",
            daysPerSeason: DAYS_PER_SEASON,
        });

        const fmt = (value: number): string => (Math.round(value * 10) / 10).toString();
        const signed = (value: number): string => `${value >= 0 ? "+" : ""}${fmt(value)}`;
        const policyPercent = (mult: number): string => {
            const percent = Math.round((mult - 1) * 100);
            return `${percent > 0 ? "+" : ""}${percent}%`;
        };
        const net = Math.round(rates.fundsNet);
        const snap = detail.stability;
        const economyFactor = stabilityProduction(player);
        const adminBonus = Math.min(15, 1.5 * snap.admin);
        const occupiedPenalty = Math.min(10, 0.3 * snap.occupiedProvinces);
        const foodStance = snap.food > 0 ? t("ui.topbar.stability.foodSurplus")
            : snap.food < 0 ? t("ui.topbar.stability.foodShortage")
            : t("ui.topbar.stability.foodBalance");
        // Only occupied land drags stability; a nation ruling its own cores sees no line.
        const occupiedLine = snap.occupiedProvinces > 0
            ? t("ui.topbar.stability.occupiedLine", {
                penalty: occupiedPenalty.toFixed(1),
                count: snap.occupiedProvinces,
            })
            : "";
        this.renderResource(this.resStability, "stability", Math.round(snap.value), `→${Math.round(snap.target)}`);
        this.resStability.dataset.tooltipTitle = "[[stability]]";
        this.resStability.dataset.tooltipBody = t("ui.topbar.stability.body", {
            value: Math.round(snap.value),
            target: Math.round(snap.target),
            adminBonus: adminBonus.toFixed(1),
            war: 5 * snap.wars,
            conscription: `${snap.conscription >= 0 ? "+" : ""}${snap.conscription}`,
            occupiedLine,
            foodStance,
            economyFactor: economyFactor.toFixed(2),
            politicsFactor: stabilityPolitics(player).toFixed(2),
            manpowerFactor: stabilityManpower(player).toFixed(2),
        });
        this.renderResource(this.resFunds, "funds", Math.floor(player.funds), signedCompact(net));
        this.resFunds.dataset.tooltipTitle = "[[funds]]";
        this.resFunds.dataset.tooltipBody = t("ui.topbar.funds.body", {
            provinces: signed(detail.funds.provinces),
            farms: signed(detail.funds.farms),
            factories: signed(detail.funds.factories),
            infrastructure: signed(detail.funds.infrastructure),
            policyBonus: policyPercent(detail.funds.policyMult),
            stabilityFactor: economyFactor.toFixed(2),
            upkeep: fmt(detail.funds.upkeep),
            net: signed(detail.funds.net),
        });
        const intake = rates.manpower;
        const sharePercent = Math.round(detail.manpower.share * 1000) / 10;
        this.renderResource(this.resManpower, "manpower", Math.floor(player.manpower), signedCompact(intake));
        this.resManpower.dataset.tooltipTitle = t("ui.topbar.tip.reserve", { token: "manpower" });
        this.resManpower.dataset.tooltipBody = t("ui.topbar.manpower.body", {
            sharePercent,
            cap: Math.round(detail.manpower.cap),
            people: peopleCount(detail.manpower.cap * MANPOWER_PER_POINT),
            stock: Math.floor(player.manpower),
            intake: signed(intake),
            stabilityFactor: stabilityManpower(player).toFixed(2),
        });
        this.renderResource(this.resIndustry, "industry", Math.floor(player.industry), `+${compactNumber(rates.industryNet)}`);
        this.resIndustry.dataset.tooltipTitle = t("ui.topbar.tip.reserve", { token: "industry" });
        this.resIndustry.dataset.tooltipBody = t("ui.topbar.industry.body", {
            total: signed(detail.industry.total),
            cities: signed(detail.industry.cities),
            factories: signed(detail.industry.factories),
            infrastructure: signed(detail.industry.infrastructure),
            policyBonus: policyPercent(detail.industry.policyMult),
            stabilityFactor: economyFactor.toFixed(2),
            upkeep: fmt(detail.chain.industryArmyUse),
            cap: Math.round(detail.industry.cap),
            shortageLine: detail.chain.industryFactor < 1
                ? t("ui.topbar.industry.shortageLine", {
                    percent: Math.round((detail.chain.industryFactor - 1) * 100),
                })
                : "",
        });

        const chain = detail.chain;
        const rawFlow = chain.raw;
        this.renderResource(this.resRaw, "raw", Math.floor(player.raw), signedCompact(rates.raw));
        this.resRaw.dataset.tooltipTitle = t("ui.topbar.tip.reserve", { token: "raw" });
        this.resRaw.dataset.tooltipBody = t("ui.topbar.raw.body", {
            mines: signed(rawFlow.mines),
            factoryUse: fmt(rawFlow.factoryUse),
            net: signed(rawFlow.net),
            cap: rawFlow.cap,
        });

        const foodFlow = chain.food;
        this.renderResource(this.resFood, "food", Math.floor(player.food), signedCompact(rates.food));
        this.resFood.dataset.tooltipTitle = t("ui.topbar.tip.reserve", { token: "food" });
        this.resFood.dataset.tooltipBody = t("ui.topbar.food.body", {
            gross: signed(foodFlow.gross),
            provinces: signed(foodFlow.provinces),
            farms: signed(foodFlow.farms),
            stabilityFactor: economyFactor.toFixed(2),
            consumption: fmt(foodFlow.consumption - foodFlow.armyUse),
            armyUse: fmt(foodFlow.armyUse),
            net: signed(foodFlow.net),
            status: foodFlow.shortage
                ? t("ui.topbar.food.shortage")
                : foodFlow.surplus
                    ? t("ui.topbar.food.surplus", { bonus: Math.round(foodFlow.surplusBonus * 100) })
                    : t("ui.topbar.food.balanced", { ratio: Math.round(FOOD_SURPLUS_RATIO * 100) }),
            cap: foodFlow.cap,
        });

        const strategicFlow = chain.strategic;
        this.renderResource(this.resStrategic, "strategic", Math.floor(player.strategic), signedCompact(rates.strategic));
        this.resStrategic.dataset.tooltipTitle = t("ui.topbar.tip.reserve", { token: "strategic" });
        this.resStrategic.dataset.tooltipBody = t("ui.topbar.strategic.body", {
            mines: signed(strategicFlow.mines),
            factoryUse: fmt(strategicFlow.factoryUse),
            armyUse: fmt(strategicFlow.armyUse),
            net: signed(strategicFlow.net),
            status: strategicFlow.shortage
                ? t("ui.topbar.strategic.shortage")
                : t("ui.topbar.strategic.surplus"),
            cap: strategicFlow.cap,
        });

        this.renderResource(this.resPp, "politics", Math.floor(player.politicalPower), `+${compactNumber(Math.round(rates.politicalPower))}`);
        const diplomaticUpkeep = state.diplomaticActions
            .filter((action) => action.nation === 0)
            .reduce((sum, action) => sum + DIPLOMATIC_PROFILES[action.kind].upkeep, 0);
        const switchUpkeep = policySwitchUpkeep(player);
        this.resPp.dataset.tooltipTitle = "[[politics]]";
        this.resPp.dataset.tooltipBody = t("ui.topbar.politics.body", {
            total: fmt(detail.political.total),
            base: detail.political.base,
            admin: detail.political.admin,
            policy: detail.political.policy,
            stabilityFactor: detail.political.stability.toFixed(2),
            diploUpkeep: diplomaticUpkeep > 0
                ? t("ui.topbar.politics.diploUpkeep", { amount: diplomaticUpkeep })
                : "",
            switchUpkeep: switchUpkeep > 0
                ? t("ui.topbar.politics.switchUpkeep", { amount: switchUpkeep })
                : "",
            cap: PP_CAP,
            switchCost: POLICY_SWITCH_COST,
            switchDays: POLICY_SWITCH_DAYS,
        });

        this.endTurnBtn.disabled = state.winner !== null;
        this.setSoundIcon();
    }

    toggleSound(): void {
        const muted = this.sound.toggle();
        this.setSoundIcon();
        this.toast(muted ? t("ui.topbar.sound.off") : t("ui.topbar.sound.on"));
    }

    setSoundIcon(): void {
        setGameHtml(this.soundBtn, this.sound.muted ? SOUND_OFF_ICON : SOUND_ON_ICON);
        this.soundBtn.setAttribute("aria-label", this.sound.muted ? t("ui.topbar.sound.enable") : t("ui.topbar.sound.disable"));
        this.soundBtn.classList.toggle("muted", this.sound.muted);
    }
}