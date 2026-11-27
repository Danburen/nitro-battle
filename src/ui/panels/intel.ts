import type { GameEngine } from "../../game/engine.ts";
import type { GameState } from "../../game/types/state.ts";
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
import { escapeGameText, game, gameText, html, iconMaskStyle, peopleCount, rawHtml, signClass } from "../text.ts";
import { tooltipAttrs } from "../tooltip.ts";
import { panelHead, PanelShell } from "../panel.ts";
import type { PanelView } from "../panel.ts";
import { tendencyBadge } from "../tendency.ts";
import { scopedTexts } from "../view.ts";
import { t } from "../../i18n/index.ts";

function intelTexts() {
    const s = scopedTexts("panels.intel.", {
        help: ["help"],
        helpTitle: ["helpTitle"],
        stateTitle: ["state.title"],
        provinceTitle: ["province.title"],
        areaState: ["area.state"],
        areaProvince: ["area.province"],
        kindCapital: ["kind.capital"],
        kindCity: ["kind.city"],
        weatherDeepSnow: ["weather.deepSnow"],
        weatherLightSnow: ["weather.lightSnow"],
        weatherNone: ["weather.none"],
        supplyAbundant: ["supply.abundant"],
        supplyLimited: ["supply.limited"],
        supplyScarce: ["supply.scarce"],
        supplyLevelTitle: ["supply.levelTitle"],
        supplyTip: ["supply.tip"],
        presenceCommandHint: ["presence.commandHint"],
        war: ["war"],
        peace: ["peace"],
        fieldController: ["field.controller"],
        fieldLegalOwner: ["field.legalOwner"],
        fieldTendency: ["field.tendency"],
        fieldEntryCost: ["field.entryCost"],
        fieldWeather: ["field.weather"],
        impassable: ["impassable"],
        applicabilityNoState: ["applicability.noState"],
        applicabilityDifferentOwner: ["applicability.differentOwner"],
        applicabilityNeutral: ["applicability.neutral"],
        applicabilitySameOwner: ["applicability.sameOwner"],
        modifiersButton: ["modifiers.button"],
        buildingSupplyCenter: ["building.supplyCenter"],
        fortEffects: ["fort.effects"],
        supplyZoneEffects: ["supplyZone.effects"],
        none: ["none"],
        stateHeading: ["state.heading"],
        stateInfoTitle: ["state.infoTitle"],
        fieldStateCenter: ["field.stateCenter"],
        fieldControl: ["field.control"],
        stateGoConstruction: ["state.goConstruction"],
        battleStop: ["battle.stop"],
        battleGarrison: ["battle.garrison"],
    });
    return {
        ...s,
        emptyHint: (area: string) => t("panels.intel.empty.hint", { area }),
        provinceCount: (count: number) => t("panels.intel.state.provinceCount", { count }),
        stateSelection: (province: string, controller: string, legal: string) =>
            t("panels.intel.state.selection", { province, controller, legal }),
        presence: (owner: string, regiments: number, hp: number) =>
            t("panels.intel.presence", { owner, regiments, hp }),
        tagDefense: (value: string) => t("panels.intel.tag.defense", { value }),
        tagIncome: (value: string) => t("panels.intel.tag.income", { value }),
        tagPopulation: (people: string, units: number) => t("panels.intel.tag.population", { people, units }),
        supplyValue: (percent: number, level: string) => t("panels.intel.supply.value", { percent, level }),
        modifiersTitle: (name: string) => t("panels.intel.modifiers.title", { name }),
        modifiersDeposits: (params: {
            raw: number; rawOutput: string; strategic: number; strategicOutput: string; foodOutput: string;
            infrastructure: number; yield: string; occupation: string;
        }) => t("panels.intel.modifiers.deposits", params),
        modifiersBody: (params: {
            level: number; max: number; effects: string; applicability: string; deposits: string;
        }) => t("panels.intel.modifiers.body", params),
        infrastructureEffects: (level: number) => t("panels.intel.infrastructure.effects", {
            output: infrastructureOutputMultiplier(level).toFixed(2),
            construction: infrastructureBuildMultiplier(level).toFixed(2),
            movement: infrastructureMoveMultiplier(level).toFixed(2),
            supply: infrastructureSupplyMultiplier(level).toFixed(2),
        }),
        buildingBody: (params: { count: string; pending: number; desc: string; points: number; detail: string }) =>
            t("panels.intel.building.body", params),
        facilitiesTitle: (name: string) => t("panels.intel.facilities.title", { name }),
        stateRules: (params: { claimants: string; controller: string; legal: string; capacity: number; max: number }) =>
            t("panels.intel.state.rules", params),
        stateMultiplier: (effects: string) => t("panels.intel.state.multiplier", { effects }),
        stateControlValue: (value: string) => t("panels.intel.state.controlValue", { value }),
        battleHeading: (params: { round: number; cancel: string }) => t("panels.intel.battle.heading", params),
        battleWithGarrison: (name: string) => t("panels.intel.battle.withGarrison", { name }),
        battleOdds: (attack: number, defense: number) => t("panels.intel.battle.odds", { attack, defense }),
    };
}
type IntelTexts = ReturnType<typeof intelTexts>;

