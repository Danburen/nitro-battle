import type { GameEngine } from "../../game/engine.ts";
import type { GameState } from "../../game/types/state.ts";
import { CLAIM_COST, canCancelStateClaim, hasStateClaim } from "../../game/diplomacy.ts";
import { nationDisplayColor } from "../../game/access.ts";
import type { StateRegion } from "../../game/types/entities.ts";
import { escapeGameText, game, html, rawHtml } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, PanelShell } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { gameHtml, scopedTexts } from "../view.ts";
import { t } from "../../i18n/index.ts";

export interface ExpansionHooks {
    focus(stateId: number | null): void;
}

function expansionTexts() {
    const s = scopedTexts("panels.expansion.", {
        title: ["title"],
        helpTitle: ["helpTitle"],
        ended: ["ended"],
        manageEnter: ["manage.enter"],
        manageExit: ["manage.exit"],
        manageHintEnter: ["manage.hint.enter"],
        manageHintExit: ["manage.hint.exit"],
        ownerDead: ["owner.dead"],
        ownerNone: ["owner.none"],
        ownerSelf: ["owner.self"],
        reasonPrompt: ["reason.prompt"],
        pillCancel: ["pill.cancel"],
        pillClaimed: ["pill.claimed"],
        pillAdd: ["pill.add"],
        pillUnclaimed: ["pill.unclaimed"],
        draftUndoCancel: ["draft.undoCancel"],
        draftUndoAdd: ["draft.undoAdd"],
        draftMarkCancel: ["draft.markCancel"],
        draftMarkAdd: ["draft.markAdd"],
        draftUndo: ["draft.undo"],
        adjacent: ["adjacent"],
        notAdjacent: ["notAdjacent"],
        actionCancelClaim: ["action.cancelClaim"],
        actionCancel: ["action.cancel"],
        actionLocate: ["action.locate"],
        actionLocateTip: ["action.locateTip"],
        hintNoForeignLand: ["hint.noForeignLand"],
        hintNotAdjacent: ["hint.notAdjacent"],
        hintClickState: ["hint.clickState"],
    });
    return {
        ...s,
        help: () => t("panels.expansion.help", { cost: CLAIM_COST }),
        statusManage: (adds: number, cancels: number) => t("panels.expansion.status.manage", { adds, cancels }),
        statusClaims: (count: number) => t("panels.expansion.status.claims", { count }),
        stagedAdds: (count: number) => t("panels.expansion.staged.adds", { count }),
        claimsMine: (count: number) => t("panels.expansion.claims.mine", { count }),
        claimsEmpty: () => t("panels.expansion.claims.empty"),
        reasonStagedAdd: () => t("panels.expansion.reason.stagedAdd", { cost: CLAIM_COST }),
        focusDetails: (params: { owner: string; provinces: number; adjacency: string }) =>
            t("panels.expansion.focus.details", params),
        cancelClaimTip: () => t("panels.expansion.action.cancelClaimTip", { cost: CLAIM_COST }),
        cancelTip: () => t("panels.expansion.action.cancelTip", { cost: CLAIM_COST }),
        rowTip: (owner: string) => t("panels.expansion.row.tip", { owner }),
        hintInsufficient: () => t("panels.expansion.hint.insufficient", { cost: CLAIM_COST }),
    };
}
type ExpansionTexts = ReturnType<typeof expansionTexts>;

function adjacent(state: GameState, region: StateRegion): boolean {
    return region.provinces.some((site) =>
        state.graph.adjacency[site].some((edge) => state.provinces[edge.site].owner === 0));
}

function draftHint(state: GameState, region: StateRegion, ctx: ExpansionViewContext, text: ExpansionTexts): string {
    const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
        .filter((owner) => owner !== 0);
    const available = state.nations[0].politicalPower + (ctx.stagedCancels.size - ctx.stagedAdds.size) * CLAIM_COST;
    if (!owners.some((owner) => owner !== -1 && state.nations[owner] !== undefined)) return text.hintNoForeignLand;
    if (!adjacent(state, region) && !region.provinces.some((site) => state.provinces[site].coreNation === 0)) {
        return text.hintNotAdjacent;
    }
    if (available < CLAIM_COST) return text.hintInsufficient();
    return text.hintClickState;
}

