import { MAP_SIZES, NATION_COUNT_MAX } from "../types/settings.ts";
import { DEFAULT_TERRAIN_PARAMS } from "../game/terrain/biome.ts";
import { t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/index.ts";
import { iconMaskStyle, html, setGameHtml } from "./text.ts";
import { tooltipAttrs } from "./tooltip.ts";
import { trustedParts } from "./view.ts";
import type { UiView } from "./view.ts";

/** Preset line-ups; anything else goes through the custom slider. */
const NATION_COUNT_PRESETS = [2, 3, 5, 6, 10] as const;
const MAP_CELL_PRESETS = [600, 1500, 2400] as const;
const DEFAULT_NATION_COUNT = 6;
const DEFAULT_MAP_CELLS = MAP_SIZES.standard.cells;
const MAP_CELLS_MIN = 600;
const MAP_CELLS_MAX = 3000;

/** Resolved at call time so a locale switch is visible on the next mount. */
function balanceTip(): string {
    return t("misc.layout.balanceTip");
}

export function defaultHint(): string {
    return t("misc.layout.defaultHint");
}

interface TerrainSlider {
    readonly key: "seaLevel" | "basePeriod" | "elevationExponent" | "moistureContrast" | "freqMultiplier";
    readonly label: MessageKey;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly digits: number;
}

const TERRAIN_SLIDERS: readonly TerrainSlider[] = [
    { key: "seaLevel", label: "misc.layout.terrain.seaLevel", min: 0.05, max: 0.45, step: 0.01, digits: 2 },
    { key: "basePeriod", label: "misc.layout.terrain.basePeriod", min: 2, max: 10, step: 0.5, digits: 1 },
    { key: "elevationExponent", label: "misc.layout.terrain.elevationExponent", min: 1, max: 4, step: 0.1, digits: 1 },
    { key: "moistureContrast", label: "misc.layout.terrain.moistureContrast", min: 1, max: 3, step: 0.1, digits: 1 },
    { key: "freqMultiplier", label: "misc.layout.terrain.freqMultiplier", min: 1.5, max: 3, step: 0.1, digits: 1 },
];

/** One slider row; the dynamic label key is resolved before the template. */
function terrainSliderView(slider: TerrainSlider): UiView {
    const label = t(slider.label);
    const value = DEFAULT_TERRAIN_PARAMS[slider.key];
    return { html: html`<div class="field slider-field">
            <label for="terrain-${slider.key}">${label} <b data-terrain-out="${slider.key}">${value.toFixed(slider.digits)}</b></label>
            <input id="terrain-${slider.key}" type="range" data-terrain="${slider.key}" data-digits="${slider.digits}" min="${slider.min}" max="${slider.max}" step="${slider.step}" value="${value}" disabled />
        </div>` };
}

function terrainRowsView(): UiView {
    const rows = TERRAIN_SLIDERS.map((slider) => terrainSliderView(slider).html).join("");
    return { html: html`${trustedParts({ rows }).rows}` };
}

/** Static HUD / overlay skeleton; all dynamic content is rendered by ui modules. */
export function mountLayout(app: HTMLElement): void {
    setGameHtml(app, `
    <div class="game-shell">
        <canvas id="game-canvas"></canvas>
        <div class="hint" id="hint">${defaultHint()}</div>
        <div id="toast" class="toast" role="status"></div>
        <div id="global-tooltip" class="global-tooltip" role="tooltip" hidden><strong></strong><div class="tooltip-body"></div></div>

        <div class="hud" id="hud">
            <div class="top-bar">
                <div class="top-country">
                    <span class="top-country-name" id="top-country-name" tabindex="0" role="note">
                        <span class="top-country-flag" id="top-country-flag"></span>
                        <span class="top-country-label" id="top-country-label"></span>
                    </span>
                </div>
                <span class="pill" id="day-pill">${t("misc.layout.dayPill")}</span>
                <div class="top-resources">
                    <span class="res-pill" id="res-stability">${t("misc.layout.resource.stability")}</span>
                    <span class="res-pill" id="res-funds">§300</span>
                    <span class="res-pill" id="res-manpower">${t("misc.layout.resource.manpower")}</span>
                    <span class="res-pill" id="res-industry">${t("misc.layout.resource.industry")}</span>
                    <span class="res-pill" id="res-raw">${t("misc.layout.resource.raw")}</span>
                    <span class="res-pill" id="res-food">${t("misc.layout.resource.food")}</span>
                    <span class="res-pill" id="res-strategic">${t("misc.layout.resource.strategic")}</span>
                    <span class="res-pill" id="res-pp">${t("misc.layout.resource.politics")}</span>
                </div>
                <div class="top-actions">
                    <button id="btn-home" class="btn btn-icon" title="${t("misc.layout.action.home")}" aria-label="${t("misc.layout.action.home")}">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.2 1.5 6.5V14a.8.8 0 0 0 .8.8h4V10h3.4v4.8h4a.8.8 0 0 0 .8-.8V6.5Z"/></svg>
                    </button>
                    <button id="btn-help" class="btn btn-icon" title="${t("misc.layout.action.manual")}" aria-label="${t("misc.layout.action.manual")}">?</button>
                    <button id="btn-sound" class="btn btn-icon" aria-label="${t("misc.layout.action.mute")}"></button>
                    <button id="btn-settings" class="btn btn-icon" title="${t("misc.layout.action.settings")}" aria-label="${t("misc.layout.action.settings")}" aria-expanded="false" aria-controls="settings-pop">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>
                    <button id="btn-menu" class="btn">${t("misc.layout.action.newGame")}</button>
                    <button id="btn-endturn" class="btn btn-primary">${t("misc.common.endTurn")} <kbd>E</kbd></button>
                    <div class="brief-start-hint hidden" id="brief-start-hint" role="status"></div>
                </div>
            </div>

                <div class="claim-manage-banner hidden" id="claim-manage-banner" role="status">${t("misc.layout.claimBanner")}</div>

                <div class="settings-pop hidden" id="settings-pop" role="dialog" aria-label="${t("misc.layout.action.settings")}">
                <div class="settings-head"><span>${t("misc.layout.action.settings")}</span><button class="settings-x" data-action="settings-close" aria-label="${t("misc.layout.action.closeSettings")}">×</button></div>
                <div class="settings-row">
                    <span class="settings-label">${t("misc.layout.settings.colorMode")}</span>
                    <span class="settings-control settings-seg-group" role="group" aria-label="${t("misc.layout.settings.colorMode")}">
                        <button class="settings-seg" data-action="color-mode" data-color="uniform" aria-pressed="false">${t("misc.colorMode.uniform")}</button>
                        <button class="settings-seg" data-action="color-mode" data-color="gradient" aria-pressed="true">${t("misc.colorMode.gradient")}</button>
                        <button class="settings-seg" data-action="color-mode" data-color="resource" aria-pressed="false">${t("misc.colorMode.resource")}</button>
                    </span>
                </div>
                <div class="settings-row">
                    <span class="settings-label">${t("misc.layout.settings.deepZoom")}</span>
                    <span class="settings-control settings-slider">
                        <input id="color-threshold" type="range" min="0.4" max="1.6" step="0.05" value="0.8" aria-label="${t("misc.layout.settings.deepZoomHint")}" />
                        <b id="color-threshold-value">0.8</b>
                    </span>
                </div>
                <div class="settings-row">
                    <span class="settings-label">${t("misc.layout.settings.restoreDefaults")}</span>
                    <span class="settings-control"><button class="btn btn-sm" data-action="color-reset">${t("misc.layout.settings.resetColor")}</button></span>
                </div>
                <p class="settings-note">${t("misc.layout.settings.colorNote")}</p>
            </div>

            <div class="hud-corner hud-tl">
                <div class="dock">
                    <nav class="tabs" id="info-tabs">
                        <button class="tab dock-toggle" id="btn-dock" data-action="dock-toggle" title="${t("misc.layout.dock.toggleTip")}" aria-label="${t("misc.layout.dock.collapse")}">«</button>
                        <button class="tab" data-tab="deploy">${t("misc.layout.tab.deploy")}</button>
                        <button class="tab" data-tab="construction">${t("misc.layout.tab.construction")}</button>
                        <button class="tab" data-tab="policy">${t("misc.layout.tab.policy")}</button>
                        <button class="tab active" data-tab="diplomacy">${t("misc.layout.tab.diplomacy")}</button>
                        <button class="tab" data-tab="trade">${t("misc.layout.tab.trade")}</button>
                        <button class="tab" data-tab="expansion">${t("misc.layout.tab.expansion")}</button>
                    </nav>
                    <section class="panel dock-panel hidden" id="deploy-panel"></section>
                    <section class="panel dock-panel hidden" id="construction-panel"></section>
                    <section class="panel dock-panel hidden" id="policy-panel"></section>
                    <section class="panel dock-panel hidden" id="diplomacy-panel"></section>
                    <section class="panel dock-panel hidden" id="trade-panel"></section>
                    <section class="panel dock-panel hidden" id="expansion-panel"></section>
                </div>
                <section class="panel map-legend hidden" id="map-legend" aria-label="${t("misc.layout.mapLegend")}"></section>
            </div>

            <section class="panel brief-panel hidden" id="brief-panel" aria-label="${t("misc.layout.nationDetail")}"></section>

            <div class="hud-feed">
                <div class="feed-bar">
                    <span class="feed-title"><span class="resource-icon" aria-hidden="true" ${iconMaskStyle("war")}></span>${t("misc.layout.feedTitle")}</span>
                    <button class="feed-toggle" id="feed-toggle" data-action="feed-toggle" title="${t("misc.feed.toggleTip")}" aria-label="${t("misc.feed.toggle.expand")}">▾</button>
                </div>
                <div class="feed-live" id="feed-live"></div>
                <div class="feed-history hidden" id="feed-history"></div>
            </div>

            <div class="hud-corner hud-bl">
                <section class="panel dock-panel" id="intel-panel"></section>
            </div>

            <div class="map-layers" id="map-layers">
                <button class="map-layers-toggle" data-action="layers-toggle" aria-expanded="true" aria-controls="map-layer-options">${t("misc.layout.layers")} · <span id="map-layer-name">${t("misc.common.area.province")}</span><span id="map-layer-chevron">▾</span></button>
                <div class="map-layer-options" id="map-layer-options" role="group" aria-label="${t("misc.layout.mapMode")}">
                    <button class="map-layer active" data-action="map-mode" data-mode="province" aria-pressed="true">${t("misc.layout.layer.province")}<span>${t("misc.layout.layer.provinceHint")}</span></button>
                    <button class="map-layer" data-action="map-mode" data-mode="state" aria-pressed="false">${t("misc.layout.layer.state")}<span>${t("misc.layout.layer.stateHint")}</span></button>
                    <button class="map-layer" data-action="color-mode" data-color="resource" aria-pressed="false">${t("misc.colorMode.resource")}<span>${t("misc.layout.layer.resourceHint")}</span></button>
                </div>
            </div>

            <div class="hud-corner hud-br">
                <div class="canvas-tools">
                    <button id="zoom-in" class="tool-btn" aria-label="${t("misc.layout.zoom.in")}">+</button>
                    <button id="zoom-out" class="tool-btn" aria-label="${t("misc.layout.zoom.out")}">−</button>
                    <button id="zoom-fit" class="tool-btn" aria-label="${t("misc.layout.zoom.fit")}">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>
                    </button>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay" id="start-overlay">
        <select id="language-select" class="start-locale" aria-label="${t("misc.layout.locale.label")}">
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
        </select>
        <div class="start-card">
            <div class="start-strip"></div>
            <div class="start-inner">
                <div class="start-brand">
                    <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
                        <rect width="32" height="32" rx="6" fill="#0d1117" stroke="#30363d"/>
                        <path d="M8 24V8l16 16V8" stroke="#1f6feb" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="24" cy="8" r="3" fill="#1f883d"/>
                    </svg>
                    <div>
                        <h1>Nitro Battle</h1>
                        <p class="start-sub">${t("misc.layout.start.tagline")}</p>
                    </div>
                </div>
                <div class="start-actions">
                    <button id="btn-start" class="btn btn-primary btn-lg" type="button">${t("misc.layout.action.newGame")}</button>
                    <button id="btn-howto" class="btn btn-lg" type="button">${t("misc.layout.action.howto")}</button>
                </div>
                <ul class="start-summary">
                    <li><b>${t("misc.layout.summary.armiesTitle")}</b>${t("misc.layout.summary.armies")}</li>
                    <li><b>${t("misc.layout.summary.economyTitle")}</b>${t("misc.layout.summary.economy")}</li>
                    <li><b>${t("misc.layout.summary.commandTitle")}</b>${t("misc.layout.summary.command")}</li>
                </ul>
                <p class="start-note">${t("misc.layout.summary.note")}</p>
            </div>
        </div>
    </div>
    <div class="overlay overlay-top hidden" id="gen-overlay">
        <div class="start-card gen-card">
            <div class="gen-inner">
                <h2>${t("misc.layout.generating.title")}</h2>
                <div class="gen-progress" id="gen-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                    <i id="gen-bar"></i>
                </div>
                <div class="gen-meta">
                    <p class="start-sub" id="gen-status">${t("misc.layout.generating.status")}</p>
                    <span class="gen-percent" id="gen-percent">0%</span>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay hidden" id="nation-picker">
        <div class="start-card picker-card">
            <div class="start-strip"></div>
            <div class="start-inner">
                <h2 class="picker-title">${t("misc.layout.picker.title")}</h2>
                <p class="start-sub">${t("misc.layout.picker.sub")}</p>
                <div class="nation-options" id="nation-options"></div>
                <div class="start-actions">
                    <button id="btn-random-nation" class="btn btn-primary" type="button">${t("misc.layout.picker.random")}</button>
                    <button id="btn-back-start" class="btn" type="button">${t("misc.layout.picker.back")}</button>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay hidden" id="newgame-overlay">
        <div class="start-card newgame-card">
            <div class="start-strip"></div>
            <div class="start-inner">
                <h2 class="picker-title">${t("misc.layout.action.newGame")}</h2>
                <p class="start-sub">${t("misc.layout.newgame.sub")}</p>
                <div class="start-form newgame-form">
                    <div class="field">
                        <label for="seed-input">${t("misc.layout.newgame.seed")}</label>
                        <div class="seed-row">
                            <input id="seed-input" type="number" step="1" />
                            <button id="btn-dice" class="btn" type="button" title="${t("misc.layout.newgame.randomSeedTitle")}">${t("misc.layout.newgame.random")}</button>
                        </div>
                    </div>
                    <div class="field">
                        <span class="field-label">${t("misc.layout.newgame.nationCount")}</span>
                        <div class="preset-row" role="group" aria-label="${t("misc.layout.newgame.nationCount")}">
                            ${NATION_COUNT_PRESETS.map((count) => `<button type="button" class="preset-btn${count === DEFAULT_NATION_COUNT ? " active" : ""}" data-nation-preset="${count}" aria-pressed="${count === DEFAULT_NATION_COUNT}">${count}</button>`).join("")}
                            <button type="button" class="preset-btn" data-nation-preset="custom" aria-pressed="false">${t("misc.layout.newgame.custom")}</button>
                        </div>
                        <div class="preset-custom hidden" id="nation-custom">
                            <input id="nation-range" type="range" min="2" max="${NATION_COUNT_MAX}" step="1" value="${DEFAULT_NATION_COUNT}" aria-label="${t("misc.layout.newgame.customNationCount")}" />
                            <b id="nation-value">${t("misc.layout.unit.countries", { count: DEFAULT_NATION_COUNT })}</b>
                        </div>
                        <p class="field-hint">${t("misc.layout.newgame.nationHint", { min: 5, low: 1, high: 3 })}</p>
                    </div>
                    <div class="field">
                        <span class="field-label">${t("misc.layout.newgame.mapSize")}</span>
                        <div class="preset-row" role="group" aria-label="${t("misc.layout.newgame.mapSize")}">
                            ${MAP_CELL_PRESETS.map((cells) => `<button type="button" class="preset-btn${cells === DEFAULT_MAP_CELLS ? " active" : ""}" data-cells-preset="${cells}" aria-pressed="${cells === DEFAULT_MAP_CELLS}" aria-label="${t("misc.layout.unit.provinces", { count: cells })}">${cells}</button>`).join("")}
                            <button type="button" class="preset-btn" data-cells-preset="custom" aria-pressed="false">${t("misc.layout.newgame.custom")}</button>
                        </div>
                        <div class="preset-custom hidden" id="cells-custom">
                            <input id="cells-range" type="range" min="${MAP_CELLS_MIN}" max="${MAP_CELLS_MAX}" step="100" value="${DEFAULT_MAP_CELLS}" aria-label="${t("misc.layout.newgame.customMapSize")}" />
                            <b id="cells-value">${t("misc.layout.unit.provinces", { count: DEFAULT_MAP_CELLS.toLocaleString("zh-CN") })}</b>
                        </div>
                    </div>
                    <div class="field">
                        <span class="field-label">${t("misc.layout.newgame.balance")}
                            <button type="button" class="intel-help intel-info" aria-label="${t("misc.layout.newgame.balanceHelp")}" ${tooltipAttrs(t("misc.layout.newgame.balance"), balanceTip())}>i</button>
                        </span>
                        <span class="settings-control settings-seg-group" role="group" aria-label="${t("misc.layout.newgame.balance")}">
                            <button type="button" class="settings-seg" data-balance="on" aria-pressed="false">${t("misc.common.on")}</button>
                            <button type="button" class="settings-seg active" data-balance="off" aria-pressed="true">${t("misc.common.off")}</button>
                        </span>
                        <p class="field-hint">${t("misc.layout.newgame.balanceHint")}</p>
                    </div>
                    <details class="newgame-advanced" id="newgame-advanced">
                        <summary>${t("misc.layout.newgame.advanced")}</summary>
                        <div class="advanced-mode">
                            <span class="settings-label">${t("misc.layout.newgame.params")}</span>
                            <span class="settings-seg-group" role="group" aria-label="${t("misc.layout.newgame.terrainMode")}">
                                <button type="button" class="settings-seg active" data-terrain-mode="default" aria-pressed="true">${t("misc.layout.newgame.default")}</button>
                                <button type="button" class="settings-seg" data-terrain-mode="custom" aria-pressed="false">${t("misc.layout.newgame.custom")}</button>
                            </span>
                        </div>
                        ${terrainRowsView().html}
                        <p class="settings-note">${t("misc.layout.newgame.terrainNote")}</p>
                    </details>
                </div>
                <div class="start-actions">
                    <button id="btn-newgame-start" class="btn btn-primary btn-lg" type="button">${t("misc.common.startGame")}</button>
                    <button id="btn-newgame-cancel" class="btn btn-lg" type="button">${t("misc.common.cancel")}</button>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay hidden" id="guide-overlay"></div>
    <div class="overlay hidden" id="end-overlay"></div>`);
}