function modifiersHtml(state: GameState, province: Province, text: IntelTexts): string {
    const region = state.states[province.stateId];
    const infrastructure = infrastructureLevel(state, province.site);
    const applicability = !region ? text.applicabilityNoState
        : state.provinces[region.center].owner !== province.owner ? text.applicabilityDifferentOwner
            : province.owner === NEUTRAL ? text.applicabilityNeutral
                : text.applicabilitySameOwner;
    const title = text.modifiersTitle(escapeGameText(province.name));
    const output = provinceResourceOutput(state, province);
    const deposits = text.modifiersDeposits({
        raw: province.deposits.raw, rawOutput: output.raw.toFixed(2),
        strategic: province.deposits.strategic, strategicOutput: output.strategic.toFixed(2),
        foodOutput: (output.food + output.farmFood).toFixed(2),
        infrastructure: output.infrastructure,
        yield: resourceYieldMultiplier(output.infrastructure).toFixed(2),
        occupation: output.occupation.toFixed(2),
    });
    const body = text.modifiersBody({
        level: infrastructure, max: INFRASTRUCTURE_MAX,
        effects: text.infrastructureEffects(infrastructure), applicability, deposits,
    });
    const label = gameText(title, "plain", null);
    return html`<button type="button" class="intel-help intel-modifiers" aria-label="${label}" data-focus-key="province-${province.site}-modifiers" ${rawHtml(tooltipAttrs(title, body))}>${text.modifiersButton}</button>`;
}

function buildingCardHtml(kind: BuildingKind, built: number, limit: number, pending: number, focusKey: string, text: IntelTexts, detail = ""): string {
    const profile = BUILDING_PROFILES[kind];
    const count = pending > 0 ? `${built}+${pending}/${limit}` : `${built}/${limit}`;
    const countHtml = pending > 0
        ? html`${built}<span class="building-pending">+${pending}</span>/${limit}`
        : html`${built}/${limit}`;
    const title = game`[[${kind}]]${kind === "supply" ? text.buildingSupplyCenter : ""}`;
    const body = text.buildingBody({
        count, pending, desc: profile.desc, points: profile.constructionPoints,
        detail: detail ? `\n${detail}` : "",
    });
    const label = gameText(`${title}：${body}`, "plain", null);
    return html`<span class="intel-building-card${pending > 0 ? " pending" : ""}" tabindex="0" role="img" aria-label="${label}" data-focus-key="${focusKey}" ${rawHtml(tooltipAttrs(title, body))}>
        <span class="building-icon" aria-hidden="true" ${rawHtml(iconMaskStyle(profile.icon))}></span>
        <span class="intel-building-count">${rawHtml(countHtml)}</span>
    </span>`;
}