function locateButton(region: StateRegion, text: ExpansionTexts): string {
    return html`<button class="btn btn-outline btn-sm" data-action="claim-locate" data-state="${region.id}" data-exp-focus="locate-${region.id}" ${rawHtml(tooltipAttrs(text.actionLocate, text.actionLocateTip))}>${text.actionLocate}</button>`;
}

function focusedClaimHtml(state: GameState, region: StateRegion, ctx: ExpansionViewContext, text: ExpansionTexts): string {
    const claim = state.claims.find((entry) => entry.nation === 0 && entry.stateId === region.id);
    const stagedAdd = ctx.stagedAdds.has(region.id);
    const stagedCancel = ctx.stagedCancels.has(region.id);
    const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
        .filter((owner) => owner !== 0);
    const ownerText = owners.length
        ? owners.map((owner) => state.nations[owner]?.name ?? text.ownerDead).join("、")
        : text.ownerNone;
    const reason = claim ? ""
        : stagedAdd ? text.reasonStagedAdd()
            : ctx.managing ? draftHint(state, region, ctx, text)
                : text.reasonPrompt;
    const pill = claim ? (stagedCancel ? text.pillCancel : text.pillClaimed)
        : stagedAdd ? text.pillAdd : text.pillUnclaimed;
    const draftLabel = stagedCancel ? text.draftUndoCancel : stagedAdd ? text.draftUndoAdd
        : claim ? text.draftMarkCancel : text.draftMarkAdd;
    const canStage = stagedCancel || stagedAdd || !claim || canCancelStateClaim(state, 0, region.id);
    const draftButton = ctx.managing
        ? html`<button class="btn ${claim || stagedCancel ? "btn-outline btn-danger" : "btn-outline"}" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}" ${rawHtml(canStage ? "" : " disabled")}>${draftLabel}</button>`
        : claim ? html`<button class="btn btn-outline btn-danger" data-action="claim-cancel" data-nation="0" data-state="${region.id}" data-exp-focus="cancel-${region.id}" ${rawHtml(tooltipAttrs(text.actionCancelClaim, escapeGameText(text.cancelClaimTip())))} ${rawHtml(state.winner === null && canCancelStateClaim(state, 0, region.id) ? "" : " disabled")}>${text.actionCancelClaim}</button>`
            : "";
    const reasonRow = reason ? html`<p class="diplo-note">${reason}</p>` : "";
    return html`<div class="claim-focused diplo-card" data-claim-row="${region.id}">
        <div class="diplo-head"><span class="nation-dot" style="--pc:${claim ? nationDisplayColor(state, 0) : "#8b949e"}"></span><span class="diplo-name">${region.name}</span><span class="status-pill ${claim || stagedAdd ? "ready" : "idle"}">${pill}</span></div>
        <p class="diplo-note">${text.focusDetails({
            owner: escapeGameText(ownerText),
            provinces: region.provinces.length,
            adjacency: adjacent(state, region) ? text.adjacent : text.notAdjacent,
        })}</p>
        ${rawHtml(reasonRow)}
        <div class="diplo-button-row">
            ${rawHtml(draftButton)}
            ${rawHtml(locateButton(region, text))}
        </div>
    </div>`;
}

function claimRowHtml(state: GameState, region: StateRegion | undefined, ctx: ExpansionViewContext, text: ExpansionTexts): string {
    if (!region) return "";
    const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
        .filter((owner) => owner !== 0);
    const ownerText = owners.map((owner) => state.nations[owner]?.name ?? text.ownerDead).join("、") || text.ownerSelf;
    const focused = ctx.focusedState === region.id;
    const pending = ctx.stagedCancels.has(region.id);
    const cancelButton = ctx.managing
        ? html`<button class="btn btn-outline${pending ? "" : " btn-danger"}" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}" ${rawHtml(canCancelStateClaim(state, 0, region.id) ? "" : " disabled")}>${pending ? text.draftUndo : text.draftMarkCancel}</button>`
        : html`<button class="btn btn-outline btn-danger" data-action="claim-cancel" data-nation="0" data-state="${region.id}" data-exp-focus="cancel-${region.id}" ${rawHtml(tooltipAttrs(text.actionCancel, escapeGameText(text.cancelTip())))} ${rawHtml(state.winner === null && canCancelStateClaim(state, 0, region.id) ? "" : " disabled")}>${text.actionCancel}</button>`;
    return html`<div class="claim-row${focused ? " focused" : ""}${pending ? " pending" : ""}" data-action="claim-focus" data-state="${region.id}" data-claim-row="${region.id}" data-exp-focus="claim-row-${region.id}" tabindex="0" role="button" ${rawHtml(tooltipAttrs(escapeGameText(region.name), escapeGameText(text.rowTip(ownerText))))}>
        <span class="nation-dot" style="--pc:${nationDisplayColor(state, 0)}"></span>
        <span class="claim-name">${region.name}</span>
        <span class="claim-owner">${ownerText}</span>
        <span class="claim-badge">${pending ? text.pillCancel : text.pillClaimed}</span>
        ${rawHtml(cancelButton)}${rawHtml(locateButton(region, text))}
    </div>`;
}

