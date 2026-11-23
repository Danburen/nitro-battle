import type { GameState } from "../game/types/state.ts";
import type { Nation } from "../game/types/entities.ts";
import { nationDisplayColor } from "../game/access.ts";
import { escapeHtml } from "./text.ts";

/**
 * Procedural flags in the Stellaris tradition: a nation colour plus one
 * abstract emblem. Emblems live in `public/assets/flags/` as plain SVG and are
 * used as monochrome CSS masks, so a new nation needs no new asset and the
 * accent colour can follow the flag's luminance.
 *
 * All call sites go through `nationFlagSpec` / `nationFlagHtmlFor`; the flag is
 * always "display colour + emblem", including generated vassals, whose display
 * colour is their overlord's while the emblem stays their own.
 */

const EMBLEMS = [
    "orbit", "star", "wings", "hex", "spear", "wave", "sun", "chevron",
    "crown", "shield", "bolt", "flame", "moon", "compass", "anvil", "tree",
] as const;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FALLBACK_COLOR = "#5b6b7c";

export interface NationFlagSpec {
    /** Background colour, already resolved through the overlord chain. */
    readonly color: string;
    /** Emblem ink, dark on light flags and light on dark flags. */
    readonly accent: string;
    readonly emblem: string;
    readonly vassal: boolean;
}

/** Dark ink on light flags, light ink on dark flags. */
export function flagAccent(color: string): string {
    const hex = color.replace("#", "");
    if (hex.length !== 6) return "#f0f6fc";
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.58 ? "#11161d" : "#f5f8fc";
}

/** Stable per-nation emblem; keyed on name so a vassal keeps a distinct flag on the overlord's colour. */
function emblemName(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return EMBLEMS[hash % EMBLEMS.length] ?? "star";
}

/** One source of truth for colour + emblem; malformed colours fall back instead of blanking the flag. */
export function nationFlagSpec(
    nation: Pick<Nation, "color" | "name"> & Partial<Pick<Nation, "overlord">>,
    displayColor = nation.color,
): NationFlagSpec {
    const color = HEX_COLOR.test(displayColor) ? displayColor : (HEX_COLOR.test(nation.color) ? nation.color : FALLBACK_COLOR);
    return {
        color,
        accent: flagAccent(color),
        emblem: emblemName(nation.name || "无名邦国"),
        vassal: (nation.overlord ?? -1) >= 0,
    };
}

export function nationFlagHtml(
    nation: Pick<Nation, "color" | "name"> & Partial<Pick<Nation, "overlord" | "vassalType">>,
    size = 24,
    displayColor = nation.color,
): string {
    const spec = nationFlagSpec(nation, displayColor);
    const height = Math.max(12, Math.round(size * 0.6));
    const label = `${nation.name}${spec.vassal ? "（附庸国）" : ""}的旗帜`;
    return `<span class="nation-flag${spec.vassal ? " is-vassal" : ""}" role="img" aria-label="${escapeHtml(label)}" style="--flag-w:${size}px;--flag-h:${height}px;--flag-bg:${escapeHtml(spec.color)};--flag-fg:${spec.accent};--flag-emblem:url('./assets/flags/emblem-${spec.emblem}.svg')"><i></i></span>`;
}

/** State-aware variant: vassals automatically fly the overlord's colour. */
export function nationFlagHtmlFor(state: GameState, nationId: number, size = 24): string {
    const nation = state.nations[nationId];
    if (!nation) return "";
    return nationFlagHtml(nation, size, nationDisplayColor(state, nationId));
}
