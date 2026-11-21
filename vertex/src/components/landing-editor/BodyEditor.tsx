"use client";

import { ArrowDown, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
import { LANDING_ICONS } from "@/components/LandingParts";

/**
 * A form for a landing block's body (the landing CMS, part 3), drawn from
 * the block's built-in text: every field the built-in text has, a list
 * where it has a list (add, remove, reorder), an icon picker for "icon".
 * No form is written per block, so a block FastAPI adds is editable here
 * as it is. FastAPI checks what's saved (lengths, links, how many items):
 * its messages come back by field and show next to each.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Issues = Record<string, string[]>; // "cards.0.title" -> messages

const ICON_NAMES = Object.keys(LANDING_ICONS);

// Fields that read better as a paragraph box.
const LONG_FIELDS = new Set(["intro", "text", "a", "subtitle", "existing_text", "video_fallback", "empty_text"]);

const LABELS: Record<string, string> = {
  q: "Question",
  a: "Answer",
  href: "Link",
  cta: "Button",
  view_all: "“View all” link",
  more_link: "“More” link",
  more_text: "“More” text",
  existing_link: "Portal link",
  existing_title: "Existing partners: title",
  existing_text: "Existing partners: text",
  trust_line: "Trust line",
  video_alt: "Video description",
  video_fallback: "Text when the video can't play",
  video_chapters: "Video chapters",
  seconds: "Starts at (seconds)",
  whatsapp: "WhatsApp number",
  office: "Office number",
  marker: "Marker",
};

export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An empty item shaped like the template (a new list item). */
export function blank(template: Json): Json {
  if (typeof template === "string") return "";
  if (typeof template === "number") return 0;
  if (typeof template === "boolean") return false;
  if (Array.isArray(template)) return [];
  if (template && typeof template === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(template)) if (k !== "icon") out[k] = blank(v);
    return out;
  }
  return null;
}

const isObject = (v: unknown): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The list's item to copy the shape of: the built-in text's first, else the value's. */
const itemTemplate = (template: Json, value: Json | undefined): Json =>
  (Array.isArray(template) && template[0] !== undefined ? template[0] : Array.isArray(value) && value[0] !== undefined ? value[0] : "") as Json;

function itemTitle(item: Json, index: number): string {
  if (isObject(item)) {
    const name = item.title ?? item.label ?? item.q;
    if (typeof name === "string" && name.trim()) return `${index + 1}. ${name}`;
  }
  return `Item ${index + 1}`;
}

interface FieldProps {
  path: (string | number)[];
  value: Json | undefined;
  template: Json;
  onChange: (value: Json | undefined) => void;
  readOnly: boolean;
  issues: Issues;
}

function Messages({ path, issues }: { path: (string | number)[]; issues: Issues }) {
  const messages = issues[path.join(".")];
  if (!messages?.length) return null;
  return (
    <p className="text-xs text-red-600 mt-1" role="alert">
      {messages.join(" ")}
    </p>
  );
}

const inputClass =
  "w-full rounded-lg border border-midnight-900/15 bg-white px-3 py-2 text-sm text-midnight-900 focus:border-midnight-700 focus:outline-none disabled:bg-ivory-100 disabled:text-midnight-900/60";

