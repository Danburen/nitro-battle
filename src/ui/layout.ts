import { MAP_SIZES, NATION_COUNT_MAX } from "../game/types.ts";
import { DEFAULT_TERRAIN_PARAMS } from "../terrain/biome.ts";
import { renderGameText } from "./text.ts";
import { tooltipAttrs } from "./tooltip.ts";

/** Preset line-ups; anything else goes through the custom slider. */
const NATION_COUNT_PRESETS = [2, 3, 5, 6, 10] as const;
const MAP_CELL_PRESETS = [600, 1500, 2400] as const;
const DEFAULT_NATION_COUNT = 6;
const DEFAULT_MAP_CELLS = MAP_SIZES.standard.cells;
const MAP_CELLS_MIN = 600;
const MAP_CELLS_MAX = 3000;

const BALANCE_TIP = "开启后按开局实力补偿：领土少于同局平均的国家会获得补偿，每省工厂密度越低补得越多（额外州属农场与基础设施，各最多 +3，优先给最大的州）。领土越多补偿越少，最大的工业强国不补。基础设施同时提高产值与补给，小国更容易守住本土。关闭时保留生成出的原始强弱差距，世界更戏剧化。";

interface TerrainSlider {
    readonly key: "seaLevel" | "basePeriod" | "elevationExponent" | "moistureContrast" | "freqMultiplier";
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly digits: number;
}

const TERRAIN_SLIDERS: readonly TerrainSlider[] = [
    { key: "seaLevel", label: "海洋占比", min: 0.05, max: 0.45, step: 0.01, digits: 2 },
    { key: "basePeriod", label: "地形周期", min: 2, max: 10, step: 0.5, digits: 1 },
    { key: "elevationExponent", label: "海岸锐度", min: 1, max: 4, step: 0.1, digits: 1 },
    { key: "moistureContrast", label: "湿度对比", min: 1, max: 3, step: 0.1, digits: 1 },
    { key: "freqMultiplier", label: "频率倍率", min: 1.5, max: 3, step: 0.1, digits: 1 },
];

function terrainRows(): string {
    return TERRAIN_SLIDERS.map((slider) => {
        const value = DEFAULT_TERRAIN_PARAMS[slider.key];
        return `<div class="field slider-field">
            <label for="terrain-${slider.key}">${slider.label} <b data-terrain-out="${slider.key}">${value.toFixed(slider.digits)}</b></label>
            <input id="terrain-${slider.key}" type="range" data-terrain="${slider.key}" data-digits="${slider.digits}" min="${slider.min}" max="${slider.max}" step="${slider.step}" value="${value}" disabled />
        </div>`;
    }).join("");
}

export const DEFAULT_HINT = "点击省份查看 · 点击军团接管指挥 · 军团列表 Ctrl+点击多选合并 · 拖拽平移 · 滚轮缩放 · 右键取消";

