import type { GameEngine } from "../../game/engine.ts";
import type { GameState } from "../../game/types/state.ts";
import type { ProvinceStance } from "../../game/types/entities.ts";
import type { UnitKind } from "../../game/types/unit.ts";
import { nationDisplayColor } from "../../game/access.ts";
import { canTrain } from "../../game/economy.ts";
import { armyUnitCap, nationUnitCount, provinceComposition } from "../../game/provinceArmy.ts";
import { UNIT_KINDS, UNIT_PROFILES } from "../../game/types/unit.ts";
import { t } from "../../i18n/index.ts";
import { escapeGameText, game, html, rawHtml } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, PanelShell } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { gameHtml, scopedTexts } from "../view.ts";

const STANCES: readonly ProvinceStance[] = ["auto", "defend", "attack"];

function deployTexts() {
    const base = scopedTexts("panels.deploy.", {
        title: ["title"],
        helpTitle: ["helpTitle"],
        help: ["help"],
        ended: ["ended"],
        targetLabel: ["targetLabel"],
        targetHint: ["targetHint"],
        noTarget: ["noTarget"],
        stance: ["stance"],
        stanceAuto: ["stance.auto"],
        stanceAutoTip: ["stance.autoTip"],
        stanceDefend: ["stance.defend"],
        stanceDefendTip: ["stance.defendTip"],
        stanceAttack: ["stance.attack"],
        stanceAttackTip: ["stance.attackTip"],
        composition: ["composition"],
        emptyComposition: ["emptyComposition"],
        removeOne: ["removeOne"],
        removeOneTip: ["removeOneTip"],
        clear: ["clear"],
        clearTip: ["clearTip"],
        garrison: ["garrison"],
        unitTypes: ["unitTypes"],
        hint: ["hint"],
    });
    return {
        ...base,
        status: (count: number, cap: number) => t("panels.deploy.status", { count, cap }),
        unitDetail: (params: { cost: string; upkeep: string; atk: number; def: number }) =>
            t("panels.deploy.unitDetail", params),
        compositionCount: (name: string, count: number) => t("panels.deploy.compositionCount", { name, count }),
        noFunds: t("panels.deploy.noFunds"),
        atCap: t("panels.deploy.atCap"),
    };
}
type DeployTexts = ReturnType<typeof deployTexts>;

function unitButton(state: GameState, kind: UnitKind, color: string, atCap: boolean, texts: DeployTexts): string {
    const up = UNIT_PROFILES[kind];
    const affordable = canTrain(state, 0, kind);
    const costParts = [game`[[funds:${up.cost}]]`];
    if (up.industryCost > 0) costParts.push(game`[[industry:${up.industryCost}]]`);
    const upkeepParts = [game`[[funds:${up.upkeep}]]`, game`[[food:${up.foodUpkeep}]]`];
    if (up.strategicUpkeep > 0) upkeepParts.push(game`[[strategic:${up.strategicUpkeep}]]`);
    if (up.industryUpkeep > 0) upkeepParts.push(game`[[industry:${up.industryUpkeep}]]`);
    const detail = `${up.desc}\n\n${texts.unitDetail({
        cost: costParts.join(" · "), upkeep: upkeepParts.join(" · "), atk: up.atk, def: up.def,
    })}${atCap ? `\n\n${texts.atCap}` : affordable ? "" : `\n\n${texts.noFunds}`}`;
    return html`<button class="deploy-kind" draggable="true" data-drag-kind="${kind}" style="--nc:${color}" ${rawHtml(tooltipAttrs(escapeGameText(up.name), detail))}>
        <span class="unit-glyph small" style="--pc:${color}">${up.glyph}</span>
        <span class="deploy-kind-name">${up.name}</span>
        <span class="deploy-kind-count">${rawHtml(gameHtml(game`[[funds:${up.cost}]]`))}</span>
    </button>`;
}

function stanceButton(state: GameState, site: number, stance: ProvinceStance, texts: DeployTexts): string {
    const province = state.provinces[site];
    const active = (province.stance ?? "auto") === stance ? " active" : "";
    const label = stance === "auto" ? texts.stanceAuto : stance === "defend" ? texts.stanceDefend : texts.stanceAttack;
    const tip = stance === "auto" ? texts.stanceAutoTip : stance === "defend" ? texts.stanceDefendTip : texts.stanceAttackTip;
    return html`<button type="button" class="stance-btn${active}" data-action="province-stance" data-stance="${stance}" ${rawHtml(tooltipAttrs(label, tip))}>${label}</button>`;
}

