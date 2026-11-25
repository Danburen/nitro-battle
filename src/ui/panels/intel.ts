import type { GameEngine } from "../../game/engine.ts";
import { isAtWar } from "../../game/diplomacy.ts";
import { battleForecast } from "../../game/battle.ts";
import { infrastructureBuildMultiplier, infrastructureLevel, infrastructureMoveMultiplier, infrastructureOutputMultiplier, infrastructureSupplyMultiplier, occupationGrowth, provinceBuildingCapacity, provinceDefense, provinceFundsIncome, provinceResourceOutput, resourceYieldMultiplier, stateBuildingCapacity } from "../../game/economy.ts";
import { supplyLevel } from "../../game/supply.ts";
import { provincePopulationView } from "../../game/stability.ts";
import { armyAt, entryCost, regimentHp } from "../../game/rules.ts";
import { BUILDING_PROFILES, INFRASTRUCTURE_MAX, PROVINCE_BUILDING_KINDS, STATE_BUILDING_KINDS } from "../../game/types/building.ts";
import { NEUTRAL } from "../../game/types/world.ts";
import { ORG_MAX } from "../../game/types/organization.ts";
import type { Battle } from "../../game/types/organization.ts";
import type { BuildingKind } from "../../game/types/building.ts";
import type { Province } from "../../game/types/entities.ts";
import { BIOME_ZH, ownerColor, ownerName } from "../common.ts";
import { BIOME_PROFILES } from "../../terrain/biome.ts";
import { escapeGameText, escapeHtml as escapeText, iconMaskStyle, peopleCount, renderGameText, signClass, textToken } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, PanelShell } from "../panel.ts";
import { tendencyBadge } from "../tendency.ts";

const INTEL_TIP = `点击地图查询省份或州。\n省份：地形、城市防御、通行、天气、[[supply]]水平、控制国与正式归属、[[occupation]]进度、驻军军团与省份设施。\n州：州中心、控制范围、[[factory]]/[[farm]]/[[infrastructure]]/[[admin]]建筑容量与增益。\n带 i 或「地区修正」按钮可查看详细修正，建筑图标上悬停显示产量与建造条件。`;

function infrastructureEffects(level: number): string {
    return `产出系数 ×${infrastructureOutputMultiplier(level).toFixed(2)}\n[[construction]]系数 ×${infrastructureBuildMultiplier(level).toFixed(2)}\n[[movement]]成本系数 ×${infrastructureMoveMultiplier(level).toFixed(2)}\n[[supply]]系数 ×${infrastructureSupplyMultiplier(level).toFixed(2)}`;
}

export class IntelPanel {
    private readonly engine: GameEngine;
    private readonly shell = new PanelShell(document.querySelector<HTMLElement>("#intel-panel") as HTMLElement);

    constructor(engine: GameEngine) {
        this.engine = engine;
    }

