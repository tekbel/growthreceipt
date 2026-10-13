"use client";

// A custom AG Studio widget that shows the proof behind each PayPal order: the order ID, whether
// PayPal captured it, and how many signature checked PayPal webhooks confirm it. It reads the
// checkouts table directly, so page filters and filter widgets narrow it like any other widget.

import type {
  AgBaseRegistry,
  AgBaseWidgetDefinition,
  AgDefaultWidgetDefinition,
  AgWidgetDataFormat,
  AgWidgetField,
  AgWidgetParams,
} from "ag-studio";
import { Clock, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { SAMPLE_ORDER_PREFIX } from "./sample";

export const RECEIPT_WIDGET = "receipt-proof";

export type ReceiptProofWidget = {
  type: typeof RECEIPT_WIDGET;
  dataMapping: Record<string, never>;
  format?: AgWidgetDataFormat<Record<string, never>>;
};

export interface RevenueRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | AgBaseWidgetDefinition<typeof RECEIPT_WIDGET, ReceiptProofWidget>
  )[];
}

// Field ids in ./data.ts, read in this order.
const COLUMNS = {
  orderId: "checkouts.id",
  status: "checkouts.status",
  verified: "checkouts.verified",
  revenue: "checkouts.revenue",
  capturedAt: "checkouts.capturedAt",
  orderedAt: "checkouts.orderedAt",
  captureId: "checkouts.captureId",
  webhooks: "checkouts.webhooks",
  post: "posts.label",
  offer: "offers.name",
} as const;

type Column = keyof typeof COLUMNS;
type Proof = Record<Column, string> & { paid: boolean; confirmed: boolean; sample: boolean };

const LIMIT = 50;

function ReceiptProof(params: AgWidgetParams<ReceiptProofWidget>) {
  const { widgetApi } = params;
  const [proofs, setProofs] = useState<Proof[]>([]);

  // Studio passes a new params object whenever the widget must query again, for example after a
  // filter changes. Local state updates keep the same object, so this does not loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: params is the refresh signal
  useEffect(() => {
    let live = true;
    const byId = new Map<string, AgWidgetField>(
      widgetApi
        .getSchema()
        .flatMap((table) => table.fields)
        .map((field) => [field.fieldId as string, field]),
    );
    const fields = Object.fromEntries(
      Object.entries(COLUMNS).map(([column, id]) => [column, byId.get(id)]),
    ) as Record<Column, AgWidgetField | undefined>;
    const missing = Object.values(fields).some((field) => !field);
    if (missing) {
      widgetApi.setDisplayState("noData");
      return;
    }
    const list = Object.values(fields) as AgWidgetField[];
    widgetApi.setDisplayState("loading", { prominent: proofs.length === 0 });
    widgetApi
      .getData({
        fields: list,
        sort: [{ field: fields.orderedAt as AgWidgetField, direction: "desc" }],
        limit: { count: LIMIT },
      })
      .then(({ results }) => {
        if (!live) return;
        const rows = results.rows.map((row) => {
          const text = Object.fromEntries(
            (Object.keys(COLUMNS) as Column[]).map((column) => {
              const field = fields[column] as AgWidgetField;
              return [column, widgetApi.formatFieldValue(field, row[field.key]) ?? ""];
            }),
          ) as Record<Column, string>;
          const paid = Number(row[(fields.verified as AgWidgetField).key]) > 0;
          const confirmed = Number(row[(fields.webhooks as AgWidgetField).key]) > 0;
          const sample = text.orderId.startsWith(SAMPLE_ORDER_PREFIX);
          return { ...text, paid, confirmed, sample };
        });
        setProofs(rows);
        widgetApi.setDisplayState(rows.length ? "displayed" : "noData");
      })
      .catch(() => {
        if (live) widgetApi.setDisplayState("noData");
      });
    return () => {
      live = false;
    };
  }, [params]);

  const paid = proofs.filter((proof) => proof.paid);
  const confirmed = paid.filter((proof) => proof.confirmed);
  const allSample = proofs.length > 0 && proofs.every((proof) => proof.sample);

  return (
    <div className="receipt-widget">
      <p className="receipt-widget-summary">
        {allSample ? (
          <>
            These are sample orders with no PayPal receipts. Real orders and their verified PayPal
            webhooks show here after the first purchase.
          </>
        ) : (
          <>
            {paid.length} of {proofs.length} {proofs.length === 1 ? "checkout" : "checkouts"} paid.{" "}
            {confirmed.length} of {paid.length} confirmed by a verified PayPal webhook.
          </>
        )}
      </p>
      <ul>
        {proofs.map((proof) => (
          <li key={proof.orderId}>
            <div className="receipt-widget-order">
              <code>{proof.orderId}</code>
              <span>
                {proof.post} · {proof.offer}
              </span>
            </div>
            <div className="receipt-widget-status">
              {proof.paid ? (
                <>
                  <strong>{proof.revenue}</strong>
                  <span>Captured {proof.capturedAt}</span>
                </>
              ) : (
                <span>Checkout started {proof.orderedAt}</span>
              )}
            </div>
            <div className={proof.confirmed ? "receipt-widget-proof ok" : "receipt-widget-proof"}>
              {proof.confirmed ? (
                <ShieldCheck aria-hidden="true" size={15} />
              ) : (
                <Clock aria-hidden="true" size={15} />
              )}
              <span>
                {proof.sample
                  ? "Sample order"
                  : proof.confirmed
                    ? `${proof.webhooks} verified ${proof.webhooks === "1" ? "webhook" : "webhooks"}`
                    : proof.paid
                      ? "Waiting for PayPal webhook"
                      : "Not paid"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const receiptWidget: AgBaseWidgetDefinition<typeof RECEIPT_WIDGET, ReceiptProofWidget> = {
  id: RECEIPT_WIDGET,
  label: "PayPal receipts",
  form: (params) => params.createDefaults({ dataMappingItems: [] }),
  comp: ReceiptProof,
  defaultSize: { width: 800, height: 400 },
  minSize: { width: 360, height: 200 },
  ai: {
    description:
      "Lists the latest PayPal orders with their order ID, post, offer, capture status and the " +
      "number of signature checked PayPal webhooks that confirm each one.",
  },
};