function provinceBuildingsHtml(state: GameState, province: Province, text: IntelTexts): string {
    if (!state.terrain.passable[province.site]) return "";
    const buildings = PROVINCE_BUILDING_KINDS.map((kind) => {
        const { built, pending, limit } = provinceBuildingCapacity(state, province, kind);
        const effects = kind === "fort" ? text.fortEffects : text.supplyZoneEffects;
        return buildingCardHtml(kind, built, limit, pending, `province-${province.site}-${kind}`, text, effects);
    }).join("");
    return html`<div class="state-section province-facilities">
        <div class="deploy-head"><span>${text.facilitiesTitle(province.name)}</span></div>
        <div class="intel-building-cards">${rawHtml(buildings)}</div>
    </div>`;
}

function stateSectionHtml(state: GameState, province: Province, text: IntelTexts): string {
    if (province.stateId < 0) return "";
    const region = state.states[province.stateId];
    const center = state.provinces[region.center];
    const capacity = region.provinces.length;
    const controlled = region.provinces.filter((site) => state.provinces[site].owner === center.owner).length;
    const claimants = [...new Set(state.claims.filter((claim) => claim.stateId === region.id).map((claim) => claim.nation))];
    const rules = text.stateRules({
        claimants: claimants.length
            ? claimants.map((nation) => escapeGameText(ownerName(state, nation))).join("、")
            : text.none,
        controller: escapeGameText(ownerName(state, center.owner)),
        legal: escapeGameText(ownerName(state, center.legalOwner)),
        capacity,
        max: INFRASTRUCTURE_MAX,
    });
    const buildings = STATE_BUILDING_KINDS.map((kind) => {
        const { built, pending, limit } = stateBuildingCapacity(state, region, kind);
        const detail = kind === "factory"
            ? game`[[production]] ${region.prodFactories} · [[idle]] ${region.factories - region.prodFactories}`
            : kind === "infrastructure" ? text.stateMultiplier(text.infrastructureEffects(built)) : "";
        return buildingCardHtml(kind, built, limit, pending, `state-${region.id}-${kind}`, text, detail);
    }).join("");
    const tendencyRow = center.owner > 0 ? html`<div class="kv-row"><dt>${text.fieldTendency}</dt><dd>${rawHtml(tendencyBadge(state.nations[center.owner], state))}</dd></div>` : "";
    const constructionButton = center.owner === 0 || province.owner === 0
        ? html`<button class="btn btn-sm" data-action="open-construction">${text.stateGoConstruction}</button>` : "";
    return html`<div class="state-section">
        <div class="deploy-head"><span class="intel-state-heading"><span>${text.stateHeading}</span><span>${region.name}</span></span><button type="button" class="intel-help intel-info" aria-label="${text.stateInfoTitle}" data-focus-key="state-${region.id}-rules" ${rawHtml(tooltipAttrs(text.stateInfoTitle, rules))}>i</button></div>
        <dl class="kv">
            <div class="kv-row"><dt>${text.fieldStateCenter}</dt><dd>${center.name} · ${ownerName(state, center.owner)}</dd></div>
            <div class="kv-row"><dt>${text.fieldControl}</dt><dd>${text.stateControlValue(`${controlled}/${capacity}`)}</dd></div>
            ${rawHtml(tendencyRow)}
        </dl>
        <div class="intel-building-cards">${rawHtml(buildings)}</div>
        ${rawHtml(constructionButton)}
    </div>`;
}

