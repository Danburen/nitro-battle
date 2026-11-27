/**
 * Pure game-text kernel: syntax, term registry and value formatting.
 *
 * No DOM, no engine state, no imports outside `src/text/`. The UI renderer and
 * the value resolver both build on this module so a token means the same thing
 * in every surface (panels, tooltips, map hover, battle reports).
 *
 * Grammar (scope is optional and only valid in the first segment):
 *   [[id]]                  text reference, registry decides plain / highlight
 *   [[id:]]                 bare icon
 *   [[id:label]]            label + icon
 *   [[id:label:pos]]        label + icon with forced semantic
 *   [[id:~]]                current value + icon
 *   [[id:~:N]]              threshold comparison (ok = registry tone, fail = red)
 *   [[id:~:N:neg]]          threshold comparison with reversed semantic
 *   [[icon:id]] / [[label:id]]  escape hatches
 *   [[@USER:id:~:pos]]      scope strip; @USER / @PLAYER / @<nation id>
 *
 * Legacy `[[chip:#hex|name]]` and `[[pos|neg|note:...]]` remain parseable.
 * Whitespace is content: no segment is trimmed.
 */

export type TextFormat = "html" | "plain" | "raw";

export interface TextTerm {
    readonly label: string;
    readonly tone: string;
    /** External SVG in `public/assets/icons/`, never inline markup. */
    readonly icon?: string;
    /** Form-1 rendering: highlight keeps the registry tone, plain uses `var(--site-fg)`. */
    readonly style?: "plain" | "highlight";
    /** Threshold direction; higher is good unless a term states otherwise. */
    readonly compare?: "atLeast" | "atMost";
    /** Numeric formatting for current values and fixed labels. */
    readonly format?: "compact" | "integer";
}

export const RELATION_COLORS = {
    friendly: "#7ee787",
    neutral: "#e3b341",
    hostile: "#ff7b72",
} as const;

export type RelationTone = keyof typeof RELATION_COLORS;

export const TEXT_TERMS = {
    funds: { label: "财政", tone: "funds", icon: "funds", compare: "atLeast" },
    fund: { label: "财政", tone: "funds", icon: "funds", compare: "atLeast" },
    manpower: { label: "人力", tone: "manpower", icon: "manpower", compare: "atLeast" },
    armyUnits: { label: "军队单位", tone: "manpower", icon: "manpower", compare: "atLeast" },
    industry: { label: "工业", tone: "industry", icon: "industry", compare: "atLeast" },
    raw: { label: "原料", tone: "raw", icon: "raw", compare: "atLeast" },
    food: { label: "粮食", tone: "food", icon: "food", compare: "atLeast" },
    strategic: { label: "战略资源", tone: "strategic", icon: "strategic", compare: "atLeast" },
    politics: { label: "政治点", tone: "politics", icon: "politics", compare: "atLeast" },
    politicalPower: { label: "政治点", tone: "politics", icon: "politics", compare: "atLeast" },
    stability: { label: "稳定度", tone: "stability", icon: "stability", compare: "atLeast" },
    construction: { label: "建造点", tone: "construction", icon: "construction", compare: "atLeast" },
    factory: { label: "工厂", tone: "industry", icon: "building-factory", style: "plain", compare: "atLeast" },
    farm: { label: "农场", tone: "funds", icon: "building-farm", style: "plain", compare: "atLeast" },
    infrastructure: { label: "基础设施", tone: "construction", icon: "building-infrastructure", style: "plain", compare: "atLeast" },
    admin: { label: "行政中心", tone: "politics", icon: "building-admin", style: "plain", compare: "atLeast" },
    supply: { label: "补给", tone: "manpower", icon: "building-supply", style: "plain", compare: "atLeast" },
    fort: { label: "要塞", tone: "construction", icon: "building-fort", style: "plain", compare: "atLeast" },
    production: { label: "生产", tone: "industry", style: "plain" },
    idle: { label: "闲置", tone: "construction", style: "plain", compare: "atMost" },
    garrison: { label: "驻军", tone: "keyword", style: "plain", compare: "atLeast" },
    turn: { label: "回合", tone: "keyword", icon: "turn", style: "plain", format: "integer", compare: "atLeast" },
    friendly: { label: "友方", tone: "friendly" },
    neutral: { label: "中立", tone: "neutral" },
    hostile: { label: "敌方", tone: "hostile" },
    organization: { label: "组织度", tone: "keyword", style: "plain", format: "integer", compare: "atLeast" },
    occupation: { label: "占领效率", tone: "keyword", style: "plain", compare: "atLeast" },
    attack: { label: "攻击", tone: "keyword", style: "plain" },
    defense: { label: "防御", tone: "keyword", style: "plain" },
    movement: { label: "移动", tone: "keyword", style: "plain" },
    surplus: { label: "有盈余", tone: "friendly" },
    shortage: { label: "短缺", tone: "hostile" },
    unknown: { label: "未知", tone: "neutral", style: "plain" },
} as const satisfies Record<string, TextTerm>;