function draftRowHtml(state: GameState, region: StateRegion | undefined, text: ExpansionTexts): string {
    if (!region) return "";
    const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
        .filter((owner) => owner !== 0);
    const ownerText = owners.map((owner) => state.nations[owner]?.name ?? text.ownerDead).join("、") || text.ownerSelf;
    return html`<div class="claim-row pending">
        <span class="nation-dot" style="--pc:${nationDisplayColor(state, 0)}"></span>
        <span class="claim-name">${region.name}</span>
        <span class="claim-owner">${ownerText}</span>
        <span class="claim-badge">${text.pillAdd}</span>
        <button class="btn btn-outline" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}">${text.draftUndo}</button>${rawHtml(locateButton(region, text))}
    </div>`;
}

export interface ExpansionViewContext {
    readonly state: GameState;
    readonly managing: boolean;
    readonly stagedAdds: ReadonlySet<number>;
    readonly stagedCancels: ReadonlySet<number>;
    readonly focusedState: number | null;
}

/** Pure view builder: claim list plus staged management rows. */
export function expansionView(ctx: ExpansionViewContext): PanelView {
    const { state, managing, stagedAdds, stagedCancels, focusedState } = ctx;
    const text = expansionTexts();
    const player = state.nations[0];
    const mine = state.claims.filter((claim) => claim.nation === 0);
    const status = managing
        ? text.statusManage(stagedAdds.size, stagedCancels.size)
        : gameHtml(game`${text.statusClaims(mine.length)} · [[politics:${Math.floor(player.politicalPower)}]]`);
    const ended = state.winner !== null ? html`<p class="diplo-requirement">${text.ended}</p>` : "";
    const manageButton = html`<button class="btn ${managing ? "btn-outline" : "btn-primary"}" data-action="${managing ? "claim-manage-exit" : "claim-manage"}" data-exp-focus="manage">${managing ? text.manageExit : text.manageEnter}</button>`;
    const focused = focusedState !== null && state.states[focusedState]
        ? focusedClaimHtml(state, state.states[focusedState], ctx, text) : "";
    const staged = managing && stagedAdds.size
        ? [html`<div class="deploy-queue-head">${text.stagedAdds(stagedAdds.size)}</div>`,
            ...[...stagedAdds].map((id) => draftRowHtml(state, state.states[id], text))].join("")
        : "";
    const claims = mine.length
        ? mine.map((claim) => claimRowHtml(state, state.states[claim.stateId], ctx, text)).join("")
        : html`<p class="diplo-note">${text.claimsEmpty()}</p>`;

    return {
        head: panelHead({
            title: text.title,
            help: { title: text.helpTitle, body: text.help() },
            helpAttrs: 'data-exp-focus="objective"',
            status,
        }),
        bodyClass: "diplo-body",
        focusAttr: "data-exp-focus",
        body: html`${rawHtml(ended)}
            <div class="claim-manage-bar">
                ${rawHtml(manageButton)}
                <span class="claim-manage-hint">${managing ? text.manageHintExit : text.manageHintEnter}</span>
            </div>
            ${rawHtml(focused)}
            ${rawHtml(staged)}
            <div class="deploy-queue-head">${text.claimsMine(mine.length)}</div>
            ${rawHtml(claims)}`,
    };
}

/** Expansion tab: stages claim changes in a management mode, then commits them on Esc confirm. */
export class ExpansionPanel {
    private readonly engine: GameEngine;
    private readonly hooks: ExpansionHooks;
    private readonly shell = new PanelShell(document.querySelector<HTMLElement>("#expansion-panel") as HTMLElement);
    private readonly el = this.shell.el;
    private focusedState: number | null = null;
    private managing = false;
    private readonly stagedAdds = new Set<number>();
    private readonly stagedCancels = new Set<number>();

