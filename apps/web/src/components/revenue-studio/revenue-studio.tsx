"use client";

import {
  type AgAiHarnessSetup,
  type AgAiModel,
  type AgAiPromptStarter,
  type AgFilterState,
  type AgPanelConfig,
  type AgReportState,
  AgStudioAiModule,
  type AgStudioApi,
  type AgStudioMode,
  type AgWidgetsConfig,
  createAiHarness,
} from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Receipt } from "@/components/receipt-proof";
import { apiFetch, type Campaign, type Offer } from "@/lib/campaign";
import { growthReceiptAdapter, setSampleData } from "./ai-adapter";
import { buildStudioData, type Checkout, postLabel } from "./data";
import { RECEIPT_WIDGET, type RevenueRegistry, receiptWidget } from "./receipt-widget";
import { revenueReport } from "./report";
import { sampleCheckouts } from "./sample";
import { revenueStudioTheme } from "./theme";

type Report = AgReportState<RevenueRegistry>;

// Baked in at build time. Without it Studio runs as a trial with a watermark.
const studioLicenseKey = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY || undefined;

// A module level function keeps one reference, so Studio does not reset on render.
const widgets = (defaults: AgWidgetsConfig) =>
  createWidgets<RevenueRegistry>({
    additionalTypes: [receiptWidget],
    menu: [...(defaults.menu ?? []), { label: "Proof", widgetIds: [RECEIPT_WIDGET] }],
  });

const promptStarters: AgAiPromptStarter[] = [
  {
    label: "Best post",
    prompt: "Which post brought the most verified revenue, and how many purchases did it get?",
  },
  {
    label: "Unpaid checkouts",
    prompt: "Which posts have checkouts that were started but not paid?",
  },
  {
    label: "Chart by channel",
    prompt: "Add a bar chart of verified revenue by channel.",
  },
];

// The assistant runs Studio's built-in agents. Each model turn goes through the GrowthReceipt API.
// The API picks the model. The reader picks how hard it thinks, which the API caps at medium.
const models: AgAiModel[] = [
  {
    id: "growthreceipt",
    label: "OpenAI",
    efforts: [
      { id: "low", label: "Fast" },
      { id: "medium", label: "Thorough" },
    ],
  },
];
const ai: AgAiHarnessSetup = ({ api }) =>
  createAiHarness(api, { adapter: growthReceiptAdapter, promptStarters, models });

const localeText = { aiMessageInputPlaceholder: "Ask about your PayPal revenue" };
const modules = [AgStudioAiModule];

// Asking the assistant shows only the chat beside the charts. Editing shows the usual panels.
const viewPanels: AgPanelConfig["view"] = { right: ["filters"] };
const assistantPanels: AgPanelConfig = { view: viewPanels, edit: { left: ["ai"] } };
const editPanels: AgPanelConfig = {
  view: viewPanels,
  edit: { right: ["filters", "edit", "data"] },
};

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

// The evidence link opens the dashboard on the posts the agent cited, as a page filter the
// founder can see in the filters panel and remove.
const focusFilter = (labels: string[]): AgFilterState<RevenueRegistry> => ({
  field: { id: "posts.label" },
  model: { operator: "isIn", value: labels },
});
const isFocus = (filter: AgFilterState<RevenueRegistry>, focus: AgFilterState<RevenueRegistry>) =>
  JSON.stringify(filter) === JSON.stringify(focus);

function withFocus(report: Report, focus: AgFilterState<RevenueRegistry> | null): Report {
  return {
    ...report,
    pages: report.pages?.map((page) => {
      if (page.id !== report.selectedPageId) return page;
      const others = (page.filter?.page ?? []).filter(
        (filter) => !focus || !isFocus(filter, focus),
      );
      return { ...page, filter: { ...page.filter, page: focus ? [...others, focus] : others } };
    }),
  };
}

