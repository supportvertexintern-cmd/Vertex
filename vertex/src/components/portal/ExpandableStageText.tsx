"use client";

import { useState } from "react";

const MAX_STAGE_LENGTH = 50;

export default function ExpandableStageText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= MAX_STAGE_LENGTH) return <span className="wrap-break-word">{text}</span>;

  return (
    <span className="wrap-break-word">
      {expanded ? text : `${text.slice(0, MAX_STAGE_LENGTH - 3).trimEnd()}...`}{" "}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="font-semibold text-gold-600 hover:underline whitespace-nowrap"
      >
        {expanded ? "Show Less" : "Show More"}
      </button>
    </span>
  );
}