function battleHtml(state: GameState, battle: Battle, text: IntelTexts): string {
    const attacker = state.armies.get(battle.attackerId);
    const defender = battle.defenderId !== null ? state.armies.get(battle.defenderId) : null;
    const forecast = attacker ? battleForecast(state, attacker, battle.province) : null;
    const cancelButton = attacker && attacker.nation === 0
        ? html`<button class="btn btn-sm" data-action="attack-cancel">${text.battleStop}</button>` : "";
    const heading = text.battleHeading({ round: battle.rounds + 1, cancel: cancelButton });
    const odds = forecast
        ? html`<div class="assault-odds">${text.battleOdds(Math.round(forecast.attackPower), Math.round(forecast.defensePower))}</div>`
        : "";
    return html`<div class="battle-box">
        <div class="battle-head">${rawHtml(heading)}</div>
        <div class="battle-sides">
            <span style="--pc:${ownerColor(state, attacker?.nation ?? NEUTRAL)}">${attacker?.name ?? "?"}（${ownerName(state, attacker?.nation ?? NEUTRAL)}）</span>
            <span class="battle-vs">vs</span><span>${defender ? text.battleWithGarrison(defender.name) : text.battleGarrison}（${ownerName(state, state.provinces[battle.province].owner)}）</span>
        </div>
        ${rawHtml(odds)}
    </div>`;
}

export interface IntelViewContext {
    readonly state: GameState;
    readonly mode: "province" | "state";
}

