import { escapeHtml, renderGameText } from "./text.ts";

export interface ConfirmSpec {
    readonly title: string;
    /** Body text; game-text tokens are supported. */
    readonly body: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
    readonly danger?: boolean;
    onConfirm(): void;
}

/** Modal confirm/cancel card shared by every state-changing action that needs an explicit go-ahead. */
export class ConfirmDialog {
    private readonly host: HTMLElement;
    private scrim: HTMLElement | null = null;
    private previousFocus: HTMLElement | null = null;

    constructor(host: HTMLElement) {
        this.host = host;
    }

    get isOpen(): boolean {
        return this.scrim !== null;
    }

    show(spec: ConfirmSpec): void {
        this.close();
        this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const scrim = document.createElement("div");
        scrim.className = "confirm-scrim";
        scrim.innerHTML = `<div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <div class="confirm-head"><span id="confirm-title">${escapeHtml(spec.title)}</span></div>
            <p class="confirm-body">${renderGameText(spec.body)}</p>
            <div class="confirm-actions">
                <button type="button" class="btn" data-confirm-cancel>${escapeHtml(spec.cancelLabel ?? "取消")}</button>
                <button type="button" class="btn ${spec.danger ? "btn-danger" : "btn-primary"}" data-confirm-ok>${escapeHtml(spec.confirmLabel ?? "确认")}</button>
            </div>
        </div>`;
        scrim.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target === scrim || target.closest("[data-confirm-cancel]")) this.close();
            else if (target.closest("[data-confirm-ok]")) {
                this.close();
                spec.onConfirm();
            }
        });
        this.host.appendChild(scrim);
        this.scrim = scrim;
        scrim.querySelector<HTMLButtonElement>("[data-confirm-ok]")?.focus({ preventScroll: true });
    }

    close(): boolean {
        if (!this.scrim) return false;
        this.scrim.remove();
        this.scrim = null;
        const focus = this.previousFocus;
        this.previousFocus = null;
        if (focus?.isConnected) focus.focus({ preventScroll: true });
        return true;
    }
}