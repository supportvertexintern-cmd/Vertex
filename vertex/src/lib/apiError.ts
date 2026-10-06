// Turns an API error response into one line a user can act on. Validation
// errors come back as { error: { message: "Validation failed", details:
// { field_name: ["reason", ...] } } } — showing only "Validation failed"
// left people unable to tell which field was wrong (or whether anything
// they did was wrong at all), so this names each offending field.
export function describeApiError(body: unknown, fallback: string): string {
  const error = (body as { error?: { message?: unknown; details?: unknown } } | null)?.error;
  const details = error?.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const fields = Object.entries(details as Record<string, unknown>)
      .map(([field, reasons]) => {
        const reason = Array.isArray(reasons) && typeof reasons[0] === "string" ? simplifyReason(reasons[0]) : "";
        return reason ? `${fieldLabel(field)} (${reason})` : fieldLabel(field);
      })
      .filter(Boolean);
    if (fields.length > 0) return `Couldn't save — please check: ${fields.join(", ")}.`;
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function fieldLabel(field: string): string {
  return field
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Zod's default messages are written for developers ("Invalid input:
// expected string, received null", "Too small: expected string to have
// >=2 characters") — reduce the common ones to plain words.
function simplifyReason(reason: string): string {
  if (/too small|>=/i.test(reason)) return "too short";
  if (/too big|<=/i.test(reason)) return "too long";
  if (/email/i.test(reason)) return "not a valid email address";
  if (/expected .*received (null|undefined)|required/i.test(reason)) return "missing";
  if (/invalid option|expected one of/i.test(reason)) return "not one of the allowed choices";
  if (/cuid|invalid (string|input)/i.test(reason)) return "invalid value";
  return reason.toLowerCase();
}
