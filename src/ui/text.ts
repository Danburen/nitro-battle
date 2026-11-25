type TextFormat = "html" | "plain" | "raw";

interface TextTerm {
    readonly label: string;
    readonly tone: string;
    /** Name of the external SVG in `public/assets/icons/`, not inline markup. */
    readonly icon?: string;
}

export const RELATION_COLORS = {
    friendly: "#7ee787",
    neutral: "#e3b341",
    hostile: "#ff7b72",
} as const;

export type RelationTone = keyof typeof RELATION_COLORS;

export const TEXT_TERMS = {
    funds: { label: "财政", tone: "funds", icon: "funds" },
    manpower: { label: "人力", tone: "manpower", icon: "manpower" },
    industry: { label: "工业", tone: "industry", icon: "industry" },
    raw: { label: "原料", tone: "raw", icon: "raw" },
    food: { label: "粮食", tone: "food", icon: "food" },
    strategic: { label: "战略资源", tone: "strategic", icon: "strategic" },
    politics: { label: "政治点", tone: "politics", icon: "politics" },
    stability: { label: "稳定度", tone: "stability", icon: "stability" },
    construction: { label: "建造点", tone: "construction", icon: "construction" },
    factory: { label: "工厂", tone: "industry" },
    farm: { label: "农场", tone: "funds" },
    infrastructure: { label: "基础设施", tone: "construction" },
    admin: { label: "行政中心", tone: "politics" },
    supply: { label: "补给", tone: "manpower" },
    fort: { label: "要塞", tone: "construction" },
    production: { label: "生产", tone: "industry" },
    idle: { label: "闲置", tone: "construction" },
    garrison: { label: "驻军", tone: "keyword" },
    turn: { label: "回合", tone: "keyword", icon: "turn" },
    friendly: { label: "友方", tone: "friendly" },
    neutral: { label: "中立", tone: "neutral" },
    hostile: { label: "敌方", tone: "hostile" },
    organization: { label: "组织度", tone: "keyword" },
    occupation: { label: "占领效率", tone: "keyword" },
    attack: { label: "攻击", tone: "keyword" },
    defense: { label: "防御", tone: "keyword" },
    movement: { label: "移动", tone: "keyword" },
    surplus: { label: "有盈余", tone: "friendly" },
    shortage: { label: "短缺", tone: "hostile" },
    unknown: { label: "未知", tone: "neutral" },
} as const satisfies Record<string, TextTerm>;

