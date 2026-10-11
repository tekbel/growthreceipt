"use client";

import {
  AllCommunityModule,
  type ColDef,
  type IRowNode,
  ModuleRegistry,
  themeQuartz,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Receipt } from "@/components/receipt-proof";
import { type Campaign, postDate } from "@/lib/campaign";

ModuleRegistry.registerModules([AllCommunityModule]);

// The grid takes its colors from the app tokens, so light and dark themes follow automatically.
const theme = themeQuartz.withParams({
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  textColor: "var(--ink)",
  subtleTextColor: "var(--muted)",
  borderColor: "var(--line)",
  accentColor: "var(--accent)",
  headerBackgroundColor: "var(--surface-subtle)",
  headerTextColor: "var(--muted)",
  rowHoverColor: "var(--surface-hover)",
  selectedRowBackgroundColor: "var(--accent-soft)",
  fontFamily: "inherit",
  fontSize: 14,
  headerFontWeight: 600,
  wrapperBorderRadius: 10,
  spacing: 7,
});

type Payment = "Verified revenue" | "Captured" | "Awaiting payment" | "Not live";

type EvidenceRow = {
  id: string;
  day: number;
  date: string;
  channel: string;
  post: string;
  approval: string;
  payment: Payment;
  purchases: number;
  revenue: number;
  attribution: string;
  nextAction: string;
};

const approvalLabels: Record<Campaign["posts"][number]["status"], string> = {
  approved: "Approved",
  needs_review: "Needs review",
  changes_requested: "Changes requested",
};

const views = ["All posts", "Verified revenue", "Awaiting payment", "Approved"] as const;
type ViewFilter = (typeof views)[number];

export function EvidenceGrid({
  campaign,
  receipts,
  nextActions,
  currency,
  onOpenPost,
}: {
  campaign: Campaign;
  receipts: Receipt[];
  /** A short next action per post id, such as the experiment the agent built on it. */
  nextActions: Record<string, string>;
  currency: string;
  onOpenPost: (postId: string) => void;
}) {
  const grid = useRef<AgGridReact<EvidenceRow>>(null);
  const [view, setView] = useState<ViewFilter>("All posts");
  const [channel, setChannel] = useState("All channels");
  // Pinned columns would fill a phone screen, so they only pin on wider screens.
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 700px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const rows = useMemo<EvidenceRow[]>(
    () =>
      campaign.posts.map((post) => {
        const paid = receipts.filter((receipt) => receipt.content_id === post.id);
        const confirmed = paid.filter((receipt) =>
          receipt.webhooks.some((event) => event.event_type === "PAYMENT.CAPTURE.COMPLETED"),
        );
        const payment: Payment = confirmed.length
          ? "Verified revenue"
          : paid.length
            ? "Captured"
            : post.status === "approved"
              ? "Awaiting payment"
              : "Not live";
        return {
          id: post.id,
          day: post.day,
          date: postDate(campaign, post),
          channel: post.channel,
          post: post.theme,
          approval: approvalLabels[post.status],
          payment,
          purchases: paid.length,
          revenue: paid.reduce((sum, receipt) => sum + Number(receipt.amount), 0),
          attribution: confirmed.length
            ? "Verified by PayPal webhook"
            : paid.length
              ? "Capture recorded, webhook pending"
              : "",
          nextAction: nextActions[post.id] ?? "",
        };
      }),
    [campaign, receipts, nextActions],
  );

  const money = useMemo(
    () => new Intl.NumberFormat("en-US", { style: "currency", currency }),
    [currency],
  );

  const columns = useMemo<ColDef<EvidenceRow>[]>(
    () => [
      // The deciding facts come first, the rest scrolls in on narrow screens.
      { field: "day", headerName: "Day", width: 74, pinned: wide ? "left" : null },
      {
        field: "post",
        headerName: "Post",
        width: wide ? 230 : 180,
        pinned: wide ? "left" : null,
        tooltipField: "post",
      },
      { field: "channel", headerName: "Channel", width: 110 },
      {
        field: "revenue",
        headerName: "Revenue",
        width: 112,
        type: "numericColumn",
        sort: "desc",
        valueFormatter: (params) => money.format(params.value ?? 0),
      },
      { field: "purchases", headerName: "Orders", width: 96, type: "numericColumn" },
      {
        field: "payment",
        headerName: "Payment",
        width: 166,
        cellClass: (params) =>
          params.value === "Verified revenue"
            ? "evidence-verified"
            : params.value === "Captured"
              ? "evidence-pending"
              : "evidence-muted",
      },
      { field: "attribution", headerName: "Attribution", width: 230 },
      { field: "approval", headerName: "Approval", width: 160 },
      {
        field: "nextAction",
        headerName: "Next action",
        flex: 1,
        minWidth: 240,
        tooltipField: "nextAction",
      },
      { field: "date", headerName: "Date", width: 100 },
    ],
    [money, wide],
  );

  const channels = useMemo(
    () => ["All channels", ...new Set(campaign.posts.map((post) => post.channel))],
    [campaign],
  );

  const passes = useCallback(
    (node: IRowNode<EvidenceRow>) => {
      const row = node.data;
      if (!row) return false;
      if (channel !== "All channels" && row.channel !== channel) return false;
      if (view === "Verified revenue") return row.payment === "Verified revenue";
      if (view === "Awaiting payment") return row.payment === "Awaiting payment";
      if (view === "Approved") return row.approval === "Approved";
      return true;
    },
    [view, channel],
  );

  // The grid caches filter results, so tell it when the chips or the channel change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rerun when the filter function changes.
  useEffect(() => {
    grid.current?.api?.onFilterChanged();
  }, [passes]);

  const counts = useMemo(
    () => ({
      "All posts": rows.length,
      "Verified revenue": rows.filter((row) => row.payment === "Verified revenue").length,
      "Awaiting payment": rows.filter((row) => row.payment === "Awaiting payment").length,
      Approved: rows.filter((row) => row.approval === "Approved").length,
    }),
    [rows],
  );

  return (
    <div className="evidence-grid">
      <div className="evidence-toolbar">
        <fieldset className="filter-row" aria-label="Filter evidence">
          {views.map((option) => (
            <button
              key={option}
              type="button"
              className={view === option ? "active" : undefined}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option} · {counts[option]}
            </button>
          ))}
        </fieldset>
        <label className="evidence-channel">
          <span className="visually-hidden">Channel</span>
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            {channels.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="evidence-grid-frame">
        <AgGridReact<EvidenceRow>
          ref={grid}
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          domLayout="autoHeight"
          isExternalFilterPresent={() => view !== "All posts" || channel !== "All channels"}
          doesExternalFilterPass={passes}
          defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
          rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
          onRowClicked={(event) => {
            if (event.data) onOpenPost(event.data.id);
          }}
          overlayNoRowsTemplate="<span>No posts match this filter.</span>"
          tooltipShowDelay={300}
        />
      </div>
      <p className="evidence-note">
        Select a row to open the post. Revenue counts only purchases PayPal captured for that post's
        buy link.
      </p>
    </div>
  );
}
