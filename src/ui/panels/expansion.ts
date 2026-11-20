import type { GameEngine } from "../../game/engine.ts";
import { CLAIM_COST, canCancelStateClaim, canClaimState, hasStateClaim } from "../../game/diplomacy.ts";
import type { StateRegion } from "../../game/types.ts";
import { escapeGameText, escapeHtml, renderGameText, textToken } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";

export interface ExpansionHooks {
    focus(stateId: number | null): void;
}

const EXPANSION_TIP = `宣称以州为单位：支付 ${CLAIM_COST} 政治点提出，不改变控制、正式归属或历史核心；宣战借口在「外交」页制造。地图已切换州模式，已宣称州以我方国家颜色覆盖。\n\n可宣称的州在地图上金色闪烁高亮：点击即宣称，再次点击同一州取消并返还政治点；交战中不可取消。\n\n点击地图上的州或下列条目可聚焦查看；「定位」将地图居中到该州中心。借口就绪后到「外交」页凭借口宣战。`;

/** Expansion tab: manages owned state claims while the map pulses claimable states in gold. */
export class ExpansionPanel {
    private readonly engine: GameEngine;
    private readonly hooks: ExpansionHooks;
    private readonly el = document.querySelector<HTMLElement>("#expansion-panel") as HTMLElement;
    private scrollTop = 0;
    private focusedState: number | null = null;

    constructor(engine: GameEngine, hooks: ExpansionHooks) {
        this.engine = engine;
        this.hooks = hooks;
    }

    /** Map click in claim mode: claim a pulsing state, cancel an existing claim. */
    toggleClaim(stateId: number): { ok: boolean; message: string } {
        const state = this.engine.state;
        const region = state.states[stateId];
        if (!region) return { ok: false, message: "目标州无效" };
        if (state.winner !== null) return { ok: false, message: "战役已结束，无法修改宣称" };
        if (hasStateClaim(state, 0, stateId)) {
            return this.engine.cancelClaim(stateId)
                ? { ok: true, message: `已取消${region.name}的宣称，返还 ${CLAIM_COST} 政治点` }
                : { ok: false, message: "无法取消宣称：正与该州归属国交战" };
        }
        if (this.engine.claimState(stateId)) {
            return { ok: true, message: `已宣称${region.name}（-${CLAIM_COST} 政治点），再次点击该州可取消` };
        }
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))];
        if (owners.every((owner) => owner === 0)) return { ok: false, message: `${region.name}是我方州，无需宣称` };
        if (!this.adjacent(region) && !region.provinces.some((site) => state.provinces[site].coreNation === 0)) {
            return { ok: false, message: "无法宣称：不与己方控制区邻接，且无历史核心" };
        }
        return { ok: false, message: `政治点不足 ${CLAIM_COST}，无法宣称` };
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
            <div class="panel-head"><h2>扩张</h2><button type="button" class="intel-help" aria-label="扩张规则" data-exp-focus="objective" ${tooltipAttrs("扩张规则", EXPANSION_TIP)}>i</button><span class="objective">${mine.length} 项宣称 · ${renderGameText(textToken("politics", Math.floor(player.politicalPower)))}</span></div>
            <div class="panel-body diplo-body">
                ${state.winner !== null ? '<p class="diplo-requirement">战役已结束，无法新增宣称。</p>' : ""}
                ${this.focusedState !== null && state.states[this.focusedState] ? this.focusedClaimHtml(state.states[this.focusedState]) : ""}
                <div class="deploy-queue-head">我的宣称 · ${mine.length} 项</div>
                ${mine.length ? mine.map((claim) => this.claimRowHtml(state.states[claim.stateId])).join("") : '<p class="diplo-note">尚未提出任何州宣称；地图上闪烁的州即可宣称目标。</p>'}
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
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
            .filter((owner) => owner !== 0);
        const ownerText = owners.length ? owners.map((owner) => state.nations[owner]?.name ?? "已灭亡国家").join("、") : "无他国正式领土";
        const reason = claim ? "" : canClaimState(state, 0, region.id)
            ? "点击地图该州即可提出宣称。"
            : !this.adjacent(region) && !region.provinces.some((site) => state.provinces[site].coreNation === 0)
                ? "不与己方控制区邻接，且无历史核心，无法宣称。"
                : owners.every((owner) => owner === 0) ? "我方州无需宣称。" : `政治点不足 ${CLAIM_COST}，无法宣称。`;
        return `<div class="claim-focused diplo-card" data-claim-row="${region.id}">
            <div class="diplo-head"><span class="nation-dot" style="--pc:${escapeHtml(claim ? state.nations[0].color : "#8b949e")}"></span><span class="diplo-name">${escapeHtml(region.name)}</span><span class="status-pill ${claim ? "ready" : "idle"}">${claim ? "已宣称" : "未宣称"}</span></div>
            <p class="diplo-note">正式归属：${escapeHtml(ownerText)} · ${region.provinces.length} 省 · ${this.adjacent(region) ? "与己方邻接" : "不邻接（需历史核心）"}</p>
            ${claim ? "" : `<p class="diplo-note">${escapeHtml(reason)}</p>`}
            <div class="diplo-button-row">
                ${claim
                    ? `<button class="btn btn-outline btn-danger" data-action="claim-cancel" data-nation="0" data-state="${region.id}" data-exp-focus="cancel-${region.id}"
                        ${tooltipAttrs("取消宣称", escapeGameText(`取消并返还 ${CLAIM_COST} 政治点；与该州归属国交战时不可取消。`))}
                        ${state.winner === null && canCancelStateClaim(state, 0, region.id) ? "" : "disabled"}>取消宣称</button>`
                    : ""}
                ${this.locateButton(region)}
            </div>
        </div>`;
    }

    private claimRowHtml(region: StateRegion | undefined): string {
        if (!region) return "";
        const state = this.engine.state;
        const owners = [...new Set(region.provinces.map((site) => state.provinces[site].legalOwner))]
            .filter((owner) => owner !== 0);
        const ownerText = owners.map((owner) => state.nations[owner]?.name ?? "已灭亡国家").join("、") || "我方";
        const focused = this.focusedState === region.id;
        return `<div class="claim-row${focused ? " focused" : ""}" data-action="claim-focus" data-state="${region.id}" data-claim-row="${region.id}" data-exp-focus="claim-row-${region.id}" tabindex="0" role="button"
            ${tooltipAttrs(escapeGameText(region.name), escapeGameText(`正式归属：${ownerText}\n点击聚焦并在地图描边`))}>
            <span class="nation-dot" style="--pc:${escapeHtml(state.nations[0].color)}"></span>
            <span class="claim-name">${escapeHtml(region.name)}</span>
            <span class="claim-owner">${escapeHtml(ownerText)}</span>
            <span class="claim-badge">已宣称</span>
            <button class="btn btn-outline btn-danger" data-action="claim-cancel" data-nation="0" data-state="${region.id}" data-exp-focus="cancel-${region.id}"
                ${tooltipAttrs("取消", escapeGameText(`取消宣称并返还 ${CLAIM_COST} 政治点；交战中不可取消。`))}
                ${state.winner === null && canCancelStateClaim(state, 0, region.id) ? "" : "disabled"}>取消</button>${this.locateButton(region)}
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