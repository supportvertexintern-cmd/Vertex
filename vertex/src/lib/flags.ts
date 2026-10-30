// Users and sessions step 8.3 moves the account routes to FastAPI behind one
// flag per area (auth hardening plan, D.2). On by default; set one to
// "false" and restart to send that area back to the website's own code,
// which stays until step 8.5. Read on every request, so no rebuild is needed.
//
//   FLAG_ACCOUNTS_FASTAPI_REGISTRATION  POST /api/auth/register, GET /api/auth/verify-email
//   FLAG_ACCOUNTS_FASTAPI_RESET         POST /api/auth/forgot-password, POST /api/auth/reset-password
//   FLAG_ACCOUNTS_FASTAPI_ADMIN_USERS   POST /api/admin/users, PATCH and DELETE /api/admin/users/[id],
//                                       POST /api/admin/users/[id]/reset-password
export type AccountsArea = "REGISTRATION" | "RESET" | "ADMIN_USERS";

export function accountsOnFastApi(area: AccountsArea): boolean {
  return process.env[`FLAG_ACCOUNTS_FASTAPI_${area}`]?.trim().toLowerCase() !== "false";
}
