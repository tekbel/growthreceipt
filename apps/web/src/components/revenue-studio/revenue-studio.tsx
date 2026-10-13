"use client";

import type { AgReportState, AgStudioApi, AgStudioMode, AgWidgetsConfig } from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Receipt } from "@/components/receipt-proof";
import { apiFetch, type Campaign, type Offer } from "@/lib/campaign";
import { buildStudioData, type Checkout } from "./data";
import { RECEIPT_WIDGET, type RevenueRegistry, receiptWidget } from "./receipt-widget";
import { revenueReport } from "./report";
import { revenueStudioTheme } from "./theme";

type Report = AgReportState<RevenueRegistry>;

// A module level function keeps one reference, so Studio does not reset on render.
const widgets = (defaults: AgWidgetsConfig) =>
  createWidgets<RevenueRegistry>({
    additionalTypes: [receiptWidget],
    menu: [...(defaults.menu ?? []), { label: "Proof", widgetIds: [RECEIPT_WIDGET] }],
  });

const reportKey = (campaignId: string) => `growthreceipt.revenue-report.${campaignId}`;

// A founder's edited report stays in their browser. Storage can be blocked, so both directions
// fall back to the built-in report.
function savedReport(campaignId: string): Report | null {
  try {
    const raw = localStorage.getItem(reportKey(campaignId));
    return raw ? (JSON.parse(raw) as Report) : null;
  } catch {
    return null;
  }
}

function saveReport(campaignId: string, state: Report | null) {
  try {
    if (state) localStorage.setItem(reportKey(campaignId), JSON.stringify(state));
    else localStorage.removeItem(reportKey(campaignId));
  } catch {
    // The edit still applies for this visit.
  }
}

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; checkouts: Checkout[]; offers: Offer[]; receipts: Receipt[] };

export default function RevenueStudio({
  campaign,
  onOpenCheckout,
}: {
  campaign: Campaign;
  onOpenCheckout: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [mode, setMode] = useState<AgStudioMode>("view");
  // Studio reads initialState once, when it is created. This component only renders in the browser.
  const [saved] = useState(() => savedReport(campaign.id));
  const [edited, setEdited] = useState(Boolean(saved));
  const api = useRef<AgStudioApi<RevenueRegistry> | null>(null);

  const fetchData = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const [checkouts, offers, receipts] = await Promise.all([
        apiFetch(`/v1/paypal/checkouts/${campaign.id}`),
        apiFetch("/v1/paypal/offers"),
        apiFetch(`/v1/paypal/receipts/${campaign.id}`),
      ]);
      if (!checkouts.ok || !offers.ok || !receipts.ok)
        throw new Error("Dashboard data is unavailable");
      setLoad({
        status: "ready",
        checkouts: ((await checkouts.json()) as { checkouts: Checkout[] }).checkouts,
        offers: (await offers.json()) as Offer[],
        receipts: ((await receipts.json()) as { receipts: Receipt[] }).receipts,
      });
    } catch {
      setLoad({ status: "error" });
    }
  }, [campaign.id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const data = useMemo(
    () =>
      load.status === "ready"
        ? buildStudioData(campaign, load.checkouts, load.offers, load.receipts)
        : null,
    [campaign, load],
  );

  function finishEditing() {
    const state = api.current?.getState() ?? null;
    saveReport(campaign.id, state);
    setEdited(Boolean(state));
    setMode("view");
  }

  function resetReport() {
    saveReport(campaign.id, null);
    api.current?.setState(revenueReport);
    api.current?.clearHistory();
    setEdited(false);
    setMode("view");
  }

  if (load.status === "loading") {
    return (
      <section className="skeleton" aria-busy="true" aria-label="Loading the revenue dashboard">
        <div className="skeleton-row">
          <div className="skeleton-block card" />
          <div className="skeleton-block card" />
          <div className="skeleton-block card" />
        </div>
        <div className="skeleton-block panel" />
      </section>
    );
  }
  if (load.status === "error" || !data) {
    return (
      <div className="empty-state boxed" role="alert">
        <strong>The dashboard could not load</strong>
        <p>GrowthReceipt could not read the PayPal orders for this campaign.</p>
        <button className="text-button" type="button" onClick={() => void fetchData()}>
          Try again
        </button>
      </div>
    );
  }
  if (!load.checkouts.length) {
    return (
      <div className="empty-state boxed">
        <strong>No checkouts yet</strong>
        <p>
          Buy the offer from a post&apos;s buy link in the PayPal sandbox. Every checkout and
          verified purchase appears here.
        </p>
        <button className="text-button" type="button" onClick={onOpenCheckout}>
          Open as customer
        </button>
      </div>
    );
  }

  return (
    <section className="revenue-studio" aria-label="Revenue dashboard">
      <div className="revenue-studio-toolbar">
        <span>
          {load.checkouts.length} checkout{load.checkouts.length === 1 ? "" : "s"} from PayPal
          sandbox
        </span>
        <div>
          {edited && mode === "view" ? (
            <button className="button secondary" type="button" onClick={resetReport}>
              Reset to default
            </button>
          ) : null}
          {mode === "view" ? (
            <button className="button secondary" type="button" onClick={() => setMode("edit")}>
              Edit dashboard
            </button>
          ) : (
            <button className="button dark" type="button" onClick={finishEditing}>
              Save layout
            </button>
          )}
        </div>
      </div>
      <div className="revenue-studio-canvas">
        <AgStudioProvider>
          <AgStudio<RevenueRegistry>
            style={{ height: "100%", width: "100%" }}
            theme={revenueStudioTheme}
            data={data}
            widgets={widgets}
            initialState={saved ?? revenueReport}
            mode={mode}
            onApiReady={(event) => {
              // The ready event is typed with the default registry, the api is ours.
              api.current = event.api as unknown as AgStudioApi<RevenueRegistry>;
            }}
          />
        </AgStudioProvider>
      </div>
    </section>
  );
}
