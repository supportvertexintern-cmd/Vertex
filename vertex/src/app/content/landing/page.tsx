"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { PORTAL_FOR_ROLE } from "@/components/portal/navForRole";
import { FieldEditor, issuesByPath, type Issues, type Json } from "@/components/landing-editor/BodyEditor";
import { useDialog } from "@/components/ui/DialogProvider";
import type { Role } from "@/lib/enums";
import { ArrowSquareOut, ClockCounterClockwise } from "@phosphor-icons/react";

// The landing editor (the landing CMS, part 3): the website's home page and
// the mobile app's home screen, block by block. A block's draft is saved,
// previewed and published; visitors see only what's published (or the
// built-in text). Who may do what is the permissions the admin gave the
// role (Admin -> Roles & Permissions): landing.edit to save, discard and
// restore drafts, landing.publish to publish. FastAPI checks them, and
// each body, on every request (vertex_be/app/api/v1/landing.py); this page
// only hides what the role can't use.

type Body = { [key: string]: Json };

interface Block {
  key: string;
  group: "web" | "mobile" | "shared";
  label: string;
  version: number;
  default: Body;
  published: { body: Body; visible: boolean; revision: number; published_at: string | null; published_by: string | null };
  draft: { body: Body; visible: boolean; updated_at: string | null; updated_by: string | null } | null;
}

interface Revision {
  number: number;
  body: Body;
  visible: boolean;
  published_at: string;
  published_by: string | null;
}

