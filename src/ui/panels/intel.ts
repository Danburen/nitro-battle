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
import { BIOME_PROFILES } from "../../game/terrain/biome.ts";
import { escapeGameText, escapeHtml as escapeText, iconMaskStyle, peopleCount, gameText, signClass, game } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, PanelShell } from "../panel.ts";
import { tendencyBadge } from "../tendency.ts";
import { t } from "../../i18n/index.ts";

const INTEL_TIP = {
    get body(): string { return t("panels.intel.help"); },
};

function infrastructureEffects(level: number): string {
    return t("panels.intel.infrastructure.effects", {
        output: infrastructureOutputMultiplier(level).toFixed(2),
        construction: infrastructureBuildMultiplier(level).toFixed(2),
        movement: infrastructureMoveMultiplier(level).toFixed(2),
        supply: infrastructureSupplyMultiplier(level).toFixed(2),
    });
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
                head: panelHead({ title: t(mode === "state" ? "panels.intel.state.title" : "panels.intel.province.title"), help: { title: t("panels.intel.helpTitle"), body: INTEL_TIP.body } }),
                body: `<div class="empty-hint">${t("panels.intel.empty.hint", { area: t(mode === "state" ? "panels.intel.area.state" : "panels.intel.area.province") })}</div>`,
            });
            return;
        }

        const province = state.provinces[site];
        if (mode === "state" && province.stateId >= 0) {
            const region = state.states[province.stateId];
            const center = state.provinces[region.center];
            this.shell.render({
                head: panelHead({
                    title: t("panels.intel.state.title"),
                    help: { title: t("panels.intel.helpTitle"), body: INTEL_TIP.body },
                    extras: `<span class="owner-pill" style="--pc:${escapeText(ownerColor(state, center.owner))}">${escapeText(ownerName(state, center.owner))}</span>`,
                }),
                body: `
                    <div class="prov-title">${escapeText(region.name)}<span class="prov-kind">${t("panels.intel.state.provinceCount", { count: region.provinces.length })}</span></div>
                    <div class="intel-selection"><span>${t("panels.intel.state.selection", { province: escapeText(province.name), controller: escapeText(ownerName(state, province.owner)), legal: escapeText(ownerName(state, province.legalOwner)) })}</span>${this.modifiersHtml(province)}</div>
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
        const kindLabel = province.isCapital ? t("panels.intel.kind.capital") : province.isCity ? t("panels.intel.kind.city") : t("panels.intel.area.province");
        const snowText = snow === 2 ? t("panels.intel.weather.deepSnow") : snow === 1 ? t("panels.intel.weather.lightSnow") : t("panels.intel.weather.none");
        const supply = supplyLevel(state, site);
        const supplyText = supply >= 0.8 ? t("panels.intel.supply.abundant") : supply >= 0.5 ? t("panels.intel.supply.limited") : t("panels.intel.supply.scarce");
        const supplyClass = supply >= 0.8 ? "good" : supply >= 0.5 ? "mid" : "bad";
        const isCore = province.owner !== NEUTRAL && province.coreNation === province.owner;
        const population = provincePopulationView(state, province);
        const occGrowth = occupationGrowth(state, province, province.owner);
        const occHtml = province.owner !== NEUTRAL && !isCore ? `
            <div class="kv-row"><dt>${"[[occupation]]"}</dt><dd>
                <div class="garrison-bar occ"><i style="width:${province.occupation}%"></i></div>
                ${Math.floor(province.occupation)}%<span class="garrison-note ${signClass(String(occGrowth))}">${occGrowth >= 0 ? "+" : ""}${occGrowth.toFixed(0)}/${"[[turn]]"}</span>
            </dd></div>` : "";
        const presenceHtml = occupant ? `
            <div class="army-presence" ${tooltipAttrs(escapeGameText(occupant.name), `[[organization]] ${Math.round(occupant.org)}/${ORG_MAX}`)}>
                <span style="--pc:${escapeText(ownerColor(state, occupant.nation))}">${escapeText(occupant.name)}</span>
                ${t("panels.intel.presence", { owner: escapeText(ownerName(state, occupant.nation)), regiments: occupant.regiments.length, hp: regimentHp(occupant) })}
                ${occupant.nation === 0 ? t("panels.intel.presence.commandHint") : ""}
            </div>` : "";

        this.shell.render({
            head: panelHead({
                title: t("panels.intel.province.title"),
                help: { title: t("panels.intel.helpTitle"), body: INTEL_TIP.body },
                extras: `<span class="owner-pill" style="--pc:${escapeText(color)}">${escapeText(ownerName(state, province.owner))}</span>`,
            }),
            body: game`
                <div class="prov-title">${escapeText(province.name)}<span class="prov-kind">${kindLabel}</span></div>
                <div class="tag-row">
                    <span class="tag">${escapeText(BIOME_ZH[biome] ?? profile.name)}</span>
                    <span class="tag">${t("panels.intel.tag.defense", { value: provinceDefense(state, province).toFixed(2) })}</span>
                    <span class="tag">${t("panels.intel.tag.income", { value: `+${Math.round(provinceFundsIncome(province) * 10) / 10}` })}</span><span class="tag">${t("panels.intel.tag.population", { people: peopleCount(population.people), eligible: peopleCount(population.eligible) })}</span>
                    <span class="tag supply-${supplyClass}" ${tooltipAttrs(t("panels.intel.supply.levelTitle"), t("panels.intel.supply.tip"))}>${t("panels.intel.supply.value", { percent: Math.round(supply * 100), level: supplyText })}</span>
                    ${province.owner !== NEUTRAL && province.owner !== 0 ? `<span class="tag">${isAtWar(state, 0, province.owner) ? t("panels.intel.war") : t("panels.intel.peace")}</span>` : ""}
                    ${this.modifiersHtml(province)}
                </div>
                <dl class="kv">
                    <div class="kv-row"><dt>${t("panels.intel.field.controller")}</dt><dd>${escapeText(ownerName(state, province.owner))}</dd></div>
                    <div class="kv-row"><dt>${t("panels.intel.field.legalOwner")}</dt><dd>${escapeText(ownerName(state, province.legalOwner))}</dd></div>
                    ${province.owner > 0 ? `<div class="kv-row"><dt>${t("panels.intel.field.tendency")}</dt><dd>${tendencyBadge(state.nations[province.owner], state)}</dd></div>` : ""}
                    ${occHtml}
                    <div class="kv-row"><dt>${t("panels.intel.field.entryCost")}</dt><dd>${state.terrain.passable[site] ? entryCost(state, site).toFixed(2) : t("panels.intel.impassable")}</dd></div>
                    <div class="kv-row"><dt>${t("panels.intel.field.weather")}</dt><dd>${snowText}</dd></div>
                </dl>
                ${presenceHtml}${battle ? this.battleHtml(battle) : ""}${this.stateSectionHtml(province)}${this.provinceBuildingsHtml(province)}`,
        });
    }

    private modifiersHtml(province: Province): string {
        const state = this.engine.state;
        const region = state.states[province.stateId];
        const infrastructure = infrastructureLevel(state, province.site);
        const applicability = !region ? t("panels.intel.applicability.noState")
            : state.provinces[region.center].owner !== province.owner ? t("panels.intel.applicability.differentOwner")
            : province.owner === NEUTRAL ? t("panels.intel.applicability.neutral")
            : t("panels.intel.applicability.sameOwner");
        const title = t("panels.intel.modifiers.title", { name: escapeGameText(province.name) });
        const output = provinceResourceOutput(state, province);
        const deposits = t("panels.intel.modifiers.deposits", {
            raw: province.deposits.raw, rawOutput: output.raw.toFixed(2),
            strategic: province.deposits.strategic, strategicOutput: output.strategic.toFixed(2),
            foodOutput: (output.food + output.farmFood).toFixed(2),
            infrastructure: output.infrastructure,
            yield: resourceYieldMultiplier(output.infrastructure).toFixed(2),
            occupation: output.occupation.toFixed(2),
        });
        const body = t("panels.intel.modifiers.body", { level: infrastructure, max: INFRASTRUCTURE_MAX, effects: infrastructureEffects(infrastructure), applicability, deposits });
        return `<button type="button" class="intel-help intel-modifiers" aria-label="${escapeText(gameText(title, "plain"))}" data-focus-key="${escapeText(`province-${province.site}-modifiers`)}" ${tooltipAttrs(title, body)}>${t("panels.intel.modifiers.button")}</button>`;
    }

    private buildingCardHtml(kind: BuildingKind, built: number, limit: number, pending: number, focusKey: string, detail = ""): string {
        const profile = BUILDING_PROFILES[kind];
        const count = pending > 0 ? `${built}+${pending}/${limit}` : `${built}/${limit}`;
        const countHtml = pending > 0
            ? `${built}<span class="building-pending">+${pending}</span>/${limit}`
            : `${built}/${limit}`;
        const title = game`[[${kind}]]${kind === "supply" ? t("panels.intel.building.supplyCenter") : ""}`;
        const body = t("panels.intel.building.body", { count, pending, desc: profile.desc, points: profile.constructionPoints, detail: detail ? `\n${detail}` : "" });
        return `<span class="intel-building-card${pending > 0 ? " pending" : ""}" tabindex="0" role="img" aria-label="${escapeText(gameText(`${title}：${body}`, "plain"))}" data-focus-key="${escapeText(focusKey)}" ${tooltipAttrs(title, body)}>
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
                ? t("panels.intel.fort.effects")
                : t("panels.intel.supplyZone.effects");
            return this.buildingCardHtml(kind, built, limit, pending, `province-${province.site}-${kind}`, effects);
        }).join("");
        return `<div class="state-section province-facilities">
            <div class="deploy-head"><span>${t("panels.intel.facilities.title", { name: escapeText(province.name) })}</span></div>
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
        const rules = t("panels.intel.state.rules", {
            claimants: claimants.length ? claimants.map((nation) => escapeGameText(ownerName(state, nation))).join("、") : t("panels.intel.none"),
            controller: escapeGameText(ownerName(state, center.owner)),
            legal: escapeGameText(ownerName(state, center.legalOwner)),
            capacity,
            max: INFRASTRUCTURE_MAX,
        });
        const buildings = STATE_BUILDING_KINDS.map((kind) => {
            const { built, pending, limit } = stateBuildingCapacity(state, region, kind);
            const detail = kind === "factory" ? `[[production]] ${region.prodFactories} · [[idle]] ${region.factories - region.prodFactories}`
                : kind === "infrastructure" ? t("panels.intel.state.multiplier", { effects: infrastructureEffects(built) }) : "";
            return this.buildingCardHtml(kind, built, limit, pending, `state-${region.id}-${kind}`, detail);
        }).join("");
        return `<div class="state-section">
            <div class="deploy-head"><span class="intel-state-heading"><span>${t("panels.intel.state.heading")}</span><span>${escapeText(region.name)}</span></span><button type="button" class="intel-help intel-info" aria-label="${t("panels.intel.state.infoTitle")}" data-focus-key="${escapeText(`state-${region.id}-rules`)}" ${tooltipAttrs(t("panels.intel.state.infoTitle"), rules)}>i</button></div>
            <dl class="kv">
                <div class="kv-row"><dt>${t("panels.intel.field.stateCenter")}</dt><dd>${escapeText(center.name)} · ${escapeText(ownerName(state, center.owner))}</dd></div>
                <div class="kv-row"><dt>${t("panels.intel.field.control")}</dt><dd>${t("panels.intel.state.controlValue", { value: escapeText(`${controlled}/${capacity}`) })}</dd></div>
                ${center.owner > 0 ? `<div class="kv-row"><dt>${t("panels.intel.field.tendency")}</dt><dd>${tendencyBadge(state.nations[center.owner], state)}</dd></div>` : ""}
            </dl>
            <div class="intel-building-cards">${buildings}</div>
            ${center.owner === 0 || province.owner === 0 ? `<button class="btn btn-sm" data-action="open-construction">${t("panels.intel.state.goConstruction")}</button>` : ""}
        </div>`;
    }

    private battleHtml(battle: Battle): string {
        const state = this.engine.state;
        const attacker = state.armies.get(battle.attackerId);
        const defender = battle.defenderId !== null ? state.armies.get(battle.defenderId) : null;
        const forecast = attacker ? battleForecast(state, attacker, battle.province) : null;
        const cancelBtn = attacker && attacker.nation === 0 ? `<button class="btn btn-sm" data-action="attack-cancel">${t("panels.intel.battle.stop")}</button>` : "";
        return `<div class="battle-box">
            <div class="battle-head">${t("panels.intel.battle.heading", { round: battle.rounds + 1, cancel: cancelBtn })}</div>
            <div class="battle-sides">
                <span style="--pc:${escapeText(ownerColor(state, attacker?.nation ?? NEUTRAL))}">${escapeText(attacker?.name ?? "?")}（${escapeText(ownerName(state, attacker?.nation ?? NEUTRAL))}）</span>
                <span class="battle-vs">vs</span><span>${defender ? t("panels.intel.battle.withGarrison", { name: escapeText(defender.name) }) : t("panels.intel.battle.garrison")}（${escapeText(ownerName(state, state.provinces[battle.province].owner))}）</span>
            </div>
            ${forecast ? `<div class="assault-odds">${t("panels.intel.battle.odds", { attack: Math.round(forecast.attackPower), defense: Math.round(forecast.defensePower) })}</div>` : ""}
        </div>`;
    }
}
