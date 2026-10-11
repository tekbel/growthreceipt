"use client";

import { Info } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/**
 * A small "i" that explains a control. Hover or keyboard focus shows it on desktop,
 * a tap toggles it on touch screens, and Escape closes it.
 */
export function InfoTip({
  label = "More information",
  align = "center",
  children,
}: {
  label?: string;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={`tip-anchor info-tip align-${align}${open ? " open" : ""}`}>
      <button
        className="info-tip-button"
        type="button"
        aria-label={label}
        aria-describedby={tipId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <Info aria-hidden="true" />
      </button>
      <span className="tip" id={tipId} role="tooltip">
        {children}
      </span>
    </span>
  );
}
