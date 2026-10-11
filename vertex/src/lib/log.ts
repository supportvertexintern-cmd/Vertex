import { redact, redactString } from "./redact";
import { currentRequest } from "./request-context";

// Structured application logs (Phase 10): one JSON object per line on
// stdout (stderr for warn and above), the same shape as the FastAPI
// service's (vertex_be/app/core/logging.py):
//
//   {"ts", "level", "service", "env", "event", "request_id", ...fields}
//
// `event` is a stable dotted name (auth.login_failed, alert.raised) to
// search and alert on; details go in fields, never in the event name.
// Every field passes through redact(), and logging never throws: a broken
// log line must not change what the request does.

export type LogLevel = "debug" | "info" | "warn" | "error" | "alert";
type Fields = Record<string, unknown> & { request_id?: string | null };

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, alert: 50 };

function minLevel(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  return ORDER[configured ?? "info"] ?? ORDER.info;
}

// Test hook: replaces the output stream.
let sink: ((line: string, level: LogLevel) => void) | null = null;
export function setLogSink(fn: ((line: string, level: LogLevel) => void) | null): void {
  sink = fn;
}

function write(level: LogLevel, record: Record<string, unknown>): void {
  try {
    const line = JSON.stringify(record);
    if (sink) return sink(line, level);
    (ORDER[level] >= ORDER.warn ? process.stderr : process.stdout).write(line + "\n");
  } catch {
    // Nothing sensible left to do; never let logging throw.
  }
}

export function emit(level: LogLevel, event: string, fields: Fields = {}): void {
  try {
    if (ORDER[level] < minLevel()) return;
    const { request_id, ...rest } = fields;
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      service: "nextjs",
      env: process.env.APP_ENV || process.env.NODE_ENV || "unknown",
      event: redactString(String(event)),
      ...(redact(rest) as Record<string, unknown>),
    };
    if (request_id !== undefined) {
      write(level, { ...record, request_id });
      return;
    }
    // No ID given: take it from the request this runs in, if any.
    currentRequest()
      .then((ctx) => write(level, { ...record, request_id: ctx.requestId }))
      .catch(() => write(level, record));
  } catch {
    // see write()
  }
}

export const log = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
  alert: (event: string, fields?: Fields) => emit("alert", event, fields),
};