/** Province army workbench: composition, posture and draggable unit palette. */
export function deployView(state: GameState): PanelView {
    const text: DeployTexts = deployTexts();
    const head = panelHead({
        title: text.title,
        help: { title: text.helpTitle, body: text.help },
        status: text.status(nationUnitCount(state, 0), armyUnitCap(state, 0)),
    });
    if (state.winner !== null) {
        return { head, body: html`<div class="empty-hint">${text.ended}</div>` };
    }

    const player = state.nations[0];
    const color = nationDisplayColor(state, 0);
    const site = state.selected;
    const ownSelected = site !== null && state.provinces[site].owner === 0;
    const province = ownSelected && site !== null ? state.provinces[site] : null;
    const composition = province ? provinceComposition(state, province.site) : [];
    const compositionRows = composition.length
        ? composition.map((entry) => {
            const profile = UNIT_PROFILES[entry.kind];
            return html`<div class="province-comp-row"><span class="unit-glyph small" style="--pc:${color}">${profile.glyph}</span>
                <span>${text.compositionCount(profile.name, entry.count)}</span>
                <button type="button" class="btn btn-sm comp-remove" data-action="disband-regiment" data-kind="${entry.kind}" ${rawHtml(tooltipAttrs(text.removeOne, text.removeOneTip))}>−</button></div>`;
        }).join("")
        : html`<p class="deploy-empty">${text.emptyComposition}</p>`;

    const target = province
        ? html`<div class="deploy-target">${text.targetLabel}<b>${province.name}</b>
            <span class="province-garrison">${text.garrison} ${province.garrison}/${province.garrisonMax}</span></div>
            <div class="stance-row" role="group" aria-label="${text.stance}">
                <span class="stance-label">${text.stance}</span>
                ${rawHtml(STANCES.map((stance) => stanceButton(state, province.site, stance, text)).join(""))}
            </div>
            <div class="province-comp">
                <div class="province-comp-head"><span>${text.composition}</span>
                    <button type="button" class="btn btn-sm deploy-clear" data-action="clear-province-troops" ${rawHtml(tooltipAttrs(text.clear, text.clearTip))} ${rawHtml(composition.length ? "" : " disabled")}>${text.clear}</button>
                </div>
                ${rawHtml(compositionRows)}
            </div>`
        : html`<div class="deploy-target deploy-target--empty"><b>${text.noTarget}</b><span>${text.targetHint}</span></div>`;

    const atCap = nationUnitCount(state, 0) >= armyUnitCap(state, 0);
    const trainRows = UNIT_KINDS.map((kind) => unitButton(state, kind, color, atCap, text)).join("");
    const funds = rawHtml(gameHtml(game`[[funds:${Math.floor(player.funds)}]]`));

    return {
        head,
        body: html`<div class="deploy-section">
            ${rawHtml(target)}
            <div class="deploy-pane province-palette">
                <div class="deploy-pane-head"><span>${text.unitTypes}</span><span>${funds}</span></div>
                <div class="deploy-pane-body">${rawHtml(trainRows)}</div>
            </div>
            <p class="micro-hint">${text.hint}</p>
        </div>`,
    };
}

/** Province army workbench (dock tab 1). */
export class DeployPanel {
    private readonly engine: GameEngine;
    private readonly shell = new PanelShell(document.querySelector<HTMLElement>("#deploy-panel") as HTMLElement);

    constructor(engine: GameEngine) {
        this.engine = engine;
        this.shell.el.addEventListener("dragstart", (event) => {
            const button = (event.target as HTMLElement).closest<HTMLElement>("[data-drag-kind]");
            if (!button || !(event instanceof DragEvent)) return;
            event.dataTransfer?.setData("text/plain", button.dataset.dragKind ?? "");
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
        });
    }

    setHidden(hidden: boolean): void {
        if (hidden) this.shell.hide();
        else this.shell.show();
    }

    render(): void {
        this.shell.render(deployView(this.engine.state));
    }
}