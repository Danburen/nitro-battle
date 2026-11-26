import type { GameEngine } from "../game/engine.ts";
import { NEUTRAL } from "../game/types/world.ts";
import type { Nation } from "../game/types/entities.ts";
import { t } from "../i18n/index.ts";
import { escapeHtml, setGameHtml } from "./text.ts";
import { NationPanel } from "./panels/nation.ts";
import { nationFlagHtmlFor } from "./flags.ts";

const BRIEF_TIP = t("misc.briefing.tip");

export interface BriefingHooks {
    /** Highlight the nation's borders; the camera stays where the player put it. */
    inspect(nationId: number): void;
    /** Commit the current selection and start the campaign. */
    start(nationId: number): void;
}

/** Pre-game nation picker: map + one nation panel, everything else hidden. */
export class Briefing {
    private readonly engine: GameEngine;
    private readonly hooks: BriefingHooks;
    private readonly panel: NationPanel;
    private readonly el = document.querySelector<HTMLElement>("#brief-panel") as HTMLElement;
    private readonly hud = document.querySelector<HTMLElement>("#hud") as HTMLElement;
    private readonly shell = document.querySelector<HTMLElement>(".game-shell") as HTMLElement;
    private readonly endTurnBtn = document.querySelector<HTMLButtonElement>("#btn-endturn") as HTMLButtonElement;
    private readonly hintEl = document.querySelector<HTMLElement>("#brief-start-hint") as HTMLElement;
    private active = false;
    private selected: number | null = null;

    constructor(engine: GameEngine, hooks: BriefingHooks) {
        this.engine = engine;
        this.hooks = hooks;
        this.panel = new NationPanel(engine, this.el, {
            help: { title: t("misc.briefing.title"), body: BRIEF_TIP },
            footer: t("misc.briefing.footer"),
        });
    }

    isActive(): boolean {
        return this.active;
    }

    start(nationId: number): void {
        this.active = true;
        this.hud.classList.add("briefing-mode");
        this.shell.classList.add("briefing-mode");
        setGameHtml(this.endTurnBtn, `${t("misc.common.startGame")} <kbd>E</kbd>`);
        this.el.classList.remove("hidden");
        this.hintEl.classList.remove("hidden");
        this.selectNation(nationId);
    }

    finish(): void {
        if (!this.active) return;
        const nationId = this.selected ?? 0;
        this.close();
        this.hooks.start(nationId);
    }

    destroy(): void {
        this.close();
        this.selected = null;
    }

    /** Clicking the map in briefing mode inspects whichever nation controls that province. */
    showSite(site: number): void {
        const province = this.engine.state.provinces[site];
        if (!province) return;
        if (province.owner === NEUTRAL) {
            this.panel.showNeutral();
            return;
        }
        this.selectNation(province.owner);
    }

    /** Select a nation for the campaign: highlight its borders and refresh the summary. */
    selectNation(nationId: number): void {
        if (!this.active) return;
        const nation = this.engine.state.nations[nationId];
        if (!nation) return;
        this.selected = nationId;
        this.panel.show(nationId);
        this.renderHint(nation);
        this.hooks.inspect(nationId);
    }

    private renderHint(nation: Nation): void {
        setGameHtml(this.hintEl, `<span>${t("misc.briefing.hintBefore")}<b>${nationFlagHtmlFor(this.engine.state, nation.id, 18)}${escapeHtml(nation.name)}</b>${t("misc.briefing.hintAfter")}</span>`);
    }

    private close(): void {
        this.active = false;
        this.hud.classList.remove("briefing-mode");
        this.shell.classList.remove("briefing-mode");
        setGameHtml(this.endTurnBtn, `${t("misc.common.endTurn")} <kbd>E</kbd>`);
        this.hintEl.classList.add("hidden");
        setGameHtml(this.hintEl, "");
        this.el.classList.add("hidden");
        this.panel.destroy();
    }
}