/** Static HUD / overlay skeleton; all dynamic content is rendered by ui modules. */
export function mountLayout(app: HTMLElement): void {
    app.innerHTML = `
    <div class="game-shell">
        <canvas id="game-canvas"></canvas>
        <div class="hint" id="hint">${DEFAULT_HINT}</div>
        <div id="toast" class="toast" role="status"></div>
        <div id="global-tooltip" class="global-tooltip" role="tooltip" hidden><strong></strong><div class="tooltip-body"></div></div>

        <div class="hud" id="hud">
            <div class="top-bar">
                <div class="top-country">
                    <span class="top-country-name" id="top-country-name" tabindex="0" role="note">
                        <span class="top-country-flag" id="top-country-flag"></span>
                        <span class="top-country-label" id="top-country-label"></span>
                    </span>
                    <div class="top-vassals hidden" id="top-vassals">
                        <button type="button" class="top-vassals-trigger" id="top-vassals-trigger" aria-expanded="false" aria-controls="top-vassals-menu">
                            <span class="top-vassals-label">附庸</span><span id="top-vassals-summary"></span><span class="top-vassals-caret" aria-hidden="true">▾</span>
                        </button>
                        <div class="top-vassals-menu hidden" id="top-vassals-menu" role="menu"></div>
                    </div>
                </div>
                <span class="pill" id="day-pill">${renderGameText("第 [[turn:1]]")}</span>
                <span class="pill" id="season-pill">春季</span>
                <div class="top-resources">
                    <span class="res-pill" id="res-funds">§300</span>
                    <span class="res-pill" id="res-manpower">人力 500</span>
                    <span class="res-pill" id="res-industry">工业 30</span>
                    <span class="res-pill" id="res-pp">政治 20</span>
                </div>
                <div class="factory-allocation" id="factory-allocation" role="group" aria-label="全国工厂调配">
                    <button class="factory-step" data-factory-step="-1" aria-label="增加闲置工厂">−</button>
                    <div class="factory-dial">
                        <div class="factory-totals"><span>${renderGameText("[[production]]")} <b id="factory-prod">0</b></span><span>${renderGameText("[[idle]]")} <b id="factory-idle">0</b></span></div>
                        <input id="factory-production" type="range" min="0" max="0" value="0" step="1" aria-label="生产工厂数量" />
                    </div>
                    <button class="factory-step" data-factory-step="1" aria-label="增加生产工厂">+</button>
                </div>
                <div class="top-actions">
                    <button id="btn-home" class="btn btn-icon" title="回到首都" aria-label="回到首都">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.2 1.5 6.5V14a.8.8 0 0 0 .8.8h4V10h3.4v4.8h4a.8.8 0 0 0 .8-.8V6.5Z"/></svg>
                    </button>
                    <button id="btn-help" class="btn btn-icon" title="作战手册" aria-label="作战手册">?</button>
                    <button id="btn-sound" class="btn btn-icon" aria-label="关闭音效"></button>
                    <button id="btn-settings" class="btn btn-icon" title="配置" aria-label="配置" aria-expanded="false" aria-controls="settings-pop">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>
                    <button id="btn-menu" class="btn">新游戏</button>
                    <button id="btn-endturn" class="btn btn-primary">${renderGameText("结束[[turn]]")} <kbd>E</kbd></button>
                    <div class="brief-start-hint hidden" id="brief-start-hint" role="status"></div>
                </div>
            </div>

                <div class="claim-manage-banner hidden" id="claim-manage-banner" role="status">当前正处在宣称管理界面，按ESC退出</div>

                <div class="settings-pop hidden" id="settings-pop" role="dialog" aria-label="配置">
                <div class="settings-head"><span>配置</span><button class="settings-x" data-action="settings-close" aria-label="关闭配置">×</button></div>
                <div class="settings-row">
                    <span class="settings-label">染色模式</span>
                    <span class="settings-control settings-seg-group" role="group" aria-label="染色模式">
                        <button class="settings-seg" data-action="color-mode" data-color="uniform" aria-pressed="false">均匀</button>
                        <button class="settings-seg" data-action="color-mode" data-color="gradient" aria-pressed="true">渐变</button>
                    </span>
                </div>
                <div class="settings-row">
                    <span class="settings-label">深色阈值</span>
                    <span class="settings-control settings-slider">
                        <input id="color-threshold" type="range" min="0.4" max="1.6" step="0.05" value="0.8" aria-label="渐变染色的深色缩放阈值" />
                        <b id="color-threshold-value">0.8</b>
                    </span>
                </div>
                <div class="settings-row">
                    <span class="settings-label">恢复默认</span>
                    <span class="settings-control"><button class="btn btn-sm" data-action="color-reset">重置染色</button></span>
                </div>
                <p class="settings-note">渐变：拉高镜头越过阈值整体加深；放大时全国浅染、国界内侧加描国家色边线。均匀：全国同深度。</p>
            </div>

            <div class="hud-corner hud-tl">
                <div class="dock">
                    <nav class="tabs" id="info-tabs">
                        <button class="tab dock-toggle" id="btn-dock" data-action="dock-toggle" title="收起/展开面板" aria-label="收起面板">«</button>
                        <button class="tab" data-tab="deploy">部署</button>
                        <button class="tab" data-tab="construction">建造</button>
                        <button class="tab" data-tab="policy">政策</button>
                        <button class="tab active" data-tab="diplomacy">外交</button>
                        <button class="tab" data-tab="expansion">扩张</button>
                    </nav>
                    <section class="panel dock-panel hidden" id="deploy-panel"></section>
                    <section class="panel dock-panel hidden" id="construction-panel"></section>
                    <section class="panel dock-panel hidden" id="policy-panel"></section>
                    <section class="panel dock-panel hidden" id="diplomacy-panel"></section>
                    <section class="panel dock-panel hidden" id="expansion-panel"></section>
                </div>
                <section class="panel map-legend hidden" id="map-legend" aria-label="地图图例"></section>
            </div>

            <section class="panel army-detail hidden" id="army-detail"></section>
            <section class="panel brief-panel hidden" id="brief-panel" aria-label="国家详情"></section>

            <div class="hud-feed">
                <div class="feed-bar">
                    <span class="feed-title">⚑ 战报直播</span>
                    <button class="feed-toggle" id="feed-toggle" data-action="feed-toggle" title="展开/收起战场直播明细" aria-label="展开战场直播明细">▾</button>
                </div>
                <div class="feed-live" id="feed-live"></div>
                <div class="feed-history hidden" id="feed-history"></div>
            </div>

            <div class="hud-corner hud-tr">
                <section class="panel dock-panel" id="army-panel"></section>
            </div>

            <div class="hud-corner hud-bl">
                <section class="panel dock-panel" id="intel-panel"></section>
            </div>

            <div class="map-layers" id="map-layers">
                <button class="map-layers-toggle" data-action="layers-toggle" aria-expanded="true" aria-controls="map-layer-options">图层 · <span id="map-layer-name">省份</span><span id="map-layer-chevron">▾</span></button>
                <div class="map-layer-options" id="map-layer-options" role="group" aria-label="地图模式">
                    <button class="map-layer active" data-action="map-mode" data-mode="province" aria-pressed="true">省份<span>地形与战术</span></button>
                    <button class="map-layer" data-action="map-mode" data-mode="state" aria-pressed="false">州<span>行政与建设</span></button>
                </div>
            </div>

            <div class="hud-corner hud-bc">
                <div class="mode-bar hidden" id="mode-bar"></div>
            </div>

            <div class="hud-corner hud-br">
                <div class="canvas-tools">
                    <button id="zoom-in" class="tool-btn" aria-label="放大">+</button>
                    <button id="zoom-out" class="tool-btn" aria-label="缩小">−</button>
                    <button id="zoom-fit" class="tool-btn" aria-label="全图">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>
                    </button>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay" id="start-overlay">
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
                        <p class="start-sub">Voronoi 大地图 · 军团战略 · 单机版</p>
                    </div>
                </div>
                <div class="start-actions">
                    <button id="btn-start" class="btn btn-primary btn-lg" type="button">新游戏</button>
                    <button id="btn-howto" class="btn btn-lg" type="button">玩法说明</button>
                </div>
                <ul class="start-summary">
                    <li><b>军团作战</b>每省最多一个军团，混编步兵/坦克/火炮；会战逐日结算，组织度决定胜负。</li>
                    <li><b>四资源经济</b>${renderGameText("[[funds]]、[[manpower]]、[[industry]]、[[politics]]；建筑与政策塑造你的战争机器，补给线决定前线战力。")}</li>
                    <li><b>便捷指挥</b>顶部资源栏 + 可收起页签；选中军团自动进入指挥模式，列表多选合并、详情窗拆分编组。</li>
                </ul>
                <p class="start-note">完整规则与操作见「玩法说明」。</p>
            </div>
        </div>
    </div>
    <div class="overlay overlay-top hidden" id="gen-overlay">
        <div class="start-card gen-card">
            <div class="gen-inner">
                <h2>正在生成世界</h2>
                <div class="gen-progress" id="gen-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                    <i id="gen-bar"></i>
                </div>
                <div class="gen-meta">
                    <p class="start-sub" id="gen-status">绘制大陆、划分州郡、推演列国……</p>
                    <span class="gen-percent" id="gen-percent">0%</span>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay hidden" id="nation-picker">
        <div class="start-card picker-card">
            <div class="start-strip"></div>
            <div class="start-inner">
                <h2 class="picker-title">选择你的国家</h2>
                <p class="start-sub">世界已经生成。点击旗帜进入巡视，可在地图上切换国家，右上角「开始游戏」以当前选中的国家开局。</p>
                <div class="nation-options" id="nation-options"></div>
                <div class="start-actions">
                    <button id="btn-random-nation" class="btn btn-primary" type="button">随机选择</button>
                    <button id="btn-back-start" class="btn" type="button">返回设置</button>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay hidden" id="newgame-overlay">
        <div class="start-card newgame-card">
            <div class="start-strip"></div>
            <div class="start-inner">
                <h2 class="picker-title">新游戏</h2>
                <p class="start-sub">选择世界规模与生成参数，随后生成世界并挑选国家。</p>
                <div class="start-form newgame-form">
                    <div class="field">
                        <label for="seed-input">地图种子</label>
                        <div class="seed-row">
                            <input id="seed-input" type="number" step="1" />
                            <button id="btn-dice" class="btn" type="button" title="随机种子">随机</button>
                        </div>
                    </div>
                    <div class="field">
                        <span class="field-label">世界国家数</span>
                        <div class="preset-row" role="group" aria-label="世界国家数">
                            ${NATION_COUNT_PRESETS.map((count) => `<button type="button" class="preset-btn${count === DEFAULT_NATION_COUNT ? " active" : ""}" data-nation-preset="${count}" aria-pressed="${count === DEFAULT_NATION_COUNT}">${count}</button>`).join("")}
                            <button type="button" class="preset-btn" data-nation-preset="custom" aria-pressed="false">自定义</button>
                        </div>
                        <div class="preset-custom hidden" id="nation-custom">
                            <input id="nation-range" type="range" min="2" max="${NATION_COUNT_MAX}" step="1" value="${DEFAULT_NATION_COUNT}" aria-label="自定义世界国家数" />
                            <b id="nation-value">${DEFAULT_NATION_COUNT} 国</b>
                        </div>
                        <p class="field-hint">5 国以上会额外生成 1–3 个附庸（割地小国或独立弱国），因此实际国家总数可能比设定多出 1–3 个。</p>
                    </div>
                    <div class="field">
                        <span class="field-label">地图大小</span>
                        <div class="preset-row" role="group" aria-label="地图大小">
                            ${MAP_CELL_PRESETS.map((cells) => `<button type="button" class="preset-btn${cells === DEFAULT_MAP_CELLS ? " active" : ""}" data-cells-preset="${cells}" aria-pressed="${cells === DEFAULT_MAP_CELLS}" aria-label="${cells} 省">${cells}</button>`).join("")}
                            <button type="button" class="preset-btn" data-cells-preset="custom" aria-pressed="false">自定义</button>
                        </div>
                        <div class="preset-custom hidden" id="cells-custom">
                            <input id="cells-range" type="range" min="${MAP_CELLS_MIN}" max="${MAP_CELLS_MAX}" step="100" value="${DEFAULT_MAP_CELLS}" aria-label="自定义地图大小" />
                            <b id="cells-value">${DEFAULT_MAP_CELLS.toLocaleString("zh-CN")} 省</b>
                        </div>
                    </div>
                    <div class="field">
                        <span class="field-label">国家强度平衡
                            <button type="button" class="intel-help intel-info" aria-label="国家强度平衡说明" ${tooltipAttrs("国家强度平衡", BALANCE_TIP)}>i</button>
                        </span>
                        <span class="settings-control settings-seg-group" role="group" aria-label="国家强度平衡">
                            <button type="button" class="settings-seg" data-balance="on" aria-pressed="false">开启</button>
                            <button type="button" class="settings-seg active" data-balance="off" aria-pressed="true">关闭</button>
                        </span>
                        <p class="field-hint">默认关闭：保留生成出的强弱差距；开启后补偿领土小、工业弱的开局国家。</p>
                    </div>
                    <details class="newgame-advanced" id="newgame-advanced">
                        <summary>地图生成参数</summary>
                        <div class="advanced-mode">
                            <span class="settings-label">参数</span>
                            <span class="settings-seg-group" role="group" aria-label="地图生成参数模式">
                                <button type="button" class="settings-seg active" data-terrain-mode="default" aria-pressed="true">默认</button>
                                <button type="button" class="settings-seg" data-terrain-mode="custom" aria-pressed="false">自定义</button>
                            </span>
                        </div>
                        ${terrainRows()}
                        <p class="settings-note">默认即标准地形；切到自定义后可调整海岸、湿度与噪声频率。</p>
                    </details>
                </div>
                <div class="start-actions">
                    <button id="btn-newgame-start" class="btn btn-primary btn-lg" type="button">开始游戏</button>
                    <button id="btn-newgame-cancel" class="btn btn-lg" type="button">取消</button>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay hidden" id="guide-overlay"></div>
    <div class="overlay hidden" id="end-overlay"></div>`;
}