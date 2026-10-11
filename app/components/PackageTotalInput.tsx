"use client";

import { useState } from "react";

export default function PackageTotalInput({ name, total, onChange, className }: { name: string; total: number; onChange: (total: number) => void; className: string }) {
  const [draft, setDraft] = useState(String(total));
  const [editing, setEditing] = useState(false);

  return <input
    aria-label={`${name} total`}
    type="number"
    inputMode="decimal"
    min="0"
    step="0.01"
    value={editing ? draft : String(total)}
    onFocus={() => { setDraft(String(total)); setEditing(true); }}
    onChange={(event) => {
      const next = event.target.value;
      setDraft(next);
      if (next === "") {
        onChange(0);
        return;
      }
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
    }}
    onBlur={() => {
      setEditing(false);
    }}
    className={className}
  />;
}
