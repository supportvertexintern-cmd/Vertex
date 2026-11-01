// Users and sessions steps 8.3 and 8.4 move the account routes to FastAPI
// behind one flag per area (auth hardening plan, D.2). On by default; set one
// to "false" and restart to send that area back to the website's own code,
// which stays until step 8.5. Read on every request, so no rebuild is needed.
//
//   FLAG_ACCOUNTS_FASTAPI_REGISTRATION  POST /api/auth/register, GET /api/auth/verify-email
//   FLAG_ACCOUNTS_FASTAPI_RESET         POST /api/auth/forgot-password, POST /api/auth/reset-password
//   FLAG_ACCOUNTS_FASTAPI_ADMIN_USERS   POST /api/admin/users, PATCH and DELETE /api/admin/users/[id],
//                                       POST /api/admin/users/[id]/reset-password
//   FLAG_ACCOUNTS_FASTAPI_PARTNERS      POST /api/admin/partners, PATCH and DELETE /api/admin/partners/[id],
//                                       POST /api/admin/partners/[id]/provision-account and /reset-password
//   FLAG_ACCOUNTS_FASTAPI_REFERRAL_AGENTS
//                                       POST /api/referral-agents/register, GET /api/referral-agents/verify-email,
//                                       POST /api/admin/referral-agents/[id]/approve, PATCH /api/admin/referral-agents/[id]
export type AccountsArea = "REGISTRATION" | "RESET" | "ADMIN_USERS" | "PARTNERS" | "REFERRAL_AGENTS";

export function accountsOnFastApi(area: AccountsArea): boolean {
  return process.env[`FLAG_ACCOUNTS_FASTAPI_${area}`]?.trim().toLowerCase() !== "false";
}
