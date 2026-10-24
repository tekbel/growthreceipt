"use client";

import { Check, X } from "lucide-react";
import { useEffect, useId } from "react";
import type { WorkflowStep, WorkflowStepId } from "@/lib/workflow";

const SEEN_KEY = "growthreceipt.tour-seen";
const STEP_KEY = "growthreceipt.tour-step";

// What the tour says at each step, written for someone opening the demo for the first time.
const tourCopy: Record<WorkflowStepId, string> = {
  product:
    "GrowthReceipt drafts launch posts, gives each one its own buy link, and traces every PayPal purchase back to the post that earned it. This demo comes with LaunchCheck, a sample product.",
  content:
    "These are the drafted posts. Each approved post gets a tracked buy link, so a sale is credited to the exact post a customer clicked.",
  purchase:
    "Buy LaunchCheck as a customer would, with the PayPal sandbox buyer. No real money moves.",
  results:
    "Each verified purchase is traced to the post that earned it, with the PayPal capture as proof.",
  next: "Find next move asks the agent for one next experiment, based only on verified purchases. It runs a live OpenAI call, so it takes a few seconds.",
};

// What a step is waiting for until the real state changes. Steps without an entry need no action.
// The next move needs a verified purchase first, so its line follows the purchase step.
function waitingCopy(id: WorkflowStepId, purchased: boolean) {
  if (id === "purchase")
    return "Waiting for your purchase. This step turns to done once PayPal confirms it.";
  if (id === "results") return "Your purchase shows up here once PayPal confirms it.";
  if (id === "next")
    return purchased
      ? "Waiting for you to run Find next move."
      : "Unlocks after your first verified purchase.";
  return null;
}

// The tour opens on its own only once per browser, so a reload or a demo reset never reopens it.
export function takeFirstTour() {
  try {
    if (localStorage.getItem(SEEN_KEY) === "1") return false;
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage can be blocked. The tour then opens on every visit, which is harmless.
  }
  return true;
}

// The open step is shared by every tab, so the tour continues in the tab the checkout opens
// and after a reload. Closing the tour clears it.
export function savedTourStep() {
  try {
    const saved = localStorage.getItem(STEP_KEY);
    return saved === null ? null : Number(saved);
  } catch {
    return null;
  }
}

export function saveTourStep(index: number | null) {
  try {
    if (index === null) localStorage.removeItem(STEP_KEY);
    else localStorage.setItem(STEP_KEY, String(index));
  } catch {}
}

export function GuidedTour({
  steps,
  index,
  onStep,
  onClose,
}: {
  steps: WorkflowStep[];
  index: number;
  onStep: (index: number) => void;
  onClose: () => void;
}) {
  const step = steps[index];
  const titleId = useId();
  const last = index === steps.length - 1;
  const purchased = steps.some((item) => item.id === "purchase" && item.complete);
  const waiting = step.complete ? null : waitingCopy(step.id, purchased);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Rings the step's target. Some targets appear later, such as receipts after a purchase,
  // so the page is watched until it shows up. Scrolls to it once, the first time it is found.
  useEffect(() => {
    let marked: HTMLElement | null = null;
    const mark = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`);
      if (target === marked) return;
      marked?.removeAttribute("data-tour-active");
      if (target) {
        target.setAttribute("data-tour-active", "");
        if (!marked) {
          const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
        }
      }
      marked = target;
    };
    const frame = requestAnimationFrame(mark);
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      marked?.removeAttribute("data-tour-active");
    };
  }, [step.id]);

  return (
    <aside className="tour-card" aria-labelledby={titleId}>
      <header>
        <span className="eyebrow">
          Tour · Step {index + 1} of {steps.length}
        </span>
        <button type="button" onClick={onClose} aria-label="Close tour">
          <X aria-hidden="true" />
        </button>
      </header>
      <div aria-live="polite">
        <h2 id={titleId}>
          {step.title}
          {step.complete ? (
            <span className="status-tag success">
              <Check aria-hidden="true" /> Done
            </span>
          ) : null}
        </h2>
        <p>{tourCopy[step.id]}</p>
        {waiting ? (
          <p className="tour-waiting">
            <span aria-hidden="true" />
            {waiting}
          </p>
        ) : null}
      </div>
      <footer>
        <button
          className="text-button muted"
          type="button"
          disabled={index === 0}
          onClick={() => onStep(index - 1)}
        >
          Back
        </button>
        <button
          className="button dark"
          type="button"
          onClick={() => (last ? onClose() : onStep(index + 1))}
        >
          {last ? "Finish" : "Next"}
        </button>
      </footer>
    </aside>
  );
}