    constructor(engine: GameEngine, hooks: ExpansionHooks) {
        this.engine = engine;
        this.hooks = hooks;
        this.el.addEventListener("keydown", this.onClaimRowKeyDown);
    }

    isManaging(): boolean {
        return this.managing;
    }

    enterManage(): boolean {
        if (this.engine.state.winner !== null) return false;
        this.managing = true;
        this.stagedAdds.clear();
        this.stagedCancels.clear();
        this.render();
        return true;
    }

    draft(): { adds: number[]; cancels: number[] } {
        return { adds: [...this.stagedAdds], cancels: [...this.stagedCancels] };
    }

    cancelDraft(): void {
        this.managing = false;
        this.stagedAdds.clear();
        this.stagedCancels.clear();
        this.render();
    }

    applyDraft(): { added: number; cancelled: number; failed: number } {
        let added = 0;
        let cancelled = 0;
        let failed = 0;
        for (const stateId of [...this.stagedCancels]) {
            if (this.engine.cancelClaim(stateId)) cancelled++;
            else failed++;
        }
        for (const stateId of [...this.stagedAdds]) {
            if (this.engine.claimState(stateId)) added++;
            else failed++;
        }
        this.managing = false;
        this.stagedAdds.clear();
        this.stagedCancels.clear();
        this.render();
        return { added, cancelled, failed };
    }

    /** Map click in management mode: stage an add, cancel, or undo of either. */
    toggleDraft(stateId: number): { ok: boolean; message: string } {
        const state = this.engine.state;
        const region = state.states[stateId];
        if (!region) return { ok: false, message: t("panels.expansion.toast.invalid") };
        if (state.winner !== null) return { ok: false, message: t("panels.expansion.toast.ended") };
        if (this.stagedAdds.has(stateId)) {
            this.stagedAdds.delete(stateId);
            this.render();
            return { ok: true, message: t("panels.expansion.toast.undoAdd", { name: region.name }) };
        }
        if (this.stagedCancels.has(stateId)) {
            this.stagedCancels.delete(stateId);
            this.render();
            return { ok: true, message: t("panels.expansion.toast.undoCancel", { name: region.name }) };
        }
        if (hasStateClaim(state, 0, stateId)) {
            if (!canCancelStateClaim(state, 0, stateId)) {
                return { ok: false, message: t("panels.expansion.toast.warCancel") };
            }
            this.stagedCancels.add(stateId);
            this.render();
            return { ok: true, message: t("panels.expansion.toast.markCancel", { name: region.name, cost: CLAIM_COST }) };
        }
        const available = state.nations[0].politicalPower + (this.stagedCancels.size - this.stagedAdds.size) * CLAIM_COST;
        if (available < CLAIM_COST) return { ok: false, message: t("panels.expansion.toast.insufficient", { cost: CLAIM_COST }) };
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))];
        if (!owners.some((owner) => owner !== 0 && owner !== -1 && state.nations[owner] !== undefined)) {
            return { ok: false, message: t("panels.expansion.toast.noForeignLand", { name: region.name }) };
        }
        if (!adjacent(state, region) && !region.provinces.some((site) => state.provinces[site].coreNation === 0)) {
            return { ok: false, message: t("panels.expansion.toast.notAdjacent") };
        }
        this.stagedAdds.add(stateId);
        this.render();
        return { ok: true, message: t("panels.expansion.toast.markAdd", { name: region.name, cost: CLAIM_COST }) };
    }

    focusFromMap(stateId: number): void {
        this.focusedState = stateId;
        this.hooks.focus(stateId);
        this.render();
        this.el.querySelector<HTMLElement>(`[data-claim-row="${stateId}"]`)?.scrollIntoView({ block: "nearest" });
    }

    clearFocus(): boolean {
        if (this.focusedState === null) return false;
        this.focusedState = null;
        this.hooks.focus(null);
        this.render();
        return true;
    }

    setHidden(hidden: boolean): void {
        if (hidden) this.shell.hide();
        else this.shell.show();
    }

    render(): void {
        this.shell.render(expansionView({
            state: this.engine.state,
            managing: this.managing,
            stagedAdds: this.stagedAdds,
            stagedCancels: this.stagedCancels,
            focusedState: this.focusedState,
        }));
    }

    private readonly onClaimRowKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-action='claim-focus']");
        if (!row) return;
        event.preventDefault();
        event.stopPropagation();
        this.focusFromMap(Number(row.dataset.state));
    };
}
