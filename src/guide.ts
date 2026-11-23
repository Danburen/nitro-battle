import { CLAIM_COST, DIPLOMATIC_PROFILES, TRUCE_DAYS } from "./game/diplomacy.ts";
import { renderGameText } from "./ui/text.ts";

export interface GuideHandle {
    open(): void;
    close(): void;
    isOpen(): boolean;
}

interface GuideSection {
    readonly id: string;
    readonly label: string;
    readonly lead: string;
    readonly items: readonly { title: string; body: string }[];
}

const SECTIONS: readonly GuideSection[] = [
    {
        id: "basics",
        label: "基础",
        lead: "一场战役从点击地图开始。先熟悉选择、移动与回合结算。",
        items: [
            {
                title: "查看与选择",
                body: "顶部资源栏从左到右实时显示日期、季节与四资源；下方页签（部署/建造/政策/外交）可用 « 按钮收起。点击地块查看省份及所属州信息，不会自动选中驻扎军团；点击己方军团徽标或右上军团列表接管指挥，并自动切到省份模式。选中军团后，详情窗独占左上；点击军团脚下徽标以外的地块可返回地区信息，Esc、右键或 ✕ 取消选择。蓝色地块可移动，红色地块可进攻；点击另一军团徽标只切换部队，不直接合并。州模式隐藏地图上的军团、驻军与行军／会战标记，切换到州模式会退出部队选择，但保留已下达的命令。地图默认不显示[[garrison]]标签：省份模式中在同一地块静止悬停 800ms 弹出省份详情查看驻军；州模式中悬停弹出整州聚合快照（核心、拥有者、控制明细与持有宣称），快照在悬停时统计一次，展示期间不随战局实时刷新。",
            },
            {
                title: "地图染色",
                body: "国家边界统一为深色粗线，省界更浅。点击右上角齿轮打开配置菜单：「染色模式」在「均匀」（全国同深度着色）与「渐变」（默认，镜头拉高越过深色阈值后整体加深；放大时全国浅染，并沿国界内侧额外描一条国家色边线突出前线）之间切换；「深色阈值」滑杆实时调节触发深度，「恢复默认」一键还原。设置自动保存，Esc 或点击菜单外关闭。",
            },
            {
                title: "移动与合并",
                body: "军团只能在己方省份间移动，进入省份消耗地形成本（军团速度取决于最慢的团）。移动到有友军的省份会合并两个军团（上限 12 团）。也可在右上列表 Ctrl+点击多选军团后合并：数量少的军团自动行军前往数量多的军团。森林、丘陵、山地更难通行，防御也更高。地图上下左右环绕连通。",
            },
            {
                title: "拆分编组",
                body: "军团详情窗列出每个团的兵力、攻防机动与[[organization]]。勾选若干团点「拆分编组」，即可分出新军团进驻相邻己方空省；新军团当回合无法行动。拆分受军团上限约束。",
            },
            {
                title: "多日行军",
                body: "点击蓝色/红色范围之外的远处省份，军团会自动寻路逐日推进：己方省份为行军，敌对省份为远征（抵达后自动进攻）。行军命令可随时在详情窗撤销，地图上有虚线箭头指示。",
            },
            {
                title: "结束回合",
                body: "按 E 或点击右上角「结束回合」。AI 行动、会战结算、行军推进、生产训练与补给恢复在同一[[turn]]内结算，然后进入下一[[turn]]。",
            },
            {
                title: "快捷键",
                body: "E / 空格：结束回合 · M：音效开关 · Esc：取消选择与战略转移 · 右键：取消选择。",
            },
        ],
    },
    {
        id: "combat",
        label: "军团与会战",
        lead: "每省最多一个军团，混编多个团。会战逐日结算，[[organization]]决定胜负。",
        items: [
            {
                title: "军团与团",
                body: "军团是唯一的移动单位，最多混编 12 个团。步兵廉价、坦克机动、火炮攻坚（对高[[garrison]]省份最高 [[attack:+60%]]）。受损的团在[[supply]]充足（≥50%）时每[[turn]]自动补充 1 HP，消耗少量资源。",
            },
            {
                title: "[[organization]]",
                body: "[[organization]]（0–100）按比例放大军团战力，每[[turn]]按[[supply]]恢复（满[[supply]] +9）。降到 15 以下军团溃退：进攻方退回原地，防守方撤往相邻己方空省，无路可退则被歼灭。战略转移后[[organization]]降为 20。",
            },
            {
                title: "会战",
                body: "进攻相邻敌对省份发起会战，每[[turn]]结算一轮：双方按攻防比例互相杀伤并损失[[organization]]。[[garrison]]每[[turn]]恢复约 10%（交战中不恢复）。摧毁[[garrison]]并击溃守军后占领省份；攻方[[organization]]先崩溃则攻势瓦解。可随时「停止进攻」。",
            },
            {
                title: "[[garrison]]",
                body: "每个省份都有按产值、城市等级与地形生成的[[garrison]]。处于有效战争时，无[[garrison]]且无守军的省份可直接占领。[[fort]]仅强化本省[[garrison]]：上限 +50%，非交战每日恢复上限的 15%（普通 10%），造成伤害 +25%，承受伤害 ×0.8；不增加地形或城市[[defense]]倍率。",
            },
            {
                title: "战略转移",
                body: "未行动的军团可一键转移到任意己方空省，适合救火与换防；转移后[[organization]]降为 20 且本回合结束。",
            },
            {
                title: "[[supply]]",
                body: "首都、城市与省份[[supply]]中心提供[[supply]]。[[supply]]中心需 [[construction:30]]，工期较长；沿己方陆地辐射范围 8，距离 d 对应 u = 1 − d/8，[[supply]]加成 +10u 个百分点、倍率 ×(1 + 0.2u)，重叠取最强而非累加。[[supply]]可超过 100%，但战斗与[[organization]]恢复最多按 100% 计算；低于 50% 停止补充，低[[occupation]]会缩短城市与首都的[[supply]]辐射范围。",
            },
        ],
    },
    {
        id: "economy",
        label: "经济与建设",
        lead: "四种资源驱动战争机器：[[funds]]、[[manpower]]、[[industry]]、[[politics]]。",
        items: [
            {
                title: "四资源",
                body: "[[funds]]来自省份税收、[[farm]]与[[production]][[factory]]，支付训练、建造与军团维护；[[manpower]]来自人口与[[farm]]，用于训练；[[industry]]来自城市与[[production]][[factory]]，用于训练、兵力补充与建筑；[[politics]]基础每[[turn]] +2，[[admin]]每座再 +1，用于切换政策、提出州宣称和准备战争借口。发不出维护费的军团每[[turn]]掉[[organization]]。",
            },
            {
                title: "训练与部署",
                body: "「部署」页签训练步兵/坦克/火炮，立即扣除三种资源，1–2 [[turn]]后部署。优先补充落点的未满军团，否则新建军团。军团上限 = 3 + 领土省数 ÷ 6，扩张领土才能养更多军团。",
            },
            {
                title: "六种建筑与归属",
                body: "[[factory]]、[[farm]]、[[infrastructure]]、[[admin]]建在州；[[supply]]中心、[[fort]]建在具体省份。采用州级统一区域加成方案，而非逐省重复堆叠：经济与区域增益归州管理，[[supply]]辐射与[[garrison]]防护保留本地落点。[[factory]]、[[farm]]各自上限等于州内省份数，已建与待建都占容量；[[admin]]每州限 1 座，仅 [[politics:+1]]/[[turn]]。",
            },
            {
                title: "州[[infrastructure]]",
                body: "[[infrastructure]] L = 0–8：产出与建造倍率均为 0.8 + 0.05L，通行成本为 1 − 0.05L，[[supply]]倍率为 1 + 0.05L。0 级依次为 0.8/0.8/1/1，8 级为 1.2/1.2/0.6/1.4。只对仍与州中心同属一国的省份生效，异主省份按 0 级计算。",
            },
            {
                title: "[[construction]]与全国队列",
                body: "建筑消耗[[construction]]，不是固定回合数。队列按顺序分配[[idle]][[factory]]，每项最多 5 座，多余[[factory]]用于下一项；每座每[[turn]]提供 0.5 基础点 × 来源州产出倍率 × 目标州建造倍率（均为 0.8 + 0.05L）。没有[[idle]][[factory]]就暂停。拖动可重排优先级；取消返还已付[[funds]]和[[industry]]的一半。项目完成后，[[factory]]从下一回合重新分配，不在当[[turn]]再次投入。",
            },
            {
                title: "建造地图与图层",
                body: "「建造」中先选州或省份建筑图标，再点击地图中的己方陆地州或省份直接入队，可连续选址。地图容量为（已建＋在建）/上限：空闲浅色，满额采用独立最深色；州建筑另有中间容量渐变。[[supply]]中心与[[fort]]每省各限 1 座，待建也占容量，不要求控制州中心；非己方控制的陆地与水域不着色、不可建造。省份容量数字放大地图后显示，缩小时仅着色；省份图层不显示州建筑汇总。资源不足仍无法入队。右键或 Esc 取消选择，切换建筑层级取消原选择，关闭建造页恢复普通地图；地图军团徽标不会抢走选址点击，右侧军团列表仍可接管指挥。",
            },
            {
                title: "州与[[factory]]分配",
                body: "开局先划州，再把全部陆地州分配给各国：大陆按省份数量均衡扩张，剩余省份并入最邻近的接壤国家，海外州整块划给最近海岸的国家，全图不存在中立地区。每州以城市为中心；战时按省争夺实际控制，攻占州中心只改变本省控制与州属建筑使用权，不令其他省份或正式归属自动易主。[[production]][[factory]]每座基础每[[turn]] [[funds:+2]]、[[industry:+2]]，受来源州产出倍率影响；[[idle]][[factory]]投入全国建设。顶部[[factory]]分配栏滚轮向上增加[[production]]、向下增加[[idle]]；聚焦后也可用方向键或 +/− 调整。"
            },
            {
                title: "[[occupation]]",
                body: "攻占的非核心省份从 0% 开始整合，基础每[[turn]] +4，可受占领政策调整；[[admin]]不增加整合速度。效率决定该省产出与[[supply]]通行：25% 起步，100% 满效。历史核心省份（开局领土）被夺回后立即满效；提出宣称、占领或正式割让都不会把非核心变为历史核心。",
            },
        ],
    },
    {
        id: "diplomacy",
        label: "政策与外交",
        lead: "全图各省均已归属国家，没有中立地区。先宣称与准备，再按目标开战；没有阵营或复杂会议。",
        items: [
            {
                title: "政策",
                body: "「政策」页签以紧凑横排按钮切换经济（[[funds]]/[[industry]]倾向）、兵役（[[manpower]]/[[funds]]权衡）与占领（整合速度/占领区税收）三组政策，悬停按钮查看具体加成，每次消耗 [[politics:20]]，立即生效。全面动员适合决战，宽容占领适合快速消化新领土。",
            },
            {
                title: "正式归属、控制与核心",
                body: "省份的实际控制决定当前驻军与行动，法理上的正式归属决定战争目标和议和割让。战时占领只改变实际控制，不能直接把他国土地变为正式领土。历史核心由开局归属决定；州宣称只是政治诉求，不等于核心，也不自动授予进攻权限。",
            },
            {
                title: "外交页与国家卡片",
                body: "「外交」页签专注国家关系：标题旁 [i] 悬浮查看战役目标与规则；顶部实时给出吞并进度、战争场次与借口就绪数量；下方国家色块即目标 tab，悬停查看国名、状态与规模，红圈表示交战、黄圈表示停战。详情卡片垂直列出拥有军团数与实际控制的州/省数，下方「外交行动」一排按钮：【制造战争借口】（计时中显示为【停止制造】）打开居中的外交行动菜单，勾选已有宣称制造夺取借口、选择全面吞并，或勾选取消进行中的项目——取消返还创建政治点，已消耗的每日维护不退还，确认后统一生效。【求和】仅交战时可用；借口就绪后点击【宣战】（悬停查看准备条件），在弹窗选择战争目标并确认才正式开战。我方目标达成后可「落实目标」按约定议和。",
            },
            {
                title: "扩张页与宣称管理",
                body: `「扩张」页签独立管理州宣称，打开即自动切换州模式：标题右侧 [i] 悬浮查看全部宣称规则。页面只列出我方已宣称的州进行管理（取消、定位、聚焦），不再罗列可宣称目标。可宣称的州直接在地图上沿州边界金色闪烁高亮，点击即花 [[politics:${CLAIM_COST}]] 提出宣称，再次点击同一州取消并返还政治点，交战中不可取消。已宣称州以我方国家颜色覆盖填充并描州边界；点击列表条目聚焦描边，「定位」把地图居中到州中心，Esc 取消聚焦。宣战借口在「外交」页的外交行动菜单制造。`,
            },
            {
                title: "州悬停聚合快照",
                body: "州地图模式下静止悬停 800ms 弹出整州统计：核心（历史核心国家）、拥有者（正式归属国家）、控制明细（各国实际控制百分比）与持有宣称的国家，均以国家色块标签展示。该快照在悬停成立时统计一次，展示期间不随战局实时刷新；移开鼠标或移动地图后重新悬停才会重新统计。",
            },
            {
                title: "州宣称与战争借口",
                body: `宣称只能在「扩张」页或州模式的地图上提出：目标州须含他国正式领土，且与己方邻接或拥有历史核心，满足条件后花 [[politics:${CLAIM_COST}]]。夺取宣称州借口另需 [[politics:${DIPLOMATIC_PROFILES.conquest.cost}]]、准备 [[turn:${DIPLOMATIC_PROFILES.conquest.days}]]（每[[turn]]维护 [[politics:${DIPLOMATIC_PROFILES.conquest.upkeep}]]），就绪有效 [[turn:${DIPLOMATIC_PROFILES.conquest.validDays}]]，目标州必须已宣称。全面吞并借口不要求州宣称，需 [[politics:${DIPLOMATIC_PROFILES.annex.cost}]]、准备 [[turn:${DIPLOMATIC_PROFILES.annex.days}]]（每[[turn]]维护 [[politics:${DIPLOMATIC_PROFILES.annex.upkeep}]]），有效 [[turn:${DIPLOMATIC_PROFILES.annex.validDays}]]。有效借口就绪且停战期结束后才能宣战，开战消耗所用借口；取消宣称会令对应的夺取借口失效。`,
            },
            {
                title: "准备队列与时限",
                body: "每个国家同时最多有一个仍在计时的外交准备；已就绪的不同目标可同时保留。战争借口要求与目标处于和平且停战期已结束；夺取借口须邻接所选州，吞并借口须与目标国接壤。在外交行动菜单中取消仍在计时的项目返还创建政治点，但准备期间已消耗的每日维护不退还；放弃已就绪或过期项目不退款。宣称与借口的条件仍由当前领土和外交局势决定；过期借口不可宣战，需要重新准备。",
            },
            {
                title: "落实战争目标",
                body: "夺取宣称州：完全控制目标州内对方的正式领土后，可点击「达成战争目标」割让这些省份。全面吞并：需控制首都及至少 60% 正式领土，且无第三方占领；或完全控制对方全部正式领土。首都陷落本身不会自动灭国。目标之外的临时占领在议和时退还，不能借割地转移第三国土地。",
            },
            {
                title: "白和平与撤军",
                body: `战争中可提议白和平，AI 依据战局接受或拒绝，弱势时也会主动求和。白和平不保留临时占领，双方返还占领区，不转移第三国土地；白和平或目标议和都会解除双方会战，双方部队退回可控地区，并进入 [[turn:${TRUCE_DAYS}]]停战期。没有空位撤军时会整编或遣散，回收相应人力。`,
            },
            {
                title: "AI 对手",
                body: "电脑会建设经济、训练部队、准备外交项目、集中兵力按省进攻、落实战争目标与求和。留意外交面板的目标国家详情、右上军团列表与战报，判断各线压力。",
            },
        ],
    },
    {
        id: "world",
        label: "季节与胜利",
        lead: "四季影响行军与战斗；首都是重要目标，但占领首都不等于赢得战争。",
        items: [
            {
                title: "四季与积雪",
                body: "每 [[turn:8]]换季。冬季积雪拖慢行军并削弱攻势，深雪地区影响更大，适合转入防御与整补。",
            },
            {
                title: "胜利条件",
                body: "通过战争目标与正式领土结算消灭所有对手，成为最后存续国家即可获胜。自己的首都陷落不会立即战败，也不会令全部领土自动被吞并；要继续保卫正式领土、反攻或议和。首都是高产值、高[[garrison]]的核心城市，也是[[supply]]网的重要来源，且是全面吞并的重要条件。",
            },
            {
                title: "战报",
                body: "地图上方的战报直播以「国家 + 行为 + 目标」的紧凑格式推送会战、占领、外交与季节消息，国家名带本国颜色标签，正负数值绿红区分；淡入淡出自动消失，点击箭头可展开完整历史战报回看战局脉络。",
            },
        ],
    },
];

