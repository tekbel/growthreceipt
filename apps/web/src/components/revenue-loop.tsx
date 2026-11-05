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
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
    copy: "Each approved post gets its own buy link, so a later purchase stays tied to the post. With LinkedIn connected, approved posts can publish on their scheduled day. For other channels you copy and post.",
    hold: 1800,
  },
  {
    label: "Customer checkout",
    actor: "Buyer",
    icon: SiPaypal,
    copy: "A customer opens the link and pays with PayPal, in the PayPal sandbox for the demo. The price comes from GrowthReceipt's server, so the page cannot change it.",
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
    copy: "Order, capture, webhook, campaign, offer and the post that earned it form one receipt. The post now shows verified revenue.",
    hold: 1800,
  },
  {
    label: "Next move",
    actor: "Agent",
    role: "Next move agent",
    icon: TrendingUp,
    copy: "GrowthReceipt ranks the posts customers bought from and rates the evidence as early, a clear leader, a tie or mixed. The agent checks the orders it cites with PayPal, then proposes your next post, for example the same angle again or a different offer, with its reason and confidence.",
    hold: 2200,
  },
  {
    label: "You decide",
    actor: "You",
    icon: UserCheck,
    copy: "Approve, edit or reject the move. The agent may also suggest a different offer, but only one from your catalog that customers have bought at least once.",
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

// One clock drives the whole loop. Each stage starts with the dot travelling from the previous
// stage for MOVE milliseconds, then it rests there for the remainder of the stage's hold.
const MOVE = 700;
const starts = stages.map((_, position) =>
  stages.slice(0, position).reduce((sum, item) => sum + item.hold, 0),
);
const TOTAL = starts[starts.length - 1] + stages[stages.length - 1].hold;
const CREDIT_STAGE = stages.findIndex((item) => item.label === "Revenue attributed");
const AMOUNT = 9;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (t: number) => Math.min(Math.max(t, 0), 1);

function stageAt(elapsed: number): number {
  let position = 0;
  while (position < starts.length - 1 && starts[position + 1] <= elapsed) position += 1;
  return position;
}

type Point = { x: number; y: number };
type Track = { centers: Point[]; lengths: number[]; closing: number };

// Sample values that show what a receipt holds. They are labelled as an example on screen.
const receiptRows: {
  label: string;
  from: number;
  value: (index: number) => string;
  check?: boolean;
}[] = [
  { label: "Post", from: 3, value: () => "Day 1 LinkedIn post" },
  { label: "Buy link", from: 3, value: () => "Unique to this post" },
  { label: "Checkout", from: 4, value: () => "Paid with PayPal" },
  { label: "Capture", from: 5, value: () => "Completed" },
  { label: "Webhook", from: 5, value: () => "Signature verified", check: true },
  { label: "Credited to", from: CREDIT_STAGE, value: () => "Day 1 post" },
  { label: "Evidence", from: 7, value: () => "Early signal" },
  {
    label: "Next move",
    from: 8,
    value: (index) => (index > 8 ? "Approved" : "Waiting for you"),
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
  const map = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const total = useRef<HTMLSpanElement>(null);
  const clock = useRef(0);
  const track = useRef<Track | null>(null);
  const indexRef = useRef(0);
  const playingRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [path, setPath] = useState("");
  const last = stages.length - 1;
  const stage = stages[index];
  playingRef.current = playing;

  // Writes the frame for a point in time straight to the DOM, so the dot, the trail, the
  // progress ring and the counter move every frame without rerendering React.
  const paint = useCallback(
    (elapsed: number) => {
      const position = stageAt(elapsed);
      const local = elapsed - starts[position];
      if (position !== indexRef.current) {
        indexRef.current = position;
        setIndex(position);
      }
      map.current?.style.setProperty("--t", String(clamp(local / stages[position].hold)));
      if (total.current) {
        const counting = position === CREDIT_STAGE && playingRef.current;
        const share = counting
          ? ease(clamp((local - MOVE) / 900))
          : position >= CREDIT_STAGE
            ? 1
            : 0;
        total.current.textContent = `$${(AMOUNT * share).toFixed(2)}`;
      }
      const geometry = track.current;
      if (!geometry || !dot.current || !trail.current) return;
      const { centers, lengths, closing } = geometry;
      const travel = position === 0 ? 1 : ease(clamp(local / MOVE));
      const from = centers[Math.max(position - 1, 0)];
      const to = centers[position];
      const x = from.x + (to.x - from.x) * travel;
      const y = from.y + (to.y - from.y) * travel;
      dot.current.style.transform = `translate(${x}px, ${y}px)`;
      let drawn = lengths
        .slice(0, Math.max(position - 1, 0))
        .reduce((sum, value) => sum + value, 0);
      if (position > 0) drawn += lengths[position - 1] * travel;
      if (position === last && closing) {
        drawn += closing * ease(clamp((local - MOVE) / (stages[last].hold - MOVE)));
      }
      trail.current.style.strokeDasharray = `${drawn} 100000`;
    },
    [last],
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // Measures where each stage mark sits, so the path follows the layout on any screen size.
  useLayoutEffect(() => {
    const element = map.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const centers = [...element.querySelectorAll<HTMLElement>(".loop-mark")].map((mark) => {
        const rect = mark.getBoundingClientRect();
        return {
          x: rect.left - box.left + rect.width / 2,
          y: rect.top - box.top + rect.height / 2,
        };
      });
      if (centers.length !== stages.length) return;
      const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
      const lengths = centers.slice(1).map((point, position) => distance(centers[position], point));
      // On wide screens the second row runs back towards the first stage, so the loop can close.
      const closes = centers[last].x < centers[5].x - 1;
      track.current = {
        centers,
        lengths,
        closing: closes ? distance(centers[last], centers[0]) : 0,
      };
      const points = closes ? [...centers, centers[0]] : centers;
      setPath(
        points.map((point, position) => `${position ? "L" : "M"}${point.x} ${point.y}`).join(" "),
      );
      paint(clock.current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [last, paint]);

  useEffect(() => {
    if (!playing) {
      paint(clock.current);
      return;
    }
    if (clock.current >= TOTAL) clock.current = 0;
    let previous = performance.now();
    let frame = window.requestAnimationFrame(function tick(now) {
      clock.current = Math.min(clock.current + now - previous, TOTAL);
      previous = now;
      paint(clock.current);
      if (clock.current >= TOTAL) setPlaying(false);
      else frame = window.requestAnimationFrame(tick);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [playing, paint]);

  // A hidden tab pauses the loop so it never plays unseen.
  useEffect(() => {
    const pause = () => document.hidden && setPlaying(false);
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);

  function show(next: number) {
    const position = Math.min(Math.max(next, 0), last);
    clock.current = starts[position] + (position ? MOVE : 0);
    setPlaying(false);
    paint(clock.current);
  }

  function restart() {
    clock.current = 0;
    paint(0);
    setPlaying(!prefersReducedMotion());
  }

  function togglePlay() {
    if (!playing && indexRef.current === last) clock.current = 0;
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

        <div
          ref={map}
          className="loop-map"
          data-ready={path ? true : undefined}
          data-glide={(path && !playing) || undefined}
        >
          <svg className="loop-track" aria-hidden="true">
            <path className="loop-track-base" d={path} />
            <path ref={trail} className="loop-trail" d={path} />
          </svg>
          <span ref={dot} className="loop-dot" aria-hidden="true" />
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
        </div>
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
          <aside className="loop-receipt" aria-label="Example receipt">
            <header>
              <span className="loop-receipt-title">Example receipt</span>
              <span className="loop-receipt-total">
                <span className="visually-hidden">Verified revenue </span>
                <span ref={total}>$0.00</span>
              </span>
            </header>
            <dl>
              {receiptRows.map((row) => (
                <div
                  key={row.label}
                  className="loop-receipt-row"
                  data-shown={index >= row.from || undefined}
                >
                  <dt>{row.label}</dt>
                  <dd>
                    {row.check ? (
                      <svg className="loop-receipt-check" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
                      </svg>
                    ) : null}
                    {row.value(index)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="loop-receipt-note">Sample values. No real order.</p>
          </aside>
        </div>

        <footer className="loop-controls">
          <button className="button" type="button" onClick={togglePlay}>
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {playing ? "Pause" : index === last ? "Play again" : "Play"}
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
