"use client";

import { ArrowRight, Check, ChevronDown, Clock, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import type { Post } from "@/lib/campaign";
import { formatMoment } from "@/lib/time";

import { InfoTip } from "./info-tip";
import { PostRef } from "./post-ref";

export type WebhookProof = {
  event_id: string;
  event_type: string;
  received_at: string;
};

export type Receipt = {
  order_id: string;
  capture_id: string;
  content_id: string;
  offer_id: string;
  amount: string;
  currency: string;
  ordered_at: string;
  captured_at: string;
  webhooks: WebhookProof[];
  // Completed refunds of this purchase. Older API responses lack it.
  refunded_amount?: string;
  // Refunds PayPal accepted but has not completed yet.
  pending_refund_amount?: string;
};

/** What the buyer kept after refunds. */
export function netAmount(receipt: Receipt): number {
  return Number(receipt.amount) - Number(receipt.refunded_amount ?? 0);
}

/** A fully refunded purchase is no longer revenue or evidence. */
export function countsAsRevenue(receipt: Receipt): boolean {
  return netAmount(receipt) > 0;
}

const refundConfirmed = (receipt: Receipt) =>
  receipt.webhooks.some((webhook) => webhook.event_type === "PAYMENT.CAPTURE.REFUNDED");

/** A refund PayPal is still processing, or one whose signed webhook is not stored yet. */
export function awaitingRefundUpdate(receipt: Receipt): boolean {
  if (Number(receipt.pending_refund_amount ?? 0) > 0) return true;
  return Number(receipt.refunded_amount ?? 0) > 0 && !refundConfirmed(receipt);
}

export type ProvenMove = { headline: string; at: string; decision?: "approved" | "rejected" };

const webhookLabels: Record<string, string> = {
  "CHECKOUT.ORDER.APPROVED": "PayPal reported the buyer approval",
  "CHECKOUT.ORDER.COMPLETED": "PayPal reported the order complete",
  "PAYMENT.CAPTURE.COMPLETED": "PayPal confirmed the payment",
  "PAYMENT.CAPTURE.REFUNDED": "PayPal confirmed the refund",
};

const stampOptions: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

function money(amount: number | string, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function at(value: string): string {
  return formatMoment(value, stampOptions);
}

/** A recommendation counts for a purchase only when the agent made it after the money arrived. */
export function moveFor(receipt: Receipt, move: ProvenMove | null): ProvenMove | null {
  return move && new Date(move.at) >= new Date(receipt.captured_at) ? move : null;
}

/** Real time since the work started, so a judge sees the agent is busy. Never a fake percentage. */
export function ElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return <span className="elapsed">{seconds} s</span>;
}

export function ReceiptChain({
  receipt,
  receipts,
  posts,
  move,
  moveLoading,
  onFindNextMove,
  onReview,
  onOpenPost,
  onRefund,
  proof = true,
}: {
  receipt: Receipt;
  receipts: Receipt[];
  posts: Post[];
  move: ProvenMove | null;
  moveLoading: boolean;
  onFindNextMove: () => void;
  onReview: () => void;
  onOpenPost?: (postId: string) => void;
  onRefund?: (orderId: string) => Promise<boolean>;
  proof?: boolean;
}) {
  const post = posts.find((item) => item.id === receipt.content_id);
  const fromPost = receipts.filter((item) => item.content_id === receipt.content_id);
  const postRevenue = fromPost.reduce((sum, item) => sum + netAmount(item), 0);
  const refunded = Number(receipt.refunded_amount ?? 0);
  const fresh = moveFor(receipt, move);
  const signal =
    receipts.length === 1
      ? "The first verified purchase of this campaign came from this post."
      : `${fromPost.length} of ${receipts.length} verified purchases came from this post, ${money(postRevenue, receipt.currency)} in total.`;

  return (
    <article
      className="receipt"
      aria-label={`PayPal purchase of ${money(netAmount(receipt), receipt.currency)}`}
    >
      <ol className="receipt-chain">
        <ChainStep label="Post" done>
          <strong>{post ? <PostRef post={post} onOpen={onOpenPost} /> : "Campaign post"}</strong>
          <span>{post?.theme ?? "This post is no longer in the campaign."}</span>
        </ChainStep>
        <ChainStep label="PayPal revenue" done>
          <strong className="receipt-amount">{money(netAmount(receipt), receipt.currency)}</strong>
          <span>
            Captured {at(receipt.captured_at)}
            {refunded > 0 ? `. ${money(refunded, receipt.currency)} refunded` : ""}
          </span>
          {onRefund ? <RefundButton receipt={receipt} onRefund={onRefund} /> : null}
        </ChainStep>
        <ChainStep label="Signal" done>
          <span>{signal}</span>
        </ChainStep>
        <ChainStep label="Next move" done={Boolean(fresh)} active={!fresh}>
          {fresh ? (
            <strong>{fresh.headline}</strong>
          ) : (
            <>
              <span>This purchase is ready for the agent to learn from.</span>
              <button
                className="button accent small receipt-cta"
                type="button"
                disabled={moveLoading}
                aria-busy={moveLoading}
                onClick={onFindNextMove}
              >
                {moveLoading ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Reviewing results
                    <ElapsedSeconds />
                  </>
                ) : (
                  <>
                    Find next move
                    <ArrowRight aria-hidden="true" />
                  </>
                )}
              </button>
            </>
          )}
        </ChainStep>
        <ChainStep label="Your decision" done={Boolean(fresh?.decision)}>
          {fresh?.decision ? (
            <>
              <strong>{fresh.decision === "approved" ? "Approved" : "Rejected"}</strong>
              <button className="text-button" type="button" onClick={onReview}>
                Open the plan
                <ArrowRight aria-hidden="true" />
              </button>
            </>
          ) : fresh ? (
            <button className="text-button" type="button" onClick={onReview}>
              Review recommendation
              <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <span>Nothing changes until you approve it.</span>
          )}
        </ChainStep>
      </ol>
      {proof ? <TechnicalProof receipt={receipt} post={post} move={fresh} /> : null}
    </article>
  );
}