function withoutFocus(report: Report, focus: AgFilterState<RevenueRegistry> | null): Report {
  if (!focus) return report;
  return {
    ...report,
    pages: report.pages?.map((page) => ({
      ...page,
      filter: {
        ...page.filter,
        page: (page.filter?.page ?? []).filter((filter) => !isFocus(filter, focus)),
      },
    })),
  };
}

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; checkouts: Checkout[]; offers: Offer[]; receipts: Receipt[] };

export default function RevenueStudio({
  campaign,
  focusPostIds = null,
  onOpenCheckout,
}: {
  campaign: Campaign;
  /** Posts to filter to on open, from the evidence behind a recommendation. */
  focusPostIds?: string[] | null;
  onOpenCheckout: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [mode, setMode] = useState<AgStudioMode>("view");
  // Charts draw a few seconds after the data arrives. The skeleton stays until Studio reports rendered.
  const [rendered, setRendered] = useState(false);
  const [assistant, setAssistant] = useState(false);
  // Studio reads initialState once, when it is created. This component only renders in the browser.
  const [saved] = useState(() => savedReport(campaign.id));
  const [edited, setEdited] = useState(Boolean(saved));
  const [focusLabels] = useState(() =>
    campaign.posts.filter((post) => focusPostIds?.includes(post.id)).map(postLabel),
  );
  const [focus] = useState(() => (focusLabels.length ? focusFilter(focusLabels) : null));
  const [focused, setFocused] = useState(Boolean(focus));
  const [initialState] = useState(() => withFocus(saved ?? revenueReport, focus));
  const api = useRef<AgStudioApi<RevenueRegistry> | null>(null);
  const opened = useRef("");

  const fetchData = useCallback(
    async (silent = false) => {
      if (!silent) setLoad({ status: "loading" });
      try {
        const [checkouts, offers, receipts] = await Promise.all([
          apiFetch(`/v1/paypal/checkouts/${campaign.id}`),
          apiFetch("/v1/paypal/offers"),
          apiFetch(`/v1/paypal/receipts/${campaign.id}`),
        ]);
        if (!checkouts.ok || !offers.ok || !receipts.ok)
          throw new Error("Dashboard data is unavailable");
        const next: Load = {
          status: "ready",
          checkouts: ((await checkouts.json()) as { checkouts: Checkout[] }).checkouts,
          offers: (await offers.json()) as Offer[],
          receipts: ((await receipts.json()) as { receipts: Receipt[] }).receipts,
        };
        // Keep the same data when nothing changed, so Studio does not redraw every refresh.
        setLoad((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      } catch {
        // A failed background refresh keeps the figures already on screen.
        if (!silent) setLoad({ status: "error" });
      }
    },
    [campaign.id],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Customers pay on the buy page in another tab. Refresh like the results page does.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void fetchData(true);
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [fetchData]);

  // With no real checkouts yet, the dashboard shows labelled sample orders until the first one.
  const sample = useMemo(
    () =>
      load.status === "ready" && !load.checkouts.length
        ? sampleCheckouts(campaign, load.offers)
        : [],
    [campaign, load],
  );
  useEffect(() => setSampleData(sample.length > 0), [sample]);
  const data = useMemo(
    () =>
      load.status === "ready"
        ? sample.length
          ? buildStudioData(campaign, sample, load.offers, [])
          : buildStudioData(campaign, load.checkouts, load.offers, load.receipts)
        : null,
    [campaign, load, sample],
  );

  function startEditing(withAssistant: boolean) {
    const current = api.current?.getState();
    opened.current = JSON.stringify(current ? withoutFocus(current, focus) : null);
    setAssistant(withAssistant);
    setMode("edit");
  }

  function finishEditing() {
    const current = api.current?.getState();
    // The evidence filter is for this visit. It is never saved into the layout.
    const state = current ? withoutFocus(current, focus) : null;
    // Only a real change is saved, so opening the editor alone never marks the layout as edited.
    if (JSON.stringify(state) !== opened.current) {
      saveReport(campaign.id, state);
      setEdited(Boolean(state));
    }
    setMode("view");
  }

  function showAllPosts() {
    const current = api.current?.getState();
    if (current) api.current?.setState(withoutFocus(current, focus));
    setFocused(false);
  }

  function resetReport() {
    saveReport(campaign.id, null);
    setFocused(false);
    api.current?.setState(revenueReport);
    api.current?.clearHistory();
    setEdited(false);
    setMode("view");
  }

  // Fallback so the dashboard never stays hidden if the render event does not arrive.
  useEffect(() => {
    if (load.status !== "ready" || rendered) return;
    const timer = window.setTimeout(() => setRendered(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [load.status, rendered]);

  const skeleton = (
    <section className="skeleton" aria-busy="true" aria-label="Loading the revenue dashboard">
      <div className="skeleton-row">
        <div className="skeleton-block card" />
        <div className="skeleton-block card" />
        <div className="skeleton-block card" />
      </div>
      <div className="skeleton-block panel" />
    </section>
  );
  if (load.status === "loading") return skeleton;
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
  if (!load.checkouts.length && !sample.length) {
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
        {sample.length ? (
          <p className="revenue-studio-sample" role="status">
            <strong>Sample data.</strong> Buy the offer in the PayPal sandbox to see your own orders
            here.{" "}
            <button className="text-button" type="button" onClick={onOpenCheckout}>
              Open as customer
            </button>
          </p>
        ) : focused && focus ? (
          <p className="revenue-studio-focus" role="status">
            Showing the {focusLabels.length === 1 ? "post" : "posts"} the agent cited.{" "}
            <button className="text-button" type="button" onClick={showAllPosts}>
              Show all posts
            </button>
          </p>
        ) : (
          // A judge who just bought once sees one row where many sample rows were, so say why.
          <p className="revenue-studio-real" role="status">
            Showing your {load.checkouts.length} checkout
            {load.checkouts.length === 1 ? "" : "s"} from the PayPal sandbox. The sample orders are
            hidden now that you have your own.
          </p>
        )}
        <div>
          {edited && mode === "view" ? (
            <button className="button secondary" type="button" onClick={resetReport}>
              Reset to default
            </button>
          ) : null}
          {mode === "view" ? (
            <>
              <button className="button secondary" type="button" onClick={() => startEditing(true)}>
                Ask AI
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => startEditing(false)}
              >
                Edit dashboard
              </button>
            </>
          ) : (
            <button className="button dark" type="button" onClick={finishEditing}>
              {assistant ? "Done" : "Save layout"}
            </button>
          )}
        </div>
      </div>
      <div className="revenue-studio-canvas">
        {rendered ? null : <div className="revenue-studio-loading">{skeleton}</div>}
        <AgStudioProvider modules={modules} licenseKey={studioLicenseKey}>
          <AgStudio<RevenueRegistry>
            style={{ height: "100%", width: "100%" }}
            theme={revenueStudioTheme}
            data={data}
            widgets={widgets}
            ai={ai}
            panels={assistant ? assistantPanels : editPanels}
            localeText={localeText}
            initialState={initialState}
            mode={mode}
            onApiReady={(event) => {
              // The ready event is typed with the default registry, the api is ours.
              api.current = event.api as unknown as AgStudioApi<RevenueRegistry>;
            }}
            onRenderStateChanged={(event) => {
              if (event.renderState === "rendered") setRendered(true);
            }}
            onStateUpdated={(event) => {
              // The note goes away when the founder removes the filter in the filters panel.
              if (!focus) return;
              const pages = (event.state as Report).pages ?? [];
              const kept = pages.some((page) =>
                (page.filter?.page ?? []).some((filter) => isFocus(filter, focus)),
              );
              setFocused(kept);
            }}
          />
        </AgStudioProvider>
      </div>
    </section>
  );
}
