"use client";

// Admin → Monitoring → Partners & Logins (owner's requirements 2026-11-07,
// phase 3): one row per partner agency, with when and by whom it was added,
// and its login: when and by whom that was created, its status and latest
// sign-in. Filters, search, and a CSV of the filtered list, which FastAPI
// records on the audit trail before it leaves. A login is deactivated or
// reactivated here (with a reason); it is created or reset on the partner's
// own page, as before.

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, DownloadSimple, Prohibit, UserCheck } from "@phosphor-icons/react";
import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import FilterBar from "@/components/portal/FilterBar";
import SearchableSelect from "@/components/SearchableSelect";
import Pagination from "@/components/Pagination";
import { useDialog } from "@/components/ui/DialogProvider";
import { GEOIP_CREDIT, place } from "@/lib/monitoring";

const PAGE_SIZE = 25;

type LoginStatus = "no_login" | "setup_pending" | "active" | "deactivated";

const LOGIN_STATUS: Record<LoginStatus, { label: string; badge: string }> = {
  no_login: { label: "No login", badge: "bg-midnight-900/5 text-midnight-900/60" },
  setup_pending: { label: "Setup email sent", badge: "bg-amber-50 text-amber-700" },
  active: { label: "Active", badge: "bg-emerald-50 text-emerald-700" },
  deactivated: { label: "Deactivated", badge: "bg-red-50 text-red-700" },
};

const AGENCY_STATUS: Record<string, { label: string; badge: string }> = {
  pending: { label: "Pending", badge: "bg-amber-50 text-amber-700" },
  active: { label: "Active", badge: "bg-emerald-50 text-emerald-700" },
  suspended: { label: "Suspended", badge: "bg-red-100 text-red-700" },
};

const TYPES: Record<string, string> = {
  travel_agency: "Travel agency",
  visa_consultancy: "Visa consultancy",
  manpower_supplier: "Manpower supplier",
  other: "Other",
};

const MOU: Record<string, string> = { none: "None", sent: "Sent", signed: "Signed" };

interface Person {
  id: string;
  full_name: string;
}

interface Login {
  id: string;
  email: string;
  status: Exclude<LoginStatus, "no_login">;
  password_set: boolean;
  created_at: string;
  created_by: Person | null;
  activated_at: string | null;
  deactivated_at: string | null;
  last_sign_in_at: string | null;
  last_sign_in_ip: string | null;
  last_sign_in_country: string | null;
}

interface Row {
  id: string;
  name: string;
  partner_type: string;
  country_of_operation: string;
  status: string;
  mou_status: string;
  created_at: string;
  created_by: Person | null;
  login_status: LoginStatus;
  login: Login | null;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = body.error?.details?.reason;
    throw new Error((Array.isArray(details) && details[0]) || body.error?.message || "Something went wrong.");
  }
  return body;
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

export default function PartnersAndLoginsPage() {
  return (
    <Suspense>
      <PartnersAndLogins />
    </Suspense>
  );
}