/** Pure view builder: province/state intelligence panel. */
export function intelView(ctx: IntelViewContext): PanelView {
    const { state, mode } = ctx;
    const text = intelTexts();
    const help = { title: text.helpTitle, body: text.help };
    const site = state.selected;
    if (site === null) {
        return {
            head: panelHead({ title: mode === "state" ? text.stateTitle : text.provinceTitle, help }),
            body: html`<div class="empty-hint">${text.emptyHint(mode === "state" ? text.areaState : text.areaProvince)}</div>`,
        };
    }

    const province = state.provinces[site];
    if (mode === "state" && province.stateId >= 0) {
        const region = state.states[province.stateId];
        const center = state.provinces[region.center];
        const ownerPill = html`<span class="owner-pill" style="--pc:${ownerColor(state, center.owner)}">${ownerName(state, center.owner)}</span>`;
        const modifiers = modifiersHtml(state, province, text);
        const stateSection = stateSectionHtml(state, province, text);
        const facilities = provinceBuildingsHtml(state, province, text);
        return {
            head: panelHead({ title: text.stateTitle, help, extras: ownerPill }),
            body: html`<div class="prov-title">${region.name}<span class="prov-kind">${text.provinceCount(region.provinces.length)}</span></div>
                <div class="intel-selection"><span>${text.stateSelection(province.name, ownerName(state, province.owner), ownerName(state, province.legalOwner))}</span>${rawHtml(modifiers)}</div>
                ${rawHtml(stateSection)}${rawHtml(facilities)}`,
        };
    }

    const biome = state.terrain.biomeAt(site);
    const profile = BIOME_PROFILES[biome];
    const snow = state.terrain.snowCover[site];
    const occupant = armyAt(state, site);
    const battle = state.battles.find((entry) => entry.province === site) ?? null;
    const kindLabel = province.isCapital ? text.kindCapital : province.isCity ? text.kindCity : text.areaProvince;
    const snowText = snow === 2 ? text.weatherDeepSnow : snow === 1 ? text.weatherLightSnow : text.weatherNone;
    const supply = supplyLevel(state, site);
    const supplyText = supply >= 0.8 ? text.supplyAbundant : supply >= 0.5 ? text.supplyLimited : text.supplyScarce;
    const supplyClass = supply >= 0.8 ? "good" : supply >= 0.5 ? "mid" : "bad";
    const isCore = province.owner !== NEUTRAL && province.coreNation === province.owner;
    const population = provincePopulationView(state, province);
    const occGrowth = occupationGrowth(state, province, province.owner);
    const occupantName = occupant?.name ?? "";
    const ownerPill = html`<span class="owner-pill" style="--pc:${ownerColor(state, province.owner)}">${ownerName(state, province.owner)}</span>`;
    const occupationRow = province.owner !== NEUTRAL && !isCore ? html`<div class="kv-row"><dt>${"[[occupation]]"}</dt><dd>
        <div class="garrison-bar occ"><i style="width:${province.occupation}%"></i></div>
        ${Math.floor(province.occupation)}%<span class="garrison-note ${signClass(String(occGrowth))}">${occGrowth >= 0 ? "+" : ""}${occGrowth.toFixed(0)}/${"[[turn]]"}</span>
    </dd></div>` : "";
    const presence = occupant ? html`<div class="army-presence" ${rawHtml(tooltipAttrs(escapeGameText(occupantName), game`[[organization]] ${Math.round(occupant.org)}/${ORG_MAX}`))}>
        <span style="--pc:${ownerColor(state, occupant.nation)}">${occupantName}</span>
        ${text.presence(ownerName(state, occupant.nation), occupant.regiments.length, regimentHp(occupant))}
        ${occupant.nation === 0 ? text.presenceCommandHint : ""}
    </div>` : "";
    const warTag = province.owner !== NEUTRAL && province.owner !== 0
        ? html`<span class="tag">${isAtWar(state, 0, province.owner) ? text.war : text.peace}</span>` : "";
    const tendencyRow = province.owner > 0 ? html`<div class="kv-row"><dt>${text.fieldTendency}</dt><dd>${rawHtml(tendencyBadge(state.nations[province.owner], state))}</dd></div>` : "";
    const modifiers = modifiersHtml(state, province, text);
    const battleBox = battle ? battleHtml(state, battle, text) : "";
    const stateSection = stateSectionHtml(state, province, text);
    const facilities = provinceBuildingsHtml(state, province, text);

    return {
        head: panelHead({ title: text.provinceTitle, help, extras: ownerPill }),
        body: html`<div class="prov-title">${province.name}<span class="prov-kind">${kindLabel}</span></div>
            <div class="tag-row">
                <span class="tag">${BIOME_ZH[biome] ?? profile.name}</span>
                <span class="tag">${text.tagDefense(provinceDefense(state, province).toFixed(2))}</span>
                <span class="tag">${text.tagIncome(`+${Math.round(provinceFundsIncome(province) * 10) / 10}`)}</span><span class="tag">${text.tagPopulation(peopleCount(population.people), population.units)}</span>
                <span class="tag supply-${supplyClass}" ${rawHtml(tooltipAttrs(text.supplyLevelTitle, text.supplyTip))}>${text.supplyValue(Math.round(supply * 100), supplyText)}</span>
                ${rawHtml(warTag)}
                ${rawHtml(modifiers)}
            </div>
            <dl class="kv">
                <div class="kv-row"><dt>${text.fieldController}</dt><dd>${ownerName(state, province.owner)}</dd></div>
                <div class="kv-row"><dt>${text.fieldLegalOwner}</dt><dd>${ownerName(state, province.legalOwner)}</dd></div>
                ${rawHtml(tendencyRow)}
                ${rawHtml(occupationRow)}
                <div class="kv-row"><dt>${text.fieldEntryCost}</dt><dd>${state.terrain.passable[site] ? entryCost(state, site).toFixed(2) : text.impassable}</dd></div>
                <div class="kv-row"><dt>${text.fieldWeather}</dt><dd>${snowText}</dd></div>
            </dl>
            ${rawHtml(presence)}${rawHtml(battleBox)}${rawHtml(stateSection)}${rawHtml(facilities)}`,
    };
}

/** Province/state intelligence panel (left dock). */
export class IntelPanel {
    private readonly engine: GameEngine;
    private readonly shell = new PanelShell(document.querySelector<HTMLElement>("#intel-panel") as HTMLElement);

    constructor(engine: GameEngine) {
        this.engine = engine;
    }

    render(mode: "province" | "state"): void {
        if (this.engine.state.selected === null) {
            this.shell.hide();
            return;
        }
        this.shell.show();
        this.shell.render(intelView({ state: this.engine.state, mode }));
    }
}
