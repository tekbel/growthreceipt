"use client";

import { Check, Link2, Pause, Play, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SiPaypal, SiX } from "react-icons/si";
import {
  nextChange,
  SEQUENCE_END,
  STAGE_COUNT,
  STAGE_STARTS,
  type StageStatus,
  stageAt,
  stageStatus,
} from "@/lib/hero-sequence";

type Stage = { title: string; copy: string; detail: ReactNode };

// Example values that mirror the approved Day 3 X post in the seeded judge demo.
// This is a picture of the flow only. It never creates an order or touches a workspace.
const stages: Stage[] = [
  {
    title: "Approved post",
    copy: "You approve the post before it goes out.",
    detail: (
      <>
        <span className="seq-meta">
          <SiX aria-hidden="true" />
          Day 3 on X
        </span>
        <q>Before you post your launch link, paste it into LaunchCheck.</q>
      </>
    ),
  },
  {
    title: "Customer checkout",
    copy: "A buyer follows the post's own link and pays with PayPal.",
    detail: (
      <>
        <span className="seq-meta">
          <Link2 aria-hidden="true" />
          <code>/buy/day-3-x</code>
        </span>
        <span className="seq-meta">
          <SiPaypal aria-hidden="true" />
          PayPal sandbox, 10 scans for $9.00
        </span>
      </>
    ),
  },
  {
    title: "Payment verified",
    copy: "PayPal confirms the payment, and the sale is credited to its post.",
    detail: (
      <>
        <span className="seq-meta seq-ok">
          <Check aria-hidden="true" />
          Capture completed
        </span>
        <span className="seq-meta seq-ok">
          <Check aria-hidden="true" />
          Webhook verified
        </span>
        <span className="seq-amount">
          $9.00 <small>credited to Day 3 on X</small>
        </span>
      </>
    ),
  },
  {
    title: "Next recommendation",
    copy: "The agent proposes one test and waits for your approval.",
    detail: (
      <>
        <q>Repeat the Day 3 angle in a LinkedIn post.</q>
        <span className="seq-meta">Early signal from 1 purchase</span>
      </>
    ),
  },
];

const statusLabel: Record<StageStatus, string> = {
  done: "Done",
  active: "Now",
  pending: "Up next",
  waiting: "Waits for you",
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Four example stages, from an approved post to the next recommendation. Plays once when the hero
 * is in view, then holds the finished state. Reduced motion shows the finished diagram instead.
 */
export function HeroSequence() {
  const root = useRef<HTMLElement>(null);
  const remaining = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  // Bumped on replay, so the timer bar restarts even when the stage index is the same.
  const [runId, setRunId] = useState(0);
  const current = stageAt(elapsed);
  const finished = current >= STAGE_COUNT;
  const running = started && !manualPause && onScreen && !finished;

  // Runs before the first paint, so reduced motion never sees the partial start.
  useLayoutEffect(() => {
    if (prefersReducedMotion()) setElapsed(SEQUENCE_END);
  }, []);

  // Starts once at 35 percent visible. Leaving view or hiding the tab only pauses it.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let inView = false;
    const update = () => setOnScreen(inView && !document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView && !prefersReducedMotion()) setStarted(true);
        update();
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // One timer per stage. A pause keeps the time left, so resuming continues the same stage.
  useEffect(() => {
    if (!running) return;
    const target = nextChange(elapsed);
    if (target === null) return;
    const delay = remaining.current ?? target - elapsed;
    remaining.current = null;
    const begin = performance.now();
    let fired = false;
    const timer = window.setTimeout(() => {
      fired = true;
      setElapsed(target);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      if (!fired) remaining.current = Math.max(0, delay - (performance.now() - begin));
    };
  }, [running, elapsed]);

  const replay = () => {
    remaining.current = null;
    setElapsed(0);
    setManualPause(false);
    setStarted(true);
    setRunId((id) => id + 1);
  };

  const announcement = !started
    ? ""
    : finished
      ? "All four steps shown. The next recommendation waits for your approval."
      : `Step ${current + 1} of ${STAGE_COUNT}: ${stages[current].title}`;

  return (
    <section ref={root} className="seq" aria-labelledby="seq-title">
      <div className="seq-head">
        <h2 id="seq-title">How one sale is traced</h2>
        <span className="seq-sample">Example values. No real order was placed.</span>
      </div>
      <ol className="seq-list">
        {stages.map((stage, index) => {
          const status = stageStatus(index, current);
          return (
            <li
              key={stage.title}
              className="seq-card"
              data-status={status}
              data-reached={(index > 0 && current >= index) || undefined}
            >
              {index > 0 ? (
                <svg
                  className="seq-link"
                  data-drawn={current >= index || undefined}
                  viewBox="0 0 2 16"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line x1="1" y1="0" x2="1" y2="16" pathLength={1} />
                </svg>
              ) : null}
              <span className="seq-num" aria-hidden="true">
                {status === "done" ? (
                  <svg className="seq-check" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <div className="seq-top">
                <h3>
                  <span className="visually-hidden">Step {index + 1}. </span>
                  {stage.title}
                </h3>
                <span className="seq-status">{statusLabel[status]}</span>
              </div>
              <p>{stage.copy}</p>
              <div className="seq-detail">{stage.detail}</div>
              {started && status === "active" ? (
                <span
                  key={`${runId}-${stage.title}`}
                  className="seq-timer"
                  aria-hidden="true"
                  style={{
                    animationDuration: `${(nextChange(STAGE_STARTS[index]) ?? SEQUENCE_END) - STAGE_STARTS[index]}ms`,
                    animationPlayState: running ? "running" : "paused",
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="seq-foot">
        <button className="button ghost seq-control" type="button" onClick={replay}>
          <RotateCcw aria-hidden="true" />
          Replay sequence
        </button>
        {started && !finished ? (
          <button
            className="button ghost seq-control"
            type="button"
            onClick={() => setManualPause((paused) => !paused)}
          >
            {manualPause ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {manualPause ? "Resume" : "Pause"}
          </button>
        ) : null}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </div>
    </section>
  );
}
