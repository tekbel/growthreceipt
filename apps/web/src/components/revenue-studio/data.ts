// AG Studio data sources for the revenue dashboard: the campaign's posts, every checkout started
// from them and the offers customers bought. Revenue counts only PayPal-completed captures.

import type {
  AgDataSourcesDefinition,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from "ag-studio";

import type { Receipt } from "@/components/receipt-proof";
import { type Campaign, type Offer, postDate } from "@/lib/campaign";
import type { RevenueRegistry } from "./receipt-widget";

type PostRef = Campaign["posts"][number];

/** How a post is named in the dashboard. The evidence link filters on this name. */
export const postLabel = (post: PostRef) => `Day ${post.day} ${post.channel}: ${post.theme}`;

export type Checkout = {
  order_id: string;
  content_id: string;
  offer_id: string;
  amount: string;
  currency: string;
  completed: boolean;
  ordered_at: string;
  captured_at: string | null;
};

const CALENDAR_ID = "calendar";

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

// Every amount is USD, so money shows with its dollar sign.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({
    id,
    name,
    format,
    ...(format === "currencyFormat" && { formatOptions: { format: usd } }),
    ...(hide && { hide }),
  }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".");
  const [targetTable, targetField] = target.split(".");
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: "many-to-one",
  };
};

const measure = (
  id: string,
  name: string,
  description: string,
  format: AgFormat,
  operator: "divide" | "subtract",
  [left, right]: [string, string],
): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format,
  ...(format === "currencyFormat" && { formatOptions: { format: usd } }),
  isMeasure: true,
  expression: {
    operator,
    inputs: [
      { id: left, aggregation: "sum" },
      { id: right, aggregation: "sum" },
    ],
  },
});

const expressions = [
  measure(
    "purchaseRate",
    "Purchase rate",
    "Verified purchases divided by checkouts started.",
    "percentageFormat",
    "divide",
    ["checkouts.verified", "checkouts.started"],
  ),
  measure(
    "averageOrder",
    "Average order value",
    "Verified revenue divided by verified purchases.",
    "currencyFormat",
    "divide",
    ["checkouts.revenue", "checkouts.verified"],
  ),
  measure(
    "unfinished",
    "Unfinished checkouts",
    "Checkouts started that PayPal has not completed.",
    "integerFormat",
    "subtract",
    ["checkouts.started", "checkouts.verified"],
  ),
];

const day = (iso: string) => iso.slice(0, 10);

export function hasCheckouts(checkouts: Checkout[]) {
  return checkouts.length > 0;
}

export function buildStudioData(
  campaign: Campaign,
  checkouts: Checkout[],
  offers: Offer[],
  receipts: Receipt[],
): AgDataSourcesDefinition<RevenueRegistry> {
  // Receipts carry the capture and the signature checked PayPal webhooks for each paid order.
  const proof = new Map(receipts.map((receipt) => [receipt.order_id, receipt]));
  const posts = campaign.posts.map((post) => ({
    id: post.id,
    label: postLabel(post),
    day: post.day,
    channel: post.channel,
    theme: post.theme,
    date: postDate(campaign, post),
    live: Boolean(post.published_at || post.published_url),
  }));
  const rows = checkouts.map((checkout) => {
    const receipt = proof.get(checkout.order_id);
    return {
      id: checkout.order_id,
      postId: checkout.content_id,
      offerId: checkout.offer_id,
      status: checkout.completed ? "Verified purchase" : "Checkout started",
      started: 1,
      verified: checkout.completed ? 1 : 0,
      revenue: checkout.completed ? Number(checkout.amount) : 0,
      currency: checkout.currency,
      orderedAt: checkout.ordered_at,
      capturedAt: checkout.captured_at,
      orderedOn: day(checkout.ordered_at),
      captureId: receipt?.capture_id ?? null,
      webhooks: receipt?.webhooks.length ?? 0,
      lastWebhookAt: receipt?.webhooks.at(-1)?.received_at ?? null,
    };
  });
  const dates = rows.map((row) => row.orderedOn).sort();
  const today = new Date().toISOString().slice(0, 10);

  return {
    description:
      `PayPal sandbox purchases for the ${campaign.product_name} campaign. Every checkout is a PayPal order ` +
      "started from a post's buy link. Revenue counts only orders PayPal completed. All amounts are USD.",
    sources: [
      {
        id: "posts",
        description: "Campaign posts. Each post has its own buy link.",
        data: posts,
        fields: fields([
          ["id", "Post ID", "textFormat", true],
          ["label", "Post", "textFormat"],
          ["day", "Campaign day", "integerFormat"],
          ["channel", "Channel", "textFormat"],
          ["theme", "Theme", "textFormat"],
          ["date", "Post date", "dateFormat"],
          ["live", "Published", "booleanFormat"],
        ]),
      },
      {
        id: "checkouts",
        description:
          "One row per PayPal order a buyer started. Verified is 1 when PayPal completed the capture. " +
          "Revenue is the captured amount, 0 until then. Verified PayPal webhooks counts the " +
          "signature checked PayPal events stored for the order and its capture.",
        data: rows,
        fields: fields([
          ["id", "PayPal order ID", "textFormat"],
          ["postId", "Post ID", "textFormat", true],
          ["offerId", "Offer ID", "textFormat", true],
          ["status", "Payment status", "textFormat"],
          ["started", "Checkouts started", "integerFormat"],
          ["verified", "Verified purchases", "integerFormat"],
          ["revenue", "Verified revenue", "currencyFormat"],
          ["currency", "Currency", "textFormat"],
          ["orderedAt", "Checkout started at", "dateTimeFormat"],
          ["capturedAt", "Captured at", "dateTimeFormat"],
          ["orderedOn", "Checkout date", "dateFormat", true],
          ["captureId", "PayPal capture ID", "textFormat"],
          ["webhooks", "Verified PayPal webhooks", "integerFormat"],
          ["lastWebhookAt", "Last webhook at", "dateTimeFormat"],
        ]),
      },
      {
        id: "offers",
        description: "What the customer bought: credit packs at fixed prices.",
        data: offers.map((offer) => ({
          id: offer.id,
          // "LaunchCheck 10 scan pack" reads as "10 scan pack" inside its own campaign.
          name: offer.name.replace(campaign.product_name, "").trim() || offer.name,
          credits: offer.credits,
          price: Number(offer.amount),
        })),
        fields: fields([
          ["id", "Offer ID", "textFormat", true],
          ["name", "Offer", "textFormat"],
          ["credits", "Credits", "integerFormat"],
          ["price", "Price", "currencyFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("checkout-post", "checkouts.postId", "posts.id"),
      manyToOne("checkout-offer", "checkouts.offerId", "offers.id"),
      {
        id: "checkouts-orderedOn-calendar",
        source: { tableId: "checkouts", fieldId: "orderedOn" },
        target: { calendarId: CALENDAR_ID },
      },
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: {
          from: { type: "date", value: dates[0] ?? today },
          to: { type: "date", value: dates.at(-1) ?? today },
        },
        fragments: ["year", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions,
  };
}
