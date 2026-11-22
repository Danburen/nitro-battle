import { MAP_SIZES, NATION_COUNT_MAX } from "../game/types.ts";
import { renderGameText } from "./text.ts";

const NATION_COUNT_LABELS = ["双雄对决", "三足鼎立", "四国争霸", "五强并立", "六方混战", "七国纵横", "八国乱世"];

export const DEFAULT_HINT = "点击省份查看 · 点击军团接管指挥 · 军团列表 Ctrl+点击多选合并 · 拖拽平移 · 滚轮缩放 · 右键取消";

/** Static HUD / overlay skeleton; all dynamic content is rendered by ui modules. */
export function mountLayout(app: HTMLElement): void {
    app.innerHTML = `
    <div class="game-shell">
        <canvas id="game-canvas"></canvas>
        <div class="hint" id="hint">${DEFAULT_HINT}</div>
        <div id="toast" class="toast" role="status"></div>
        <div id="global-tooltip" class="global-tooltip" role="tooltip" hidden><strong></strong><p></p></div>

        <div class="hud" id="hud">
            <div class="top-bar">
                <div class="brand">
                    <svg class="brand-mark" width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
                        <rect width="32" height="32" rx="6" fill="#161b22" stroke="#30363d"/>
                        <path d="M8 24V8l16 16V8" stroke="#1f6feb" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="24" cy="8" r="3" fill="#1f883d"/>
                    </svg>
                    <span class="brand-name">Nitro Battle</span>
                </div>
                <span class="pill" id="day-pill">第 1 天</span>
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
                    <button id="btn-menu" class="btn">新战役</button>
                    <button id="btn-endturn" class="btn btn-primary">结束回合 <kbd>E</kbd></button>
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

            <div class="hud-feed">
                <div class="feed-bar">
                    <span class="feed-title">⚑ 战报直播</span>
                    <button class="feed-toggle" id="feed-toggle" data-action="feed-toggle" title="展开/收起历史战报" aria-label="展开历史战报">▾</button>
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
                <div class="start-form">
                    <div class="field">
                        <label for="seed-input">地图种子</label>
                        <div class="seed-row">
                            <input id="seed-input" type="number" step="1" />
                            <button id="btn-dice" class="btn" type="button" title="随机种子">随机</button>
                        </div>
                    </div>
                    <div class="field">
                        <label for="size-select">地图规模</label>
                        <select id="size-select">
                            ${Object.entries(MAP_SIZES).map(([id, size]) => `<option value="${id}"${id === "standard" ? " selected" : ""}>${size.label}</option>`).join("")}
                        </select>
                    </div>
                    <div class="field">
                        <label for="nation-select">国家数量</label>
                        <select id="nation-select">
                            ${Array.from({ length: NATION_COUNT_MAX - 1 }, (_, index) => index + 2)
                                .map((count) => `<option value="${count}"${count === 3 ? " selected" : ""}>${count} 国 · ${NATION_COUNT_LABELS[count - 2]}</option>`)
                                .join("")}
                        </select>
                    </div>
                </div>
                <div class="start-actions">
                    <button id="btn-start" class="btn btn-primary btn-lg" type="button">开始战役</button>
                    <button id="btn-howto" class="btn btn-lg" type="button">玩法说明</button>
                </div>
                <ul class="start-summary">
                    <li><b>军团作战</b>每省最多一个军团，混编步兵/坦克/火炮；会战逐日结算，组织度决定胜负。</li>
                    <li><b>四资源经济</b>资金、人力、工业、政治点；建筑与政策塑造你的战争机器，补给线决定前线战力。</li>
                    <li><b>便捷指挥</b>顶部资源栏 + 可收起页签；选中军团自动进入指挥模式，列表多选合并、详情窗拆分编组。</li>
                </ul>
                <p class="start-note">完整规则与操作见「玩法说明」。</p>
            </div>
        </div>
    </div>
    <div class="overlay overlay-top hidden" id="gen-overlay">
        <div class="start-card gen-card">
            <div class="gen-inner">
                <div class="gen-spinner" aria-hidden="true"></div>
                <h2>正在生成世界</h2>
                <p class="start-sub" id="gen-status">绘制大陆、划分州郡、推演列国……</p>
            </div>
        </div>
    </div>
    <div class="overlay hidden" id="nation-picker">
        <div class="start-card picker-card">
            <div class="start-strip"></div>
            <div class="start-inner">
                <h2 class="picker-title">选择你的国家</h2>
                <p class="start-sub">世界已经生成。执掌一国，或把命运交给骰子。</p>
                <div class="nation-options" id="nation-options"></div>
                <div class="start-actions">
                    <button id="btn-random-nation" class="btn btn-primary" type="button">随机选择</button>
                    <button id="btn-back-start" class="btn" type="button">返回设置</button>
                </div>
            </div>
        </div>
    </div>
    <div class="overlay hidden" id="guide-overlay"></div>
    <div class="overlay hidden" id="end-overlay"></div>`;
}