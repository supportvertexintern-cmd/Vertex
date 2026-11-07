import { describe, expect, it } from "vitest";
import { createDialogQueue, type DialogRequest } from "./dialog-queue";

function queue() {
  const shown: (DialogRequest | null)[] = [];
  const q = createDialogQueue((current) => shown.push(current));
  return { q, shown };
}

describe("dialog queue", () => {
  it("shows one dialog at a time, in the order asked", async () => {
    const { q, shown } = queue();
    const first = q.alert("one");
    const second = q.confirm("two?");
    expect(shown.map((d) => d?.message)).toEqual(["one"]);
    q.answer(q.current()!.id, undefined);
    await first;
    expect(q.current()?.message).toBe("two?");
    q.answer(q.current()!.id, true);
    expect(await second).toBe(true);
    expect(shown.at(-1)).toBeNull();
  });

  it("answers a dismissal as the browser's dialogs did", async () => {
    const { q } = queue();
    const confirmed = q.confirm("sure?");
    q.dismiss(q.current()!.id);
    expect(await confirmed).toBe(false);
    const typed = q.prompt("why?");
    q.dismiss(q.current()!.id);
    expect(await typed).toBeNull();
  });

  it("returns what was typed, even when empty", async () => {
    const { q } = queue();
    const typed = q.prompt("reference?");
    q.answer(q.current()!.id, "");
    expect(await typed).toBe("");
  });

  it("ignores an answer for a dialog that isn't on screen", async () => {
    const { q } = queue();
    const first = q.confirm("first?");
    const id = q.current()!.id;
    q.answer(id + 1, true);
    expect(q.current()?.id).toBe(id);
    q.answer(id, true);
    q.answer(id, false); // a second click on the same dialog
    expect(await first).toBe(true);
  });

  it("keeps the options with the request", () => {
    const { q } = queue();
    void q.confirm("Delete it?", { confirmLabel: "Delete", danger: true });
    expect(q.current()).toMatchObject({ kind: "confirm", confirmLabel: "Delete", danger: true });
  });
});
