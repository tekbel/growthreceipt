// The built-in revenue report as AG Studio state. Field ids ("checkouts.revenue") refer to the
// data sources in ./data.ts. Founders can edit it, and the edited copy is kept in their browser.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";

// Position on the canvas grid, in tracks: 24 columns wide.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });

const kpi = (text: string, value: { id: string; aggregation?: "sum" }) => ({
  type: "value" as const,
  dataMapping: { value: [value] },
  format: title(text),
});

const revenue: AgPageState = {
  id: "revenue",
  widgets: {
    "kpi-revenue": kpi("Verified revenue", sum("checkouts.revenue")),
    "kpi-purchases": kpi("Purchases", sum("checkouts.verified")),
    "kpi-average": kpi("Order value", { id: "averageOrder" }),
    "kpi-started": kpi("Checkouts", sum("checkouts.started")),
    "kpi-unfinished": kpi("Unfinished", { id: "unfinished" }),
    "kpi-rate": kpi("Purchase rate", { id: "purchaseRate" }),
    "filter-channel": {
      type: "button-filter",
      dataMapping: { value: [{ id: "posts.channel" }] },
      format: title("Channel"),
    },
    "filter-offer": {
      type: "button-filter",
      dataMapping: { value: [{ id: "offers.name" }] },
      format: title("Offer"),
    },
    "revenue-by-post": {
      type: "bar-chart-grouped",
      dataMapping: {
        categoryKey: [{ id: "posts.label" }],
        valueKey: [sum("checkouts.revenue")],
      },
      sort: [{ field: sum("checkouts.revenue"), direction: "desc" }],
      format: title("Verified revenue by post"),
    },
    "funnel-by-channel": {
      type: "column-chart-grouped",
      dataMapping: {
        categoryKey: [{ id: "posts.channel" }],
        valueKey: [sum("checkouts.started"), sum("checkouts.verified")],
      },
      format: {
        ...title("Checkouts started and verified purchases by channel"),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    "revenue-over-time": {
      type: "combo-chart-grouped-column-line",
      dataMapping: {
        categoryKey: [{ id: "calendar::day" }],
        valueKey: [sum("checkouts.revenue")],
        secondaryValueKey: [sum("checkouts.started")],
      },
      format: {
        ...title("Verified revenue and checkouts started by day"),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    "revenue-by-offer": {
      type: "donut-chart",
      dataMapping: {
        categoryKey: [{ id: "offers.name" }],
        valueKey: [sum("checkouts.revenue")],
      },
      format: title("Verified revenue by offer"),
    },
    posts: {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "posts.label" },
          { id: "posts.channel" },
          sum("checkouts.started"),
          sum("checkouts.verified"),
          sum("checkouts.revenue"),
          { id: "purchaseRate" },
        ],
      },
      sort: [{ field: sum("checkouts.revenue"), direction: "desc" }],
      format: title("Posts ranked by verified revenue"),
    },
    "revenue-by-week": {
      type: "pivot-grid",
      dataMapping: {
        rows: [{ id: "posts.channel" }, { id: "posts.label" }],
        columns: [{ id: "calendar::week" }],
        values: [sum("checkouts.revenue"), sum("checkouts.verified")],
      },
      format: {
        ...title("Verified revenue by channel, post and week"),
        style: { grandTotalRow: { enabled: true } },
      },
    },
  },
  widgetLayout: {
    "kpi-revenue": at(0, 0, 4, 7),
    "kpi-purchases": at(4, 0, 4, 7),
    "kpi-average": at(8, 0, 4, 7),
    "kpi-started": at(12, 0, 4, 7),
    "kpi-unfinished": at(16, 0, 4, 7),
    "kpi-rate": at(20, 0, 4, 7),
    "filter-channel": at(0, 7, 12, 8),
    "filter-offer": at(12, 7, 12, 8),
    "revenue-by-post": at(0, 15, 14, 18),
    "revenue-by-offer": at(14, 15, 10, 18),
    "revenue-over-time": at(0, 33, 14, 18),
    "funnel-by-channel": at(14, 33, 10, 18),
    "revenue-by-week": at(0, 51, 24, 16),
    posts: at(0, 67, 24, 20),
  },
};

export const revenueReport: AgReportState = {
  selectedPageId: revenue.id,
  pages: [revenue],
  panels: { filters: { collapsed: false } },
};
