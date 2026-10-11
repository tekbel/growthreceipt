"use client";

import { ArrowRight, Check, ChevronDown, Clock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import type { Post } from "@/lib/campaign";

export type WebhookProof = {
  event_id: string;
  event_type: string;
  received_at: string;
};

export type Receipt = {
  order_id: string;
  capture_id: string;
  content_id: string;
  amount: string;
  currency: string;
  ordered_at: string;
  captured_at: string;
  webhooks: WebhookProof[];
};

export type ProvenMove = { headline: string; at: string; decision?: "approved" | "rejected" };

const webhookLabels: Record<string, string> = {
  "CHECKOUT.ORDER.APPROVED": "PayPal reported the buyer approval",
  "CHECKOUT.ORDER.COMPLETED": "PayPal reported the order complete",
  "PAYMENT.CAPTURE.COMPLETED": "PayPal confirmed the payment",
};

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function money(amount: number | string, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function at(value: string): string {
  return stamp.format(new Date(value));
}

/** A recommendation counts for a purchase only when the agent made it after the money arrived. */
export function moveFor(receipt: Receipt, move: ProvenMove | null): ProvenMove | null {
  return move && new Date(move.at) >= new Date(receipt.captured_at) ? move : null;
}

export function ReceiptChain({
  receipt,
  receipts,
  posts,
  move,
  moveLoading,
  onFindNextMove,
  onReview,
  proof = true,
}: {
  receipt: Receipt;
  receipts: Receipt[];
  posts: Post[];
  move: ProvenMove | null;
  moveLoading: boolean;
  onFindNextMove: () => void;
  onReview: () => void;
  proof?: boolean;
}) {
  const post = posts.find((item) => item.id === receipt.content_id);
  const fromPost = receipts.filter((item) => item.content_id === receipt.content_id);
  const postRevenue = fromPost.reduce((sum, item) => sum + Number(item.amount), 0);
  const fresh = moveFor(receipt, move);
  const signal =
    receipts.length === 1
      ? "The first verified purchase of this campaign came from this post."
      : `${fromPost.length} of ${receipts.length} verified purchases came from this post, ${money(postRevenue, receipt.currency)} in total.`;

  return (
    <article
      className="receipt"
      aria-label={`PayPal purchase of ${money(receipt.amount, receipt.currency)}`}
    >
      <ol className="receipt-chain">
        <ChainStep label="Post" done>
          <strong>{post ? `Day ${post.day} · ${post.channel}` : "Campaign post"}</strong>
          <span>{post?.theme ?? "This post is no longer in the campaign."}</span>
        </ChainStep>
        <ChainStep label="PayPal revenue" done>
          <strong className="receipt-amount">{money(receipt.amount, receipt.currency)}</strong>
          <span>Captured {at(receipt.captured_at)}</span>
        </ChainStep>
        <ChainStep label="Signal" done>
          <span>{signal}</span>
        </ChainStep>
        <ChainStep label="Next move" done={Boolean(fresh)}>
          {fresh ? (
            <strong>{fresh.headline}</strong>
          ) : (
            <button
              className="text-button"
              type="button"
              disabled={moveLoading}
              aria-busy={moveLoading}
              onClick={onFindNextMove}
            >
              {moveLoading ? "Reviewing results" : "Find next move"}
              <ArrowRight aria-hidden="true" />
            </button>
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

function ChainStep({
  label,
  done,
  children,
}: {
  label: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <li className={done ? "done" : undefined}>
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
        <ProofStep title="Credited to the post" time={receipt.captured_at}>
          <ProofId label="Post">{receipt.content_id}</ProofId>
          <p>
            {post
              ? `The buy link of the day ${post.day} ${post.channel} post opened this order.`
              : "The buy link of this post opened the order."}
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
