import type { GameEngine } from "../../game/engine.ts";
import { CLAIM_COST, canCancelStateClaim, hasStateClaim } from "../../game/diplomacy.ts";
import { nationDisplayColor } from "../../game/access.ts";
import type { StateRegion } from "../../game/types/entities.ts";
import { escapeGameText, escapeHtml, setGameHtml, game } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead } from "../panel.ts";
import { t } from "../../i18n/index.ts";

export interface ExpansionHooks {
    focus(stateId: number | null): void;
}

const EXPANSION_TIP = {
    get body(): string { return t("panels.expansion.help", { cost: CLAIM_COST }); },
};

/** Expansion tab: stages claim changes in a management mode, then commits them on Esc confirm. */
export class ExpansionPanel {
    private readonly engine: GameEngine;
    private readonly hooks: ExpansionHooks;
    private readonly el = document.querySelector<HTMLElement>("#expansion-panel") as HTMLElement;
    private scrollTop = 0;
    private focusedState: number | null = null;
    private managing = false;
    private readonly stagedAdds = new Set<number>();
    private readonly stagedCancels = new Set<number>();

    constructor(engine: GameEngine, hooks: ExpansionHooks) {
        this.engine = engine;
        this.hooks = hooks;
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
        if (!this.adjacent(region) && !region.provinces.some((site) => state.provinces[site].coreNation === 0)) {
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
        const body = this.el.querySelector<HTMLElement>(".diplo-body");
        if (hidden && body && body.clientHeight > 0) this.scrollTop = body.scrollTop;
        this.el.classList.toggle("hidden", hidden);
        if (!hidden && body) body.scrollTop = this.scrollTop;
    }

    render(): void {
        const oldBody = this.el.querySelector<HTMLElement>(".diplo-body");
        if (oldBody && oldBody.clientHeight > 0) this.scrollTop = oldBody.scrollTop;
        const active = document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement)
            ? document.activeElement : null;
        const focusKey = active?.dataset.expFocus;

        const state = this.engine.state;
        const player = state.nations[0];
        const mine = state.claims.filter((claim) => claim.nation === 0);
        setGameHtml(this.el, `
            ${panelHead({
                title: t("panels.expansion.title"),
                help: { title: t("panels.expansion.helpTitle"), body: EXPANSION_TIP.body },
                helpAttrs: 'data-exp-focus="objective"',
                status: this.managing
                    ? t("panels.expansion.status.manage", { adds: this.stagedAdds.size, cancels: this.stagedCancels.size })
                    : game`${t("panels.expansion.status.claims", { count: mine.length })} · [[politics:${Math.floor(player.politicalPower)}]]`,
            })}
            <div class="panel-body diplo-body">
                ${state.winner !== null ? `<p class="diplo-requirement">${t("panels.expansion.ended")}</p>` : ""}
                <div class="claim-manage-bar">
                    <button class="btn ${this.managing ? "btn-outline" : "btn-primary"}" data-action="${this.managing ? "claim-manage-exit" : "claim-manage"}" data-exp-focus="manage">${this.managing ? t("panels.expansion.manage.exit") : t("panels.expansion.manage.enter")}</button>
                    <span class="claim-manage-hint">${this.managing ? t("panels.expansion.manage.hint.exit") : t("panels.expansion.manage.hint.enter")}</span>
                </div>
                ${this.focusedState !== null && state.states[this.focusedState] ? this.focusedClaimHtml(state.states[this.focusedState]) : ""}
                ${this.managing && this.stagedAdds.size
                    ? `<div class="deploy-queue-head">${t("panels.expansion.staged.adds", { count: this.stagedAdds.size })}</div>${[...this.stagedAdds].map((id) => this.draftRowHtml(state.states[id])).join("")}`
                    : ""}
                <div class="deploy-queue-head">${t("panels.expansion.claims.mine", { count: mine.length })}</div>
                ${mine.length ? mine.map((claim) => this.claimRowHtml(state.states[claim.stateId])).join("") : `<p class="diplo-note">${t("panels.expansion.claims.empty")}</p>`}
            </div>`);

        for (const row of this.el.querySelectorAll<HTMLElement>("[data-action='claim-focus']")) {
            row.onkeydown = (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                this.focusFromMap(Number(row.dataset.state));
            };
        }
        if (active) {
            const next = [...this.el.querySelectorAll<HTMLElement>("[data-exp-focus]")]
                .find((element) => element.dataset.expFocus === focusKey && !element.matches(":disabled"));
            next?.focus({ preventScroll: true });
        }
        this.el.querySelector<HTMLElement>(".diplo-body")!.scrollTop = this.scrollTop;
    }

