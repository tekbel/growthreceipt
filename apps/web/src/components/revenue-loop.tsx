"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Link2,
  type LucideIcon,
  Pause,
  PenLine,
  Play,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import { SiPaypal } from "react-icons/si";

type Actor = "You" | "Agent" | "Buyer" | "PayPal" | "GrowthReceipt";

type Stage = {
  label: string;
  actor: Actor;
  role?: string;
  icon: LucideIcon | IconType;
  copy: string;
  /** Milliseconds the stage stays active while playing. */
  hold: number;
  approval?: boolean;
};

// Checked against the build on 2026-10-25. Every claim here must match the judged product.
const stages: Stage[] = [
  {
    label: "Brief",
    actor: "You",
    icon: ClipboardList,
    copy: "You describe the product, audience, goal, channels and voice. Or paste your product page and the brief agent suggests a brief for you to edit.",
    hold: 1800,
  },
  {
    label: "Campaign drafted",
    actor: "Agent",
    role: "Campaign agent",
    icon: PenLine,
    copy: "One agent run sets the positioning, then drafts one post per day across your channels. Every draft waits in review.",
    hold: 1800,
  },
  {
    label: "You approve",
    actor: "You",
    icon: UserCheck,
    copy: "Approve or edit each post, or ask for changes with a note and the revision agent rewrites it. Nothing gets a buy link or publishes without your approval.",
    hold: 3000,
    approval: true,
  },
  {
    label: "Buy link per post",
    actor: "GrowthReceipt",
    icon: Link2,
    copy: "Each approved post gets its own buy link, so a later purchase stays tied to the message. LinkedIn posts publish in one click. For other channels you copy and post.",
    hold: 1800,
  },
  {
    label: "Customer checkout",
    actor: "Buyer",
    icon: SiPaypal,
    copy: "A customer opens the link and pays with PayPal, in the PayPal sandbox for the demo. The price comes from the server catalog, never the page.",
    hold: 1800,
  },
  {
    label: "Payment verified",
    actor: "PayPal",
    icon: ShieldCheck,
    copy: "GrowthReceipt creates and captures the order on the server. PayPal sends a signed webhook, and its signature is checked before the payment counts as evidence.",
    hold: 2200,
  },
  {
    label: "Revenue attributed",
    actor: "GrowthReceipt",
    icon: ReceiptText,
    copy: "Order, capture, webhook, campaign, offer and the post that sold form one receipt. The post now shows verified revenue.",
    hold: 1800,
  },
  {
    label: "Next move",
    actor: "Agent",
    role: "Next move agent",
    icon: TrendingUp,
    copy: "Code ranks the paying posts and labels the evidence as early, a clear leader or a tie. The agent checks the orders it cites with PayPal, then proposes one experiment with its reason and confidence.",
    hold: 2200,
  },
  {
    label: "You decide",
    actor: "You",
    icon: UserCheck,
    copy: "Approve, edit or reject the move. An offer switch is optional, comes only from the existing catalog and needs at least one purchase behind it.",
    hold: 3000,
    approval: true,
  },
  {
    label: "Next post",
    actor: "Agent",
    role: "Follow up agent",
    icon: PenLine,
    copy: "Once you approve, the agent drafts the follow up post. It goes back to review, gets its own buy link and starts the next round.",
    hold: 2400,
  },
];

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The full loop in a dialog. It plays once, then holds the finished loop. */
export default function RevenueLoop({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const last = stages.length - 1;
  const stage = stages[index];

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (index === last) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex((value) => value + 1), stage.hold);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, stage.hold]);

  // A hidden tab pauses the loop so it never plays unseen.
  useEffect(() => {
    const pause = () => document.hidden && setPlaying(false);
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);

  function show(next: number) {
    setPlaying(false);
    setIndex(Math.min(Math.max(next, 0), last));
  }

  function togglePlay() {
    if (!playing && index === last) setIndex(0);
    setPlaying(!playing);
  }

  const Icon = stage.icon;
  return (
    <dialog
      ref={dialog}
      className="loop-dialog"
      aria-labelledby="loop-title"
      aria-describedby="loop-intro"
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && dialog.current?.close()}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLButtonElement && event.target.closest(".loop-stages")) {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") show(index + 1);
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") show(index - 1);
        }
      }}
    >
      <div className="loop-panel">
        <header className="loop-head">
          <div>
            <h2 id="loop-title">From approved post to verified revenue</h2>
            <p id="loop-intro">
              See how GrowthReceipt turns a PayPal purchase into the next experiment you approve.
            </p>
          </div>
          <button
            className="button loop-icon"
            type="button"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <ol className="loop-stages" data-playing={playing || undefined}>
          {stages.map((item, position) => {
            const StageIcon = item.icon;
            const state = position < index ? "done" : position === index ? "active" : "next";
            return (
              <li
                key={item.label}
                className="loop-stage"
                data-state={state}
                data-approval={item.approval || undefined}
                style={{ "--i": position } as CSSProperties}
              >
                <button
                  type="button"
                  aria-current={position === index ? "step" : undefined}
                  onClick={() => show(position)}
                >
                  <span className="loop-mark">
                    {state === "done" ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <StageIcon aria-hidden="true" />
                    )}
                  </span>
                  <span className="loop-copy">
                    <span className="loop-label">{item.label}</span>
                    <span className="loop-actor">
                      {item.approval ? "Waits for you" : (item.role ?? item.actor)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="loop-return">
          <RotateCcw aria-hidden="true" />
          The new post returns to review and the loop starts again.
        </p>

        <section
          className="loop-detail"
          data-approval={stage.approval || undefined}
          aria-live={playing ? "off" : "polite"}
          key={index}
        >
          <span className="loop-detail-icon">
            <Icon aria-hidden="true" />
          </span>
          <div>
            <p className="loop-detail-actor">
              {stage.approval ? "Human approval" : (stage.role ?? stage.actor)}
            </p>
            <h3>{stage.label}</h3>
            <p>{stage.copy}</p>
          </div>
        </section>

        <footer className="loop-controls">
          <button className="button" type="button" onClick={togglePlay}>
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {playing ? "Pause" : index === last ? "Play again" : "Play"}
          </button>
          <button
            className="button loop-icon"
            type="button"
            aria-label="Restart"
            onClick={() => {
              setIndex(0);
              setPlaying(!prefersReducedMotion());
            }}
          >
            <RotateCcw aria-hidden="true" />
          </button>
          <span className="loop-count" aria-live="off">
            {index + 1} of {stages.length}
          </span>
          <button
            className="button loop-icon"
            type="button"
            aria-label="Previous step"
            disabled={index === 0}
            onClick={() => show(index - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            className="button loop-icon"
            type="button"
            aria-label="Next step"
            disabled={index === last}
            onClick={() => show(index + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </footer>

        <details className="loop-text">
          <summary>Read the loop as text</summary>
          <ol>
            {stages.map((item) => (
              <li key={item.label}>
                <strong>{item.label}.</strong> {item.copy}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </dialog>
  );
}
