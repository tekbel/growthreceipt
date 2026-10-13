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
    "kpi-purchases": kpi("Verified purchases", sum("checkouts.verified")),
    "kpi-started": kpi("Checkouts started", sum("checkouts.started")),
    "kpi-rate": kpi("Purchase rate", { id: "purchaseRate" }),
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
  },
  widgetLayout: {
    "kpi-revenue": at(0, 0, 6, 7),
    "kpi-purchases": at(6, 0, 6, 7),
    "kpi-started": at(12, 0, 6, 7),
    "kpi-rate": at(18, 0, 6, 7),
    "revenue-by-post": at(0, 7, 14, 18),
    "revenue-by-offer": at(14, 7, 10, 18),
    "revenue-over-time": at(0, 25, 14, 18),
    "funnel-by-channel": at(14, 25, 10, 18),
    posts: at(0, 43, 24, 20),
  },
};

export const revenueReport: AgReportState = {
  selectedPageId: revenue.id,
  pages: [revenue],
  panels: { filters: { collapsed: true } },
};
