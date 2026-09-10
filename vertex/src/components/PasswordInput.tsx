"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";

type Props = InputHTMLAttributes<HTMLInputElement>;

// A password <input> with a show/hide toggle — used anywhere a user types
// a password (login, register) so they can check what they typed before
// submitting, rather than the field staying masked with no way to verify it.
export default function PasswordInput({ className, ...props }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${className ?? "input-field"} pr-11`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-midnight-900/35 hover:text-midnight-900/70 transition-colors"
      >
        {visible ? <EyeSlash size={18} weight="regular" /> : <Eye size={18} weight="regular" />}
      </button>
    </div>
  );
}