/** Refunds a purchase in full after the founder confirms it. */
function RefundStatus({ receipt }: { receipt: Receipt }) {
  if (Number(receipt.refunded_amount ?? 0) === 0)
    return (
      <span className="refund-status">
        <span className="status-tag review">Refund pending</span>
        <InfoTip label="About this refund" align="end">
          PayPal accepted this refund and is still processing it. The purchase counts as revenue
          until PayPal completes it.
        </InfoTip>
      </span>
    );
  const confirmed = refundConfirmed(receipt);
  return (
    <span className="refund-status">
      <span className="status-tag danger">
        {countsAsRevenue(receipt) ? "Partly refunded" : "Refunded"}
      </span>
      <span className={confirmed ? "refund-note confirmed" : "refund-note"}>
        {confirmed ? "Webhook verified" : "Webhook on its way"}
      </span>
      <InfoTip label="About this refund" align="end">
        {confirmed
          ? "PayPal completed this refund and sent a signed webhook as proof. GrowthReceipt checked its signature with PayPal before storing it."
          : "PayPal completed this refund. It also sends a signed webhook as proof, usually within a minute. This page checks for it on its own."}
      </InfoTip>
    </span>
  );
}

export function RefundButton({
  receipt,
  onRefund,
}: {
  receipt: Receipt;
  onRefund: (orderId: string) => Promise<boolean>;
}) {
  const [state, setState] = useState<"idle" | "confirm" | "working">("idle");
  const refunded =
    Number(receipt.refunded_amount ?? 0) + Number(receipt.pending_refund_amount ?? 0);
  if (refunded > 0) return <RefundStatus receipt={receipt} />;
  if (state === "idle")
    return (
      <button
        className="text-button refund-button"
        type="button"
        onClick={() => setState("confirm")}
      >
        Refund
      </button>
    );
  async function refund() {
    setState("working");
    if (!(await onRefund(receipt.order_id))) setState("confirm");
  }
  return (
    <span className="refund-confirm">
      <span>Refund {money(receipt.amount, receipt.currency)} to the buyer?</span>
      <button
        className="button secondary small"
        type="button"
        disabled={state === "working"}
        aria-busy={state === "working"}
        onClick={() => void refund()}
      >
        {state === "working" ? "Refunding" : "Refund"}
      </button>
      <button
        className="text-button"
        type="button"
        disabled={state === "working"}
        onClick={() => setState("idle")}
      >
        Cancel
      </button>
    </span>
  );
}

