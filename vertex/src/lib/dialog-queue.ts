// The app's own alert / confirm / prompt (components/ui/DialogProvider.tsx),
// in place of the browser's: one dialog at a time, in the order asked, each
// answered through the promise its caller awaits. Kept free of React so the
// order and the answers can be tested on their own (dialog-queue.test.ts).

export type DialogKind = "alert" | "confirm" | "prompt";

export interface DialogOptions {
  title?: string;
  /** The main button's label. Defaults: OK, Confirm, Save. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** A destructive action: a red button, and Cancel has the focus. */
  danger?: boolean;
  /** prompt only */
  defaultValue?: string;
  placeholder?: string;
  /** prompt only: the main button stays off until something is typed. */
  required?: boolean;
  multiline?: boolean;
}

export interface DialogRequest extends DialogOptions {
  id: number;
  kind: DialogKind;
  message: string;
}

type Answer = boolean | string | null | undefined;

// What a dismissal (Escape, Cancel, the backdrop) answers, as the browser's
// own dialogs did: confirm false, prompt null.
const DISMISSED: Record<DialogKind, Answer> = { alert: undefined, confirm: false, prompt: null };

export interface DialogQueue {
  alert(message: string, options?: DialogOptions): Promise<void>;
  confirm(message: string, options?: DialogOptions): Promise<boolean>;
  prompt(message: string, options?: DialogOptions): Promise<string | null>;
  /** The dialog on screen, or null. */
  current(): DialogRequest | null;
  /** The answer to the dialog on screen; ignored for any other id. */
  answer(id: number, value: Answer): void;
  dismiss(id: number): void;
}

export function createDialogQueue(onChange: (current: DialogRequest | null) => void): DialogQueue {
  const waiting: { request: DialogRequest; resolve: (value: Answer) => void }[] = [];
  let nextId = 1;

  function show(kind: DialogKind, message: string, options: DialogOptions = {}): Promise<Answer> {
    return new Promise((resolve) => {
      waiting.push({ request: { ...options, id: nextId++, kind, message }, resolve });
      if (waiting.length === 1) onChange(waiting[0].request);
    });
  }

  function answer(id: number, value: Answer) {
    const head = waiting[0];
    if (!head || head.request.id !== id) return;
    waiting.shift();
    head.resolve(value);
    onChange(waiting[0]?.request ?? null);
  }

  return {
    alert: (message, options) => show("alert", message, options).then(() => undefined),
    confirm: (message, options) => show("confirm", message, options).then((v) => v === true),
    prompt: (message, options) => show("prompt", message, options).then((v) => (typeof v === "string" ? v : null)),
    current: () => waiting[0]?.request ?? null,
    answer,
    dismiss: (id) => {
      const head = waiting[0];
      if (head && head.request.id === id) answer(id, DISMISSED[head.request.kind]);
    },
  };
}