    render(mode: "province" | "state"): void {
        const state = this.engine.state;
        const site = state.selected;
        if (site === null) {
            this.shell.render({
                head: panelHead({ title: mode === "state" ? "州情报" : "省份", help: { title: "情报面板", body: INTEL_TIP } }),
                body: `<div class="empty-hint">${renderGameText(`点击地图查看${mode === "state" ? "州" : "省份"}。左上「建造」管理州属[[factory]]、[[farm]]、[[infrastructure]]、[[admin]]与省份[[supply]]中心、[[fort]]；点击军团接管指挥。`)}</div>`,
            });
            return;
        }

        const province = state.provinces[site];
        if (mode === "state" && province.stateId >= 0) {
            const region = state.states[province.stateId];
            const center = state.provinces[region.center];
            this.shell.render({
                head: panelHead({
                    title: "州情报",
                    help: { title: "情报面板", body: INTEL_TIP },
                    extras: `<span class="owner-pill" style="--pc:${escapeText(ownerColor(state, center.owner))}">${escapeText(ownerName(state, center.owner))}</span>`,
                }),
                body: `
                    <div class="prov-title">${escapeText(region.name)}<span class="prov-kind">${region.provinces.length} 省</span></div>
                    <div class="intel-selection"><span>选中省份：${escapeText(province.name)} · 控制国：${escapeText(ownerName(state, province.owner))} · 正式归属：${escapeText(ownerName(state, province.legalOwner))}</span>${this.modifiersHtml(province)}</div>
                    ${this.stateSectionHtml(province)}${this.provinceBuildingsHtml(province)}`,
            });
            return;
        }
        const biome = state.terrain.biomeAt(site);
        const profile = BIOME_PROFILES[biome];
        const snow = state.terrain.snowCover[site];
        const occupant = armyAt(state, site);
        const color = ownerColor(state, province.owner);
        const battle = this.engine.battleAt(site);
        const kindLabel = province.isCapital ? "首都" : province.isCity ? "城市" : "省份";
        const snowText = snow === 2 ? "深雪 ×0.5 速度" : snow === 1 ? "浅雪 ×0.75 速度" : "无积雪";
        const supply = supplyLevel(state, site);
        const supplyText = supply >= 0.8 ? "充足" : supply >= 0.5 ? "受限" : "匮乏";
        const supplyClass = supply >= 0.8 ? "good" : supply >= 0.5 ? "mid" : "bad";
        const isCore = province.owner !== NEUTRAL && province.coreNation === province.owner;
        const population = provincePopulationView(state, province);
        const occGrowth = occupationGrowth(state, province, province.owner);
        const occHtml = province.owner !== NEUTRAL && !isCore ? `
            <div class="kv-row"><dt>${renderGameText("[[occupation]]")}</dt><dd>
                <div class="garrison-bar occ"><i style="width:${province.occupation}%"></i></div>
                ${Math.floor(province.occupation)}%<span class="garrison-note ${signClass(String(occGrowth))}">${occGrowth >= 0 ? "+" : ""}${occGrowth.toFixed(0)}/${renderGameText("[[turn]]")}</span>
            </dd></div>` : "";
        const presenceHtml = occupant ? `
            <div class="army-presence" ${tooltipAttrs(escapeGameText(occupant.name), `[[organization]] ${Math.round(occupant.org)}/${ORG_MAX}`)}>
                <span style="--pc:${escapeText(ownerColor(state, occupant.nation))}">${escapeText(occupant.name)}</span>
                （${escapeText(ownerName(state, occupant.nation))}）· ${occupant.regiments.length} 团 · ${regimentHp(occupant)} HP
                ${occupant.nation === 0 ? " · 左上详情窗可指挥" : ""}
            </div>` : "";

        this.shell.render({
            head: panelHead({
                title: "省份",
                help: { title: "情报面板", body: INTEL_TIP },
                extras: `<span class="owner-pill" style="--pc:${escapeText(color)}">${escapeText(ownerName(state, province.owner))}</span>`,
            }),
            body: `
                <div class="prov-title">${escapeText(province.name)}<span class="prov-kind">${kindLabel}</span></div>
                <div class="tag-row">
                    <span class="tag">${escapeText(BIOME_ZH[biome] ?? profile.name)}</span>
                    <span class="tag">${renderGameText(`地形/城市[[defense]] ×${provinceDefense(state, province).toFixed(2)}`)}</span>
                    <span class="tag">产值 ${renderGameText(textToken("funds", `+${Math.round(provinceFundsIncome(province) * 10) / 10}`))}</span><span class="tag">人口 ${peopleCount(population.people)}（可招募 ${peopleCount(population.eligible)}）</span>
                    <span class="tag supply-${supplyClass}" ${tooltipAttrs("[[supply]]水平", "[[supply]]可超过 100%；战斗与[[organization]]恢复的[[supply]]系数最多按 100% 计算。")}>${renderGameText(`[[supply]] ${Math.round(supply * 100)}% · ${supplyText}`)}</span>
                    ${province.owner !== NEUTRAL && province.owner !== 0 ? `<span class="tag">${isAtWar(state, 0, province.owner) ? "交战中" : "和平"}</span>` : ""}
                    ${this.modifiersHtml(province)}
                </div>
                <dl class="kv">
                    <div class="kv-row"><dt>控制国</dt><dd>${escapeText(ownerName(state, province.owner))}</dd></div>
                    <div class="kv-row"><dt>正式归属</dt><dd>${escapeText(ownerName(state, province.legalOwner))}</dd></div>
                    ${province.owner > 0 ? `<div class="kv-row"><dt>外交倾向</dt><dd>${tendencyBadge(state.nations[province.owner], state)}</dd></div>` : ""}
                    ${occHtml}
                    <div class="kv-row"><dt>通行成本</dt><dd>${state.terrain.passable[site] ? entryCost(state, site).toFixed(2) : "不可通行"}</dd></div>
                    <div class="kv-row"><dt>天气</dt><dd>${snowText}</dd></div>
                </dl>
                ${presenceHtml}${battle ? this.battleHtml(battle) : ""}${this.stateSectionHtml(province)}${this.provinceBuildingsHtml(province)}`,
        });
    }