export type TextKey = keyof typeof TEXT_TERMS;

export function isTextKey(id: string): id is TextKey {
    return Object.hasOwn(TEXT_TERMS, id);
}

/** Values that mean "no fixed value"; parse degrades them to a label-only token. */
export const INVALID_VALUE_SENTINEL = "undefined";
const INVALID_VALUES = new Set(["NaN", "undefined", "null", "Infinity", "-Infinity"]);

function isInvalidValue(value: string): boolean {
    return INVALID_VALUES.has(unescapeGameText(value));
}

/**
 * Tagged template for game-text sources. Interpolations that land inside
 * `[[...]]` are token values: finite numbers pass through, invalid numbers and
 * nullish values become a sentinel that parse treats as "no value", and strings
 * are escaped so they cannot close or inject a token. Interpolations outside a
 * token keep ordinary template-literal semantics (HTML fragments, names, ...).
 */
export function game(parts: TemplateStringsArray, ...values: readonly unknown[]): string {
    let out = "";
    let inToken = false;
    for (let i = 0; i < parts.length; i++) {
        const literal = parts[i];
        inToken = scanTokenState(literal, inToken);
        out += literal;
        if (i >= values.length) continue;
        out += inToken ? safeTokenValue(values[i]) : stringifyValue(values[i]);
    }
    return out;
}

/** Advance the "inside [[...]]" flag while walking one literal chunk. */
function scanTokenState(part: string, inToken: boolean): boolean {
    for (let i = 0; i < part.length; i++) {
        if (part[i] === "\\") { i++; continue; }
        if (part[i] === "[" && part[i + 1] === "[") { inToken = true; i++; continue; }
        if (part[i] === "]" && part[i + 1] === "]") { inToken = false; i++; continue; }
    }
    return inToken;
}

function stringifyValue(value: unknown): string {
    return String(value);
}

function safeTokenValue(value: unknown): string {
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : INVALID_VALUE_SENTINEL;
    if (value === undefined || value === null) return INVALID_VALUE_SENTINEL;
    return escapeGameText(String(value));
}

/** Colored nation chip: [[chip:#hex|名称]]; invalid colors degrade to plain text. */
export function chipToken(color: string, name: string): string {
    const label = escapeGameText(name);
    return CHIP_COLOR.test(color) ? `[[chip:${color}|${label}]]` : label;
}

// ---- plain string helpers (shared with the UI and the game layer) ----------

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });
const ESCAPE_CHARS = new Set(["\\", "[", "]", ":", "~", "@"]);

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Escapes every character that carries meaning in game-text source. */
export function escapeGameText(value: string): string {
    return value.replace(/[\\\[\]:~@]/g, (char) => `\\${char}`);
}

export function unescapeGameText(value: string): string {
    return value.replace(/\\([\\\[\]:~@])/g, "$1");
}

/** Whole-person counts for hover/detail text, compacted past four digits: 25,000 → 25 K. */
export function peopleCount(value: number): string {
    return compactNumber(Math.max(0, Math.round(value)));
}

/** Resource amounts: 10,000 → 10 K, 1,200,000 → 1.2 M; smaller values keep grouping. */
export function compactNumber(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 999_950) return `${Math.round(value / 100_000) / 10} M`;
    if (abs >= 10_000) return `${Math.round(value / 100) / 10} K`;
    return numberFormat.format(Math.round(value * 10) / 10);
}

/** Signed compact delta for resource pills, e.g. +12.3 K / -5. Keeps one decimal. */
export function signedCompact(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return `${rounded >= 0 ? "+" : ""}${compactNumber(rounded)}`;
}

/** Positive numbers read green, negative red, zero neutral. */
export function signClass(value: string): string {
    const n = Number(value.replace(/%$/, ""));
    return n > 0 ? "game-text--pos" : n < 0 ? "game-text--neg" : "game-text--zero";
}

const CHIP_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;
const AMOUNT_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/;
const THRESHOLD_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/;
const SEMANTIC_RE = /^(?:pos|neg|neutral)$/;
const SCOPE_RE = /^@(?:USER|PLAYER|-?\d+)$/;
const MAX_TOKEN_BODY = 256;

export interface TokenAmount {
    readonly text: string;
    /** null for arbitrary labels, which carry no numeric semantics. */
    readonly numeric: number | null;
}

/** Formats a fixed label or a resolved value; never throws on hostile input. */
export function formatTokenAmount(raw: string, term: TextTerm): TokenAmount {
    if (AMOUNT_RE.test(raw)) {
        const numeric = Number(raw.replace(/%$/, ""));
        if (Number.isFinite(numeric)) {
            const sign = raw.startsWith("+") ? "+" : "";
            const text = raw.endsWith("%")
                ? `${sign}${numberFormat.format(numeric)}%`
                : term.format === "integer"
                    ? `${sign}${Math.round(numeric)}`
                    : `${sign}${compactNumber(numeric)}`;
            return { text, numeric };
        }
    }
    return { text: raw, numeric: null };
}

