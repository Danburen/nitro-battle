import type { GameEngine } from "../../game/engine.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { canTrain } from "../../game/economy.ts";
import { armyCap, nationArmyCount } from "../../game/rules.ts";
import { REGIMENT_CAP, UNIT_KINDS, UNIT_PROFILES } from "../../game/types/unit.ts";
import { escapeGameText, escapeHtml, game } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, renderPanel } from "../panel.ts";
import { t } from "../../i18n/index.ts";

const DEPLOY_TIP = {
    get body(): string { return t("panels.deploy.help", { regimentCap: REGIMENT_CAP }); },
};

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
                title: t("panels.deploy.title"),
                help: { title: t("panels.deploy.helpTitle"), body: DEPLOY_TIP.body },
                status: t("panels.deploy.status", { count: nationArmyCount(state, 0), cap: armyCap(state, 0) }),
            }),
            body: this.trainSectionHtml(),
        });
    }

    private trainSectionHtml(): string {
        const state = this.engine.state;
        if (state.winner !== null) return `<div class="empty-hint">${t("panels.deploy.ended")}</div>`;

        const player = state.nations[0];
        const playerColor = nationDisplayColor(state, 0);
        const queue = state.deployments.filter((order) => order.nation === 0);
        const selectedSite = state.selected;
        const ownSelected = selectedSite !== null && state.provinces[selectedSite].owner === 0;
        const targetLabel = ownSelected && selectedSite !== null ? state.provinces[selectedSite].name : t("panels.deploy.auto");

        const trainRows = UNIT_KINDS.map((kind) => {
            const up = UNIT_PROFILES[kind];
            const affordable = canTrain(state, 0, kind);
            const costParts = [game`[[funds:${up.cost}]]`, game`[[manpower:${up.manpowerCost}]]`];
            if (up.industryCost > 0) costParts.push(game`[[industry:${up.industryCost}]]`);
            const upkeepParts = [game`[[funds:${up.upkeep}]]`, game`[[food:${up.foodUpkeep}]]`];
            if (up.strategicUpkeep > 0) upkeepParts.push(game`[[strategic:${up.strategicUpkeep}]]`);
            if (up.industryUpkeep > 0) upkeepParts.push(game`[[industry:${up.industryUpkeep}]]`);
            const detail = `${up.desc}\n\n${t("panels.deploy.unitDetail", {
                cost: costParts.join(" · "), upkeep: upkeepParts.join(" · "),
                days: up.trainDays, atk: up.atk, def: up.def, mp: up.mp,
            })}`;
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
                ? t("panels.deploy.order.blocked")
                : order.daysLeft > 0
                    ? t("panels.deploy.order.training", { days: order.daysLeft })
                    : t("panels.deploy.order.pending");
            const options = [
                `<option value="">${t("panels.deploy.option.auto")}</option>`,
                ...destinations.map((site) =>
                    `<option value="${site}"${order.destination === site ? " selected" : ""}>${escapeHtml(state.provinces[site].name)}${state.provinces[site].isCapital ? t("panels.deploy.option.capital") : ""}</option>`),
            ];
            if (order.destination !== null && !destinations.includes(order.destination)) {
                options.push(`<option value="${order.destination}" selected>${escapeHtml(state.provinces[order.destination].name)}</option>`);
            }
            return `
                <div class="deploy-order">
                    <div class="deploy-order-head">
                        <span class="deploy-order-name">${escapeHtml(up.glyph)} ${escapeHtml(up.name)}</span>
                        <button class="deploy-cancel" data-action="train-cancel" data-order="${order.id}" aria-label="${t("panels.deploy.order.cancel", { name: escapeHtml(up.name) })}">×</button>
                    </div>
                    <div class="deploy-order-status${order.status === "blocked" ? " blocked" : ""}">${status}</div>
                    <select class="deploy-order-dest" data-action="train-target" data-order="${order.id}" aria-label="${t("panels.deploy.order.destination", { name: escapeHtml(up.name) })}">${options.join("")}</select>
                </div>`;
        }).join("");

        return game`
            <div class="deploy-section">
                <div class="deploy-target">${t("panels.deploy.targetLabel")}<b>${escapeHtml(targetLabel)}</b>${ownSelected ? "" : ` · ${t("panels.deploy.targetHint")}`}</div>
                <div class="deploy-workbench">
                    <div class="deploy-pane">
                        <div class="deploy-pane-head"><span>${t("panels.deploy.queue")}</span><span>${queue.length}</span></div>
                        <div class="deploy-pane-body">
                            ${queueRows || `<div class="deploy-empty">${t("panels.deploy.queueEmpty")}</div>`}
                        </div>
                    </div>
                    <div class="deploy-pane">
                        <div class="deploy-pane-head"><span>${t("panels.deploy.unitTypes")}</span><span>[[funds:${Math.floor(player.funds)}]]</span></div>
                        <div class="deploy-pane-body">${trainRows}</div>
                    </div>
                </div>
                <p class="micro-hint">${t("panels.deploy.hint")}</p>
            </div>`;
    }
}