    private modifiersHtml(province: Province): string {
        const state = this.engine.state;
        const region = state.states[province.stateId];
        const infrastructure = infrastructureLevel(state, province.site);
        const applicability = !region ? "未属州：州[[infrastructure]]不生效，按 0 级。"
            : state.provinces[region.center].owner !== province.owner ? "与州中心异主：是，州[[infrastructure]]不生效，按 0 级。"
            : province.owner === NEUTRAL ? "与州中心异主：否；中立省份的州[[infrastructure]]不生效，按 0 级。"
            : "与州中心异主：否，州[[infrastructure]]生效。";
        const title = `地区修正 · ${escapeGameText(province.name)}`;
        const output = provinceResourceOutput(state, province);
        const deposits = `矿点：[[raw]] ${province.deposits.raw} 级 · 产出 ${output.raw.toFixed(2)}/[[turn]]；[[strategic]] ${province.deposits.strategic} 级 · 产出 ${output.strategic.toFixed(2)}/[[turn]]；[[food]] 产出 ${(output.food + output.farmFood).toFixed(2)}/[[turn]]。\n有效[[infrastructure]] ${output.infrastructure} 级 → 矿产系数 ×${resourceYieldMultiplier(output.infrastructure).toFixed(2)}；[[occupation]]系数 ×${output.occupation.toFixed(2)}（0 为无矿）。`;
        const body = `有效州[[infrastructure]]：${infrastructure}/${INFRASTRUCTURE_MAX} 级\n${infrastructureEffects(infrastructure)}\n${applicability}\n${deposits}`;
        return `<button type="button" class="intel-help intel-modifiers" aria-label="${escapeText(renderGameText(title, "plain"))}" data-focus-key="${escapeText(`province-${province.site}-modifiers`)}" ${tooltipAttrs(title, body)}>地区修正</button>`;
    }

    private buildingCardHtml(kind: BuildingKind, built: number, limit: number, pending: number, focusKey: string, detail = ""): string {
        const profile = BUILDING_PROFILES[kind];
        const count = pending > 0 ? `${built}+${pending}/${limit}` : `${built}/${limit}`;
        const countHtml = pending > 0
            ? `${built}<span class="building-pending">+${pending}</span>/${limit}`
            : `${built}/${limit}`;
        const title = `${textToken(kind)}${kind === "supply" ? "中心" : ""}`;
        const body = `已建/上限：${count}\n待建：${pending}\n${profile.desc}\n建造需求：${textToken("construction", profile.constructionPoints)}。${detail ? `\n${detail}` : ""}`;
        return `<span class="intel-building-card${pending > 0 ? " pending" : ""}" tabindex="0" role="img" aria-label="${escapeText(renderGameText(`${title}：${body}`, "plain"))}" data-focus-key="${escapeText(focusKey)}" ${tooltipAttrs(title, body)}>
            <span class="building-icon" aria-hidden="true" ${iconMaskStyle(profile.icon)}></span>
            <span class="intel-building-count">${countHtml}</span>
        </span>`;
    }

    private provinceBuildingsHtml(province: Province): string {
        const state = this.engine.state;
        if (!state.terrain.passable[province.site]) return "";
        const buildings = PROVINCE_BUILDING_KINDS.map((kind) => {
            const { built, pending, limit } = provinceBuildingCapacity(state, province, kind);
            const effects = kind === "fort"
                ? "仅本省：[[garrison]]上限 +50%，非交战每日恢复上限的 15%（普通 10%）；[[garrison]]造成伤害 +25%，[[garrison]]承受伤害 ×0.8。不改变地形/城市[[defense]]倍率。"
                : "沿己方陆地辐射范围 8：距离 d，u = 1 − d/8；[[supply]]加成 +10u 个百分点、倍率 ×(1 + 0.2u)。重叠中心取最强，不累加。";
            return this.buildingCardHtml(kind, built, limit, pending, `province-${province.site}-${kind}`, effects);
        }).join("");
        return `<div class="state-section province-facilities">
            <div class="deploy-head"><span>省份设施 · ${escapeText(province.name)}</span></div>
            <div class="intel-building-cards">${buildings}</div>
        </div>`;
    }

