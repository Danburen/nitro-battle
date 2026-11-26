import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { chipToken, escapeGameText, escapeHtml, game, RELATION_COLORS, renderGameMarkup, renderGameText, setGameHtml, setGameText, TEXT_TERMS } from "../ui/text.ts";
import type { RelationTone, TextKey } from "../ui/text.ts";
import { tooltipAttrs } from "../ui/tooltip.ts";
import { garrisonRelation } from "../ui/common.ts";
import { setWar } from "../game/diplomacy.ts";
import { NEUTRAL } from "../game/types/world.ts";
import type { GameState } from "../game/types/state.ts";

/** CSS assertions span the split style package and the per-component stylesheets. */
function readStyles(): string {
    const chunks: string[] = [];
    const walk = (dir: URL): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const target = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
            if (entry.isDirectory()) walk(target);
            else if (entry.name.endsWith(".css")) chunks.push(readFileSync(target, "utf8"));
        }
    };
    walk(new URL("../style/", import.meta.url));
    walk(new URL("../ui/", import.meta.url));
    return chunks.join("\n");
}

for (const key of Object.keys(TEXT_TERMS) as TextKey[]) {
    test(`${key} has a consistent colored label and plain equivalent`, () => {
        const term = TEXT_TERMS[key];
        const style = "style" in term && term.style === "plain" ? "game-text--plain" : `game-text--${term.tone}`;
        assert.equal(renderGameText(game`[[${key}]]`, "plain"), term.label);
        assert.equal(renderGameText(game`[[${key}]]`), `<span class="game-text ${style}">${term.label}</span>`);
    });
}

test("garrison relations follow player ownership and current peace or war", () => {
    const state = {
        day: 1,
        war: Array.from({ length: 3 }, () => [false, false, false]),
        warSince: Array.from({ length: 3 }, () => [-1, -1, -1]),
        truce: Array.from({ length: 3 }, () => [-1, -1, -1]),
        peaceOffers: [],
    } as unknown as GameState;
    assert.equal(garrisonRelation(state, 0), "friendly");
    assert.equal(garrisonRelation(state, NEUTRAL), "neutral");
    assert.equal(garrisonRelation(state, 1), "neutral");
    setWar(state, 1, 2, true);
    assert.equal(garrisonRelation(state, 1), "neutral", "foreign wars do not make a nation hostile to the player");
    setWar(state, 1, 0, true);
    assert.equal(garrisonRelation(state, 1), "hostile");
    assert.equal(garrisonRelation(state, 2), "neutral");
    assert.equal(garrisonRelation(state, 0), "friendly");
    assert.equal(garrisonRelation(state, NEUTRAL), "neutral");
    setWar(state, 0, 1, false);
    assert.equal(garrisonRelation(state, 1), "neutral", "peace updates the same state without a cached relation");
    setWar(state, 0, 1, true);
    assert.equal(garrisonRelation(state, 1), "hostile");
});

test("relation tokens name garrisons explicitly without changing generic garrison semantics", () => {
    const labels: Record<RelationTone, string> = { friendly: "友方", neutral: "中立", hostile: "敌方" };
    for (const tone of Object.keys(RELATION_COLORS) as RelationTone[]) {
        assert.deepEqual(TEXT_TERMS[tone], { label: labels[tone], tone });
        const source = game`[[${tone}]]驻军`;
        assert.equal(renderGameText(source, "plain"), `${labels[tone]}驻军`);
        assert.equal(renderGameText(source), `<span class="game-text game-text--${tone}">${labels[tone]}</span>驻军`);
    }
    assert.equal(renderGameText("[[garrison]]"), '<span class="game-text game-text--plain">驻军</span>');
});

