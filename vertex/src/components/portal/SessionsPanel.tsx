"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";

interface Session {
  id: string;
  device: string | null;
  started_at: string;
  last_active_at: string;
  expires_at: string;
  current: boolean;
}

// A rough, readable name for a user-agent string; the full string is shown
// on hover.
function describe(device: string | null): string {
  if (!device) return "Unknown device";
  const browser = /Edg\//.test(device) ? "Edge" : /Chrome\//.test(device) ? "Chrome" : /Firefox\//.test(device) ? "Firefox" : /Safari\//.test(device) ? "Safari" : "Browser";
  const os = /Windows/.test(device) ? "Windows" : /Android/.test(device) ? "Android" : /iPhone|iPad/.test(device) ? "iOS" : /Mac OS/.test(device) ? "macOS" : /Linux/.test(device) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * "Active sessions" (G19): every browser signed in to this account, with
 * sign-out per session and "Log out everywhere".
 */
export default function SessionsPanel({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    const res = await fetch("/api/auth/sessions");
    if (!res.ok) {
      setError("Couldn't load your sessions.");
      return;
    }
    setSessions((await res.json()).data);
  };

  useEffect(() => {
    void load();
  }, []);

  const endOne = async (s: Session) => {
    setBusy(true);
    const res = await fetch(`/api/auth/sessions/${encodeURIComponent(s.id)}`, { method: "DELETE" });
    setBusy(false);
    if (s.current && res.ok) {
      window.location.assign("/auth/login");
      return;
    }
    if (!res.ok) setError("Couldn't end that session.");
    await load();
  };

  const endAll = async () => {
    setBusy(true);
    await fetch("/api/auth/sessions", { method: "DELETE" });
    window.location.assign("/auth/login");
  };

  return (
    <div className="fixed inset-0 z-[60] bg-midnight-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="sessions-title">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-midnight-950/10">
          <h2 id="sessions-title" className="text-lg font-semibold text-midnight-950">Active sessions</h2>
          <button onClick={onClose} className="p-2 text-midnight-950/60 hover:text-midnight-950" aria-label="Close">
            <X size={20} weight="bold" />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1">
          <p className="text-sm text-midnight-950/60 mb-4">
            Browsers and devices signed in to your account. End any you don&apos;t recognise, then change your password.
          </p>
          {error && <p className="text-sm text-red-700 mb-3">{error}</p>}
          {!sessions && !error && <p className="text-sm text-midnight-950/60">Loading…</p>}
          <ul className="flex flex-col gap-3">
            {sessions?.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-midnight-950/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-midnight-950" title={s.device ?? undefined}>
                    {describe(s.device)}
                    {s.current && <span className="ml-2 text-xs font-semibold text-gold-600">This browser</span>}
                  </p>
                  <p className="text-xs text-midnight-950/60">Signed in {when(s.started_at)}</p>
                  <p className="text-xs text-midnight-950/60">Last active {when(s.last_active_at)}</p>
                </div>
                <button
                  disabled={busy}
                  onClick={() => endOne(s)}
                  className="shrink-0 text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                >
                  {s.current ? "Log out" : "End session"}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-6 py-4 border-t border-midnight-950/10 flex justify-end">
          <button
            disabled={busy}
            onClick={endAll}
            className="px-4 py-2 rounded-xl bg-midnight-950 text-ivory-50 text-sm font-medium hover:bg-midnight-900 disabled:opacity-50"
          >
            Log out everywhere
          </button>
        </div>
      </div>
    </div>
  );
}
