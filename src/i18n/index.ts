/**
 * Lightweight i18n layer.
 *
 * Translation data lives in domain-scoped JSON files so translators never need
 * to touch code. TypeScript derives `MessageKey` from the canonical zh-CN
 * catalog, and every other locale must provide the same keys. Locale state is
 * a pure module value: no DOM, no storage, no framework.
 *
 * To add a namespace, drop `src/i18n/locales/<locale>/<namespace>.json`, import
 * it below, and spread it into both catalogs.
 */

import { escapeGameText, INVALID_VALUE_SENTINEL } from "../utils/spec.ts";

import zhCommon from "./locales/zh-CN/common.json" with { type: "json" };
import zhTerms from "./locales/zh-CN/terms.json" with { type: "json" };
import zhUi from "./locales/zh-CN/ui.json" with { type: "json" };
import zhGame from "./locales/zh-CN/game.json" with { type: "json" };
import zhPanels from "./locales/zh-CN/panels.json" with { type: "json" };
import zhActions from "./locales/zh-CN/actions.json" with { type: "json" };
import zhGuide from "./locales/zh-CN/guide.json" with { type: "json" };
import zhMisc from "./locales/zh-CN/misc.json" with { type: "json" };
import enCommon from "./locales/en-US/common.json" with { type: "json" };
import enTerms from "./locales/en-US/terms.json" with { type: "json" };
import enUi from "./locales/en-US/ui.json" with { type: "json" };
import enGame from "./locales/en-US/game.json" with { type: "json" };
import enPanels from "./locales/en-US/panels.json" with { type: "json" };
import enActions from "./locales/en-US/actions.json" with { type: "json" };
import enGuide from "./locales/en-US/guide.json" with { type: "json" };
import enMisc from "./locales/en-US/misc.json" with { type: "json" };

export const LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageParams = Readonly<Record<string, unknown>>;

type CanonicalKeys =
    | keyof typeof zhCommon | keyof typeof zhTerms | keyof typeof zhUi
    | keyof typeof zhGame | keyof typeof zhPanels | keyof typeof zhActions
    | keyof typeof zhGuide | keyof typeof zhMisc;
type CatalogShape = { readonly [K in CanonicalKeys]: string };

const zhCN: CatalogShape = {
    ...zhCommon, ...zhTerms, ...zhUi, ...zhGame, ...zhPanels, ...zhActions, ...zhGuide, ...zhMisc,
};
const enUS: CatalogShape = {
    ...enCommon, ...enTerms, ...enUi, ...enGame, ...enPanels, ...enActions, ...enGuide, ...enMisc,
};

const catalogs: Record<Locale, CatalogShape> = {
    "zh-CN": zhCN,
    "en-US": enUS,
};

export type MessageKey = keyof CatalogShape;

let currentLocale: Locale = "zh-CN";

export function getLocale(): Locale {
    return currentLocale;
}

export function setLocale(locale: Locale): void {
    currentLocale = locale;
}

export function isLocale(value: string): value is Locale {
    return (LOCALES as readonly string[]).includes(value);
}

export function hasMessage(key: MessageKey): boolean {
    return key in catalogs[currentLocale] || key in catalogs["zh-CN"];
}

/** Values inside `[[...]]` must not be able to close or inject a token. */
function tokenValue(value: unknown): string {
    if (value === null || value === undefined) return INVALID_VALUE_SENTINEL;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : INVALID_VALUE_SENTINEL;
    return escapeGameText(String(value));
}

/**
 * Substitute `{{name}}` placeholders while tracking whether the placeholder
 * sits inside a game-text token. Outside a token, values are plain source text
 * (the UI layer escapes HTML). Inside a token, values use the same safe rules
 * as the `game` tagged template.
 */
function interpolate(source: string, params: MessageParams): string {
    let out = "";
    let inToken = false;

    for (let i = 0; i < source.length;) {
        if (source.startsWith("{{", i)) {
            const end = source.indexOf("}}", i + 2);
            if (end >= 0) {
                const name = source.slice(i + 2, end);
                const value = params[name];
                out += inToken ? tokenValue(value) : String(value ?? "");
                i = end + 2;
                continue;
            }
        }

        if (source[i] === "\\" && i + 1 < source.length) {
            out += source.slice(i, i + 2);
            i += 2;
            continue;
        }
        if (source.startsWith("[[", i)) {
            inToken = true;
            out += "[[";
            i += 2;
            continue;
        }
        if (source.startsWith("]]", i)) {
            inToken = false;
            out += "]]";
            i += 2;
            continue;
        }

        out += source[i];
        i++;
    }

    return out;
}

export function t(key: MessageKey, params: MessageParams = {}): string {
    const source = catalogs[currentLocale][key] ?? catalogs["zh-CN"][key] ?? key;
    return interpolate(source, params);
}
