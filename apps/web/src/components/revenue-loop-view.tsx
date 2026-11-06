"use client";

import {
  Check,
  ClipboardList,
  Link2,
  type LucideIcon,
  PenLine,
  ReceiptText,
  ShieldCheck,
  TrendingUp,
  UserCheck,
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

export type Stage = {
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
export const stages: Stage[] = [
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
export const LAST = stages.length - 1;
// The first half runs left to right, the second half comes back right to left, so the path closes.
const HALF = Math.ceil(stages.length / 2);

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

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The clock, the measured track and the frame painter shared by the dialog and the hero. */
export function useLoopClock(initialPlaying: boolean | (() => boolean)) {
  const map = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const total = useRef<HTMLSpanElement>(null);
  const clock = useRef(0);
  const track = useRef<Track | null>(null);
  const indexRef = useRef(0);
  const playingRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(initialPlaying);
  const [path, setPath] = useState("");
  playingRef.current = playing;

  // Writes the frame for a point in time straight to the DOM, so the dot, the trail, the
  // progress ring and the counter move every frame without rerendering React.
  const paint = useCallback((elapsed: number) => {
    const position = stageAt(elapsed);
    const local = elapsed - starts[position];
    if (position !== indexRef.current) {
      indexRef.current = position;
      setIndex(position);
    }
    map.current?.style.setProperty("--t", String(clamp(local / stages[position].hold)));
    if (total.current) {
      const counting = position === CREDIT_STAGE && playingRef.current;
      const share = counting ? ease(clamp((local - MOVE) / 900)) : position >= CREDIT_STAGE ? 1 : 0;
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
    let drawn = lengths.slice(0, Math.max(position - 1, 0)).reduce((sum, value) => sum + value, 0);
    if (position > 0) drawn += lengths[position - 1] * travel;
    if (position === LAST && closing) {
      drawn += closing * ease(clamp((local - MOVE) / (stages[LAST].hold - MOVE)));
    }
    trail.current.style.strokeDasharray = `${drawn} 100000`;
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
      // In two rows the second row runs back towards the first stage, so the loop can close.
      const closes = centers[LAST].x < centers[HALF].x - 1;
      track.current = {
        centers,
        lengths,
        closing: closes ? distance(centers[LAST], centers[0]) : 0,
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
  }, [paint]);

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

  const show = useCallback(
    (next: number) => {
      const position = Math.min(Math.max(next, 0), LAST);
      clock.current = starts[position] + (position ? MOVE : 0);
      setPlaying(false);
      paint(clock.current);
    },
    [paint],
  );

  const finish = useCallback(() => {
    clock.current = TOTAL;
    setPlaying(false);
    paint(TOTAL);
  }, [paint]);

  const restart = useCallback(() => {
    clock.current = 0;
    paint(0);
    setPlaying(!prefersReducedMotion());
  }, [paint]);

  const done = useCallback(() => clock.current >= TOTAL, []);

  const togglePlay = useCallback(() => {
    if (!playingRef.current && indexRef.current === LAST) clock.current = 0;
    setPlaying(!playingRef.current);
  }, []);

  return {
    refs: { map, dot, trail, total },
    index,
    playing,
    setPlaying,
    path,
    done,
    show,
    finish,
    restart,
    togglePlay,
  };
}

export type LoopClock = ReturnType<typeof useLoopClock>;

/** The stage map with the measured track, the trail, the moving dot and the progress ring. */
export function LoopMap({
  loop,
  onSelect,
}: {
  loop: LoopClock;
  onSelect?: (index: number) => void;
}) {
  const { refs, index, playing, path } = loop;
  return (
    <div
      ref={refs.map}
      className="loop-map"
      data-ready={path ? true : undefined}
      data-glide={(path && !playing) || undefined}
    >
      <svg className="loop-track" aria-hidden="true">
        <path className="loop-track-base" d={path} />
        <path ref={refs.trail} className="loop-trail" d={path} />
      </svg>
      <span ref={refs.dot} className="loop-dot" aria-hidden="true" />
      <ol className="loop-stages" data-playing={playing || undefined}>
        {stages.map((item, position) => {
          const StageIcon = item.icon;
          const state = position < index ? "done" : position === index ? "active" : "next";
          const body = (
            <>
              <span className="loop-mark">
                {state === "done" ? <Check aria-hidden="true" /> : <StageIcon aria-hidden="true" />}
              </span>
              <span className="loop-copy">
                <span className="loop-label">{item.label}</span>
                <span className="loop-actor">
                  {item.approval ? "Waits for you" : (item.role ?? item.actor)}
                </span>
              </span>
            </>
          );
          return (
            <li
              key={item.label}
              className="loop-stage"
              data-state={state}
              data-approval={item.approval || undefined}
              style={
                {
                  "--col": position < HALF ? position + 1 : stages.length - position,
                  "--row": position < HALF ? 1 : 2,
                } as CSSProperties
              }
            >
              {onSelect ? (
                <button
                  className="loop-target"
                  type="button"
                  aria-current={position === index ? "step" : undefined}
                  onClick={() => onSelect(position)}
                >
                  {body}
                </button>
              ) : (
                <span className="loop-target">{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The sample receipt that fills in as the loop plays. The dialog names it as a landmark. */
export function LoopReceipt({ loop, labelled }: { loop: LoopClock; labelled?: boolean }) {
  const { refs, index } = loop;
  const Box = labelled ? "aside" : "div";
  return (
    <Box className="loop-receipt" aria-label={labelled ? "Example receipt" : undefined}>
      <header>
        <span className="loop-receipt-title">Example receipt</span>
        <span className="loop-receipt-total">
          <span className="visually-hidden">Verified revenue </span>
          <span ref={refs.total}>$0.00</span>
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
    </Box>
  );
}
