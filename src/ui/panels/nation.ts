import type { GameEngine } from "../../game/engine.ts";
import type { GameState } from "../../game/types/state.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { html, rawHtml } from "../text.ts";
import { PanelShell, panelHead } from "../panel.ts";
import type { HelpSpec, PanelView } from "../panel.ts";
import { nationFlagHtmlFor } from "../flags.ts";
import { nationOverviewBody, emptyNationStats, nationStatSteps } from "../nation-info.ts";
import type { NationStats } from "../nation-info.ts";
import { runSlices } from "../slices.ts";
import { scopedTexts } from "../view.ts";

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

function nationTexts() {
    return scopedTexts("panels.nation.", {
        title: ["title"],
        loading: ["loading"],
        neutralArea: ["neutralArea"],
        neutralHint: ["neutralHint"],
    });
}
type NationTexts = ReturnType<typeof nationTexts>;

function nationHead(name: string, color: string, text: NationTexts, options: NationPanelOptions): string {
    return panelHead({
        title: text.title,
        help: options.help,
        extras: html`<span class="owner-pill" style="--pc:${color}">${name}</span>`,
    });
}

export interface NationLoadingViewContext {
    readonly state: GameState;
    readonly nationId: number;
    readonly name: string;
    readonly color: string;
    readonly options: NationPanelOptions;
}

/** Pure view builder for the initial loading state. */
export function nationLoadingView(ctx: NationLoadingViewContext): PanelView {
    const text = nationTexts();
    return {
        head: nationHead(ctx.name, ctx.color, text, ctx.options),
        bodyClass: "brief-body",
        body: html`<div class="brief-title">${rawHtml(nationFlagHtmlFor(ctx.state, ctx.nationId, 30))}<span>${ctx.name}</span></div>
            <p class="micro-hint">${text.loading}</p>`,
    };
}

/** Pure view builder for the neutral-area state. */
export function nationNeutralView(options: NationPanelOptions): PanelView {
    const text = nationTexts();
    return {
        head: nationHead(text.neutralArea, "#6e7781", text, options),
        bodyClass: "brief-body",
        body: html`<div class="brief-title"><span class="nation-swatch" style="--nc:#6e7781"></span>${text.neutralArea}</div>
            <p class="micro-hint">${text.neutralHint}</p>`,
    };
}

export interface NationStatsViewContext {
    readonly state: GameState;
    readonly stats: NationStats;
    readonly color: string;
    readonly options: NationPanelOptions;
}

/** Pure view builder for fully gathered nation statistics. */
export function nationStatsView(ctx: NationStatsViewContext): PanelView {
    const text = nationTexts();
    const nation = ctx.state.nations[ctx.stats.nationId];
    const footer = ctx.options.footer ? html`<p class="micro-hint">${ctx.options.footer}</p>` : "";
    return {
        head: nationHead(nation.name, ctx.color, text, ctx.options),
        bodyClass: "brief-body",
        body: html`<div class="brief-title">${rawHtml(nationFlagHtmlFor(ctx.state, nation.id, 30))}<span>${nation.name}</span></div>
            ${rawHtml(nationOverviewBody(ctx.state, ctx.stats))}
            ${rawHtml(footer)}`,
    };
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
        const state = this.engine.state;
        const nation = state.nations[nationId];
        if (!nation) return;
        this.nationId = nationId;
        this.stop();
        this.shell.show();
        this.shell.render(nationLoadingView({
            state, nationId, name: nation.name,
            color: nationDisplayColor(state, nationId), options: this.options,
        }));

        const stats = emptyNationStats(nationId);
        const token = ++this.token;
        this.cancel = runSlices(nationStatSteps(state, stats), () => {
            if (token !== this.token) return;
            this.renderStats(stats);
        });
    }

    showNeutral(): void {
        this.stop();
        this.nationId = null;
        this.shell.show();
        this.shell.render(nationNeutralView(this.options));
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

    private renderStats(stats: NationStats): void {
        const state = this.engine.state;
        const nation = state.nations[stats.nationId];
        if (!nation) return;
        this.shell.render(nationStatsView({
            state, stats, color: nationDisplayColor(state, stats.nationId), options: this.options,
        }));
    }
}
