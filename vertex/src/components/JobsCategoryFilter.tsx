"use client";

import { useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";

interface Props {
  categories: string[];
  defaultValue: string;
}

// The surrounding <form> on /jobs is a plain server-rendered GET form (no
// client-side routing) — this wraps just the category filter with a
// searchable combobox while keeping a hidden native input in sync, so the
// page doesn't need converting into a client component to get this.
export default function JobsCategoryFilter({ categories, defaultValue }: Props) {
  const [value, setValue] = useState(defaultValue);

  return (
    <>
      <input type="hidden" name="category" value={value} />
      <SearchableSelect
        value={value}
        onChange={setValue}
        placeholder="All Categories"
        className="input-field w-full md:w-56 text-sm"
        options={[{ value: "", label: "All Categories" }, ...categories.map((cat) => ({ value: cat, label: cat }))]}
      />
    </>
  );
}
