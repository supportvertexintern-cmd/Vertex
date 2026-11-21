"use client";

import { useEffect, useState } from "react";
import type { Role } from "@/lib/enums";

/**
 * The signed-in user's role and permissions (role management, 2026-11-21),
 * from /api/auth/me: asked once per page load and shared by the portal
 * shell's nav and the pages a role reaches by permission. For showing
 * things only; FastAPI checks every permission itself. Nobody (null) if
 * the answer fails.
 */
export interface Me {
  role: Role;
  permissions: string[];
}

let request: Promise<Me | null> | null = null;

export function fetchMe(): Promise<Me | null> {
  request ??= fetch("/api/auth/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((body) =>
      body?.data?.role ? { role: body.data.role as Role, permissions: Array.isArray(body.data.permissions) ? body.data.permissions : [] } : null,
    )
    .catch(() => null);
  return request;
}

/** undefined while asking, then the user or null. */
export function useMe(): Me | null | undefined {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetchMe().then((answer) => live && setMe(answer));
    return () => {
      live = false;
    };
  }, []);
  return me;
}
