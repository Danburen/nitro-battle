import { CLAIM_COST, DIPLOMATIC_PROFILES, TRUCE_DAYS } from "./game/diplomacy.ts";
import { DAYS_PER_SEASON } from "./game/types/world.ts";
import { t } from "./i18n/index.ts";
import { html, rawHtml, setGameHtml } from "./ui/text.ts";
import type { SafeHtml } from "./ui/text.ts";

export interface GuideHandle {
    open(): void;
    close(): void;
    isOpen(): boolean;
}

interface GuideSection {
    readonly id: string;
    readonly label: string;
    readonly lead: string;
    readonly items: readonly { title: string; body: string }[];
}

/** Built on every render so switching locale is reflected the next time the guide opens. */
function guideSections(): readonly GuideSection[] {
    return [
        {
            id: "basics",
            label: t("guide.section.basics.label"),
            lead: t("guide.section.basics.lead"),
            items: [
                {
                    title: t("guide.step.viewSelect.title"),
                    body: t("guide.step.viewSelect.body"),
                },
                {
                    title: t("guide.step.mapTint.title"),
                    body: t("guide.step.mapTint.body"),
                },
                {
                    title: t("guide.step.moveMerge.title"),
                    body: t("guide.step.moveMerge.body"),
                },
                {
                    title: t("guide.step.splitGroup.title"),
                    body: t("guide.step.splitGroup.body"),
                },
                {
                    title: t("guide.step.multiDayMarch.title"),
                    body: t("guide.step.multiDayMarch.body"),
                },
                {
                    title: t("guide.step.endTurn.title"),
                    body: t("guide.step.endTurn.body"),
                },
                {
                    title: t("guide.step.shortcuts.title"),
                    body: t("guide.step.shortcuts.body"),
                },
            ],
        },
        {
            id: "combat",
            label: t("guide.section.combat.label"),
            lead: t("guide.section.combat.lead"),
            items: [
                {
                    title: t("guide.step.armiesUnits.title"),
                    body: t("guide.step.armiesUnits.body"),
                },
                {
                    title: t("guide.step.organization.title"),
                    body: t("guide.step.organization.body"),
                },
                {
                    title: t("guide.step.battle.title"),
                    body: t("guide.step.battle.body"),
                },
                {
                    title: t("guide.step.garrison.title"),
                    body: t("guide.step.garrison.body"),
                },
                {
                    title: t("guide.step.supply.title"),
                    body: t("guide.step.supply.body"),
                },
            ],
        },
        {
            id: "economy",
            label: t("guide.section.economy.label"),
            lead: t("guide.section.economy.lead"),
            items: [
                {
                    title: t("guide.step.resources.title"),
                    body: t("guide.step.resources.body"),
                },
                {
                    title: t("guide.step.rawFoodStrategic.title"),
                    body: t("guide.step.rawFoodStrategic.body"),
                },
                {
                    title: t("guide.step.trainingDeploy.title"),
                    body: t("guide.step.trainingDeploy.body"),
                },
                {
                    title: t("guide.step.buildingsOwnership.title"),
                    body: t("guide.step.buildingsOwnership.body"),
                },
                {
                    title: t("guide.step.stateInfrastructure.title"),
                    body: t("guide.step.stateInfrastructure.body"),
                },
                {
                    title: t("guide.step.constructionQueue.title"),
                    body: t("guide.step.constructionQueue.body"),
                },
                {
                    title: t("guide.step.buildMapLayers.title"),
                    body: t("guide.step.buildMapLayers.body"),
                },
                {
                    title: t("guide.step.stateFactoryAllocation.title"),
                    body: t("guide.step.stateFactoryAllocation.body"),
                },
                {
                    title: t("guide.step.occupation.title"),
                    body: t("guide.step.occupation.body"),
                },
            ],
        },
        {
            id: "diplomacy",
            label: t("guide.section.diplomacy.label"),
            lead: t("guide.section.diplomacy.lead"),
            items: [
                {
                    title: t("guide.step.policies.title"),
                    body: t("guide.step.policies.body"),
                },
                {
                    title: t("guide.step.stability.title"),
                    body: t("guide.step.stability.body"),
                },
                {
                    title: t("guide.step.ownership.title"),
                    body: t("guide.step.ownership.body"),
                },
                {
                    title: t("guide.step.diplomacyPage.title"),
                    body: t("guide.step.diplomacyPage.body"),
                },
                {
                    title: t("guide.step.expansionPage.title"),
                    body: t("guide.step.expansionPage.body", { cost: CLAIM_COST }),
                },
                {
                    title: t("guide.step.stateHoverSnapshot.title"),
                    body: t("guide.step.stateHoverSnapshot.body"),
                },
                {
                    title: t("guide.step.claimsWarGoals.title"),
                    body: t("guide.step.claimsWarGoals.body", {
                        claimCost: CLAIM_COST,
                        conquestCost: DIPLOMATIC_PROFILES.conquest.cost,
                        conquestDays: DIPLOMATIC_PROFILES.conquest.days,
                        conquestUpkeep: DIPLOMATIC_PROFILES.conquest.upkeep,
                        conquestValidDays: DIPLOMATIC_PROFILES.conquest.validDays,
                        annexCost: DIPLOMATIC_PROFILES.annex.cost,
                        annexDays: DIPLOMATIC_PROFILES.annex.days,
                        annexUpkeep: DIPLOMATIC_PROFILES.annex.upkeep,
                        annexValidDays: DIPLOMATIC_PROFILES.annex.validDays,
                    }),
                },
                {
                    title: t("guide.step.preparationQueue.title"),
                    body: t("guide.step.preparationQueue.body"),
                },
                {
                    title: t("guide.step.enforceWarGoals.title"),
                    body: t("guide.step.enforceWarGoals.body"),
                },
                {
                    title: t("guide.step.whitePeace.title"),
                    body: t("guide.step.whitePeace.body", { days: TRUCE_DAYS }),
                },
                {
                    title: t("guide.step.aiOpponent.title"),
                    body: t("guide.step.aiOpponent.body"),
                },
            ],
        },
        {
            id: "world",
            label: t("guide.section.world.label"),
            lead: t("guide.section.world.lead"),
            items: [
                {
                    title: t("guide.step.seasons.title"),
                    body: t("guide.step.seasons.body", { days: DAYS_PER_SEASON }),
                },
                {
                    title: t("guide.step.victory.title"),
                    body: t("guide.step.victory.body"),
                },
                {
                    title: t("guide.step.warReport.title"),
                    body: t("guide.step.warReport.body"),
                },
            ],
        },
    ];
}