/** Scope syntax is checked here; scope-to-nation resolution needs live state and lives in the UI. */
export function isTokenScope(scope: string): boolean {
    return SCOPE_RE.test(scope);
}

// ---- parser ----------------------------------------------------------------

export type TokenKind = "term" | "icon" | "label" | "chip" | "trait";

export interface GameToken {
    readonly kind: TokenKind;
    readonly raw: string;
    readonly scope: string | null;
    readonly id: string;
    /** Segments after `id`; empty for form 1. Values are still escaped. */
    readonly segments: readonly string[];
    readonly color?: string;
    readonly label?: string;
    readonly trait?: "pos" | "neg" | "note";
}

export interface TextSegment {
    readonly kind: "literal" | "token";
    readonly value: string;
    readonly token?: GameToken;
}

const TRAIT_RE = /^(pos|neg|note):([^]*)$/;
const CHIP_RE = /^chip:(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\|([^]*)$/;

/** Split on real separators only: `\:` inside a value must not start a segment. */
function splitTokenSegments(rest: string): string[] {
    const parts: string[] = [];
    let current = "";
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "\\" && i + 1 < rest.length) {
            current += rest[i] + rest[i + 1];
            i++;
            continue;
        }
        if (rest[i] === ":") {
            parts.push(current);
            current = "";
            continue;
        }
        current += rest[i];
    }
    parts.push(current);
    return parts;
}

/** Parses the inside of `[[...]]`; returns null for anything it cannot own. */
export function parseGameToken(body: string): GameToken | null {
    if (body.length === 0 || body.length > MAX_TOKEN_BODY) return null;
    // A token cannot contain another token delimiter. Escaped delimiters (from
    // the game tag or chipToken) have a backslash between the brackets, so only
    // raw nesting is rejected here.
    if (body.includes("[[") || body.includes("]]")) return null;

    const trait = TRAIT_RE.exec(body);
    if (trait && trait[2].length > 0) {
        return { kind: "trait", raw: body, scope: null, id: trait[1], segments: [], trait: trait[1] as "pos" | "neg" | "note", label: unescapeGameText(trait[2]) };
    }
    const chip = CHIP_RE.exec(body);
    if (chip) {
        return { kind: "chip", raw: body, scope: null, id: "chip", segments: [], color: chip[1], label: unescapeGameText(chip[2]) };
    }

    let rest = body;
    let scope: string | null = null;
    if (rest.startsWith("@")) {
        const colon = rest.indexOf(":");
        if (colon <= 1) return null;
        scope = rest.slice(0, colon);
        if (!isTokenScope(scope)) return null;
        rest = rest.slice(colon + 1);
    }

    const parts = splitTokenSegments(rest);
    if (parts.length > 4) return null;
    const head = parts[0];
    if (head === "icon" || head === "label") {
        if (parts.length !== 2 || !isTextKey(parts[1])) return null;
        return { kind: head, raw: body, scope, id: parts[1], segments: [] };
    }
    if (!isTextKey(head)) return null;

    const segments = parts.slice(1);
    if (segments.length >= 2 && !SEMANTIC_RE.test(segments[1]) && !THRESHOLD_RE.test(segments[1])) return null;
    if (segments.length >= 3) {
        if (!THRESHOLD_RE.test(segments[1]) || !SEMANTIC_RE.test(segments[2])) return null;
    }
    // Interpolated bad numbers (`NaN`, `undefined`, ...) degrade to a label
    // instead of leaking the sentinel text into the rendered value.
    if (segments.length > 0 && isInvalidValue(segments[0])) {
        return { kind: "term", raw: body, scope, id: head, segments: [] };
    }
    return { kind: "term", raw: body, scope, id: head, segments };
}

function findTokenEnd(source: string, from: number): number {
    for (let i = from; i + 1 < source.length; i++) {
        if (source[i] === "\\" && ESCAPE_CHARS.has(source[i + 1])) { i++; continue; }
        if (source[i] === "]" && source[i + 1] === "]") return i;
    }
    return -1;
}

/** Splits source into unescaped literals and parsed tokens, in order. */
export function parseGameText(source: string): readonly TextSegment[] {
    const segments: TextSegment[] = [];
    let text = "";
    const flush = (): void => {
        if (text.length === 0) return;
        segments.push({ kind: "literal", value: text });
        text = "";
    };

    for (let i = 0; i < source.length;) {
        const char = source[i];
        if (char === "\\" && i + 1 < source.length && ESCAPE_CHARS.has(source[i + 1])) {
            text += source[i + 1];
            i += 2;
            continue;
        }
        if (char === "[" && source[i + 1] === "[") {
            const end = findTokenEnd(source, i + 2);
            if (end < 0) { text += source.slice(i); break; }
            flush();
            const raw = source.slice(i, end + 2);
            const token = parseGameToken(source.slice(i + 2, end));
            segments.push(token ? { kind: "token", value: raw, token } : { kind: "literal", value: raw });
            i = end + 2;
            continue;
        }
        text += char;
        i++;
    }
    flush();
    return segments;
}
