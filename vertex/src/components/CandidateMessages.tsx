"use client";

import { useEffect, useRef, useState } from "react";
import { PaperPlaneRight, PencilSimple, Trash, Check, X } from "@phosphor-icons/react";

interface Message {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  sender_id: string;
  sender: { full_name: string; role: string };
}

interface Props {
  candidateId: string;
}

/**
 * One continuous message thread between a candidate and whoever's handling
 * them (2026-07-13, confirmed with the business; widened 2026-07-31 to
 * also cover a partner-sourced candidate's partner/HR/Operations/Director
 * participants) — reused as-is across the recruiter's candidate detail
 * page, the candidate's own dashboard, HR's submission review, and the
 * partner's own candidate detail page, since it's the same thread either
 * way, not separate views of different data.
 *
 * Edit/Delete (2026-08-12) — sender-only, on their own messages only, not
 * a moderation tool for the other side's messages.
 */
export default function CandidateMessages({ candidateId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = () => {
    fetch(`/api/candidates/${candidateId}/messages`)
      .then((r) => r.json())
      .then((res) => setMessages(res.data ?? []))
      .catch(() => setError("Failed to load messages."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((res) => setCurrentUserId(res.data?.userId ?? null))
      .catch(() => {});
  }, []);

  useEffect(load, [candidateId]);

  useEffect(() => {
    if (!editingId) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, editingId]);

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/candidates/${candidateId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Failed to send message.");
      setDraft("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const startEdit = (m: Message) => {
    setEditingId(m.id);
    setEditDraft(m.body);
  };

  const saveEdit = async (messageId: string) => {
    if (!editDraft.trim()) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Failed to save.");
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!confirm("Delete this message?")) return;
    setDeletingId(messageId);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/messages/${messageId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Failed to delete.");
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="card p-6">
      <h2 className="text-sm font-semibold text-midnight-900/70 uppercase tracking-wider mb-4">Messages</h2>
      <div className="max-h-96 overflow-y-auto space-y-3 mb-4 pr-1">
        {loading ? (
          <p className="text-sm text-midnight-900/40">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-midnight-900/40">No messages yet — say hello.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === currentUserId;
            const edited = m.updated_at !== m.created_at;
            const isEditing = editingId === m.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-gold-400 text-midnight-950" : "bg-ivory-100 text-midnight-900"}`}>
                  {isEditing ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={2}
                        className="w-full resize-none rounded-lg px-2 py-1.5 text-sm text-midnight-900 bg-white/70"
                        autoFocus
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button type="button" onClick={() => setEditingId(null)} className="text-midnight-950/60 hover:text-midnight-950" aria-label="Cancel edit">
                          <X size={14} weight="bold" />
                        </button>
                        <button
                          type="button"
                          disabled={savingEdit || !editDraft.trim()}
                          onClick={() => saveEdit(m.id)}
                          className="text-midnight-950/60 hover:text-midnight-950 disabled:opacity-40"
                          aria-label="Save edit"
                        >
                          <Check size={14} weight="bold" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`flex items-center gap-2 text-[10px] mt-1 ${mine ? "text-midnight-950/50" : "text-midnight-900/40"}`}>
                        <span>
                          {m.sender.full_name} <span className="capitalize">({m.sender.role.replace(/_/g, " ")})</span> · {new Date(m.created_at).toLocaleString()}
                          {edited && " (edited)"}
                        </span>
                        {mine && (
                          <span className="flex items-center gap-1.5 ml-auto">
                            <button type="button" onClick={() => startEdit(m)} className="hover:text-midnight-950" aria-label="Edit message">
                              <PencilSimple size={11} weight="bold" />
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === m.id}
                              onClick={() => deleteMessage(m.id)}
                              className="hover:text-red-700 disabled:opacity-40"
                              aria-label="Delete message"
                            >
                              <Trash size={11} weight="bold" />
                            </button>
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="text-xs text-red-500 mb-2">{error}</div>}

      <div className="flex items-end gap-2 pt-2 border-t border-midnight-900/10">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message…"
          rows={2}
          className="input-field flex-1 resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          disabled={sending || !draft.trim()}
          onClick={send}
          className="btn-primary py-2.5 px-4 text-xs disabled:opacity-50 shrink-0"
          aria-label="Send message"
        >
          <PaperPlaneRight size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}