    private stateSectionHtml(province: Province): string {
        const state = this.engine.state;
        if (province.stateId < 0) return "";
        const region = state.states[province.stateId];
        const center = state.provinces[region.center];
        const capacity = region.provinces.length;
        const controlled = region.provinces.filter((site) => state.provinces[site].owner === center.owner).length;
        const claimants = [...new Set(state.claims.filter((claim) => claim.stateId === region.id).map((claim) => claim.nation))];
        const rules = `宣称国：${claimants.length ? claimants.map((nation) => escapeGameText(ownerName(state, nation))).join("、") : "无"}\n州中心控制国：${escapeGameText(ownerName(state, center.owner))}\n州中心正式归属：${escapeGameText(ownerName(state, center.legalOwner))}\n数量为已建/上限，待建也占容量。\n[[factory]]、[[farm]]各自独立上限为州内省份数（${capacity} 座）。\n[[infrastructure]]上限 ${INFRASTRUCTURE_MAX} 级，仅同属州中心控制者的省份生效；异主省份按 0 级倍率。\n[[admin]]每州限 1 座，州中心为核心或[[occupation]] ≥50% 时仅 [[politics:+1]]/[[turn]]，不加快占领整合。`;
        const buildings = STATE_BUILDING_KINDS.map((kind) => {
            const { built, pending, limit } = stateBuildingCapacity(state, region, kind);
            const detail = kind === "factory" ? `[[production]] ${region.prodFactories} · [[idle]] ${region.factories - region.prodFactories}`
                : kind === "infrastructure" ? `州级倍率：\n${infrastructureEffects(built)}` : "";
            return this.buildingCardHtml(kind, built, limit, pending, `state-${region.id}-${kind}`, detail);
        }).join("");
        return `<div class="state-section">
            <div class="deploy-head"><span class="intel-state-heading"><span>州情况</span><span>${escapeText(region.name)}</span></span><button type="button" class="intel-help intel-info" aria-label="州信息与建筑规则" data-focus-key="${escapeText(`state-${region.id}-rules`)}" ${tooltipAttrs("州信息与建筑规则", rules)}>i</button></div>
            <dl class="kv">
                <div class="kv-row"><dt>州中心</dt><dd>${escapeText(center.name)} · ${escapeText(ownerName(state, center.owner))}</dd></div>
                <div class="kv-row"><dt>控制范围</dt><dd>${escapeText(`${controlled}/${capacity}`)} 省</dd></div>
                ${center.owner > 0 ? `<div class="kv-row"><dt>外交倾向</dt><dd>${tendencyBadge(state.nations[center.owner], state)}</dd></div>` : ""}
            </dl>
            <div class="intel-building-cards">${buildings}</div>
            ${center.owner === 0 || province.owner === 0 ? '<button class="btn btn-sm" data-action="open-construction">前往建造页</button>' : ""}
        </div>`;
    }

    private battleHtml(battle: Battle): string {
        const state = this.engine.state;
        const attacker = state.armies.get(battle.attackerId);
        const defender = battle.defenderId !== null ? state.armies.get(battle.defenderId) : null;
        const forecast = attacker ? battleForecast(state, attacker, battle.province) : null;
        const cancelBtn = attacker && attacker.nation === 0 ? '<button class="btn btn-sm" data-action="attack-cancel">停止进攻</button>' : "";
        return `<div class="battle-box">
            <div class="battle-head">会战进行中 · 第 ${battle.rounds + 1} 轮 ${cancelBtn}</div>
            <div class="battle-sides">
                <span style="--pc:${escapeText(ownerColor(state, attacker?.nation ?? NEUTRAL))}">${escapeText(attacker?.name ?? "?")}（${escapeText(ownerName(state, attacker?.nation ?? NEUTRAL))}）</span>
                <span class="battle-vs">vs</span><span>${defender ? `${escapeText(defender.name)} + 驻军` : "驻军"}（${escapeText(ownerName(state, state.provinces[battle.province].owner))}）</span>
            </div>
            ${forecast ? `<div class="assault-odds">攻 ${Math.round(forecast.attackPower)} / 守 ${Math.round(forecast.defensePower)} · 每日结算一轮</div>` : ""}
        </div>`;
    }
}