test("resource amounts have suffix icons and accessible names without duplicate speech", () => {
    const html = renderGameText("消耗 [[funds:1234]] 与 [[industry:20]]");
    assert.match(html, /aria-label="1,234 财政"/);
    assert.match(html, /aria-label="20 工业"/);
    assert.match(html, /<span class="gtext-value game-text--pos">1,234<\/span><span class="gtext-icon resource-icon game-text--funds"/);
    assert.equal((html.match(/class="gtext-icon resource-icon/g) ?? []).length, 2);
    assert.match(html, /--icon:url\('\.\/assets\/icons\/funds\.svg'\)/);
    assert.ok(!html.includes("<path"));
    assert.equal(renderGameText("消耗 [[funds:1234]] 与 [[industry:20]]", "plain"), "消耗 1,234 财政 与 20 工业");
});

test("signed fractions, percentages, zero and adjacent tokens retain their semantics", () => {
    assert.equal(renderGameText("[[funds:+1234.5]][[manpower:-0.5]][[industry:0]][[supply:120%]]", "plain"),
        "+1,234.5 财政-0.5 人力0 工业120% 补给");
    assert.equal(renderGameText("[[construction:.5]]", "plain"), "0.5 建造点");
    assert.equal(renderGameText("[[politics:+10%]]", "plain"), "+10% 政治点");
});

test("signed bonuses color green, penalties red and zero stays neutral", () => {
    const html = renderGameText("产出 +20% 维护 -5% 修正 +0");
    assert.match(html, /<span class="game-text game-text--pos">\+20%<\/span>/);
    assert.match(html, /<span class="game-text game-text--neg">-5%<\/span>/);
    assert.match(html, /<span class="game-text game-text--zero">\+0<\/span>/);
    assert.match(renderGameText("[[industry:+20%]]"), /class="gtext-value game-text--pos">\+20%<\/span>/);
    assert.match(renderGameText("[[funds:-3.5]]"), /class="gtext-value game-text--neg">-3\.5<\/span>/);
    assert.equal(renderGameText("产出 +20%", "plain"), "产出 +20%");
});

test("unified forms cover bare icons, forced labels and static semantics", () => {
    assert.equal(renderGameText("[[funds:]]", "plain"), "财政");
    assert.match(renderGameText("[[funds:]]"), /class="gtext-icon resource-icon game-text--funds"/);
    assert.equal(renderGameText("[[icon:funds]]", "plain"), "财政");
    assert.equal(renderGameText("[[label:funds]]"), '<span class="game-text game-text--plain">财政</span>');
    assert.match(renderGameText("[[funds:13:pos]]"), /class="gtext-value game-text--pos">13<\/span>/);
    assert.match(renderGameText("[[funds:13:neg]]"), /class="gtext-value game-text--neg">13<\/span>/);
    assert.match(renderGameText("[[funds:13:neutral]]"), /class="gtext-value game-text--plain">13<\/span>/);
    assert.equal(renderGameText("[[fund:13]]", "plain"), "13 财政");
});

test("current-value tokens resolve through an injected read-only resolver", () => {
    const resolver = (id: string, scope: string | null): number | null =>
        id === "funds" ? (scope === null || scope === "@USER" ? 13 : scope === "@1" ? 7 : null) : null;
    assert.equal(renderGameText("[[funds:~]]", "plain", resolver), "13 财政");
    assert.equal(renderGameText("[[@1:funds:~]]", "plain", resolver), "7 财政");
    assert.equal(renderGameText("[[funds:~]]", "plain"), "财政", "no active resolver keeps the semantic label");
    assert.match(renderGameText("[[@USER:funds:~:pos]]", "html", resolver), /class="gtext-value game-text--pos">13<\/span>/);
    assert.match(renderGameText("[[funds:~:10]]", "html", resolver), /class="gtext-value game-text--plain">13<\/span>/);
    assert.match(renderGameText("[[funds:~:20]]", "html", resolver), /class="gtext-value game-text--neg">13<\/span>/);
    assert.match(renderGameText("[[funds:~:20:neg]]", "html", resolver), /class="gtext-value game-text--pos">13<\/span>/);
    assert.match(renderGameText("[[funds:~:10:pos]]", "html", resolver), /class="gtext-value game-text--pos">13<\/span>/);
});

test("unknown, malformed, nested and nonfinite tokens remain literal", () => {
    for (const source of ["[[unknown]]", "[[constructor]]", "[[__proto__]]", "[[funds", "[[ funds ]]", "[[funds:[[industry]]]]",
        "[[funds:1:pos:extra:extra]]", "[[@BAD:funds]]", "[[funds:1:abc]]", "[[icon:unknown]]", "[[label:funds:extra]]",
        `[[funds:${"9".repeat(400)}]]`]) {
        assert.equal(renderGameText(source), escapeHtml(source));
        assert.equal(renderGameText(source, "plain"), source);
    }
});

test("signed trait tokens prefix + or - and colour the whole line", () => {
    assert.equal(renderGameText("[[pos:倾向于主动进攻他国]]"),
        '<span class="game-text game-text--pos">+倾向于主动进攻他国</span>');
    assert.equal(renderGameText("[[neg:难以忍受长期战争]]"),
        '<span class="game-text game-text--neg">-难以忍受长期战争</span>');
    assert.equal(renderGameText("[[note:对扩张领土兴趣不大]]"),
        '<span class="game-text game-text--note">~对扩张领土兴趣不大</span>');
    assert.equal(renderGameText("[[pos:倾向于主动进攻他国]]", "plain"), "+倾向于主动进攻他国");
    assert.equal(renderGameText("[[note:对扩张领土兴趣不大]]", "plain"), "~对扩张领土兴趣不大");
    assert.equal(renderGameText("[[neg:<b>短板</b>]]"),
        '<span class="game-text game-text--neg">-&lt;b&gt;短板&lt;/b&gt;</span>');
    for (const source of ["[[pos:]]", "[[neg:]]", "[[note:]]", "[[positive:1]]", "[[pos :x]]"]) {
        assert.equal(renderGameText(source), escapeHtml(source));
    }
});

test("ordinary text and untrusted HTML are escaped, not interpreted", () => {
    const source = `<img src=x onerror="alert(1)"> & 'quoted'\n[[funds]]`;
    const html = renderGameText(source);
    assert.ok(html.startsWith("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;\n"));
    assert.ok(!html.includes("<img"));
    assert.match(html, /game-text--funds/);
    assert.equal(renderGameText(source, "plain"), `<img src=x onerror="alert(1)"> & 'quoted'\n财政`);
});

test("dynamic names can contain literal tokens, backslashes and HTML safely", () => {
    const name = `[[funds:900]] <script>bad()</script> \\ frontier`;
    const source = `地点：${escapeGameText(name)}\n成本：[[industry:12]]`;
    const html = renderGameText(source);
    assert.equal((html.match(/class="gtext game-text-amount"/g) ?? []).length, 1);
    assert.ok(html.includes("[[funds:900]] &lt;script&gt;bad()&lt;/script&gt; \\ frontier"));
    assert.equal(renderGameText(source, "plain"), `地点：${name}\n成本：12 工业`);
});

test("game tag cannot smuggle markup through a token value", () => {
    const payload = '1]][[industry:999]]<img src=x onerror="bad()">';
    const source = game`[[funds:${payload}]]`;
    assert.equal(source, `[[funds:${escapeGameText(payload)}]]`);
    const html = renderGameText(source);
    assert.ok(!html.includes("<svg"));
    assert.ok(!html.includes("<img"));
    assert.equal(renderGameText(source, "plain"), `${payload} 财政`);
});

test("game tag escapes every value inside a multi-value token", () => {
    const source = game`[[${"funds"}:${"1]]<img onerror=bad()>"}]]`;
    assert.equal(source, `[[funds:${escapeGameText("1]]<img onerror=bad()>")}]]`);
    assert.ok(!renderGameText(source).includes("<img"));
    assert.equal(renderGameText(source, "plain"), `1]]<img onerror=bad()> 财政`);
});

test("invalid interpolated values degrade to a label, never a sentinel string", () => {
    for (const value of [NaN, Infinity, -Infinity, undefined, null]) {
        assert.equal(game`[[funds:${value}]]`, "[[funds:undefined]]");
    }
    // String sentinels stay literal in the source; parse still degrades them.
    for (const value of [NaN, Infinity, -Infinity, undefined, null, "NaN", "undefined", "Infinity"]) {
        const source = game`[[funds:${value}]]`;
        assert.equal(renderGameText(source, "plain"), "财政", `value: ${String(value)}`);
        const html = renderGameText(source);
        assert.ok(!html.includes("undefined"), html);
        assert.ok(!html.includes("NaN"), html);
        assert.match(html, /class="game-text game-text--funds">财政<\/span>/);
    }
    // A live resolver that hands back a bad value degrades the same way.
    const badResolver = (): number => Number.NaN;
    assert.equal(renderGameText("[[funds:~]]", "plain", badResolver), "财政");
    assert.ok(!renderGameText("[[funds:~]]", "html", badResolver).includes("NaN"));
    // Values outside tokens keep ordinary template-literal semantics.
    assert.equal(game`花费 ${NaN} 与 ${undefined}`, "花费 NaN 与 undefined");
});

test("nation chips render colored labels and round-trip hostile names safely", () => {
    assert.equal(renderGameText(chipToken("#1f6feb", "蔚蓝联邦")),
        '<span class="game-text game-text--chip" style="--pc:#1f6feb">蔚蓝联邦</span>');
    assert.equal(renderGameText(chipToken("#abc", "蔚蓝联邦"), "plain"), "蔚蓝联邦");
    const hostile = `]] [[funds:9]] <img src=x onerror="bad()"> \\ N0`;
    const source = `核心：${chipToken("#1f6feb", hostile)} 与 ${chipToken("#f85149", "赤色同盟")}`;
    const html = renderGameText(source);
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img src=x onerror=&quot;bad()&quot;&gt;"));
    assert.equal((html.match(/game-text--chip/g) ?? []).length, 2);
    assert.equal(renderGameText(source, "plain"), `核心：${hostile} 与 赤色同盟`);
    for (const color of ["red", "#12", "#12345g", "javascript:alert(1)", "#fff;position:fixed"]) {
        assert.equal(renderGameText(`[[chip:${color}|X]]`), escapeHtml(`[[chip:${color}|X]]`));
        assert.equal(chipToken(color, "X"), "X");
    }
    const css = readStyles();
    assert.match(css, /\.game-text--chip\s*\{/);
});

test("escape syntax leaves ordinary backslashes and line breaks intact", () => {
    assert.equal(renderGameText(String.raw`\[[funds]] [[industry]] C:\data`, "plain"), String.raw`[[funds]] 工业 C:\data`);
    assert.equal(renderGameText("第一行\n第二行", "plain"), "第一行\n第二行");
});

test("tooltip attributes preserve source markup while escaping the HTML boundary", () => {
    const attrs = tooltipAttrs('[[funds]] "储备"', '[[funds:42]] <img onerror="bad()">');
    assert.equal(attrs, 'data-tooltip-title="[[funds]] &quot;储备&quot;" data-tooltip-body="[[funds:42]] &lt;img onerror=&quot;bad()&quot;&gt;"');
});

test("DOM text updates skip unchanged content and keep nodes independent", () => {
    let writes = 0;
    let content = "";
    const element = {
        set innerHTML(value: string) { writes++; content = value; },
        set textContent(value: string) { writes++; content = value; },
    } as HTMLElement;
    assert.equal(setGameText(element, "[[funds:1]]"), true);
    for (let i = 0; i < 100; i++) assert.equal(setGameText(element, "[[funds:1]]"), false);
    assert.equal(writes, 1);
    assert.equal(setGameText(element, "[[funds:2]]"), true);
    assert.equal(writes, 2);
    assert.equal(setGameText(element, "[[funds:2]]", "plain"), true);
    assert.equal(content, "2 财政");
    const second = { innerHTML: "" } as HTMLElement;
    assert.equal(setGameText(second, "[[funds:2]]"), true);
    assert.match(second.innerHTML, /aria-label="2 财政"/);

    let current = 1;
    const live = (): number => current;
    const third = { innerHTML: "" } as HTMLElement;
    assert.equal(setGameText(third, "[[funds:~]]", "html", live), true);
    assert.equal(setGameText(third, "[[funds:~]]", "html", live), false);
    current = 2;
    assert.equal(setGameText(third, "[[funds:~]]", "html", live), true, "same source must refresh when its value changes");
});

test("markup rendering keeps attribute tokens as source and renders text nodes", () => {
    const markup = renderGameMarkup('<div title="[[funds:2]]">消耗 [[funds:2]] 与 +5</div>');
    assert.match(markup, /title="\[\[funds:2\]\]"/);
    assert.equal((markup.match(/aria-label="2 财政"/g) ?? []).length, 1);
    assert.match(markup, /<span class="game-text game-text--pos">\+5<\/span>/);

    const feed = renderGameMarkup('<p data-x="[[turn]]">最近 3 [[turn]]没有战况。</p>');
    assert.match(feed, /data-x="\[\[turn\]\]"/);
    assert.match(feed, /<span class="game-text game-text--plain">回合<\/span>/);
    assert.ok(!feed.includes("[[turn]]没有"));
});

test("setGameHtml deduplicates rendered markup and refreshes live tokens", () => {
    const element = { innerHTML: "" } as HTMLElement;
    assert.equal(setGameHtml(element, "<b>[[funds:1]]</b>"), true);
    const first = element.innerHTML;
    assert.equal(setGameHtml(element, "<b>[[funds:1]]</b>"), false);
    assert.equal(element.innerHTML, first);
    assert.equal(setGameHtml(element, "<b>[[funds:2]]</b>"), true);

    let current = 1;
    const live = (): number => current;
    const liveElement = { innerHTML: "" } as HTMLElement;
    assert.equal(setGameHtml(liveElement, "<b>[[funds:~]]</b>", live), true);
    assert.equal(setGameHtml(liveElement, "<b>[[funds:~]]</b>", live), false);
    current = 2;
    assert.equal(setGameHtml(liveElement, "<b>[[funds:~]]</b>", live), true);
});

test("registry plain labels use the theme foreground class", () => {
    const css = readStyles();
    assert.match(css, /\.game-text--plain\s*\{\s*color:\s*var\(--site-fg\);\s*\}/);
});

test("large unmatched and unknown input stays literal without recursion", () => {
    for (const source of ["[[".repeat(50000), "[[missing]]".repeat(10000)]) {
        assert.equal(renderGameText(source), source);
    }
});

test("relation palette matches CSS semantic classes and garrison bar inheritance", () => {
    assert.deepEqual(RELATION_COLORS, { friendly: "#7ee787", neutral: "#e3b341", hostile: "#ff7b72" });
    const css = readStyles();
    for (const [tone, color] of Object.entries(RELATION_COLORS)) {
        const hex = css.match(new RegExp(`--relation-${tone}:\\s*(#[0-9a-f]{6})\\s*;`))?.[1];
        assert.equal(hex, color, `${tone} CSS and Canvas palette must agree`);
        assert.match(css, new RegExp(`\\.game-text--${tone}\\s*\\{\\s*color:\\s*var\\(--relation-${tone}\\);\\s*\\}`));
    }
    assert.match(css, /\.garrison-bar i\s*\{[^}]*background:\s*currentColor;/);
    assert.match(css, /\.garrison-bar\.occ i\s*\{\s*background:\s*#8957e5;/);
});

test("semantic text colors maintain readable contrast on dark panel and tooltip surfaces", () => {
    const css = readStyles();
    const luminance = (hex: string): number => {
        const rgb = hex.match(/\w\w/g)!.map((channel) => Number.parseInt(channel, 16) / 255)
            .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    for (const variable of ["resource-funds", "resource-manpower", "resource-industry", "resource-politics", "resource-construction", "text-keyword",
        ...Object.keys(RELATION_COLORS).map((tone) => `relation-${tone}`)]) {
        const hex = css.match(new RegExp(`--${variable}: #([0-9a-f]{6})`))![1];
        for (const background of ["161b22", "0d1117"]) {
            assert.ok((luminance(hex) + 0.05) / (luminance(background) + 0.05) >= 4.5, variable);
        }
    }
});
