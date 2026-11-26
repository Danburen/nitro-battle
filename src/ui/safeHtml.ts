/**
 * Safe HTML interpolation layer.
 *
 * `html` escapes every interpolation by default. Trusted fragments produced by
 * code (flags, icons, tooltip attributes) must be wrapped in `rawHtml()` so the
 * escape is explicit and auditable. Locale text goes through `t()` inside an
 * `html` template; never use `tHtml()` inside `html` to avoid double escaping.
 */

import { t } from "../i18n/index.ts";
import type { MessageKey, MessageParams } from "../i18n/index.ts";
import { escapeHtml } from "../utils/spec.ts";

declare const safeHtmlBrand: unique symbol;
export type SafeHtml = string & { readonly [safeHtmlBrand]: true };

/** Runtime marker so `html` can recognise explicitly trusted fragments. */
const RAW_PREFIX = "\u0000nitro-raw\u0000";

function escapeValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return text.startsWith(RAW_PREFIX) ? text.slice(RAW_PREFIX.length) : escapeHtml(text);
}

/** Build trusted markup; every `${}` is HTML-escaped unless wrapped in rawHtml(). */
export function html(parts: TemplateStringsArray, ...values: readonly unknown[]): SafeHtml {
    let out = "";
    for (let i = 0; i < parts.length; i++) {
        out += parts[i];
        if (i < values.length) out += escapeValue(values[i]);
    }
    return out as SafeHtml;
}

/** Mark a code-generated fragment as already safe. Use sparingly. */
export function rawHtml(value: string): SafeHtml {
    return (RAW_PREFIX + value) as SafeHtml;
}

/** Strip the raw marker if a trusted fragment reaches setGameHtml directly. */
export function unwrapRawHtml(value: string): string {
    return value.startsWith(RAW_PREFIX) ? value.slice(RAW_PREFIX.length) : value;
}

/** Standalone localized text as SafeHtml. Inside `html`, use `t()` instead. */
export function tHtml(key: MessageKey, params: MessageParams = {}): SafeHtml {
    return html`${t(key, params)}`;
}
