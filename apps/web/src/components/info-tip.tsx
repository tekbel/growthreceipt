"use client";

import { Info } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";

// Space kept between a tip and the screen edge.
const EDGE = 12;

/**
 * A small "i" that explains a control. Hover or keyboard focus shows it on desktop,
 * a tap toggles it on touch screens, and Escape closes it. Before it shows, the tip is measured and
 * nudged back inside the screen, and flipped below the button when there is no room above.
 */
export function InfoTip({
  label = "More information",
  align = "center",
  side = "top",
  children,
}: {
  label?: string;
  align?: "start" | "center" | "end";
  /** Opens below the button when there is no room above, such as in bars at the top of the page. */
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(side === "bottom");
  const tip = useRef<HTMLSpanElement>(null);

  // A hidden tip keeps its layout, so it can be measured before it fades in.
  function fit() {
    const element = tip.current;
    if (!element) return;
    element.style.setProperty("--tip-shift", "0px");
    const rect = element.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const shift =
      rect.left < EDGE
        ? EDGE - rect.left
        : rect.right > width - EDGE
          ? width - EDGE - rect.right
          : 0;
    element.style.setProperty("--tip-shift", `${Math.round(shift)}px`);
    if (side === "top") {
      const anchor = element.parentElement?.getBoundingClientRect();
      setBelow(Boolean(anchor && anchor.top - rect.height - 10 < EDGE));
    }
  }

  return (
    <span
      className={`tip-anchor info-tip align-${align} side-${below ? "bottom" : "top"}${open ? " open" : ""}`}
    >
      <button
        className="info-tip-button"
        type="button"
        aria-label={label}
        aria-describedby={tipId}
        aria-expanded={open}
        onPointerEnter={fit}
        onFocus={fit}
        onClick={() => {
          fit();
          setOpen((value) => !value);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <Info aria-hidden="true" />
      </button>
      <span className="tip" id={tipId} role="tooltip" ref={tip}>
        {children}
      </span>
    </span>
  );
}
