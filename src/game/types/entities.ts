/** Persistent world entities: states (州), nations and provinces. */
import type { AITendencyId } from "../ai/types.ts";
import type { ProvinceBuildingKind } from "./building.ts";
import type { PolicyCategory, Policies, PolicyTransition } from "./policy.ts";
import type { VassalType } from "./diplomacy.ts";

/** 州: a contiguous province group built around a city center. */
export interface StateRegion {
    readonly id: number;
    readonly name: string;
    /** Controls access to state buildings, not ownership of the other provinces. */
    readonly center: number;
    readonly provinces: number[];
    readonly culture: number;
    buildings: ("farm" | "admin")[];
    factories: number;
    /** Factories assigned to production; the rest are construction workers. */
    prodFactories: number;
    /** 0–8; applies to members controlled by the center's owner. */
    infrastructure: number;
}

export interface Nation {
    readonly id: number;
    readonly name: string;
    readonly color: string;
    readonly isPlayer: boolean;
    /** Fixed per-nation AI temperament; omitted by hand-built test fixtures, defaults at read time. */
    readonly tendency?: AITendencyId;
    capital: number;
    funds: number;
    manpower: number;
    industry: number;
    politicalPower: number;
    policies: Policies;
    /** In-progress switches per category; the committed value lives in `policies`. */
    policyTransitions?: Partial<Record<PolicyCategory, PolicyTransition>>;
    alive: boolean;
    /** Overlord nation id; -1 or omitted when independent. */
    overlord?: number;
    vassalType?: VassalType;
    /** Current independence, clamped to the contract's cap (100 / 300 / 500). */
    independence?: number;
    /** Resource share paid to the overlord; only cooperative vassals may adjust it. */
    tributeRate?: number;
    /** Day of the last foreign-aid request; gates `VASSAL_AID_COOLDOWN`. */
    lastAidDay?: number;
}

export interface Province {
    readonly site: number;
    name: string;
    /** Actual controller; changes province by province in war. */
    owner: number;
    legalOwner: number;
    isCity: boolean;
    isCapital: boolean;
    garrison: number;
    garrisonMax: number;
    income: number;
    defense: number;
    /** 1–6; feeds manpower income and caps. */
    population: number;
    /** Original owner at world gen; NEUTRAL for neutral land. */
    coreNation: number;
    /** 0–100 integration of non-core provinces; cores are always 100. */
    occupation: number;
    /** Local buildings remain with this province on capture. */
    buildings: ProvinceBuildingKind[];
    /** Owning state (州), or -1 for water. */
    stateId: number;
}