export type TextKey = keyof typeof TEXT_TERMS;
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });

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
const rendered = new WeakMap<HTMLElement, { source: string; format: TextFormat }>();

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function escapeGameText(value: string): string {
    return value.replace(/[\\[]/g, "\\$&");
}

/**
 * External icon reference: the mask URL is injected inline, so it resolves
 * against the document (browser + Electron) just like the flag emblems do.
 * SVG geometry lives in `public/assets/icons/`, never in UI source.
 */
export function iconMaskStyle(name: string, ink?: string): string {
    // Masked glyphs ink themselves with currentColor, so `ink` tints one icon.
    return ink
        ? `style="--icon:url('./assets/icons/${name}.svg');color:${ink}"`
        : `style="--icon:url('./assets/icons/${name}.svg')"`;
}

export function textToken(key: TextKey, value?: number | string): string {
    // A broken economy total must never leak a literal `[[raw:NaN]]` into the UI.
    const safe = typeof value === "number" && !Number.isFinite(value) ? undefined : value;
    if (safe === undefined) return `[[${key}]]`;
    const source = `[[${key}:${safe}]]`;
    return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(String(safe)) ? source : escapeGameText(source);
}

const CHIP_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SIGNED_NUMBER = /([+-]\d+(?:\.\d+)?%?)/g;

/** Positive bonuses read green, penalties red, zero-impact neutral. */
export function signClass(value: string): string {
    const n = Number(value.replace(/%$/, ""));
    return n > 0 ? "game-text--pos" : n < 0 ? "game-text--neg" : "game-text--zero";
}

/** Colored nation chip: [[chip:#hex|名称]]; invalid colors degrade to plain text. */
export function chipToken(color: string, name: string): string {
    const label = escapeGameText(name).replaceAll("]", "\\]");
    return CHIP_COLOR.test(color) ? `[[chip:${color}|${label}]]` : label;
}

function renderToken(body: string, format: TextFormat): string | null {
    // Trait line: [[pos:倾向]] / [[neg:短板]] / [[note:中性描述]] — the sign carries the colour.
    const trait = /^(pos|neg|note):([^]*)$/.exec(body);
    if (trait) {
        const label = trait[2].replace(/\\([\\[\]])/g, "$1");
        if (!label) return null;
        const sign = trait[1] === "pos" ? "+" : trait[1] === "neg" ? "-" : "~";
        if (format === "plain") return `${sign}${label}`;
        return `<span class="game-text game-text--${trait[1]}">${sign}${escapeHtml(label)}</span>`;
    }
    const chip = /^chip:(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\|([^]*)$/.exec(body);
    if (chip) {
        const label = chip[2].replace(/\\([\\[\]])/g, "$1");
        if (format === "plain") return label;
        return `<span class="game-text game-text--chip" style="--pc:${chip[1]}">${escapeHtml(label)}</span>`;
    }
    const match = /^([a-z]+)(?::([+-]?(?:\d+(?:\.\d+)?|\.\d+)(%)?))?$/.exec(body);
    if (!match || !Object.hasOwn(TEXT_TERMS, match[1])) return null;
    const term: TextTerm = TEXT_TERMS[match[1] as TextKey];
    let amount: string | undefined;
    if (match[2] !== undefined) {
        const value = Number(match[2].replace(/%$/, ""));
        if (!Number.isFinite(value)) return null;
        amount = match[3]
            ? `${match[2].startsWith("+") ? "+" : ""}${numberFormat.format(value)}%`
            : `${match[2].startsWith("+") ? "+" : ""}${compactNumber(value)}`;
    }
    const plain = amount === undefined ? term.label : `${amount} ${term.label}`;
    if (format === "plain") return plain;
    if (amount === undefined) return `<span class="game-text game-text--${term.tone}">${plain}</span>`;
    const signed = `<span class="${signClass(match[2]!)}">${amount}</span>`;
    if (!term.icon) return `<span class="game-text game-text--${term.tone}">${signed} ${term.label}</span>`;
    return `<span class="game-text game-text--${term.tone} game-text-amount" role="img" aria-label="${plain}"><span aria-hidden="true" class="${signClass(match[2]!)}">${amount}</span><span class="resource-icon" aria-hidden="true" ${iconMaskStyle(term.icon)}></span></span>`;
}

export function renderGameText(source: string, format: TextFormat = "html"): string {
    // "raw" is for trusted markup that already contains its own attributes and
    // game-text tokens in values (e.g. a tooltip body); pass it through untouched.
    if (format === "raw") return source;
    const output: string[] = [];
    const literal = (value: string): void => {
        if (format !== "html") { output.push(value); return; }
        let last = 0;
        for (const match of value.matchAll(SIGNED_NUMBER)) {
            output.push(escapeHtml(value.slice(last, match.index)));
            output.push(`<span class="game-text ${signClass(match[1])}">${escapeHtml(match[1])}</span>`);
            last = match.index! + match[1].length;
        }
        output.push(escapeHtml(value.slice(last)));
    };
    let start = 0;
    let cursor = 0;
    while (cursor < source.length) {
        if (source[cursor] === "\\" && (source[cursor + 1] === "[" || source[cursor + 1] === "\\")) {
            literal(source.slice(start, cursor));
            literal(source[cursor + 1]);
            cursor += 2;
            start = cursor;
        } else if (source.startsWith("[[", cursor)) {
            const end = source.indexOf("]]", cursor + 2);
            if (end < 0) break;
            literal(source.slice(start, cursor));
            const token = renderToken(source.slice(cursor + 2, end), format);
            if (token === null) output.push(format === "html" ? escapeHtml(source.slice(cursor, end + 2)) : source.slice(cursor, end + 2));
            else output.push(token);
            cursor = end + 2;
            start = cursor;
        } else {
            cursor++;
        }
    }
    literal(source.slice(start));
    return output.join("");
}

export function setGameText(element: HTMLElement, source: string, format: TextFormat = "html"): boolean {
    const previous = rendered.get(element);
    if (previous?.source === source && previous.format === format) return false;
    if (format === "plain") element.textContent = renderGameText(source, format);
    else element.innerHTML = renderGameText(source, format);
    rendered.set(element, { source, format });
    return true;
}