export function initGuide(): GuideHandle {
    const overlay = document.querySelector<HTMLElement>("#guide-overlay") as HTMLElement;

    const tabs = SECTIONS.map((section, index) =>
        `<button class="guide-tab${index === 0 ? " active" : ""}" data-guide-tab="${section.id}">${section.label}</button>`).join("");

    const panels = SECTIONS.map((section, index) => `
        <section class="guide-section${index === 0 ? "" : " hidden"}" data-guide-section="${section.id}">
            <p class="guide-lead">${renderGameText(section.lead)}</p>
            <div class="guide-grid">
                ${section.items.map((item) => `
                    <article class="guide-item">
                        <h3>${renderGameText(item.title)}</h3>
                        <p>${renderGameText(item.body)}</p>
                    </article>`).join("")}
            </div>
        </section>`).join("");

    overlay.innerHTML = `
        <div class="guide-card">
            <div class="guide-head">
                <div>
                    <h2>作战手册</h2>
                    <p>从军团作战、四资源经济到政策外交，一页看懂全部机制。</p>
                </div>
                <button class="btn btn-icon guide-close" data-guide-close aria-label="关闭">✕</button>
            </div>
            <nav class="guide-tabs" id="guide-tabs">${tabs}</nav>
            <div class="guide-body">${panels}</div>
            <div class="guide-foot">
                <span>提示：游戏中可随时点击右上角「?」重新打开。</span>
                <button class="btn btn-primary" data-guide-close>返回战场</button>
            </div>
        </div>`;

    const select = (id: string): void => {
        for (const button of overlay.querySelectorAll<HTMLElement>("[data-guide-tab]")) {
            button.classList.toggle("active", button.dataset.guideTab === id);
        }
        for (const section of overlay.querySelectorAll<HTMLElement>("[data-guide-section]")) {
            section.classList.toggle("hidden", section.dataset.guideSection !== id);
        }
    };

    overlay.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-guide-close]")) {
            close();
            return;
        }
        const tab = target.closest<HTMLElement>("[data-guide-tab]");
        if (tab?.dataset.guideTab) select(tab.dataset.guideTab);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !overlay.classList.contains("open")) return;
        event.stopImmediatePropagation();
        close();
    });

    const open = (): void => {
        overlay.classList.remove("hidden");
        overlay.classList.add("open");
        select("basics");
    };
    const close = (): void => {
        overlay.classList.add("hidden");
        overlay.classList.remove("open");
    };

    return { open, close, isOpen: () => overlay.classList.contains("open") };
}
