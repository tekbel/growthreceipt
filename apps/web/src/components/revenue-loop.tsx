"use client";

import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  LAST,
  LoopMap,
  LoopReceipt,
  prefersReducedMotion,
  stages,
  useLoopClock,
} from "@/components/revenue-loop-view";

/** The full loop in a dialog. It plays once, then holds the finished loop. */
export default function RevenueLoop({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const loop = useLoopClock(() => !prefersReducedMotion());
  const { index, playing, show, restart, togglePlay } = loop;
  const stage = stages[index];

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

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

        <LoopMap loop={loop} onSelect={show} />
        <p className="loop-return">
          <RotateCcw aria-hidden="true" />
          The new post returns to review and the loop starts again.
        </p>

        <div className="loop-body">
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
          <LoopReceipt loop={loop} labelled />
        </div>

        <footer className="loop-controls">
          <button className="button" type="button" onClick={togglePlay}>
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {playing ? "Pause" : index === LAST ? "Play again" : "Play"}
          </button>
          <button className="button loop-icon" type="button" aria-label="Restart" onClick={restart}>
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
            disabled={index === LAST}
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