export function FieldEditor({ path, value, template, onChange, readOnly, issues }: FieldProps) {
  const key = String(path[path.length - 1] ?? "");
  const id = `field-${path.join("-")}`;

  if (key === "icon") {
    return (
      <>
        <select id={id} className={inputClass} value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">No icon</option>
          {ICON_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Messages path={path} issues={issues} />
      </>
    );
  }

  if (typeof template === "number") {
    return (
      <>
        <input
          id={id}
          type="number"
          min={0}
          className={inputClass}
          value={typeof value === "number" ? value : ""}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
        <Messages path={path} issues={issues} />
      </>
    );
  }

  if (typeof template === "boolean") {
    return (
      <>
        <input id={id} type="checkbox" checked={value === true} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} />
        <Messages path={path} issues={issues} />
      </>
    );
  }

  if (Array.isArray(template)) {
    const items = Array.isArray(value) ? value : [];
    const shape = itemTemplate(template, value);
    const set = (next: Json[]) => onChange(next);
    return (
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-midnight-900/10 bg-ivory-50 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-midnight-900/50">{itemTitle(item, i)}</span>
              {!readOnly && (
                <span className="flex gap-1">
                  <button type="button" className="p-1.5 text-midnight-900/50 hover:text-midnight-900 disabled:opacity-30" disabled={i === 0}
                    onClick={() => set(items.map((x, j) => (j === i - 1 ? items[i] : j === i ? items[i - 1] : x)))} aria-label={`Move ${fieldLabel(key)} ${i + 1} up`}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="p-1.5 text-midnight-900/50 hover:text-midnight-900 disabled:opacity-30" disabled={i === items.length - 1}
                    onClick={() => set(items.map((x, j) => (j === i + 1 ? items[i] : j === i ? items[i + 1] : x)))} aria-label={`Move ${fieldLabel(key)} ${i + 1} down`}>
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" className="p-1.5 text-midnight-900/50 hover:text-red-600"
                    onClick={() => set(items.filter((_, j) => j !== i))} aria-label={`Remove ${fieldLabel(key)} ${i + 1}`}>
                    <Trash size={14} />
                  </button>
                </span>
              )}
            </div>
            <FieldEditor
              path={[...path, i]}
              value={item}
              template={shape}
              onChange={(v) => set(items.map((x, j) => (j === i ? (v ?? blank(shape)) : x)))}
              readOnly={readOnly}
              issues={issues}
            />
          </div>
        ))}
        {!readOnly && (
          <button type="button" onClick={() => set([...items, blank(shape)])}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-midnight-700 hover:text-gold-600">
            <Plus size={14} weight="bold" /> Add {items.length ? "another" : "one"}
          </button>
        )}
        <Messages path={path} issues={issues} />
      </div>
    );
  }

  if (isObject(template)) {
    const current = isObject(value) ? value : {};
    const keys = [...Object.keys(template), ...Object.keys(current).filter((k) => !(k in template))];
    return (
      <div className="space-y-4">
        {keys.map((k) => {
          const childPath = [...path, k];
          const nested = Array.isArray(template[k] ?? current[k]) || isObject(template[k] ?? current[k]);
          return (
            <div key={k}>
              <label htmlFor={`field-${childPath.join("-")}`} className="block text-xs font-semibold text-midnight-900/70 mb-1.5">
                {fieldLabel(k)}
              </label>
              <div className={nested ? "pl-3 border-l-2 border-midnight-900/10" : undefined}>
                <FieldEditor
                  path={childPath}
                  value={current[k]}
                  template={(template[k] ?? current[k]) as Json}
                  onChange={(v) => {
                    const next = { ...current };
                    if (v === undefined) delete next[k];
                    else next[k] = v;
                    onChange(next);
                  }}
                  readOnly={readOnly}
                  issues={issues}
                />
              </div>
            </div>
          );
        })}
        <Messages path={path} issues={issues} />
      </div>
    );
  }

  // Text: one line, or a paragraph box for the long ones (a line break is kept).
  const text = typeof value === "string" ? value : "";
  const long = LONG_FIELDS.has(key) || (typeof template === "string" && (template.length > 90 || template.includes("\n")));
  return (
    <>
      {long ? (
        <textarea id={id} rows={Math.min(8, Math.max(3, Math.ceil(text.length / 90) + 1))} className={inputClass} value={text} disabled={readOnly}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type="text" className={inputClass} value={text} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
      )}
      <Messages path={path} issues={issues} />
    </>
  );
}

/** FastAPI's issues ({loc, msg}) by field path; a field-less one under "". */
export function issuesByPath(issues: { loc: (string | number)[]; msg: string }[] | undefined): Issues {
  const out: Issues = {};
  for (const issue of issues ?? []) {
    // pydantic names a union's branch in loc ("str", "function-after[...]"): leave those out.
    const path = issue.loc.filter((part) => typeof part === "number" || !/[\[\]]|^(str|int|none|function-)/.test(String(part)));
    const at = path.join(".");
    (out[at] ??= []).push(issue.msg.replace(/^Value error, /, ""));
  }
  return out;
}
