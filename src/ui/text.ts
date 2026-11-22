type TextFormat = "html" | "plain";

interface TextTerm {
    readonly label: string;
    readonly tone: string;
    readonly icon?: string;
}

export const RELATION_COLORS = {
    friendly: "#7ee787",
    neutral: "#e3b341",
    hostile: "#ff7b72",
} as const;

export type RelationTone = keyof typeof RELATION_COLORS;

export const TEXT_TERMS = {
    funds: { label: "财政", tone: "funds", icon: '<path d="M12 2v20m5-16H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6"/>' },
    manpower: { label: "人力", tone: "manpower", icon: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>' },
    industry: { label: "工业", tone: "industry", icon: '<path d="M3 21V10l6 3V8l6 3V3h5l1 18H3Zm4-4h1m4 0h1m4 0h1"/>' },
    politics: { label: "政治点", tone: "politics", icon: '<path d="m2 8 10-5 10 5H2Zm2 13h16M6 11v7m6-7v7m6-7v7"/>' },
    construction: { label: "建造点", tone: "construction", icon: '<path d="m5 3 16 16-3 3L2 6l3-3Zm0 5 3-3m1 7 3-3m1 7 3-3"/>' },
    factory: { label: "工厂", tone: "industry" },
    farm: { label: "农场", tone: "funds" },
    infrastructure: { label: "基础设施", tone: "construction" },
    admin: { label: "行政中心", tone: "politics" },
    supply: { label: "补给", tone: "manpower" },
    fort: { label: "要塞", tone: "construction" },
    production: { label: "生产", tone: "industry" },
    idle: { label: "闲置", tone: "construction" },
    garrison: { label: "驻军", tone: "keyword" },
    turn: { label: "回合", tone: "keyword", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.4 2"/>' },
    days: { label: "天", tone: "keyword", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.4 2"/>' },
    friendly: { label: "友方", tone: "friendly" },
    neutral: { label: "中立", tone: "neutral" },
    hostile: { label: "敌方", tone: "hostile" },
    organization: { label: "组织度", tone: "keyword" },
    occupation: { label: "占领效率", tone: "keyword" },
    attack: { label: "攻击", tone: "keyword" },
    defense: { label: "防御", tone: "keyword" },
    movement: { label: "移动", tone: "keyword" },
} as const satisfies Record<string, TextTerm>;

export type TextKey = keyof typeof TEXT_TERMS;
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });
const rendered = new WeakMap<HTMLElement, { source: string; format: TextFormat }>();

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function escapeGameText(value: string): string {
    return value.replace(/[\\[]/g, "\\$&");
}

export function textToken(key: TextKey, value?: number | string): string {
    if (value === undefined) return `[[${key}]]`;
    const source = `[[${key}:${value}]]`;
    return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(String(value)) ? source : escapeGameText(source);
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
        amount = `${match[2].startsWith("+") ? "+" : ""}${numberFormat.format(value)}${match[3] ?? ""}`;
    }
    const plain = amount === undefined ? term.label : `${amount} ${term.label}`;
    if (format === "plain") return plain;
    if (amount === undefined) return `<span class="game-text game-text--${term.tone}">${plain}</span>`;
    const signed = `<span class="${signClass(match[2]!)}">${amount}</span>`;
    if (!term.icon) return `<span class="game-text game-text--${term.tone}">${signed} ${term.label}</span>`;
    return `<span class="game-text game-text--${term.tone} game-text-amount" role="img" aria-label="${plain}"><span aria-hidden="true" class="${signClass(match[2]!)}">${amount}</span><svg class="resource-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${term.icon}</svg></span>`;
}

export function renderGameText(source: string, format: TextFormat = "html"): string {
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