function guideMarkup(): SafeHtml {
    const sections = guideSections();

    const tabs = sections.map((section, index) =>
        html`<button class="guide-tab${index === 0 ? " active" : ""}" data-guide-tab="${section.id}">${section.label}</button>`).join("");

    const panels = sections.map((section, index) => html`
        <section class="guide-section${index === 0 ? "" : " hidden"}" data-guide-section="${section.id}">
            <p class="guide-lead">${section.lead}</p>
            <div class="guide-grid">
                ${rawHtml(section.items.map((item) => html`
                    <article class="guide-item">
                        <h3>${item.title}</h3>
                        <p>${item.body}</p>
                    </article>`).join(""))}
            </div>
        </section>`).join("");

    return html`
        <div class="guide-card">
            <div class="guide-head">
                <div>
                    <h2>${t("guide.title")}</h2>
                    <p>${t("guide.subtitle")}</p>
                </div>
                <button class="btn btn-icon guide-close" data-guide-close aria-label="${t("guide.close")}">✕</button>
            </div>
            <nav class="guide-tabs" id="guide-tabs">${rawHtml(tabs)}</nav>
            <div class="guide-body">${rawHtml(panels)}</div>
            <div class="guide-foot">
                <span>${t("guide.footNote")}</span>
                <button class="btn btn-primary" data-guide-close>${t("guide.back")}</button>
            </div>
        </div>`;
}

export function initGuide(): GuideHandle {
    const overlay = document.querySelector<HTMLElement>("#guide-overlay") as HTMLElement;

    const render = (): void => {
        setGameHtml(overlay, guideMarkup());
    };
    render();

    const select = (id: string): void => {
        for (const button of overlay.querySelectorAll<HTMLElement>("[data-guide-tab]")) {
            button.classList.toggle("active", button.dataset.guideTab === id);
        }
        for (const section of overlay.querySelectorAll<HTMLElement>("[data-guide-section]")) {
            section.classList.toggle("hidden", section.dataset.guideSection !== id);
        }
    };

    overlay.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-guide-close]")) {
            close();
            return;
        }
        const tab = target.closest<HTMLElement>("[data-guide-tab]");
        if (tab?.dataset.guideTab) select(tab.dataset.guideTab);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !overlay.classList.contains("open")) return;
        event.stopImmediatePropagation();
        close();
    });

    const open = (): void => {
        render();
        overlay.classList.remove("hidden");
        overlay.classList.add("open");
        select("basics");
    };
    const close = (): void => {
        overlay.classList.add("hidden");
        overlay.classList.remove("open");
    };

    return { open, close, isOpen: () => overlay.classList.contains("open") };
}
