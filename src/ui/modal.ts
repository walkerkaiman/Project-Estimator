/**
 * Lightweight modal helpers — replacements for browser prompt() / confirm().
 *
 * Tauri's WebView does not implement window.prompt() or window.confirm(),
 * so we use custom modal dialogs everywhere instead.
 */

// ── Shared backdrop ────────────────────────────────────────────────────────────

function makeBackdrop(id: string): HTMLElement {
  document.getElementById(id)?.remove();
  const el = document.createElement('div');
  el.id = id;
  el.className = 'modal-backdrop';
  document.body.appendChild(el);
  return el;
}

function focusFirst(el: HTMLElement): void {
  const input = el.querySelector<HTMLElement>('input,textarea,button.btn-primary');
  input?.focus();
}

// ── showPrompt ─────────────────────────────────────────────────────────────────

/**
 * Ask the user for a text value.
 * Resolves to the trimmed string, or null if cancelled / empty.
 */
export function showPrompt(title: string, defaultValue = '', placeholder = ''): Promise<string | null> {
  const backdrop = makeBackdrop('app-prompt-modal');
  backdrop.innerHTML = `
    <div class="modal-box" style="max-width:400px">
      <div class="modal-header">
        <h2>${esc(title)}</h2>
        <button class="modal-close" id="prompt-cancel-x">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px">
        <input id="prompt-input" type="text"
          value="${esc(defaultValue)}"
          placeholder="${esc(placeholder)}"
          style="width:100%;padding:8px 10px;background:var(--color-surface2);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px"/>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="prompt-cancel">Cancel</button>
        <button class="btn-primary"   id="prompt-ok">OK</button>
      </div>
    </div>`;

  const input = backdrop.querySelector<HTMLInputElement>('#prompt-input')!;

  return new Promise(resolve => {
    function confirm(): void {
      const val = input.value.trim();
      backdrop.remove();
      resolve(val || null);
    }
    function cancel(): void { backdrop.remove(); resolve(null); }

    backdrop.querySelector('#prompt-ok')?.addEventListener('click', confirm);
    backdrop.querySelector('#prompt-cancel')?.addEventListener('click', cancel);
    backdrop.querySelector('#prompt-cancel-x')?.addEventListener('click', cancel);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') cancel();
    });
    // Select-all on open so the user can retype instantly
    setTimeout(() => { input.select(); focusFirst(backdrop); }, 10);
  });
}

// ── showConfirm ────────────────────────────────────────────────────────────────

/**
 * Ask the user to confirm a destructive action.
 * Resolves to true if confirmed, false otherwise.
 */
export function showConfirm(message: string, confirmLabel = 'Delete'): Promise<boolean> {
  const backdrop = makeBackdrop('app-confirm-modal');
  backdrop.innerHTML = `
    <div class="modal-box" style="max-width:380px">
      <div class="modal-header">
        <h2>Confirm</h2>
        <button class="modal-close" id="confirm-cancel-x">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px">
        <p style="color:var(--color-text)">${esc(message)}</p>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="confirm-cancel">Cancel</button>
        <button class="btn-primary" id="confirm-ok" style="background:var(--color-danger)">${esc(confirmLabel)}</button>
      </div>
    </div>`;

  return new Promise(resolve => {
    function ok():     void { backdrop.remove(); resolve(true);  }
    function cancel(): void { backdrop.remove(); resolve(false); }

    backdrop.querySelector('#confirm-ok')?.addEventListener('click', ok);
    backdrop.querySelector('#confirm-cancel')?.addEventListener('click', cancel);
    backdrop.querySelector('#confirm-cancel-x')?.addEventListener('click', cancel);
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Enter') ok();
      if (e.key === 'Escape') cancel();
    });
    setTimeout(() => focusFirst(backdrop), 10);
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
