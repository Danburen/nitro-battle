import assert from "node:assert/strict";
import test from "node:test";
import { nationFlagHtml, nationFlagSpec } from "../ui/flags.ts";

test("a flag is always the display colour plus one stable emblem", () => {
    const nation = { color: "#1f6feb", name: "卡尔联邦" };
    const first = nationFlagSpec(nation);
    const second = nationFlagSpec({ ...nation });
    assert.equal(first.color, "#1f6feb");
    assert.equal(first.vassal, false);
    assert.match(first.emblem, /^[a-z]+$/);
    assert.deepEqual(first, second);
    assert.match(first.accent, /^#[0-9a-f]{6}$/i);

    const html = nationFlagHtml(nation, 24);
    assert.match(html, /class="nation-flag"/);
    assert.match(html, /--flag-bg:#1f6feb/);
    assert.match(html, /--flag-emblem:url\('\.\/assets\/flags\/emblem-[a-z]+\.svg'\)/);
    assert.match(html, /<i><\/i>/);
});

test("vassals fly the overlord display colour but keep their own emblem", () => {
    const independent = nationFlagSpec({ color: "#1f6feb", name: "诺特帝国" });
    const vassal = nationFlagSpec({ color: "#1f6feb", name: "诺特帝国", overlord: 0 }, "#da3633");
    assert.equal(vassal.color, "#da3633");
    assert.equal(vassal.vassal, true);
    assert.equal(vassal.emblem, independent.emblem);

    const html = nationFlagHtml({ color: "#1f6feb", name: "诺特帝国", overlord: 0 }, 20, "#da3633");
    assert.match(html, /class="nation-flag is-vassal"/);
    assert.match(html, /--flag-bg:#da3633/);
    assert.match(html, /（附庸国）/);
});

test("malformed colours fall back instead of rendering a blank flag", () => {
    const spec = nationFlagSpec({ color: "not-a-colour", name: "" });
    assert.match(spec.color, /^#[0-9a-f]{6}$/i);
    assert.match(spec.emblem, /^[a-z]+$/);
    assert.match(nationFlagHtml({ color: "bad", name: "无名" }), /--flag-bg:#5b6b7c/);
});