function ChainStep({
  label,
  done,
  active = false,
  children,
}: {
  label: string;
  done: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={done ? "done" : active ? "active" : undefined}>
      <span className="receipt-marker" aria-hidden="true">
        {done ? <Check /> : null}
      </span>
      <span className="eyebrow">{label}</span>
      {children}
    </li>
  );
}

function TechnicalProof({
  receipt,
  post,
  move,
}: {
  receipt: Receipt;
  post: Post | undefined;
  move: ProvenMove | null;
}) {
  const approval = receipt.webhooks.find((event) => event.event_type === "CHECKOUT.ORDER.APPROVED");
  return (
    <details className="receipt-proof">
      <summary>
        <ShieldCheck aria-hidden="true" />
        Technical proof
        <ChevronDown className="receipt-proof-chevron" aria-hidden="true" />
      </summary>
      <ol className="proof-timeline">
        <ProofStep title="Order created on the server" time={receipt.ordered_at}>
          <ProofId label="PayPal order">{receipt.order_id}</ProofId>
          <p>The price came from the server, never from the browser.</p>
        </ProofStep>
        <ProofStep title="Buyer approved in PayPal" time={approval?.received_at}>
          <p>
            {approval
              ? "Reported by a verified PayPal webhook."
              : "PayPal only captures an order the buyer approved."}
          </p>
        </ProofStep>
        <ProofStep title="Payment captured" time={receipt.captured_at}>
          <ProofId label="PayPal capture">{receipt.capture_id}</ProofId>
          <p>Captured by the server. PayPal settles an order only once.</p>
        </ProofStep>
        {receipt.webhooks
          .filter((event) => event !== approval)
          .map((event) => (
            <ProofStep
              key={event.event_id}
              title={webhookLabels[event.event_type] ?? "PayPal webhook received"}
              time={event.received_at}
            >
              <ProofId label={event.event_type}>{event.event_id}</ProofId>
              <p>Signature verified with PayPal before it was stored.</p>
            </ProofStep>
          ))}
        {receipt.webhooks.length === 0 ? (
          <ProofStep title="Waiting for the PayPal webhook" pending>
            <p>PayPal usually sends it within a minute. This page refreshes on its own.</p>
          </ProofStep>
        ) : null}
        {Number(receipt.refunded_amount ?? 0) > 0 ? (
          <ProofStep title="Refund completed by PayPal">
            <p>
              {money(receipt.refunded_amount ?? 0, receipt.currency)} went back to the buyer. That
              amount no longer counts as revenue or as evidence for the agent.
            </p>
          </ProofStep>
        ) : null}
        <ProofStep title="Credited to the post" time={receipt.captured_at}>
          <ProofId label="Post">{receipt.content_id}</ProofId>
          <ProofId label="Buy link">{`/buy/${receipt.content_id}`}</ProofId>
          <p>
            {post
              ? `Each post has its own buy link that carries its ID. This order was opened from the day ${post.day} ${post.channel} post's link, and the server stored that ID with the order.`
              : "Each post has its own buy link that carries its ID. The server stored that ID with this order."}
          </p>
        </ProofStep>
        {move ? (
          <ProofStep title="Next move recommended from this revenue" time={move.at}>
            <p>{move.headline}</p>
          </ProofStep>
        ) : (
          <ProofStep title="Next move not requested yet" pending>
            <p>The agent reads this purchase when you ask for the next move.</p>
          </ProofStep>
        )}
      </ol>
      <p className="proof-note">PayPal sandbox. No real money moved.</p>
    </details>
  );
}

function ProofStep({
  title,
  time,
  pending = false,
  children,
}: {
  title: string;
  time?: string;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={pending ? "pending" : undefined}>
      <span className="proof-dot" aria-hidden="true">
        {pending ? <Clock /> : <Check />}
      </span>
      <div>
        <div className="proof-head">
          <strong>{title}</strong>
          {time ? <time dateTime={time}>{at(time)}</time> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

function ProofId({ label, children }: { label: string; children: string }) {
  return (
    <span className="proof-id">
      <span>{label}</span>
      <code>{children}</code>
    </span>
  );
}
