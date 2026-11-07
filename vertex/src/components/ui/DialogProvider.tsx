"use client";

// The app's alert / confirm / prompt dialog, in place of the browser's
// window.alert, window.confirm and window.prompt. Mounted once in the root
// layout; anywhere below it:
//
//   const dialog = useDialog();
//   if (!(await dialog.confirm("Delete this draft?", { confirmLabel: "Delete", danger: true }))) return;
//   await dialog.alert("Saved.");
//   const reason = await dialog.prompt("Reason for rejecting:", { required: true });
//
// Answers match the browser's: confirm false and prompt null when dismissed
// (Escape, Cancel or a click outside). One dialog shows at a time, in order.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createDialogQueue, type DialogQueue, type DialogRequest } from "@/lib/dialog-queue";

type DialogApi = Pick<DialogQueue, "alert" | "confirm" | "prompt">;

const DialogContext = createContext<DialogApi | null>(null);

// Outside the provider (it's in the root layout, so only in isolation) the
// browser's own dialogs stand in, rather than failing.
const BROWSER: DialogApi = {
  alert: async (message) => window.alert(message),
  confirm: async (message) => window.confirm(message),
  prompt: async (message, options) => window.prompt(message, options?.defaultValue ?? ""),
};

export function useDialog(): DialogApi {
  return useContext(DialogContext) ?? BROWSER;
}

const DEFAULT_LABEL = { alert: "OK", confirm: "Confirm", prompt: "Save" } as const;
const FOCUSABLE = 'button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])';

export default function DialogProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const queue = useMemo(() => createDialogQueue(setCurrent), []);
  const api = useMemo<DialogApi>(() => ({ alert: queue.alert, confirm: queue.confirm, prompt: queue.prompt }), [queue]);
  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <Dialog key={current.id} request={current} queue={queue} />}
    </DialogContext.Provider>
  );
}

function Dialog({ request, queue }: { request: DialogRequest; queue: DialogQueue }) {
  const { id, kind, message, title, danger, required, multiline } = request;
  const [value, setValue] = useState(request.defaultValue ?? "");
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  const submit = useCallback(() => {
    if (kind === "prompt" && required && !value.trim()) return;
    queue.answer(id, kind === "confirm" ? true : kind === "prompt" ? value : undefined);
  }, [id, kind, queue, required, value]);
  const dismiss = useCallback(() => queue.dismiss(id), [id, queue]);

  // Focus inside on open (Cancel first for a destructive action, so Enter
  // can't confirm it by accident), and back where it was on close; no page
  // scroll behind the dialog.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (kind === "prompt" ? input.current : danger ? cancel.current : primary.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [danger, kind]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    } else if (e.key === "Tab" && panel.current) {
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    } else if (e.key === "Enter" && kind === "prompt" && !multiline && e.target === input.current) {
      e.preventDefault();
      submit();
    }
  }

  const titleId = `dialog-${id}-title`;
  const messageId = `dialog-${id}-message`;
  const blocked = kind === "prompt" && required && !value.trim();

  return (
    <div
      className="fixed inset-0 z-[80] bg-midnight-950/60 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) (kind === "alert" ? submit : dismiss)(); }}
    >
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : messageId}
        aria-describedby={title ? messageId : undefined}
        onKeyDown={onKeyDown}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md"
      >
        <div className="px-6 pt-5 pb-2">
          {title && <h2 id={titleId} className="text-lg font-semibold text-midnight-950 mb-2">{title}</h2>}
          <p id={messageId} className="text-sm text-midnight-950/80 whitespace-pre-line break-words">{message}</p>
          {kind === "prompt" && (multiline ? (
            <textarea
              ref={input}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={request.placeholder}
              rows={3}
              aria-labelledby={messageId}
              className="mt-3 w-full rounded-xl border border-midnight-950/20 px-3 py-2 text-sm text-midnight-950 focus:outline-none focus:ring-2 focus:ring-midnight-600"
            />
          ) : (
            <input
              ref={input}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={request.placeholder}
              aria-labelledby={messageId}
              className="mt-3 w-full rounded-xl border border-midnight-950/20 px-3 py-2 text-sm text-midnight-950 focus:outline-none focus:ring-2 focus:ring-midnight-600"
            />
          ))}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4">
          {kind !== "alert" && (
            <button
              ref={cancel}
              type="button"
              onClick={dismiss}
              className="px-4 py-2 rounded-xl text-sm font-medium text-midnight-950/70 hover:bg-midnight-950/5 focus:outline-none focus:ring-2 focus:ring-midnight-600"
            >
              {request.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            ref={primary}
            type="button"
            onClick={submit}
            disabled={blocked}
            className={`px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              danger ? "bg-red-700 hover:bg-red-800 focus:ring-red-700" : "bg-midnight-800 hover:bg-midnight-700 focus:ring-midnight-600"
            }`}
          >
            {request.confirmLabel ?? DEFAULT_LABEL[kind]}
          </button>
        </div>
      </div>
    </div>
  );
}