const GROUPS: { group: Block["group"]; title: string; note: string }[] = [
  { group: "web", title: "Website", note: "The home page" },
  { group: "mobile", title: "Mobile app", note: "The home screen, before sign-in" },
  { group: "shared", title: "Shared", note: "Shown on both" },
];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function LandingEditorPage() {
  const dialog = useDialog();
  const [role, setRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selected, setSelected] = useState<string>("web.hero");
  const [body, setBody] = useState<Body | null>(null);
  const [visible, setVisible] = useState(true);
  const [issues, setIssues] = useState<Issues>({});
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const canEdit = permissions?.includes("landing.edit") ?? false;
  const canPublish = permissions?.includes("landing.publish") ?? false;
  const block = blocks.find((b) => b.key === selected) ?? null;

  // The version being worked on: the draft, else what's published.
  const base = useMemo(() => (block ? { body: block.draft?.body ?? block.published.body, visible: block.draft?.visible ?? block.published.visible } : null), [block]);
  const dirty = !!base && body !== null && (!same(body, base.body) || visible !== base.visible);

  const pick = useCallback((b: Block) => {
    setSelected(b.key);
    setBody(structuredClone(b.draft?.body ?? b.published.body));
    setVisible(b.draft?.visible ?? b.published.visible);
    setIssues({});
    setRevisions(null);
  }, []);

  useEffect(() => {
    Promise.all([fetch("/api/auth/me").then((r) => r.json()), fetch("/api/content/blocks").then(async (r) => ({ ok: r.ok, body: await r.json() }))])
      .then(([me, list]) => {
        setRole(me?.data?.role ?? null);
        setPermissions(me?.data?.permissions ?? []);
        if (!list.ok) throw new Error(list.body?.error?.message || "Failed to load the landing pages.");
        const loaded: Block[] = list.body.data;
        setBlocks(loaded);
        const first = loaded.find((b) => b.key === "web.hero") ?? loaded[0];
        if (first) pick(first);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the landing pages."))
      .finally(() => setLoading(false));
  }, [pick]);

  const replace = (updated: Block) => {
    setBlocks((bs) => bs.map((b) => (b.key === updated.key ? updated : b)));
    pick(updated);
  };

  const choose = async (b: Block) => {
    if (b.key === selected) return;
    if (dirty && !(await dialog.confirm("You have unsaved changes to this block. Leave them?", { confirmLabel: "Leave", danger: true }))) return;
    pick(b);
    setNotice("");
    setError("");
  };

  async function act(path: string, init: RequestInit, done: string) {
    if (!block) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/content/blocks/${encodeURIComponent(block.key)}${path}`, init);
      const answer = await res.json();
      if (!res.ok) {
        setIssues(issuesByPath(answer.error?.details?.issues));
        throw new Error(answer.error?.message || "That didn't work.");
      }
      replace(answer.data);
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const save = async () => {
    if (!block || !body) return;
    if (block.key === "shared.contact" && !visible) {
      const ok = await dialog.confirm(
        "Hiding the contact details hides the home page's contact strip. The footer, the WhatsApp button and the contact page then show the built-in details, not these. Hide it anyway?",
        { confirmLabel: "Hide it" },
      );
      if (!ok) return;
    }
    await act("/draft", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, visible }) }, "Draft saved. Visitors don't see it until it's published.");
  };

  const publish = async () => {
    if (!block) return;
    const ok = await dialog.confirm(`Publish “${block.label}”? Visitors will see it within a minute.`, { confirmLabel: "Publish" });
    if (ok) await act("/publish", { method: "POST" }, "Published.");
  };

  const discard = async () => {
    if (!block) return;
    const ok = await dialog.confirm("Discard the saved draft? The published version stays.", { confirmLabel: "Discard", danger: true });
    if (ok) await act("/discard", { method: "POST" }, "Draft discarded.");
  };

  const restore = async (number: number) => {
    const ok = await dialog.confirm(`Copy version ${number} into the draft? Nothing changes for visitors until you publish.`, { confirmLabel: "Copy into draft" });
    if (ok) await act(`/revisions/${number}/restore`, { method: "POST" }, `Version ${number} is now the draft.`);
  };

  const showHistory = async () => {
    if (!block) return;
    const res = await fetch(`/api/content/blocks/${encodeURIComponent(block.key)}/revisions`);
    const answer = await res.json();
    if (res.ok) setRevisions(answer.data);
    else setError(answer.error?.message || "Failed to load the history.");
  };

  const shell = (role && PORTAL_FOR_ROLE[role]) || { roleLabel: "Content", navItems: [] };
  const allowed = canEdit || canPublish;

  return (
    <PortalShell roleLabel={shell.roleLabel} navItems={shell.navItems}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Content
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Landing pages</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        The text and links of the website&apos;s home page and the mobile app&apos;s home screen. Save a draft, preview it, then
        publish it. Visitors see only what&apos;s published; a block never published shows the built-in text.
      </p>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-4 text-sm mb-6">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-midnight-900/50">Loading…</div>
      ) : !allowed ? (
        <div className="card p-10 text-center text-midnight-900/60">
          Your role can&apos;t edit or publish the landing pages. An administrator can give it permission on Roles &amp; Permissions.
        </div>
      ) : (
        <div className="grid lg:grid-cols-[260px_1fr] gap-6 items-start">
          <nav className="card p-3" aria-label="Blocks">
            {GROUPS.map(({ group, title, note }) => (
              <div key={group} className="mb-3 last:mb-0">
                <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-midnight-900/50">{title}</p>
                <p className="px-3 pb-2 text-xs text-midnight-900/40">{note}</p>
                {blocks.filter((b) => b.group === group).map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => choose(b)}
                    aria-current={b.key === selected ? "true" : undefined}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${
                      b.key === selected ? "bg-midnight-900 text-ivory-50" : "text-midnight-900 hover:bg-ivory-100"
                    }`}
                  >
                    <span>{b.label}</span>
                    <span className="flex gap-1 text-[10px] font-semibold uppercase">
                      {b.draft && <span className="rounded bg-gold-400 px-1.5 py-0.5 text-midnight-950">Draft</span>}
                      {!(b.draft?.visible ?? b.published.visible) && <span className="rounded bg-midnight-900/10 px-1.5 py-0.5">Hidden</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {block && body && (
            <section className="card p-6" aria-label={block.label}>
              <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
                <div>
                  <h2 className="text-xl font-semibold text-midnight-900">{block.label}</h2>
                  <p className="text-xs text-midnight-900/50 mt-1">
                    {block.published.revision === 0
                      ? "Showing the built-in text: never published."
                      : `Published version ${block.published.revision}${block.published.published_by ? ` by ${block.published.published_by}` : ""}, ${when(block.published.published_at)}.`}
                    {block.draft && ` Draft saved${block.draft.updated_by ? ` by ${block.draft.updated_by}` : ""}, ${when(block.draft.updated_at)}.`}
                  </p>
                </div>
                {block.group !== "mobile" && (
                  <a href="/?preview=1" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-midnight-700 hover:text-gold-600">
                    Preview the home page <ArrowSquareOut size={14} />
                  </a>
                )}
              </div>
              {block.group === "mobile" && (
                <p className="text-xs text-midnight-900/50 mb-2">The app shows published text the next time it opens; there is no preview here.</p>
              )}

              <label className="flex items-center gap-2 text-sm text-midnight-900 my-5">
                <input type="checkbox" checked={visible} disabled={!canEdit || busy} onChange={(e) => setVisible(e.target.checked)} />
                Show this section
              </label>

              {issues[""] && <p className="text-sm text-red-600 mb-4">{issues[""].join(" ")}</p>}

              <FieldEditor path={[]} value={body} template={block.default} onChange={(v) => setBody((v ?? {}) as Body)} readOnly={!canEdit || busy} issues={issues} />

              <div className="flex flex-wrap gap-3 mt-8 pt-6 border-t border-midnight-900/10">
                {canEdit && (
                  <button type="button" onClick={save} disabled={busy || !dirty} className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50">
                    Save draft
                  </button>
                )}
                {canPublish && (
                  <button
                    type="button"
                    onClick={publish}
                    disabled={busy || !block.draft || dirty}
                    title={dirty ? "Save the draft first" : !block.draft ? "There is no draft to publish" : undefined}
                    className="btn-gold px-5 py-2.5 text-sm disabled:opacity-50"
                  >
                    Publish
                  </button>
                )}
                {canEdit && dirty && (
                  <button type="button" onClick={() => pick(block)} disabled={busy} className="px-4 py-2.5 text-sm font-semibold text-midnight-900/60 hover:text-midnight-900">
                    Undo changes
                  </button>
                )}
                {canEdit && block.draft && !dirty && (
                  <button type="button" onClick={discard} disabled={busy} className="px-4 py-2.5 text-sm font-semibold text-red-600 hover:text-red-700">
                    Discard draft
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setBody(structuredClone(block.default));
                      setVisible(true);
                      setIssues({});
                    }}
                    disabled={busy}
                    className="px-4 py-2.5 text-sm font-semibold text-midnight-900/60 hover:text-midnight-900"
                  >
                    Use the built-in text
                  </button>
                )}
                <button type="button" onClick={showHistory} className="ml-auto inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-midnight-700 hover:text-gold-600">
                  <ClockCounterClockwise size={16} /> History
                </button>
              </div>

              {revisions && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-midnight-900 mb-3">Published versions</h3>
                  {revisions.length === 0 ? (
                    <p className="text-sm text-midnight-900/50">Never published.</p>
                  ) : (
                    <ul className="divide-y divide-midnight-900/10 text-sm">
                      {revisions.map((r) => (
                        <li key={r.number} className="flex items-center justify-between gap-4 py-2">
                          <span>
                            Version {r.number}
                            {r.number === block.published.revision && " (live)"}
                            {!r.visible && " (hidden)"} · {r.published_by ?? "Unknown"} · {when(r.published_at)}
                          </span>
                          {canEdit && (
                            <button type="button" onClick={() => restore(r.number)} disabled={busy} className="text-xs font-semibold text-midnight-700 hover:text-gold-600">
                              Copy into draft
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </PortalShell>
  );
}
