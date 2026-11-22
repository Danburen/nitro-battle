import type { GameEngine } from "../../game/engine.ts";
import { CLAIM_COST, canCancelStateClaim, hasStateClaim } from "../../game/diplomacy.ts";
import { nationDisplayColor } from "../../game/access.ts";
import type { StateRegion } from "../../game/types.ts";
import { escapeGameText, escapeHtml, renderGameText, textToken } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead } from "../panel.ts";

export interface ExpansionHooks {
    focus(stateId: number | null): void;
}

const EXPANSION_TIP = `宣称以州为单位：支付 ${CLAIM_COST} 政治点提出，不改变控制、正式归属或历史核心；宣战借口在「外交」页制造。地图已切换州模式，已宣称州以我方国家颜色覆盖。\n\n点击「管理宣称」进入宣称管理：点击地图上的州标记新增，或标记取消已有宣称；金色闪烁州为可新增目标。按 Esc 弹出确认窗，确认后一次性提交全部变更，取消则留在管理界面。\n\n外交页可凭借口宣战；交战中不可取消相关宣称。`;

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
        if (!region) return { ok: false, message: "目标州无效" };
        if (state.winner !== null) return { ok: false, message: "战役已结束，无法修改宣称" };
        if (this.stagedAdds.has(stateId)) {
            this.stagedAdds.delete(stateId);
            this.render();
            return { ok: true, message: `已撤销${region.name}的待宣称` };
        }
        if (this.stagedCancels.has(stateId)) {
            this.stagedCancels.delete(stateId);
            this.render();
            return { ok: true, message: `已保留${region.name}的原有宣称` };
        }
        if (hasStateClaim(state, 0, stateId)) {
            if (!canCancelStateClaim(state, 0, stateId)) {
                return { ok: false, message: "与该州归属国交战中，无法取消宣称" };
            }
            this.stagedCancels.add(stateId);
            this.render();
            return { ok: true, message: `已标记取消${region.name}的宣称（确认后返还 ${CLAIM_COST} 政治点）` };
        }
        const available = state.nations[0].politicalPower + (this.stagedCancels.size - this.stagedAdds.size) * CLAIM_COST;
        if (available < CLAIM_COST) return { ok: false, message: `政治点不足 ${CLAIM_COST}，无法新增宣称` };
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))];
        if (!owners.some((owner) => owner !== 0 && owner !== -1 && state.nations[owner] !== undefined)) {
            return { ok: false, message: `${region.name}没有可宣称的他国正式领土` };
        }
        if (!this.adjacent(region) && !region.provinces.some((site) => state.provinces[site].coreNation === 0)) {
            return { ok: false, message: "无法宣称：不与己方控制区邻接，且无历史核心" };
        }
        this.stagedAdds.add(stateId);
        this.render();
        return { ok: true, message: `已标记宣称${region.name}（确认后支付 ${CLAIM_COST} 政治点）` };
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
        this.el.innerHTML = `
            ${panelHead({
                title: "扩张",
                help: { title: "扩张规则", body: EXPANSION_TIP },
                helpAttrs: 'data-exp-focus="objective"',
                status: this.managing
                    ? `${this.stagedAdds.size} 待宣称 · ${this.stagedCancels.size} 待取消`
                    : `${mine.length} 项宣称 · ${renderGameText(textToken("politics", Math.floor(player.politicalPower)))}`,
            })}
            <div class="panel-body diplo-body">
                ${state.winner !== null ? '<p class="diplo-requirement">战役已结束，无法新增宣称。</p>' : ""}
                <div class="claim-manage-bar">
                    <button class="btn ${this.managing ? "btn-outline" : "btn-primary"}" data-action="${this.managing ? "claim-manage-exit" : "claim-manage"}" data-exp-focus="manage">${this.managing ? "退出管理" : "管理宣称"}</button>
                    <span class="claim-manage-hint">${this.managing ? "点击地图州标记新增 / 取消 · Esc 确认退出" : "进入后可批量新增或取消宣称"}</span>
                </div>
                ${this.focusedState !== null && state.states[this.focusedState] ? this.focusedClaimHtml(state.states[this.focusedState]) : ""}
                ${this.managing && this.stagedAdds.size
                    ? `<div class="deploy-queue-head">待新增 · ${this.stagedAdds.size} 项</div>${[...this.stagedAdds].map((id) => this.draftRowHtml(state.states[id])).join("")}`
                    : ""}
                <div class="deploy-queue-head">我的宣称 · ${mine.length} 项</div>
                ${mine.length ? mine.map((claim) => this.claimRowHtml(state.states[claim.stateId])).join("") : '<p class="diplo-note">尚未提出任何州宣称；进入「管理宣称」后点击地图上的金色闪烁州即可标记新增。</p>'}
            </div>`;

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
        const ownerText = owners.length ? owners.map((owner) => state.nations[owner]?.name ?? "已灭亡国家").join("、") : "无他国正式领土";
        const reason = claim ? ""
            : stagedAdd ? `已标记待宣称，确认后支付 ${CLAIM_COST} 政治点。`
            : this.managing ? this.draftHint(region)
            : "进入「管理宣称」后点击地图该州即可标记宣称。";
        const pill = claim ? (stagedCancel ? "待取消" : "已宣称") : stagedAdd ? "待宣称" : "未宣称";
        const draftLabel = stagedCancel ? "撤销取消" : stagedAdd ? "撤销待宣称" : claim ? "标记取消" : "标记宣称";
        const canStage = stagedCancel || stagedAdd || !claim || canCancelStateClaim(state, 0, region.id);
        return `<div class="claim-focused diplo-card" data-claim-row="${region.id}">
            <div class="diplo-head"><span class="nation-dot" style="--pc:${escapeHtml(claim ? nationDisplayColor(state, 0) : "#8b949e")}"></span><span class="diplo-name">${escapeHtml(region.name)}</span><span class="status-pill ${claim || stagedAdd ? "ready" : "idle"}">${pill}</span></div>
            <p class="diplo-note">正式归属：${escapeHtml(ownerText)} · ${region.provinces.length} 省 · ${this.adjacent(region) ? "与己方邻接" : "不邻接（需历史核心）"}</p>
            ${reason ? `<p class="diplo-note">${escapeHtml(reason)}</p>` : ""}
            <div class="diplo-button-row">
                ${this.managing
                    ? `<button class="btn ${claim || stagedCancel ? "btn-outline btn-danger" : "btn-outline"}" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}" ${canStage ? "" : "disabled"}>${draftLabel}</button>`
                    : claim
                        ? `<button class="btn btn-outline btn-danger" data-action="claim-cancel" data-nation="0" data-state="${region.id}" data-exp-focus="cancel-${region.id}"
                            ${tooltipAttrs("取消宣称", escapeGameText(`取消并返还 ${CLAIM_COST} 政治点；与该州归属国交战时不可取消。`))}
                            ${state.winner === null && canCancelStateClaim(state, 0, region.id) ? "" : "disabled"}>取消宣称</button>`
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
        if (!owners.some((owner) => owner !== -1 && state.nations[owner] !== undefined)) return "无他国正式领土，无需宣称。";
        if (!this.adjacent(region) && !region.provinces.some((site) => state.provinces[site].coreNation === 0)) {
            return "不与己方控制区邻接，且无历史核心，无法宣称。";
        }
        if (available < CLAIM_COST) return `政治点不足 ${CLAIM_COST}，无法宣称。`;
        return "点击地图该州即可标记宣称。";
    }

    private claimRowHtml(region: StateRegion | undefined): string {
        if (!region) return "";
        const state = this.engine.state;
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
            .filter((owner) => owner !== 0);
        const ownerText = owners.map((owner) => state.nations[owner]?.name ?? "已灭亡国家").join("、") || "我方";
        const focused = this.focusedState === region.id;
        const pending = this.stagedCancels.has(region.id);
        const cancelButton = this.managing
            ? `<button class="btn btn-outline${pending ? "" : " btn-danger"}" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}"
                ${canCancelStateClaim(state, 0, region.id) ? "" : "disabled"}>${pending ? "撤销" : "标记取消"}</button>`
            : `<button class="btn btn-outline btn-danger" data-action="claim-cancel" data-nation="0" data-state="${region.id}" data-exp-focus="cancel-${region.id}"
                ${tooltipAttrs("取消", escapeGameText(`取消宣称并返还 ${CLAIM_COST} 政治点；交战中不可取消。`))}
                ${state.winner === null && canCancelStateClaim(state, 0, region.id) ? "" : "disabled"}>取消</button>`;
        return `<div class="claim-row${focused ? " focused" : ""}${pending ? " pending" : ""}" data-action="claim-focus" data-state="${region.id}" data-claim-row="${region.id}" data-exp-focus="claim-row-${region.id}" tabindex="0" role="button"
            ${tooltipAttrs(escapeGameText(region.name), escapeGameText(`正式归属：${ownerText}\n点击聚焦并在地图描边`))}>
            <span class="nation-dot" style="--pc:${escapeHtml(nationDisplayColor(state, 0))}"></span>
            <span class="claim-name">${escapeHtml(region.name)}</span>
            <span class="claim-owner">${escapeHtml(ownerText)}</span>
            <span class="claim-badge">${pending ? "待取消" : "已宣称"}</span>
            ${cancelButton}${this.locateButton(region)}
        </div>`;
    }

    private draftRowHtml(region: StateRegion | undefined): string {
        if (!region) return "";
        const state = this.engine.state;
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
            .filter((owner) => owner !== 0);
        const ownerText = owners.map((owner) => state.nations[owner]?.name ?? "已灭亡国家").join("、") || "我方";
        return `<div class="claim-row pending">
            <span class="nation-dot" style="--pc:${escapeHtml(nationDisplayColor(state, 0))}"></span>
            <span class="claim-name">${escapeHtml(region.name)}</span>
            <span class="claim-owner">${escapeHtml(ownerText)}</span>
            <span class="claim-badge">待宣称</span>
            <button class="btn btn-outline" data-action="claim-draft" data-state="${region.id}" data-exp-focus="draft-${region.id}">撤销</button>${this.locateButton(region)}
        </div>`;
    }

    private locateButton(region: StateRegion): string {
        return `<button class="btn btn-outline btn-sm" data-action="claim-locate" data-state="${region.id}" data-exp-focus="locate-${region.id}" ${tooltipAttrs("定位", "将地图居中到该州中心")}>定位</button>`;
    }

    private adjacent(region: StateRegion): boolean {
        const state = this.engine.state;
        return region.provinces.some((site) =>
            state.graph.adjacency[site].some((edge) => state.provinces[edge.site].owner === 0));
    }
}