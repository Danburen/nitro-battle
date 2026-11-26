/**
 * Game-text HTML renderer. All parsing, registry and formatting live in the
 * pure kernel at `src/text/spec.ts`; this module only turns tokens into safe
 * markup, resolves `~` values and writes them into the DOM.
 */
import {
    INVALID_VALUE_SENTINEL, TEXT_TERMS, escapeHtml, formatTokenAmount, parseGameText, parseGameToken, signClass, unescapeGameText,
} from "../utils/spec.ts";
import type { GameToken, TextFormat, TextKey, TextTerm, TokenAmount } from "../utils/spec.ts";
import { hasMessage, t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/index.ts";
import { unwrapRawHtml } from "./safeHtml.ts";
import { getActiveTokenValueResolver } from "./tokenValues.ts";
import type { TokenValueResolver } from "./tokenValues.ts";

export {
    RELATION_COLORS, TEXT_TERMS, chipToken, compactNumber, escapeGameText, escapeHtml, game, peopleCount, signClass, signedCompact,
} from "../utils/spec.ts";
export type { RelationTone, TextFormat, TextKey, TextTerm } from "../utils/spec.ts";
export { html, rawHtml, tHtml } from "./safeHtml.ts";
export type { SafeHtml } from "./safeHtml.ts";

const SIGNED_NUMBER = /([+-]\d+(?:\.\d+)?%?)/g;
const AMOUNT_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/;
const PLAIN = "game-text--plain";

/** Localized term label; the registry keeps its Chinese label as a fallback. */
export function termLabel(id: string): string {
    const key = `terms.${id}` as MessageKey;
    return hasMessage(key) ? t(key) : TEXT_TERMS[id as TextKey]?.label ?? id;
}

export function iconMaskStyle(name: string, ink?: string): string {
    // Masked glyphs ink themselves with currentColor, so `ink` tints one icon.
    return ink
        ? `style="--icon:url('./assets/icons/${name}.svg');color:${ink}"`
        : `style="--icon:url('./assets/icons/${name}.svg')"`;
}

function semanticClass(semantic: string): string {
    if (semantic === "pos") return "game-text--pos";
    if (semantic === "neg") return "game-text--neg";
    return PLAIN;
}

function termClass(tone: string, style: "plain" | "highlight" | undefined): string {
    return style === "plain" ? PLAIN : `game-text--${tone}`;
}

function iconSpan(tone: string, icon: string): string {
    // The icon inherits a dedicated color class, independent of the value tone.
    return `<span class="gtext-icon resource-icon game-text--${tone}" aria-hidden="true" ${iconMaskStyle(icon)}></span>`;
}

function labelHtml(label: string, tone: string, style: "plain" | "highlight" | undefined): string {
    return `<span class="game-text ${termClass(tone, style)}">${escapeHtml(label)}</span>`;
}

function valueHtml(label: string, amount: TokenAmount, tone: string, toneName: string, style: "plain" | "highlight" | undefined, icon?: string): string {
    if (!icon) {
        // Terms without an external SVG keep a readable "value label" fallback.
        return `<span class="game-text ${tone}">${escapeHtml(amount.text)}</span> ${labelHtml(label, toneName, style)}`;
    }
    const accessible = `${amount.text} ${label}`;
    return `<span class="gtext game-text-amount" role="img" aria-label="${escapeHtml(accessible)}"><span class="gtext-value ${tone}">${escapeHtml(amount.text)}</span>${iconSpan(toneName, icon)}</span>`;
}

function resolveValueTone(token: GameToken, amount: TokenAmount, compare: "atLeast" | "atMost" | undefined): string {
    const semantic = token.segments[1];
    if (semantic === "pos" || semantic === "neg" || semantic === "neutral") return semanticClass(semantic);

    if (semantic !== undefined && AMOUNT_RE.test(semantic)) {
        const threshold = Number(semantic.replace(/%$/, ""));
        const ok = amount.numeric !== null && (compare === "atMost" ? amount.numeric <= threshold : amount.numeric >= threshold);
        const suffix = token.segments[2];
        if (suffix === "neg") return ok ? "game-text--neg" : "game-text--pos";
        if (suffix === "pos") return ok ? "game-text--pos" : "game-text--neg";
        return ok ? PLAIN : "game-text--neg";
    }

    if (amount.numeric === null) return PLAIN;
    return amount.numeric > 0 ? "game-text--pos" : amount.numeric < 0 ? "game-text--neg" : PLAIN;
}

function renderGameToken(token: GameToken, format: TextFormat, resolver: TokenValueResolver | null): string {
    if (token.kind === "trait") {
        const sign = token.trait === "pos" ? "+" : token.trait === "neg" ? "-" : "~";
        const label = `${sign}${token.label ?? ""}`;
        if (format === "plain") return label;
        return `<span class="game-text game-text--${token.trait}">${escapeHtml(label)}</span>`;
    }
    if (token.kind === "chip") {
        const label = token.label ?? "";
        if (format === "plain") return label;
        return `<span class="game-text game-text--chip" style="--pc:${token.color}">${escapeHtml(label)}</span>`;
    }

    const term: TextTerm = TEXT_TERMS[token.id as TextKey];
    const label = termLabel(token.id);
    // Form 1 `[[id]]` stays a text reference; only an explicit empty segment or
    // the `icon:` escape hatch requests the glyph.
    if (token.kind === "term" && token.segments.length === 0) {
        return format === "plain" ? label : labelHtml(label, term.tone, term.style);
    }
    const bare = token.kind === "icon" || (token.kind === "term" && token.segments[0] === "");
    if (bare || token.kind === "label") {
        if (format === "plain") return label;
        if (bare && term.icon) {
            return `<span class="gtext game-text-amount" role="img" aria-label="${escapeHtml(label)}">${iconSpan(term.tone, term.icon)}</span>`;
        }
        return labelHtml(label, term.tone, token.kind === "label" ? "plain" : term.style);
    }

    const first = token.segments[0];
    let amount: TokenAmount | null = null;
    if (first === "~") {
        const resolved = resolver?.(token.id, token.scope) ?? null;
        const usable = resolved !== null
            && (typeof resolved !== "number" || Number.isFinite(resolved))
            && resolved !== INVALID_VALUE_SENTINEL;
        if (usable) amount = formatTokenAmount(String(resolved), term);
    } else {
        amount = formatTokenAmount(unescapeGameText(first), term);
    }
    if (amount === null) {
        return format === "plain" ? label : labelHtml(label, term.tone, term.style);
    }
    if (format === "plain") return `${amount.text} ${label}`;
    const tone = resolveValueTone(token, amount, term.compare);
    return valueHtml(label, amount, tone, term.tone, term.style, term.icon);
}

export function renderGameText(source: string, format: TextFormat = "html", resolver?: TokenValueResolver | null): string {
    // "raw" is for trusted markup that already contains its own attributes and
    // game-text tokens in values (e.g. a tooltip body); pass it through untouched.
    if (format === "raw") return source;
    const resolve = resolver === undefined ? getActiveTokenValueResolver() : resolver;
    const output: string[] = [];
    for (const segment of parseGameText(source)) {
        if (segment.kind === "token") {
            output.push(renderGameToken(segment.token!, format, resolve));
            continue;
        }
        const value = segment.value;
        if (format !== "html") { output.push(value); continue; }
        let last = 0;
        for (const match of value.matchAll(SIGNED_NUMBER)) {
            output.push(escapeHtml(value.slice(last, match.index)));
            output.push(`<span class="game-text ${signClass(match[1])}">${escapeHtml(match[1])}</span>`);
            last = match.index! + match[1].length;
        }
        output.push(escapeHtml(value.slice(last)));
    }
    return output.join("");
}

const MARKUP_ESCAPES = new Set(["\\", "[", "]", ":", "~", "@"]);

/**
 * Renders game text inside trusted HTML markup. Literal segments are developer
 * authored HTML, so they stay raw; tokens and signed numbers still go through
 * the same kernel as `renderGameText`. Tokens inside tag attributes are left
 * untouched as source text.
 */
export function renderGameMarkup(markup: string, resolver?: TokenValueResolver | null): string {
    const resolve = resolver === undefined ? getActiveTokenValueResolver() : resolver;
    const output: string[] = [];
    let text = "";
    let inTag = false;
    let quote: string | null = null;

    const flush = (): void => {
        if (text.length === 0) return;
        let last = 0;
        for (const match of text.matchAll(SIGNED_NUMBER)) {
            output.push(text.slice(last, match.index));
            output.push(`<span class="game-text ${signClass(match[1])}">${escapeHtml(match[1])}</span>`);
            last = match.index! + match[1].length;
        }
        output.push(text.slice(last));
        text = "";
    };

    for (let i = 0; i < markup.length;) {
        const char = markup[i];
        if (inTag) {
            if (quote !== null) {
                if (char === quote) quote = null;
            } else if (char === '"' || char === "'") {
                quote = char;
            } else if (char === ">") {
                inTag = false;
            }
            output.push(char);
            i++;
            continue;
        }
        if (char === "<") {
            flush();
            inTag = true;
            quote = null;
            output.push(char);
            i++;
            continue;
        }
        if (char === "\\" && i + 1 < markup.length && MARKUP_ESCAPES.has(markup[i + 1])) {
            text += markup[i + 1];
            i += 2;
            continue;
        }
        if (char === "[" && markup[i + 1] === "[") {
            let end = -1;
            for (let j = i + 2; j + 1 < markup.length; j++) {
                if (markup[j] === "\\" && MARKUP_ESCAPES.has(markup[j + 1])) { j++; continue; }
                if (markup[j] === "]" && markup[j + 1] === "]") { end = j; break; }
            }
            if (end >= 0) {
                const token = parseGameToken(markup.slice(i + 2, end));
                if (token) {
                    flush();
                    output.push(renderGameToken(token, "html", resolve));
                } else {
                    text += markup.slice(i, end + 2);
                }
                i = end + 2;
                continue;
            }
        }
        text += char;
        i++;
    }
    flush();
    return output.join("");
}

/** Explicit game-text fragment. Prefer passing source to setGameHtml/setGameText. */
export function gameText(source: string, format: TextFormat = "html", resolver?: TokenValueResolver | null): string {
    return renderGameText(source, format, resolver);
}

const rendered = new WeakMap<HTMLElement, string>();

function writeGameOutput(element: HTMLElement, output: string, format: TextFormat): boolean {
    const key = `${format}\u0000${output}`;
    if (rendered.get(element) === key) return false;
    if (format === "plain") element.textContent = output;
    else element.innerHTML = output;
    rendered.set(element, key);
    return true;
}

/** Writes trusted HTML markup containing game-text tokens. */
export function setGameHtml(element: HTMLElement, markup: string, resolver?: TokenValueResolver | null): boolean {
    return writeGameOutput(element, renderGameMarkup(unwrapRawHtml(markup), resolver), "html");
}

/** Deduplicates on rendered output, not source, so `~` tokens refresh with state. */
export function setGameText(element: HTMLElement, source: string, format: TextFormat = "html", resolver?: TokenValueResolver | null): boolean {
    if (format === "raw") return writeGameOutput(element, source, "raw");
    return writeGameOutput(element, renderGameText(source, format, resolver), format);
}