    private focusedClaimHtml(region: StateRegion): string {
        const state = this.engine.state;
        const claim = state.claims.find((entry) => entry.nation === 0 && entry.stateId === region.id);
        const stagedAdd = this.stagedAdds.has(region.id);
        const stagedCancel = this.stagedCancels.has(region.id);
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
            .filter((owner) => owner !== 0);
        const ownerText = owners.length ? owners.map((owner) => state.nations[owner]?.name ?? t("panels.expansion.owner.dead")).join("、") : t("panels.expansion.owner.none");
        const reason = claim ? ""
            : stagedAdd ? t("panels.expansion.reason.stagedAdd", { cost: CLAIM_COST })
            : this.managing ? this.draftHint(region)
            : t("panels.expansion.reason.prompt");
        const pill = claim ? (stagedCancel ? t("panels.expansion.pill.cancel") : t("panels.expansion.pill.claimed")) : stagedAdd ? t("panels.expansion.pill.add") : t("panels.expansion.pill.unclaimed");
        const draftLabel = stagedCancel ? t("panels.expansion.draft.undoCancel") : stagedAdd ? t("panels.expansion.draft.undoAdd") : claim ? t("panels.expansion.draft.markCancel") : t("panels.expansion.draft.markAdd");
        const canStage = stagedCancel || stagedAdd || !claim || canCancelStateClaim(state, 0, region.id);
        return `<div class="claim-focused diplo-card" data-claim-row="${region.id}">
            <div class="diplo-head"><span class="nation-dot" style="--pc:${escapeHtml(claim ? nationDisplayColor(state, 0) : "#8b949e")}"></span><span class="diplo-name">${escapeHtml(region.name)}</span><span class="status-pill ${claim || stagedAdd ? "ready" : "idle"}">${pill}</span></div>
            <p class="diplo-note">${t("panels.expansion.focus.details", { owner: escapeHtml(ownerText), provinces: region.provinces.length, adjacency: this.adjacent(region) ? t("panels.expansion.adjacent") : t("panels.expansion.notAdjacent") })}</p>
            ${reason ? `<p class="diplo-note">${escapeHtml(reason)}</p>` : ""}
            <div class="diplo-button-row">
                ${this.managing
                    ? `<button class="btn ${claim || stagedCancel ? "btn-outline btn-danger" : "btn-outline"}" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}" ${canStage ? "" : "disabled"}>${draftLabel}</button>`
                    : claim
                        ? `<button class="btn btn-outline btn-danger" data-action="claim-cancel" data-nation="0" data-state="${region.id}" data-exp-focus="cancel-${region.id}"
                            ${tooltipAttrs(t("panels.expansion.action.cancelClaim"), escapeGameText(t("panels.expansion.action.cancelClaimTip", { cost: CLAIM_COST })))}
                            ${state.winner === null && canCancelStateClaim(state, 0, region.id) ? "" : "disabled"}>${t("panels.expansion.action.cancelClaim")}</button>`
                        : ""}
                ${this.locateButton(region)}
            </div>
        </div>`;
    }

    /** Why a fresh claim cannot be staged right now (management mode). */
    private draftHint(region: StateRegion): string {
        const state = this.engine.state;
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
            .filter((owner) => owner !== 0);
        const available = state.nations[0].politicalPower + (this.stagedCancels.size - this.stagedAdds.size) * CLAIM_COST;
        if (!owners.some((owner) => owner !== -1 && state.nations[owner] !== undefined)) return t("panels.expansion.hint.noForeignLand");
        if (!this.adjacent(region) && !region.provinces.some((site) => state.provinces[site].coreNation === 0)) {
            return t("panels.expansion.hint.notAdjacent");
        }
        if (available < CLAIM_COST) return t("panels.expansion.hint.insufficient", { cost: CLAIM_COST });
        return t("panels.expansion.hint.clickState");
    }

    private claimRowHtml(region: StateRegion | undefined): string {
        if (!region) return "";
        const state = this.engine.state;
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
            .filter((owner) => owner !== 0);
        const ownerText = owners.map((owner) => state.nations[owner]?.name ?? t("panels.expansion.owner.dead")).join("、") || t("panels.expansion.owner.self");
        const focused = this.focusedState === region.id;
        const pending = this.stagedCancels.has(region.id);
        const cancelButton = this.managing
            ? `<button class="btn btn-outline${pending ? "" : " btn-danger"}" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}"
                ${canCancelStateClaim(state, 0, region.id) ? "" : "disabled"}>${pending ? t("panels.expansion.draft.undo") : t("panels.expansion.draft.markCancel")}</button>`
            : `<button class="btn btn-outline btn-danger" data-action="claim-cancel" data-nation="0" data-state="${region.id}" data-exp-focus="cancel-${region.id}"
                ${tooltipAttrs(t("panels.expansion.action.cancel"), escapeGameText(t("panels.expansion.action.cancelTip", { cost: CLAIM_COST })))}
                ${state.winner === null && canCancelStateClaim(state, 0, region.id) ? "" : "disabled"}>${t("panels.expansion.action.cancel")}</button>`;
        return `<div class="claim-row${focused ? " focused" : ""}${pending ? " pending" : ""}" data-action="claim-focus" data-state="${region.id}" data-claim-row="${region.id}" data-exp-focus="claim-row-${region.id}" tabindex="0" role="button"
            ${tooltipAttrs(escapeGameText(region.name), escapeGameText(t("panels.expansion.row.tip", { owner: ownerText })))}>
            <span class="nation-dot" style="--pc:${escapeHtml(nationDisplayColor(state, 0))}"></span>
            <span class="claim-name">${escapeHtml(region.name)}</span>
            <span class="claim-owner">${escapeHtml(ownerText)}</span>
            <span class="claim-badge">${pending ? t("panels.expansion.pill.cancel") : t("panels.expansion.pill.claimed")}</span>
            ${cancelButton}${this.locateButton(region)}
        </div>`;
    }

    private draftRowHtml(region: StateRegion | undefined): string {
        if (!region) return "";
        const state = this.engine.state;
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
            .filter((owner) => owner !== 0);
        const ownerText = owners.map((owner) => state.nations[owner]?.name ?? t("panels.expansion.owner.dead")).join("、") || t("panels.expansion.owner.self");
        return `<div class="claim-row pending">
            <span class="nation-dot" style="--pc:${escapeHtml(nationDisplayColor(state, 0))}"></span>
            <span class="claim-name">${escapeHtml(region.name)}</span>
            <span class="claim-owner">${escapeHtml(ownerText)}</span>
            <span class="claim-badge">${t("panels.expansion.pill.add")}</span>
            <button class="btn btn-outline" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}">${t("panels.expansion.draft.undo")}</button>${this.locateButton(region)}
        </div>`;
    }

    private locateButton(region: StateRegion): string {
        return `<button class="btn btn-outline btn-sm" data-action="claim-locate" data-state="${region.id}" data-exp-focus="locate-${region.id}" ${tooltipAttrs(t("panels.expansion.action.locate"), t("panels.expansion.action.locateTip"))}>${t("panels.expansion.action.locate")}</button>`;
    }

    private adjacent(region: StateRegion): boolean {
        const state = this.engine.state;
        return region.provinces.some((site) =>
            state.graph.adjacency[site].some((edge) => state.provinces[edge.site].owner === 0));
    }
}