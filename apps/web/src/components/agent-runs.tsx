"use client";

import { Bot, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { type Campaign, type CampaignEvent, campaignApi } from "@/lib/campaign";

type Run = {
  id: number;
  title: string;
  at: string;
  meta: string[];
  input: string;
  evidence?: string[];
  output: string;
  control: string;
};

type PaidPost = { day: number; channel: string; theme: string; revenue: string };

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function runMeta(detail: Record<string, unknown>): string[] {
  const meta: string[] = [];
  const model = text(detail.model);
  if (model) meta.push(model);
  if (typeof detail.duration_ms === "number")
    meta.push(`${(detail.duration_ms / 1000).toFixed(1)} s`);
  const turn = text(detail.turn_id);
  if (turn) meta.push(`run ${turn.slice(-8)}`);
  return meta;
}

/** Turns recorded agent events into input, evidence, output and control. Prompts stay private. */
function toRuns(campaign: Campaign, events: CampaignEvent[]): Run[] {
  const runs: Run[] = [];
  for (const [index, event] of events.entries()) {
    const detail = event.detail;
    if (event.action === "campaign_generated") {
      runs.push({
        id: event.id,
        title: "Campaign draft",
        at: event.created_at,
        meta: runMeta(detail),
        input: `${campaign.product_name} brief: description, audience, objective, ${campaign.channels.join(", ")} and brand voice.`,
        output: `${detail.post_count ?? campaign.posts.length} posts across ${campaign.channels.join(", ")}.`,
        control: "Every post waits for your approval before it can go out.",
      });
    } else if (event.action === "next_action_recommended") {
      const evidence = (detail.evidence ?? {}) as {
        completed_orders?: number;
        gross_revenue?: string;
        currency?: string;
        paid_posts?: PaidPost[];
      };
      const action = (detail.next_action ?? {}) as { headline?: string };
      // Events are newest first. This run's decision is the first one after it, before a newer run.
      const newer = events.slice(0, index).reverse();
      const until = newer.findIndex((item) => item.action === "next_action_recommended");
      const decided = (until === -1 ? newer : newer.slice(0, until)).find(
        (item) => item.actor === "human" && item.action.startsWith("next_action_"),
      );
      runs.push({
        id: event.id,
        title: "Next recommendation",
        at: event.created_at,
        meta: runMeta(detail),
        input: `Verified PayPal revenue: ${evidence.completed_orders ?? 0} purchase${evidence.completed_orders === 1 ? "" : "s"}, ${evidence.gross_revenue ?? "0.00"} ${evidence.currency ?? "USD"}.`,
        evidence: [
          ...(evidence.paid_posts ?? []).map(
            (post) => `Day ${post.day} on ${post.channel}, "${post.theme}", earned ${post.revenue}`,
          ),
          `Campaign objective: ${campaign.objective}`,
          "Payment status, approved posts and campaign state",
        ],
        output: action.headline ?? "One experiment",
        control: decided
          ? `You ${decided.action === "next_action_approved" ? "approved" : "rejected"} it.`
          : "Waiting for your decision. The agent cannot act on its own.",
      });
    } else if (event.action === "post_revised") {
      const post = campaign.posts.find((item) => item.id === event.post_id);
      runs.push({
        id: event.id,
        title: "Post revision",
        at: event.created_at,
        meta: runMeta(detail),
        input: `Your note: "${text(detail.review_note) ?? "requested changes"}"`,
        evidence: post ? [`The day ${post.day} ${post.channel} post as it was`] : undefined,
        output: "A revised version of the same post, same channel and offer.",
        control:
          post?.status === "approved" ? "You approved it." : "It waits in Content for your review.",
      });
    } else if (event.action === "follow_up_drafted") {
      const post = campaign.posts.find((item) => item.id === event.post_id);
      runs.push({
        id: event.id,
        title: "Follow-up post",
        at: event.created_at,
        meta: runMeta(detail),
        input: `Your approved plan: ${text(detail.approved_plan) ?? "the approved next move"}`,
        evidence:
          typeof detail.source_day === "number"
            ? [`Built on the day ${detail.source_day} post that earned the revenue`]
            : undefined,
        output: post ? `Day ${post.day} ${post.channel} post, "${post.theme}".` : "One new post.",
        control:
          post?.status === "approved" ? "You approved it." : "It waits in Content for your review.",
      });
    }
  }
  return runs;
}

export function AgentRuns({ campaign, refreshKey }: { campaign: Campaign; refreshKey: string }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey reloads after a new run.
  useEffect(() => {
    let active = true;
    campaignApi
      .events(campaign.id)
      .then((events) => {
        if (!active) return;
        setRuns(toRuns(campaign, events));
        setSeeded(events.some((event) => event.action === "campaign_seeded"));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [campaign, refreshKey]);

  return (
    <section className="agent-runs" aria-labelledby="agent-runs-title">
      <div className="column-heading">
        <h2 id="agent-runs-title">Agent runs</h2>
        <span>What each run read, what it produced, and where you stay in control</span>
      </div>
      {failed ? <p className="inline-error">Agent runs could not be loaded.</p> : null}
      {seeded ? (
        <p className="evidence-note">
          This sample campaign was prepared in advance, so its draft is not listed as a run. Draft a
          new campaign to watch a live one.
        </p>
      ) : null}
      {runs && !runs.length ? (
        <p className="evidence-note">
          No agent runs yet. Find the next move after a purchase to see one.
        </p>
      ) : null}
      <ol>
        {(runs ?? []).map((run, index) => (
          <li key={run.id} className="reveal" style={{ "--i": index } as React.CSSProperties}>
            <details open={index === 0}>
              <summary>
                <Bot aria-hidden="true" />
                <span className="agent-run-title">
                  <strong>{run.title}</strong>
                  <small>
                    <time dateTime={run.at}>{stamp.format(new Date(run.at))}</time>
                    {run.meta.map((item) => (
                      <span key={item}> · {item}</span>
                    ))}
                  </small>
                </span>
                <ChevronDown className="agent-run-chevron" aria-hidden="true" />
              </summary>
              <dl>
                <div>
                  <dt>Input</dt>
                  <dd>{run.input}</dd>
                </div>
                {run.evidence?.length ? (
                  <div>
                    <dt>Evidence used</dt>
                    <dd>
                      <ul>
                        {run.evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>Output</dt>
                  <dd>{run.output}</dd>
                </div>
                <div>
                  <dt>Control</dt>
                  <dd className="agent-run-control">{run.control}</dd>
                </div>
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
