import type { GameEngine } from "../../game/engine.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { canTrain } from "../../game/economy.ts";
import { armyCap, nationArmyCount } from "../../game/rules.ts";
import { REGIMENT_CAP, UNIT_KINDS, UNIT_PROFILES } from "../../game/types.ts";
import { escapeGameText, escapeHtml, renderGameText, textToken } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, renderPanel } from "../panel.ts";

const DEPLOY_TIP = `训练立即扣除[[funds]]/[[manpower]]/[[industry]]，完成后优先补充落点的未满军团（每军团 ${REGIMENT_CAP} 团），否则新建军团；军团满编时自动寻找其他落点。\n\n选中己方首都或城市可指定落点，否则自动优先首都/城市。\n队列中的项目可随时取消，返还半数资源。\n军团数量上限随控制的州增长。`;

/** Training & deployment workbench (dock tab 2). */
export class DeployPanel {
    private readonly engine: GameEngine;
    private readonly el = document.querySelector<HTMLElement>("#deploy-panel") as HTMLElement;

    constructor(engine: GameEngine) {
        this.engine = engine;
    }

    setHidden(hidden: boolean): void {
        this.el.classList.toggle("hidden", hidden);
    }

    render(): void {
        const state = this.engine.state;
        renderPanel(this.el, {
            head: panelHead({
                title: "部署",
                help: { title: "训练与部署", body: DEPLOY_TIP },
                status: `${nationArmyCount(state, 0)}/${armyCap(state, 0)} 军团`,
            }),
            body: this.trainSectionHtml(),
        });
    }

    private trainSectionHtml(): string {
        const state = this.engine.state;
        if (state.winner !== null) return `<div class="empty-hint">战役已结束。</div>`;

        const player = state.nations[0];
        const playerColor = nationDisplayColor(state, 0);
        const queue = state.deployments.filter((order) => order.nation === 0);
        const selectedSite = state.selected;
        const ownSelected = selectedSite !== null && state.provinces[selectedSite].owner === 0;
        const targetLabel = ownSelected && selectedSite !== null ? state.provinces[selectedSite].name : "自动";

        const trainRows = UNIT_KINDS.map((kind) => {
            const up = UNIT_PROFILES[kind];
            const affordable = canTrain(state, 0, kind);
            const costParts = [textToken("funds", up.cost), textToken("manpower", up.manpowerCost)];
            if (up.industryCost > 0) costParts.push(textToken("industry", up.industryCost));
            const detail = `${up.desc}\n\n造价 ${costParts.join(" · ")}\n维护 ${textToken("funds", up.upkeep)}/${textToken("turn")}\n训练 ${textToken("turn", up.trainDays)} · 攻${up.atk}/防${up.def}/机动${up.mp}`;
            return `
                <button class="deploy-kind" data-action="train" data-kind="${kind}" style="--nc:${escapeHtml(playerColor)}" ${tooltipAttrs(escapeGameText(up.name), detail)} ${affordable ? "" : "disabled"}>
                    <span class="unit-glyph small" style="--pc:${escapeHtml(playerColor)}">${escapeHtml(up.glyph)}</span>
                    <span class="deploy-kind-name">${escapeHtml(up.name)}</span>
                </button>`;
        }).join("");

        const destinations = state.provinces
            .filter((province) => province.owner === 0 && (province.isCity || province.isCapital))
            .map((province) => province.site);

        const queueRows = queue.map((order) => {
            const up = UNIT_PROFILES[order.kind];
            const status = order.status === "blocked"
                ? "落点被阻断"
                : order.daysLeft > 0
                    ? `训练中 · 剩 ${textToken("turn", order.daysLeft)}`
                    : "待部署";
            const options = [
                `<option value="">自动（优先首都/城市）</option>`,
                ...destinations.map((site) =>
                    `<option value="${site}"${order.destination === site ? " selected" : ""}>${escapeHtml(state.provinces[site].name)}${state.provinces[site].isCapital ? "（首都）" : ""}</option>`),
            ];
            if (order.destination !== null && !destinations.includes(order.destination)) {
                options.push(`<option value="${order.destination}" selected>${escapeHtml(state.provinces[order.destination].name)}</option>`);
            }
            return `
                <div class="deploy-order">
                    <div class="deploy-order-head">
                        <span class="deploy-order-name">${escapeHtml(up.glyph)} ${escapeHtml(up.name)}</span>
                        <button class="deploy-cancel" data-action="train-cancel" data-order="${order.id}" aria-label="取消${escapeHtml(up.name)}训练">×</button>
                    </div>
                    <div class="deploy-order-status${order.status === "blocked" ? " blocked" : ""}">${status}</div>
                    <select class="deploy-order-dest" data-action="train-target" data-order="${order.id}" aria-label="${escapeHtml(up.name)}部署地点">${options.join("")}</select>
                </div>`;
        }).join("");

        return `
            <div class="deploy-section">
                <div class="deploy-target">部署目标：<b>${escapeHtml(targetLabel)}</b>${ownSelected ? "" : " · 选中己方省份可指定落点"}</div>
                <div class="deploy-workbench">
                    <div class="deploy-pane">
                        <div class="deploy-pane-head"><span>队列</span><span>${queue.length}</span></div>
                        <div class="deploy-pane-body">
                            ${queueRows || `<div class="deploy-empty">队列为空<br />点右侧兵种添加</div>`}
                        </div>
                    </div>
                    <div class="deploy-pane">
                        <div class="deploy-pane-head"><span>兵种</span><span>${renderGameText(textToken("funds", Math.floor(player.funds)))}</span></div>
                        <div class="deploy-pane-body">${trainRows}</div>
                    </div>
                </div>
                <p class="micro-hint">${renderGameText("点击兵种加入训练队列 · 选中己方首都/城市指定落点 · 取消返还半数资源")}</p>
            </div>`;
    }
}