function PartnersAndLogins() {
  const search = useSearchParams();
  const dialog = useDialog();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [options, setOptions] = useState<{ countries: string[]; creators: Person[] }>({ countries: [], creators: [] });
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("");
  const [loginStatus, setLoginStatus] = useState(search.get("login_status") ?? "");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [page, setPage] = useState(1);

  const filters = useCallback(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      q, country, status, login_status: loginStatus, created_from: createdFrom, created_to: createdTo, created_by: createdBy,
    })) {
      if (value) params.set(key, value);
    }
    return params;
  }, [q, country, status, loginStatus, createdFrom, createdTo, createdBy]);

  const load = useCallback(() => {
    setLoading(true);
    const params = filters();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    call(`/api/admin/monitoring/partners?${params}`)
      .then((body) => {
        setRows((body.data as Row[]) ?? []);
        setTotal(Number(body.total ?? 0));
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load partners."))
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => {
    const timeout = setTimeout(load, 250); // debounce search-as-you-type
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    call("/api/admin/monitoring/partners/options")
      .then((body) => setOptions(body.data as { countries: string[]; creators: Person[] }))
      .catch(() => {});
  }, []);

  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  const changeLogin = async (row: Row, action: "deactivate" | "reactivate") => {
    if (!row.login) return;
    const deactivating = action === "deactivate";
    const reason = await dialog.prompt(
      deactivating
        ? `${row.name}'s login (${row.login.email}) won't be able to sign in, and its sessions end now. The agency's own status and MOU stay as they are. Why is it being deactivated?`
        : `${row.name}'s login (${row.login.email}) will be able to sign in again. Why is it being reactivated?`,
      {
        title: deactivating ? "Deactivate partner login" : "Reactivate partner login",
        confirmLabel: deactivating ? "Deactivate" : "Reactivate",
        danger: deactivating,
        required: true,
        multiline: true,
        placeholder: "Reason (kept on the audit trail)",
      },
    );
    if (reason === null) return;
    setBusy(row.id);
    setError("");
    setNotice("");
    try {
      await call(`/api/admin/users/${row.login.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setNotice(deactivating ? `${row.name}: login deactivated.` : `${row.name}: login reactivated.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const exportHref = () => {
    const params = filters();
    return `/api/admin/monitoring/partners/export${params.size ? `?${params}` : ""}`;
  };

  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <div className="flex items-start justify-between gap-6 mb-2">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Monitoring
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Partners &amp; Logins</h1>
        </div>
        <a href={exportHref()} className="btn-secondary text-xs shrink-0" download>
          <DownloadSimple size={16} weight="bold" /> Export CSV
        </a>
      </div>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Every partner agency, when and by whom it was added, and its login. The export is the filtered list, every page,
        and is recorded on the audit trail.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm mb-6">{error}</div>}
      {notice && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      <FilterBar searchValue={q} onSearchChange={filter(setQ)} searchPlaceholder="Search by agency name or login email…">
        <SearchableSelect
          value={country}
          onChange={filter(setCountry)}
          placeholder="All countries"
          className="input-field w-48"
          options={[{ value: "", label: "All countries" }, ...options.countries.map((c) => ({ value: c, label: c }))]}
        />
        <SearchableSelect
          value={status}
          onChange={filter(setStatus)}
          placeholder="Any agency status"
          className="input-field w-48"
          options={[{ value: "", label: "Any agency status" }, ...Object.entries(AGENCY_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
        />
        <SearchableSelect
          value={loginStatus}
          onChange={filter(setLoginStatus)}
          placeholder="Any login status"
          className="input-field w-48"
          options={[{ value: "", label: "Any login status" }, ...Object.entries(LOGIN_STATUS).map(([value, s]) => ({ value, label: s.label }))]}
        />
        <SearchableSelect
          value={createdBy}
          onChange={filter(setCreatedBy)}
          placeholder="Added by anyone"
          className="input-field w-52"
          options={[{ value: "", label: "Added by anyone" }, ...options.creators.map((p) => ({ value: p.id, label: p.full_name }))]}
        />
        <label className="flex items-center gap-2 text-xs text-midnight-900/50">
          Added from
          <input type="date" value={createdFrom} onChange={(e) => filter(setCreatedFrom)(e.target.value)} className="input-field py-2 text-xs w-40" />
        </label>
        <label className="flex items-center gap-2 text-xs text-midnight-900/50">
          to
          <input type="date" value={createdTo} onChange={(e) => filter(setCreatedTo)(e.target.value)} className="input-field py-2 text-xs w-40" />
        </label>
      </FilterBar>

      {loading && rows.length === 0 ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No matching partners.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-midnight-900/10 text-left text-midnight-900/40 text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Agency</th>
                <th className="px-5 py-3 font-semibold">Status · MOU</th>
                <th className="px-5 py-3 font-semibold">Added</th>
                <th className="px-5 py-3 font-semibold">Login</th>
                <th className="px-5 py-3 font-semibold">Login status</th>
                <th className="px-5 py-3 font-semibold">Last sign-in</th>
                <th className="px-5 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const agency = AGENCY_STATUS[r.status] ?? { label: r.status, badge: "bg-midnight-900/5" };
                const login = LOGIN_STATUS[r.login_status];
                return (
                  <tr key={r.id} className="border-b border-midnight-900/5 last:border-0 align-top">
                    <td className="px-5 py-4">
                      <Link href={`/management/partners/${r.id}`} className="font-medium text-midnight-900 hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-midnight-900/45">
                        {TYPES[r.partner_type] ?? r.partner_type} · {r.country_of_operation}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <Badge className={agency.badge}>{agency.label}</Badge>
                      <div className="text-xs text-midnight-900/45 mt-1">MOU: {MOU[r.mou_status] ?? r.mou_status}</div>
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">
                      <div>{when(r.created_at)}</div>
                      <div className="text-xs text-midnight-900/40">{r.created_by ? `by ${r.created_by.full_name}` : ""}</div>
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">
                      {r.login ? (
                        <>
                          <div className="break-all">{r.login.email}</div>
                          <div className="text-xs text-midnight-900/40">
                            created {when(r.login.created_at)}
                            {r.login.created_by ? ` by ${r.login.created_by.full_name}` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-midnight-900/30">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <Badge className={login.badge}>{login.label}</Badge>
                      {r.login_status === "active" && r.login?.activated_at && (
                        <div className="text-xs text-midnight-900/40 mt-1">since {when(r.login.activated_at)}</div>
                      )}
                      {r.login_status === "deactivated" && r.login?.deactivated_at && (
                        <div className="text-xs text-midnight-900/40 mt-1">on {when(r.login.deactivated_at)}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-midnight-900/70">
                      <div>{when(r.login?.last_sign_in_at ?? null)}</div>
                      {r.login?.last_sign_in_ip && (
                        <div className="text-xs text-midnight-900/40">{place(r.login.last_sign_in_ip, r.login.last_sign_in_country)}</div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col items-end gap-2 text-xs">
                        <Link href={`/management/partners/${r.id}`} className="font-medium text-gold-700 hover:underline whitespace-nowrap">
                          {r.login ? "Open partner" : "Create login"}
                        </Link>
                        <Link href={`/admin/monitoring/audit?entity_type=Partner&entity_id=${r.id}`} className="text-midnight-900/50 hover:underline whitespace-nowrap">
                          View history
                        </Link>
                        {r.login && r.login_status !== "deactivated" && (
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => changeLogin(r, "deactivate")}
                            className="inline-flex items-center gap-1 font-medium text-red-600 hover:underline disabled:opacity-60 whitespace-nowrap"
                          >
                            <Prohibit size={14} weight="bold" /> Deactivate login
                          </button>
                        )}
                        {r.login && r.login_status === "deactivated" && (
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => changeLogin(r, "reactivate")}
                            className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline disabled:opacity-60 whitespace-nowrap"
                          >
                            <UserCheck size={14} weight="bold" /> Reactivate login
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
      <p className="mt-4 text-xs text-midnight-900/40">{GEOIP_CREDIT}</p>
    </PortalShell>
  );
}
