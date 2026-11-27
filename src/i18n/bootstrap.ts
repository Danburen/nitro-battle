/**
 * Browser-side locale persistence.
 *
 * Kept separate from `index.ts` so the translation core stays a pure module
 * value (Node tests keep the default locale). Import this module before any
 * module that calls `t()` at load time, e.g. as the first import of `main.ts`.
 */

import { getLocale, isLocale, setLocale } from "./index.ts";
import type { Locale } from "./index.ts";

const STORAGE_KEY = "nitro.locale";

function readStored(): string | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

export function persistLocale(locale: Locale): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
        // Storage may be disabled; the switch still applies for this session.
    }
}

const stored = readStored();
if (stored !== null && isLocale(stored)) setLocale(stored);
if (typeof document !== "undefined") document.documentElement.lang = getLocale();
