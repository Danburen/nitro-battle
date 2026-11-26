import type { GameEngine } from "../../game/engine.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { escapeHtml, setGameHtml } from "../text.ts";
import { PanelShell, panelHead } from "../panel.ts";
import type { HelpSpec } from "../panel.ts";
import { nationFlagHtmlFor } from "../flags.ts";
import { nationOverviewBody, emptyNationStats, nationStatSteps } from "../nation-info.ts";
import type { NationStats } from "../nation-info.ts";
import { runSlices } from "../slices.ts";
import { t } from "../../i18n/index.ts";

/**
 * Standalone nation overview panel.
 *
 * Stats are gathered lazily when the panel is shown (never on every game
 * refresh) and spread over animation frames, so opening a nation never blocks
 * a frame on large maps. The figures and rows come from the shared
 * `ui/nation-info.ts` module used by diplomacy and the topbar hover too.
 */

export interface NationPanelOptions {
    readonly help: HelpSpec;
    readonly footer?: string;
}

export class NationPanel {
    private readonly engine: GameEngine;
    private readonly shell: PanelShell;
    private readonly options: NationPanelOptions;
    private cancel: (() => void) | null = null;
    private token = 0;
    private nationId: number | null = null;

    constructor(engine: GameEngine, el: HTMLElement, options: NationPanelOptions) {
        this.engine = engine;
        this.shell = new PanelShell(el);
        this.options = options;
    }

    get selected(): number | null {
        return this.nationId;
    }

    /** Open the panel and start gathering this nation's statistics. */
    show(nationId: number): void {
        const nation = this.engine.state.nations[nationId];
        if (!nation) return;
        this.nationId = nationId;
        this.stop();
        this.shell.show();
        const displayColor = nationDisplayColor(this.engine.state, nationId);
        setGameHtml(this.shell.el, `${this.head(nation.name, displayColor)}
            <div class="panel-body brief-body">
                <div class="brief-title">${nationFlagHtmlFor(this.engine.state, nation.id, 30)}<span>${escapeHtml(nation.name)}</span></div>
                <p class="micro-hint">${t("panels.nation.loading")}</p>
            </div>`);

        const stats = emptyNationStats(nationId);
        const token = ++this.token;
        this.cancel = runSlices(nationStatSteps(this.engine.state, stats), () => {
            if (token !== this.token) return;
            this.renderStats(stats);
        });
    }

    showNeutral(): void {
        this.stop();
        this.nationId = null;
        this.shell.show();
        setGameHtml(this.shell.el, `${this.head(t("panels.nation.neutralArea"), "#6e7781")}
            <div class="panel-body brief-body">
                <div class="brief-title"><span class="nation-swatch" style="--nc:#6e7781"></span>${t("panels.nation.neutralArea")}</div>
                <p class="micro-hint">${t("panels.nation.neutralHint")}</p>
            </div>`);
    }

    hide(): void {
        this.stop();
        this.shell.hide();
        this.shell.clear();
    }

    destroy(): void {
        this.hide();
        this.nationId = null;
    }

    private stop(): void {
        this.token++;
        this.cancel?.();
        this.cancel = null;
    }

    private head(name: string, color: string): string {
        return panelHead({
            title: t("panels.nation.title"),
            help: this.options.help,
            extras: `<span class="owner-pill" style="--pc:${escapeHtml(color)}">${escapeHtml(name)}</span>`,
        });
    }

    private renderStats(stats: NationStats): void {
        const nation = this.engine.state.nations[stats.nationId];
        if (!nation) return;
        const displayColor = nationDisplayColor(this.engine.state, stats.nationId);
        this.shell.render({
            head: this.head(nation.name, displayColor),
            body: `
                <div class="brief-title">${nationFlagHtmlFor(this.engine.state, nation.id, 30)}<span>${escapeHtml(nation.name)}</span></div>
                ${nationOverviewBody(this.engine.state, stats)}
                ${this.options.footer ? `<p class="micro-hint">${escapeHtml(this.options.footer)}</p>` : ""}`,
        });
    }
}
