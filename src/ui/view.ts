/**
 * Small helpers for the "view model -> parts -> template" pattern.
 *
 * They keep `t()` and `rawHtml()` out of markup templates without adding a
 * framework or a runtime dependency. The conventional shape for a renderer is:
 *
 *   interface XxxView { ... }                  // plain data + resolved strings
 *   function xxxView(state): XxxView { ... }   // reads state, calls resolveTexts
 *   function xxxHtml(state): string {          // orchestration only
 *       const view = xxxView(state);
 *       const parts = trustedParts({ ... });    // icons / tooltips / child markup
 *       return html`...${view.x}...${parts.x}...`;
 *   }
 *
 * Plain `${view.x}` interpolations stay HTML-escaped by `html`; only values
 * declared in `trustedParts` bypass escaping, so the existing safety rules are
 * unchanged.
 */

import { t } from "../i18n/index.ts";
import type { MessageKey, MessageParams } from "../i18n/index.ts";
import { rawHtml } from "./safeHtml.ts";
import type { SafeHtml } from "./safeHtml.ts";
import { gameText, setGameHtml } from "./text.ts";
import type { TokenValueResolver } from "./tokenValues.ts";

/** `[key]` or `[key, params]` for each named message. */
export type TextSpec = Readonly<Record<string, readonly [MessageKey, MessageParams?]>>;

/** Resolve a batch of messages up front so templates contain no `t()` calls. */
export function resolveTexts<S extends TextSpec>(spec: S): { readonly [K in keyof S]: string } {
    const result: Record<string, string> = {};
    for (const name of Object.keys(spec) as Array<keyof S & string>) {
        const [key, params] = spec[name];
        result[name] = t(key, params ?? {});
    }
    return result as { readonly [K in keyof S]: string };
}

/**
 * Render a game-text source to its final HTML here, so the template only ever
 * sees already-assembled markup. No resolver is used by default: the value is
 * supplied explicitly at the call site instead of depending on the active `~`
 * context. Wrap the result with `rawHtml()` only when nesting it in an `html`
 * template; `panelHead` and `setGameHtml` take the plain string directly.
 */
export function gameHtml(source: string, resolver: TokenValueResolver | null = null): string {
    return gameText(source, "html", resolver);
}

/** Wrap trusted HTML fragments once so templates contain no repeated `rawHtml()`. */
export function trustedParts<S extends Readonly<Record<string, string>>>(parts: S): { readonly [K in keyof S]: SafeHtml } {
    const result: Record<string, SafeHtml> = {};
    for (const name of Object.keys(parts) as Array<keyof S & string>) {
        result[name] = rawHtml(parts[name]);
    }
    return result as { readonly [K in keyof S]: SafeHtml };
}

/** `MessageKey` with the shared namespace prefix removed, e.g. `title` for `panels.x.`. */
export type ScopedSuffix<P extends string> = MessageKey extends infer K
    ? K extends `${P}${infer Rest}` ? Rest : never
    : never;

/** `[suffix]` or `[suffix, params]`; the full key is `prefix + suffix`. */
export type ScopedTextSpec<P extends string> = Readonly<Record<string, readonly [ScopedSuffix<P>, MessageParams?]>>;

/**
 * `resolveTexts` with a shared prefix. Each entry is just the suffix, so a
 * renderer that uses 6 keys from the same namespace doesn't repeat it 6 times.
 * Suffixes are still type-checked and autocompleted against the catalog.
 */
export function scopedTexts<P extends string, S extends ScopedTextSpec<P>>(
    prefix: P,
    spec: S,
): { readonly [K in keyof S]: string } {
    const result: Record<string, string> = {};
    for (const name of Object.keys(spec) as Array<keyof S & string>) {
        const [suffix, params] = spec[name];
        result[name] = t(`${prefix}${suffix}` as MessageKey, params ?? {});
    }
    return result as { readonly [K in keyof S]: string };
}

/**
 * A trusted fragment for nesting inside another `html` template. Shared
 * builders return this instead of a raw string, so the escaping boundary is
 * visible in the type.
 */
export type UiPart = SafeHtml;

/**
 * Common contract for a complete render target: everything the DOM needs is
 * already assembled here, with no `t()` calls left inside templates.
 */
export interface UiView {
    /** Trusted markup produced by `html` / `gameHtml`. */
    readonly html: string;
}

/** Pure builder: explicit inputs in, view out. Never touches the DOM. */
export type UiViewBuilder<C, V extends UiView = UiView> = (ctx: C) => V;

/** The single DOM write path for a `UiView`. */
export function renderUiView(el: HTMLElement, view: UiView): void {
    setGameHtml(el, view.html);
}
