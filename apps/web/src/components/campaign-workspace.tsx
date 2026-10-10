"use client";

import {
  BarChart3,
  Box,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Moon,
  Network,
  PencilLine,
  Plus,
  Receipt,
  ReceiptText,
  Search,
  Send,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { FaFacebookF, FaInstagram, FaLinkedinIn, FaXTwitter } from "react-icons/fa6";
import { SiPaypal, SiPosthog } from "react-icons/si";
import { PayPalCheckout } from "@/components/paypal-checkout";
import {
  apiFetch,
  type Campaign,
  type CampaignBrief,
  type CampaignEvent,
  type Channel,
  campaignApi,
  channels,
  type DraftProgress,
  type DraftStage,
  exampleBrief,
  type Post,
  type PostStatus,
  type PostUpdate,
  postDate,
  scheduleRange,
} from "@/lib/campaign";

const views = [
  "today",
  "products",
  "campaigns",
  "new-campaign",
  "content",
  "calendar",
  "results",
  "experiment",
  "integrations",
  "settings",
  "checkout",
] as const;
type View = (typeof views)[number];
type Filter = "All" | "Needs review" | "Changes requested" | "Approved";
type ReviewStatus = Exclude<Filter, "All">;
type Stage = "Approval" | "Publishing" | "Measurement";
type Toast = { message: string; action?: { label: string; view: View } };

// The current page lives in the URL hash so refresh, back, and links work.
function viewFromHash(): View | null {
  const hash = window.location.hash.slice(1);
  return (views as readonly string[]).includes(hash) ? (hash as View) : null;
}

type RevenueSummary = {
  completed_orders: number;
  gross_revenue: string;
  currency: string;
  latest_capture_id: string | null;
};

type Recommendation = {
  evidence_summary: string;
  recommendation: string;
  rationale: string;
  expected_signal: string;
  confidence: "low" | "medium" | "high";
  needs_more_data: boolean;
  human_approval_required: boolean;
};

const workspaceNavigation = [
  ["today", "Today", LayoutDashboard],
  ["products", "Products", Box],
  ["campaigns", "Campaigns", Send],
  ["content", "Content", FileText],
  ["calendar", "Calendar", CalendarDays],
  ["results", "Results", BarChart3],
  ["experiment", "Next experiment", FlaskConical],
] as const;
const systemNavigation = [
  ["integrations", "Integrations", Network],
  ["settings", "Settings", SlidersHorizontal],
  ["checkout", "Customer checkout", CreditCard],
] as const;
const viewLabels: Record<View, string> = {
  today: "Today",
  products: "Products",
  campaigns: "Campaigns",
  "new-campaign": "New campaign",
  content: "Content",
  calendar: "Calendar",
  results: "Results",
  experiment: "Next experiment",
  integrations: "Integrations",
  settings: "Settings",
  checkout: "Customer checkout",
};
const reviewLabels: Record<PostStatus, ReviewStatus> = {
  needs_review: "Needs review",
  changes_requested: "Changes requested",
  approved: "Approved",
};
const campaignLabels: Record<Campaign["status"], string> = {
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};
const eventLabels: Record<string, string> = {
  campaign_generated: "Campaign drafted by the campaign agent",
  campaign_seeded: "Demo campaign loaded",
  post_edited: "Post edited",
  post_approved: "Post approved",
  changes_requested: "Changes requested",
  campaign_approved: "Campaign approved",
  next_action_recommended: "Next move recommended from PayPal revenue",
};

const draftSteps: [DraftStage, string][] = [
  ["brief_received", "Brief sent to the campaign agent"],
  ["session_started", "Campaign agent connected"],
  ["thinking", "Planning the campaign"],
  ["writing", "Writing posts"],
  ["checking", "Checking channels and schedule"],
  ["saving", "Saving drafts for your review"],
];

type Theme = "light" | "dark";
const THEME_KEY = "growthreceipt-theme";

export type WorkspaceIdentity = {
  mode: "local" | "judge" | "user";
  displayName: string;
  isAnonymous: boolean;
};

function statusFor(post: Post): ReviewStatus {
  return reviewLabels[post.status];
}

export function CampaignWorkspace({
  identity,
  onSignOut,
  onResetDemo,
}: {
  identity: WorkspaceIdentity;
  onSignOut?: () => Promise<void>;
  onResetDemo?: () => Promise<void>;
}) {
  const [view, setView] = useState<View>("today");
  const [theme, setTheme] = useState<Theme>("light");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [revenueError, setRevenueError] = useState(false);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);

  const posts = useMemo(() => campaign?.posts ?? [], [campaign]);
  const selected = posts.find((post) => post.id === selectedId) ?? posts[0] ?? null;
  // A customer can only arrive from a post the founder approved. Prefer the post in view.
  const checkoutPost =
    selected?.status === "approved"
      ? selected
      : (posts.find((post) => post.status === "approved") ?? null);
  const filteredPosts = useMemo(
    () => posts.filter((post) => filter === "All" || statusFor(post) === filter),
    [posts, filter],
  );
  const counts = useMemo(
    () => ({
      All: posts.length,
      "Needs review": posts.filter((post) => post.status === "needs_review").length,
      "Changes requested": posts.filter((post) => post.status === "changes_requested").length,
      Approved: posts.filter((post) => post.status === "approved").length,
    }),
    [posts],
  );
  const stage: Stage =
    campaign?.status !== "approved"
      ? "Approval"
      : revenue?.completed_orders
        ? "Measurement"
        : "Publishing";

  const loadCampaign = useCallback(async () => {
    setLoadState("loading");
    try {
      const latest = await campaignApi.latest();
      setCampaign(latest);
      setLoadState("ready");
      if (!latest) {
        setView("new-campaign");
        window.history.replaceState(null, "", "#new-campaign");
      }
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);

  useEffect(() => {
    const syncView = () => setView(viewFromHash() ?? "today");
    syncView();
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, []);

  // The inline script in layout.tsx applies the theme before first paint. Mirror it here.
  useEffect(() => {
    if (document.documentElement.dataset.theme === "dark") setTheme("dark");
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be blocked. The choice still applies for this visit.
    }
  }

  const campaignId = campaign?.id;
  const loadRevenue = useCallback(async () => {
    if (!campaignId) return;
    try {
      const response = await apiFetch(`/v1/paypal/revenue/${campaignId}`);
      if (!response.ok) throw new Error("Results are unavailable");
      setRevenue((await response.json()) as RevenueSummary);
      setRevenueError(false);
    } catch {
      setRevenueError(true);
    }
  }, [campaignId]);

  useEffect(() => {
    setRevenue(null);
    setRecommendation(null);
    void loadRevenue();
  }, [loadRevenue]);

  function notify(message: string, action?: Toast["action"]) {
    setToast({ message, action });
    // Leave time to reach the button when the toast offers a next step.
    window.setTimeout(() => setToast(null), action ? 7000 : 2800);
  }

  function navigate(nextView: View) {
    if (nextView !== view) window.history.pushState(null, "", `#${nextView}`);
    setView(nextView);
    setMobileNavigationOpen(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    const firstMatch = posts.find((post) => nextFilter === "All" || statusFor(post) === nextFilter);
    if (firstMatch) setSelectedId(firstMatch.id);
    setEditingBody(null);
  }

  async function mutate(action: () => Promise<Campaign>, message: string, next?: Toast["action"]) {
    setSaving(true);
    try {
      setCampaign(await action());
      notify(message, next);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "That change could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function updateSelected(update: PostUpdate, message: string, next?: Toast["action"]) {
    if (!campaign || !selected) return false;
    return mutate(() => campaignApi.updatePost(campaign.id, selected.id, update), message, next);
  }

  async function saveEdits() {
    if (!selected || editingBody === null) return;
    const content = editingBody.trim();
    if (!content || content === selected.content) {
      setEditingBody(null);
      return;
    }
    if (await updateSelected({ content }, "Edits saved. The post needs a fresh approval.")) {
      setEditingBody(null);
    }
  }

  function approveCampaign() {
    if (!campaign) return;
    void mutate(
      () => campaignApi.approve(campaign.id),
      "Campaign approved. Next, make a test purchase as your customer.",
      { label: "Open checkout", view: "checkout" },
    );
  }

  async function createCampaign(
    brief: CampaignBrief,
    onProgress: (progress: DraftProgress) => void,
  ) {
    const created = await campaignApi.streamCreate(brief, onProgress);
    setCampaign(created);
    setSelectedId(created.posts[0]?.id ?? null);
    setFilter("All");
    setEditingBody(null);
    navigate("content");
    notify(`${created.posts.length} posts drafted. Review them before anything is published.`);
  }

  async function findNextMove() {
    if (!campaign) return;
    setRecommendationLoading(true);
    setRecommendationError(null);
    try {
      const response = await apiFetch("/v1/agents/next-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaign.id }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        throw new Error(
          response.status === 429 && typeof body?.detail === "string"
            ? body.detail
            : "A next move could not be prepared right now.",
        );
      }
      const result = (await response.json()) as { next_action: Recommendation };
      setRecommendation(result.next_action);
    } catch (error) {
      setRecommendationError(
        error instanceof Error ? error.message : "A next move could not be prepared right now.",
      );
    } finally {
      setRecommendationLoading(false);
    }
  }

  function renderPage() {
    if (loadState === "loading") {
      return <WorkspaceSkeleton />;
    }
    if (loadState === "error") {
      return (
        <EmptyState
          title="Your workspace did not load"
          copy="Something went wrong on our side. Please try again in a moment."
          action="Try again"
          onAction={() => void loadCampaign()}
          boxed
        />
      );
    }
    if (view === "new-campaign" || !campaign || !selected) {
      return (
        <NewCampaignPage
          canCancel={Boolean(campaign)}
          createCampaign={createCampaign}
          onCancel={() => navigate("campaigns")}
        />
      );
    }
    switch (view) {
      case "today":
        return (
          <TodayPage
            campaign={campaign}
            revenue={revenue}
            revenueError={revenueError}
            stage={stage}
            needsReview={counts["Needs review"] + counts["Changes requested"]}
            navigate={navigate}
          />
        );
      case "products":
        return <ProductsPage campaign={campaign} navigate={navigate} />;
      case "campaigns":
        return (
          <CampaignsPage
            campaign={campaign}
            counts={counts}
            stage={stage}
            saving={saving}
            navigate={navigate}
            approveCampaign={approveCampaign}
          />
        );
      case "content":
        return (
          <ContentPage
            campaign={campaign}
            openCheckout={() => navigate("checkout")}
            counts={counts}
            posts={filteredPosts}
            filter={filter}
            stage={stage}
            selected={selected}
            editingBody={editingBody}
            saving={saving}
            approveCampaign={approveCampaign}
            approvePost={() =>
              void updateSelected(
                { status: "approved" },
                "Post approved. You can make a test purchase from it now.",
                { label: "Open checkout", view: "checkout" },
              )
            }
            requestChanges={(note) =>
              updateSelected(
                { status: "changes_requested", review_note: note },
                `Changes requested for day ${selected.day}.`,
              )
            }
            saveEdits={saveEdits}
            selectFilter={selectFilter}
            selectPost={(id) => {
              setSelectedId(id);
              setEditingBody(null);
            }}
            setEditingBody={setEditingBody}
          />
        );
      case "calendar":
        return <CalendarPage campaign={campaign} />;
      case "results":
        return (
          <ResultsPage
            revenue={revenue}
            revenueError={revenueError}
            recommendation={recommendation}
            recommendationError={recommendationError}
            recommendationLoading={recommendationLoading}
            findNextMove={findNextMove}
            openCheckout={() => setCheckoutOpen(true)}
            navigate={navigate}
          />
        );
      case "experiment":
        return (
          <ExperimentPage
            revenue={revenue}
            recommendation={recommendation}
            recommendationError={recommendationError}
            recommendationLoading={recommendationLoading}
            findNextMove={findNextMove}
            navigate={navigate}
          />
        );
      case "integrations":
        return <IntegrationsPage navigate={navigate} notify={notify} />;
      case "settings":
        return <SettingsPage notify={notify} />;
      case "checkout":
        return (
          <CheckoutPage
            post={checkoutPost}
            revenue={revenue}
            openCheckout={() => setCheckoutOpen(true)}
          />
        );
      default:
        return null;
    }
  }

  const productName = campaign?.product_name ?? "New product";
  const productIcon = campaign?.product_icon_url ?? null;
  return (
    <div className="growthreceipt-app">
      <Sidebar
        currentView={view}
        isOpen={mobileNavigationOpen}
        productName={productName}
        productIcon={productIcon}
        navigate={navigate}
        onClose={() => setMobileNavigationOpen(false)}
        notify={notify}
        identity={identity}
        onSignOut={onSignOut}
        onResetDemo={onResetDemo}
      />
      <div className="app-stage">
        <Topbar
          currentView={view}
          productName={productName}
          theme={theme}
          searchOpen={searchOpen}
          onMenu={() => setMobileNavigationOpen(true)}
          onSearch={() => setSearchOpen((open) => !open)}
          onTheme={toggleTheme}
          onHelp={() => setHelpOpen(true)}
          notify={notify}
          identity={identity}
        />
        <main className="page-shell" key={loadState === "ready" ? view : loadState}>
          {renderPage()}
        </main>
      </div>
      {toast ? (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                if (toast.action) navigate(toast.action.view);
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {checkoutOpen && campaign && checkoutPost ? (
        <PayPalCheckout
          campaignId={campaign.id}
          contentId={checkoutPost.id}
          onClose={() => setCheckoutOpen(false)}
          onCaptured={async () => {
            await loadRevenue();
            setRecommendation(null);
          }}
        />
      ) : null}
      {helpOpen ? (
        <HelpPanel
          campaign={campaign}
          revenue={revenue}
          recommendation={recommendation}
          navigate={(nextView) => {
            setHelpOpen(false);
            navigate(nextView);
          }}
          onClose={() => setHelpOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Sidebar({
  currentView,
  isOpen,
  productName,
  productIcon,
  navigate,
  onClose,
  notify,
  identity,
  onSignOut,
  onResetDemo,
}: {
  currentView: View;
  isOpen: boolean;
  productName: string;
  productIcon: string | null;
  navigate: (view: View) => void;
  onClose: () => void;
  notify: (message: string) => void;
  identity: WorkspaceIdentity;
  onSignOut?: () => Promise<void>;
  onResetDemo?: () => Promise<void>;
}) {
  const initial = identity.displayName.trim().charAt(0).toUpperCase() || "G";
  const environmentLabel =
    identity.mode === "judge"
      ? "Private judge demo"
      : identity.mode === "user"
        ? "Personal workspace"
        : "Demo workspace · Local";
  return (
    <>
      <button
        className={`navigation-scrim ${isOpen ? "visible" : ""}`}
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
      />
      <aside className={`sidebar ${isOpen ? "open" : ""}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <button className="wordmark" type="button" onClick={() => navigate("today")}>
            <span className="wordmark-symbol">
              <ReceiptText aria-hidden="true" />
            </span>
            <span>GrowthReceipt</span>
          </button>
          <button
            className="mobile-close"
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <button
          className="product-picker"
          type="button"
          onClick={() => notify("Product switching is coming next.")}
        >
          {productIcon ? (
            <ProductMark className="picker-mark" name={productName} iconUrl={productIcon} />
          ) : (
            <span className="product-dot" />
          )}
          <strong>{productName}</strong>
          <ChevronDown aria-hidden="true" />
        </button>
        <NavigationGroup
          label="Workspace"
          items={workspaceNavigation}
          currentView={currentView}
          navigate={navigate}
        />
        <NavigationGroup
          label="System"
          items={systemNavigation}
          currentView={currentView}
          navigate={navigate}
        />
        <div className="sidebar-footer">
          <div className="environment-state">
            <span /> {environmentLabel}
          </div>
          <button
            type="button"
            onClick={() => notify("Workspace settings are available from Settings.")}
          >
            <span className="avatar">{initial}</span>
            <strong>{identity.displayName}</strong>
            <ChevronDown aria-hidden="true" />
          </button>
          {onResetDemo || onSignOut ? (
            <div className="sidebar-session-actions">
              {onResetDemo ? (
                <button
                  type="button"
                  onClick={() =>
                    void onResetDemo().catch(() => notify("The judge demo could not be reset."))
                  }
                >
                  Reset demo
                </button>
              ) : null}
              {onSignOut ? (
                <button type="button" onClick={() => void onSignOut()}>
                  Sign out
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function NavigationGroup({
  label,
  items,
  currentView,
  navigate,
}: {
  label: string;
  items: readonly (readonly [View, string, typeof LayoutDashboard])[];
  currentView: View;
  navigate: (view: View) => void;
}) {
  return (
    <div className="navigation-group">
      <span>{label}</span>
      <nav aria-label={`${label} navigation`}>
        {items.map(([target, itemLabel, Icon]) => (
          <button
            type="button"
            className={currentView === target ? "active" : ""}
            aria-current={currentView === target ? "page" : undefined}
            onClick={() => navigate(target)}
            key={target}
          >
            <Icon aria-hidden="true" />
            <span>{itemLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Topbar({
  currentView,
  productName,
  theme,
  searchOpen,
  onMenu,
  onSearch,
  onTheme,
  onHelp,
  notify,
  identity,
}: {
  currentView: View;
  productName: string;
  theme: Theme;
  searchOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  onTheme: () => void;
  onHelp: () => void;
  notify: (message: string) => void;
  identity: WorkspaceIdentity;
}) {
  const initial = identity.displayName.trim().charAt(0).toUpperCase() || "G";
  return (
    <header className="topbar">
      <button className="mobile-menu" type="button" onClick={onMenu} aria-label="Open navigation">
        <Menu aria-hidden="true" />
      </button>
      <div className="breadcrumbs">
        <span>{productName}</span>
        <span>/</span>
        <strong>{viewLabels[currentView]}</strong>
      </div>
      <div className="topbar-actions">
        {searchOpen ? (
          <input
            className="topbar-search"
            aria-label="Search workspace"
            placeholder="Search workspace"
          />
        ) : null}
        <button
          type="button"
          onClick={onTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} appearance`}
        >
          {theme === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        </button>
        <button type="button" onClick={onSearch} aria-label="Search">
          <Search aria-hidden="true" />
        </button>
        <button type="button" onClick={onHelp} aria-label="Help">
          <CircleHelp aria-hidden="true" />
        </button>
        <button
          className="topbar-avatar"
          type="button"
          onClick={() => notify(`Signed in to ${identity.displayName}.`)}
          aria-label={identity.displayName}
        >
          {initial}
        </button>
      </div>
    </header>
  );
}

function HelpPanel({
  campaign,
  revenue,
  recommendation,
  navigate,
  onClose,
}: {
  campaign: Campaign | null;
  revenue: RevenueSummary | null;
  recommendation: Recommendation | null;
  navigate: (view: View) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const approved = campaign?.status === "approved";
  const hasRevenue = Boolean(revenue?.completed_orders);
  const steps: Array<{
    title: string;
    copy: string;
    action: string;
    view: View;
    complete: boolean;
  }> = [
    {
      title: "Describe your product",
      copy: "Set the audience, revenue goal, channels, and voice.",
      action: campaign ? "Review product" : "Add product",
      view: campaign ? "products" : "new-campaign",
      complete: Boolean(campaign),
    },
    {
      title: "Review the campaign",
      copy: "Edit the drafted posts and approve the work you want to use.",
      action: "Open content",
      view: "content",
      complete: approved,
    },
    {
      title: "Test the purchase",
      copy: "Complete a PayPal Sandbox checkout. No real money moves.",
      action: "Open checkout",
      view: "checkout",
      complete: hasRevenue,
    },
    {
      title: "Read verified results",
      copy: "See which campaign and post produced the captured order.",
      action: "View results",
      view: "results",
      complete: hasRevenue,
    },
    {
      title: "Choose the next test",
      copy: "Turn verified revenue into one controlled recommendation.",
      action: "Open experiment",
      view: "experiment",
      complete: Boolean(recommendation),
    },
  ];

  return (
    <div className="help-backdrop">
      <button className="help-scrim" type="button" onClick={onClose} aria-label="Close help" />
      <aside className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="help-header">
          <div>
            <span className="eyebrow">Help</span>
            <h2 id="help-title">Learn the workflow</h2>
            <p>Five steps from a product brief to a revenue backed next move.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close help">
            <X aria-hidden="true" />
          </button>
        </header>
        <ol className="help-steps">
          {steps.map((step, index) => (
            <li className={step.complete ? "complete" : ""} key={step.title}>
              <span className="help-step-mark" aria-hidden="true">
                {step.complete ? <Check /> : index + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.copy}</p>
                <button type="button" onClick={() => navigate(step.view)}>
                  {step.action}
                </button>
              </div>
            </li>
          ))}
        </ol>
        <footer className="help-footer">
          <strong>Check your connections</strong>
          <p>Review PayPal, publishing, and measurement services in one place.</p>
          <button
            className="button secondary"
            type="button"
            onClick={() => navigate("integrations")}
          >
            Open integrations
          </button>
        </footer>
      </aside>
    </div>
  );
}

function PageHeader({
  eyebrow = "Workspace",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </div>
  );
}

function CampaignProgress({ status }: { status: Stage }) {
  const steps = ["Strategy", "Content", "Approval", "Publishing", "Measurement"];
  const currentIndex = steps.indexOf(status);
  return (
    <nav className="campaign-ribbon" aria-label="Launch week campaign progress">
      {steps.map((step, index) => (
        <div
          className={
            index === currentIndex ? "current" : index < currentIndex ? "complete" : "upcoming"
          }
          key={step}
          aria-current={index === currentIndex ? "step" : undefined}
        >
          <span className="step-mark">
            {index < currentIndex ? <Check aria-hidden="true" /> : index + 1}
          </span>
          <span className="step-copy">
            <strong>{step}</strong>
            {step === "Measurement" ? <small>Waiting for data</small> : null}
          </span>
        </div>
      ))}
    </nav>
  );
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function excerpt(content: string): string {
  return content.split("\n").find((line) => line.trim()) ?? content;
}

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function TodayPage({
  campaign,
  revenue,
  revenueError,
  stage,
  needsReview,
  navigate,
}: {
  campaign: Campaign;
  revenue: RevenueSummary | null;
  revenueError: boolean;
  stage: Stage;
  needsReview: number;
  navigate: (view: View) => void;
}) {
  const [clock, setClock] = useState<{ date: string; greeting: string } | null>(null);

  // Formatted on the client so server and browser render the same markup.
  useEffect(() => {
    const now = new Date();
    setClock({
      date: new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(now),
      greeting: greetingFor(now.getHours()),
    });
  }, []);
  const attention = campaign.posts.filter((post) => post.status !== "approved").slice(0, 3);
  const approved = campaign.posts.filter((post) => post.status === "approved");
  const sales = revenue?.completed_orders ?? 0;
  return (
    <>
      <header className="today-header">
        <span className="eyebrow">{clock?.date ?? "Today"}</span>
        <h1>{clock?.greeting ?? "Today"}</h1>
        <p>
          {campaign.name} for {campaign.product_name} · {scheduleRange(campaign)}
        </p>
      </header>
      <FocusCard
        campaign={campaign}
        stage={stage}
        needsReview={needsReview}
        sales={sales}
        navigate={navigate}
      />
      <section className="metric-strip" aria-label="Workspace summary">
        <Metric
          icon={<Check aria-hidden="true" />}
          label="Campaign status"
          value={campaignLabels[campaign.status]}
          detail={
            needsReview
              ? `${needsReview} post${needsReview === 1 ? "" : "s"} need a decision`
              : `All ${campaign.posts.length} posts approved`
          }
          tone={needsReview ? "review" : "success"}
        />
        <Metric
          icon={<CalendarDays aria-hidden="true" />}
          label="Next publish"
          value={approved[0] ? postDate(campaign, approved[0]) : "Not scheduled"}
          detail={
            approved[0] ? `Day ${approved[0].day} · ${approved[0].channel}` : "Approve a post first"
          }
          tone={approved[0] ? "success" : "neutral"}
        />
        <Metric
          icon={<CreditCard aria-hidden="true" />}
          label="Verified revenue"
          value={
            revenue
              ? formatMoney(revenue.gross_revenue, revenue.currency)
              : revenueError
                ? "Unavailable"
                : "Loading"
          }
          detail={
            sales
              ? `${sales} PayPal purchase${sales === 1 ? "" : "s"} verified`
              : "Waiting for the first PayPal purchase"
          }
          tone={sales ? "success" : "neutral"}
        />
        <Metric
          icon={<TrendingUp aria-hidden="true" />}
          label="Trial to paid"
          value="Not connected"
          detail="Connect PostHog to measure"
          tone="neutral"
          muted
        />
      </section>
      <section className="today-grid">
        <article>
          <SectionTitle
            title="Needs your attention"
            action="View content queue"
            onAction={() => navigate("content")}
          />
          {attention.length ? (
            <ul className="row-list">
              {attention.map((post, index) => (
                <PostRow
                  key={post.id}
                  campaign={campaign}
                  post={post}
                  index={index}
                  onOpen={() => navigate("content")}
                />
              ))}
            </ul>
          ) : (
            <QuietState
              icon={<Check aria-hidden="true" />}
              tone="success"
              title={`All ${campaign.posts.length} posts approved`}
              copy="Nothing is waiting on you."
            />
          )}
        </article>
        <article>
          <SectionTitle
            title="Publishing next"
            action="Open calendar"
            onAction={() => navigate("calendar")}
          />
          {approved.length ? (
            <ul className="row-list">
              {approved.slice(0, 3).map((post, index) => (
                <PostRow
                  key={post.id}
                  campaign={campaign}
                  post={post}
                  index={index}
                  onOpen={() => navigate("calendar")}
                />
              ))}
            </ul>
          ) : (
            <QuietState
              icon={<CalendarDays aria-hidden="true" />}
              title="Nothing approved yet"
              copy="Approved posts line up here in publishing order."
            />
          )}
        </article>
      </section>
      <section className="today-grid">
        <article>
          <SectionTitle title="Recent results" />
          {sales && revenue ? (
            <div className="result-summary">
              <strong>{formatMoney(revenue.gross_revenue, revenue.currency)}</strong>
              <span>
                {sales} verified PayPal sandbox purchase{sales === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            <QuietState
              icon={<BarChart3 aria-hidden="true" />}
              title="No results yet"
              copy="A PayPal sandbox purchase shows up here as verified revenue."
              action="Open checkout"
              onAction={() => navigate("checkout")}
            />
          )}
        </article>
        <article>
          <SectionTitle title="Next experiment" />
          <QuietState
            icon={<FlaskConical aria-hidden="true" />}
            title="No recommendation yet"
            copy="GrowthReceipt picks a test once it has verified results."
            action="See what is needed"
            onAction={() => navigate("experiment")}
          />
        </article>
      </section>
    </>
  );
}

function FocusCard({
  campaign,
  stage,
  needsReview,
  sales,
  navigate,
}: {
  campaign: Campaign;
  stage: Stage;
  needsReview: number;
  sales: number;
  navigate: (view: View) => void;
}) {
  const waiting = campaign.posts.find((post) => post.status !== "approved");
  const next = campaign.posts.find((post) => post.status === "approved");
  const focus: { label: string; title: string; note?: string; action: string; view: View } =
    needsReview
      ? {
          label: "Next decision",
          title: `${needsReview} post${needsReview === 1 ? "" : "s"} need your review`,
          action: "Review posts",
          view: "content" as View,
        }
      : sales
        ? {
            label: "Next move",
            title: "Results are in. Choose the next experiment",
            action: "Find next move",
            view: "experiment" as View,
          }
        : stage === "Publishing"
          ? {
              label: "Next up",
              title: "Your campaign is approved. Now be your own customer",
              note: `You are the founder of ${campaign.product_name}. Picture a customer who saw one of your posts and bought the 10 scan pack for 9 USD. Make that purchase yourself with a PayPal sandbox account. The 9 USD is credited to this campaign as revenue, and the agent learns from it to plan posts around what people paid for, not what they liked.`,
              action: "Open checkout",
              view: "checkout" as View,
            }
          : {
              label: "Next up",
              title: next
                ? `Day ${next.day} goes out ${postDate(campaign, next)} on ${next.channel}`
                : "Approve a post to schedule it",
              action: "Review posts",
              view: "content" as View,
            };
  const post = focus.note ? null : needsReview ? waiting : next;
  return (
    <section className="panel focus-card" aria-label={focus.label}>
      <div className="focus-body">
        <span className="focus-label">{focus.label}</span>
        <h2>{focus.title}</h2>
        {focus.note ? <p className="focus-note">{focus.note}</p> : null}
        {post ? (
          <figure className="focus-post">
            <figcaption>
              <ChannelIcon channel={post.channel} />
              <strong>{post.theme}</strong>
              <span className={`status-tag ${statusClass(statusFor(post))}`}>
                {statusFor(post)}
              </span>
            </figcaption>
            <p>{excerpt(post.content)}</p>
          </figure>
        ) : null}
        <div className="focus-actions">
          <button className="button dark" type="button" onClick={() => navigate(focus.view)}>
            {focus.action}
          </button>
          <button className="button outline" type="button" onClick={() => navigate("campaigns")}>
            Open campaign
          </button>
        </div>
      </div>
      <CampaignProgress status={stage} />
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone,
  muted = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "success" | "review" | "neutral";
  muted?: boolean;
}) {
  return (
    <article className="metric">
      <span className="metric-label">
        {icon}
        {label}
      </span>
      <strong className={muted ? "muted" : ""}>{value}</strong>
      <small>
        <span className={`dot ${tone}`} aria-hidden="true" />
        {detail}
      </small>
    </article>
  );
}

function PostRow({
  campaign,
  post,
  index,
  onOpen,
}: {
  campaign: Campaign;
  post: Post;
  index: number;
  onOpen: () => void;
}) {
  const [month, day] = postDate(campaign, post).split(" ");
  const status = statusFor(post);
  return (
    <li className="reveal" style={{ "--i": index } as React.CSSProperties}>
      <button className="post-row" type="button" onClick={onOpen}>
        <span className="date-chip" aria-hidden="true">
          <small>{month}</small>
          <strong>{day}</strong>
        </span>
        <span className="post-row-body">
          <strong>
            <ChannelIcon channel={post.channel} />
            {post.theme}
          </strong>
          <small>{post.review_note ?? excerpt(post.content)}</small>
        </span>
        <span className={`status-tag ${statusClass(status)}`}>{status}</span>
      </button>
    </li>
  );
}

function QuietState({
  icon,
  title,
  copy,
  action,
  onAction,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
  action?: string;
  onAction?: () => void;
  tone?: "success" | "neutral";
}) {
  return (
    <div className="quiet-state">
      <span className={`quiet-icon ${tone}`}>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
      {action && onAction ? (
        <button className="button secondary small" type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

function ProductsPage({
  campaign,
  navigate,
}: {
  campaign: Campaign;
  navigate: (view: View) => void;
}) {
  return (
    <>
      <PageHeader
        title="Products"
        description="The source material GrowthReceipt uses to understand what you sell."
        action={
          <button className="button dark" type="button" onClick={() => navigate("new-campaign")}>
            <Plus aria-hidden="true" /> Add product
          </button>
        }
      />
      <section className="product-hero">
        <ProductMark
          className="product-avatar"
          name={campaign.product_name}
          iconUrl={campaign.product_icon_url}
        />
        <div>
          <span className="status-tag success">Active</span>
          <h2>{campaign.product_name}</h2>
          <p>{campaign.product_description}</p>
        </div>
        <button className="button secondary" type="button" onClick={() => navigate("campaigns")}>
          View campaigns
        </button>
      </section>
      <section className="detail-columns">
        <div>
          <span className="eyebrow">Positioning</span>
          <h3>{campaign.positioning}</h3>
          <p>Voice: {campaign.brand_voice}</p>
        </div>
        <div>
          <span className="eyebrow">Audience</span>
          <h3>{campaign.audience}</h3>
        </div>
        <div>
          <span className="eyebrow">Primary goal</span>
          <h3>{campaign.objective}</h3>
        </div>
      </section>
    </>
  );
}

function NewCampaignPage({
  canCancel,
  createCampaign,
  onCancel,
}: {
  canCancel: boolean;
  createCampaign: (
    brief: CampaignBrief,
    onProgress: (progress: DraftProgress) => void,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [brief, setBrief] = useState<CampaignBrief>({
    ...exampleBrief,
    product_name: "",
    product_icon_url: "",
    product_description: "",
    audience: "",
    objective: "",
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DraftProgress | null>(null);
  const [thought, setThought] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const iconUploaded = brief.product_icon_url.startsWith("data:");
  const [previewIcon, setPreviewIcon] = useState("");

  // Load the preview once typing pauses, so partial links do not flash an error.
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewIcon(brief.product_icon_url), 400);
    return () => window.clearTimeout(timer);
  }, [brief.product_icon_url]);

  async function uploadIcon(file: File | undefined) {
    if (!file) return;
    if (!ICON_TYPES.includes(file.type)) {
      setIconError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 5_000_000) {
      setIconError("Use an image smaller than 5 MB.");
      return;
    }
    try {
      field("product_icon_url", await squareIcon(file));
      setIconError(null);
    } catch {
      setIconError("This image could not be read. Try another file.");
    }
  }

  function field<K extends keyof CampaignBrief>(key: K, value: CampaignBrief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  function toggleChannel(channel: Channel) {
    field(
      "channels",
      brief.channels.includes(channel)
        ? brief.channels.filter((item) => item !== channel)
        : channels.filter((item) => item === channel || brief.channels.includes(item)),
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brief.channels.length) {
      setError("Choose at least one channel.");
      return;
    }
    setGenerating(true);
    setError(null);
    setProgress(null);
    setThought(null);
    try {
      await createCampaign(brief, (next) => {
        setProgress(next);
        if (next.detail) setThought(next.detail);
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The campaign could not be drafted right now.",
      );
      setGenerating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Describe the product and the result you want. GrowthReceipt drafts a campaign for you to review. Nothing is published without your approval."
        action={
          <button
            className="button secondary"
            type="button"
            disabled={generating}
            onClick={() => setBrief(exampleBrief)}
          >
            Use example brief
          </button>
        }
      />
      <form className="settings-form brief-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={generating}>
          <legend>Product</legend>
          <label htmlFor="product-name">Product name</label>
          <input
            id="product-name"
            required
            minLength={2}
            maxLength={120}
            value={brief.product_name}
            onChange={(event) => field("product_name", event.target.value)}
          />
          <label htmlFor="product-icon">
            Product icon <span className="optional">Optional</span>
          </label>
          <div className="icon-field">
            <ProductMark
              className="icon-preview"
              name={brief.product_name || "?"}
              iconUrl={previewIcon || null}
              onLoadResult={(loaded) =>
                setIconError(
                  loaded
                    ? null
                    : "This link did not load an image. Copy the image address itself, or upload a file.",
                )
              }
            />
            {iconUploaded ? (
              <span className="icon-uploaded">Uploaded image</span>
            ) : (
              <input
                id="product-icon"
                inputMode="url"
                maxLength={500}
                pattern="(https://|/).+"
                title="Use a link that starts with https://"
                placeholder="https://"
                aria-describedby="product-icon-hint"
                value={brief.product_icon_url}
                onChange={(event) => {
                  setIconError(null);
                  field("product_icon_url", event.target.value.trim());
                }}
              />
            )}
            <button
              className="button secondary"
              type="button"
              onClick={() => iconInput.current?.click()}
            >
              <Upload aria-hidden="true" /> Upload
            </button>
            {brief.product_icon_url ? (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setIconError(null);
                  field("product_icon_url", "");
                }}
              >
                Remove
              </button>
            ) : null}
            <input
              ref={iconInput}
              type="file"
              accept={ICON_TYPES.join(",")}
              hidden
              onChange={(event) => {
                void uploadIcon(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
          <p
            id="product-icon-hint"
            className={iconError ? "field-hint error" : "field-hint"}
            role={iconError ? "alert" : undefined}
          >
            {iconError ??
              "A square PNG, JPEG, or WebP. Without one, the first letter of the name is used."}
          </p>
          <label htmlFor="product-description">What it does</label>
          <textarea
            id="product-description"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            value={brief.product_description}
            onChange={(event) => field("product_description", event.target.value)}
          />
          <label htmlFor="audience">Who it is for</label>
          <input
            id="audience"
            required
            minLength={3}
            maxLength={500}
            value={brief.audience}
            onChange={(event) => field("audience", event.target.value)}
          />
        </fieldset>
        <fieldset disabled={generating}>
          <legend>Campaign</legend>
          <label htmlFor="objective">Revenue goal</label>
          <input
            id="objective"
            required
            minLength={3}
            maxLength={240}
            value={brief.objective}
            onChange={(event) => field("objective", event.target.value)}
          />
          <span className="field-label">Channels</span>
          <div className="channel-options">
            {channels.map((channel) => (
              <label className="channel-option" key={channel}>
                <input
                  type="checkbox"
                  checked={brief.channels.includes(channel)}
                  onChange={() => toggleChannel(channel)}
                />
                <ChannelIcon channel={channel} /> {channel}
              </label>
            ))}
          </div>
          <label htmlFor="days">Length</label>
          <select
            id="days"
            value={brief.days}
            onChange={(event) => field("days", Number(event.target.value))}
          >
            {[3, 5, 7, 10, 14].map((days) => (
              <option value={days} key={days}>
                {days} days, one post a day
              </option>
            ))}
          </select>
          <label htmlFor="brand-voice">Brand voice</label>
          <input
            id="brand-voice"
            maxLength={500}
            value={brief.brand_voice}
            onChange={(event) => field("brand_voice", event.target.value)}
          />
        </fieldset>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {generating ? (
          <AgentSteps progress={progress} thought={thought} productName={brief.product_name} />
        ) : null}
        <div className="form-actions">
          <button className="button dark" type="submit" disabled={generating}>
            <Send aria-hidden="true" /> {generating ? "Drafting campaign" : "Draft campaign"}
          </button>
          {canCancel ? (
            <button
              className="button secondary"
              type="button"
              disabled={generating}
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}

function CampaignsPage({
  campaign,
  counts,
  stage,
  saving,
  navigate,
  approveCampaign,
}: {
  campaign: Campaign;
  counts: Record<Filter, number>;
  stage: Stage;
  saving: boolean;
  navigate: (view: View) => void;
  approveCampaign: () => void;
}) {
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Plan, review, publish, and measure one focused campaign at a time."
        action={
          <button className="button dark" type="button" onClick={() => navigate("new-campaign")}>
            <Plus aria-hidden="true" /> New campaign
          </button>
        }
      />
      <CampaignProgress status={stage} />
      <section className="campaign-feature">
        <div className="campaign-feature-copy">
          <span className={`status-tag ${statusClass(campaignLabels[campaign.status])}`}>
            {campaignLabels[campaign.status]}
          </span>
          <div className="campaign-feature-title">
            <ProductMark
              className="title-mark"
              name={campaign.product_name}
              iconUrl={campaign.product_icon_url}
            />
            <h2>{campaign.name}</h2>
          </div>
          <p>{campaign.positioning}</p>
          <dl>
            <div>
              <dt>Objective</dt>
              <dd>{campaign.objective}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>{scheduleRange(campaign)}</dd>
            </div>
            <div>
              <dt>Content</dt>
              <dd>
                {counts.All} posts across {campaign.channels.length} channel
                {campaign.channels.length === 1 ? "" : "s"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="campaign-feature-actions">
          <button className="button outline" type="button" onClick={() => navigate("content")}>
            Review content
          </button>
          {campaign.status === "approved" ? (
            <TestPurchaseButton className="button accent" onClick={() => navigate("checkout")} />
          ) : (
            <button
              className="button accent"
              type="button"
              onClick={approveCampaign}
              disabled={saving}
            >
              <Check aria-hidden="true" /> Approve campaign
            </button>
          )}
        </div>
      </section>
      <ActivityPanel campaign={campaign} />
    </>
  );
}

function ActivityPanel({ campaign }: { campaign: Campaign }) {
  const [events, setEvents] = useState<CampaignEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    campaignApi
      .events(campaign.id)
      .then((items) => {
        if (active) setEvents(items);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [campaign]);

  const days = new Map(campaign.posts.map((post) => [post.id, post.day]));
  const time = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <section className="activity-panel" aria-label="Campaign activity">
      <div className="column-heading">
        <h2>Activity</h2>
        <span>Every agent output and human decision is recorded</span>
      </div>
      {failed ? <p className="inline-error">Activity could not be loaded.</p> : null}
      <ol>
        {(events ?? []).slice(0, 12).map((event, index) => (
          <li className="reveal" style={{ "--i": index } as React.CSSProperties} key={event.id}>
            <span className={`activity-actor ${event.actor}`}>{event.actor}</span>
            <strong>
              {eventLabels[event.action] ?? event.action}
              {event.post_id && days.has(event.post_id) ? ` · day ${days.get(event.post_id)}` : ""}
            </strong>
            <time dateTime={event.created_at}>{time.format(new Date(event.created_at))}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ContentPage({
  campaign,
  counts,
  posts,
  filter,
  stage,
  selected,
  editingBody,
  saving,
  approveCampaign,
  approvePost,
  requestChanges,
  saveEdits,
  selectFilter,
  selectPost,
  setEditingBody,
  openCheckout,
}: {
  campaign: Campaign;
  openCheckout: () => void;
  counts: Record<Filter, number>;
  posts: Post[];
  filter: Filter;
  stage: Stage;
  selected: Post;
  editingBody: string | null;
  saving: boolean;
  approveCampaign: () => void;
  approvePost: () => void;
  requestChanges: (note: string) => Promise<boolean>;
  saveEdits: () => Promise<void>;
  selectFilter: (filter: Filter) => void;
  selectPost: (id: string) => void;
  setEditingBody: (body: string | null) => void;
}) {
  const selectedStatus = statusFor(selected);
  return (
    <>
      <PageHeader
        title="Content"
        description="A compact review queue for the work that is almost ready to publish."
      />
      <CampaignProgress status={stage} />
      <fieldset className="filter-row" aria-label="Filter content queue">
        {(["All", "Needs review", "Changes requested", "Approved"] as Filter[]).map((item) => (
          <button
            type="button"
            className={filter === item ? "active" : ""}
            aria-pressed={filter === item}
            onClick={() => selectFilter(item)}
            key={item}
          >
            {item} · {counts[item]}
          </button>
        ))}
      </fieldset>
      <section className="review-workspace">
        <section className="review-queue" aria-label="Campaign content queue">
          <div className="column-heading">
            <h2>{campaign.name}</h2>
            <span>{posts.length} posts</span>
          </div>
          {posts.length ? (
            posts.map((post, index) => {
              const status = statusFor(post);
              return (
                <button
                  type="button"
                  className={`queue-item reveal ${post.id === selected.id ? "selected" : ""}`}
                  style={{ "--i": index } as React.CSSProperties}
                  aria-pressed={post.id === selected.id}
                  onClick={() => selectPost(post.id)}
                  key={post.id}
                >
                  <span className={`status-tag ${statusClass(status)}`}>{status}</span>
                  <strong>{post.theme}</strong>
                  <small>
                    Day {post.day} · {post.channel} · {postDate(campaign, post)}
                  </small>
                </button>
              );
            })
          ) : (
            <EmptyState
              title="Nothing in this view"
              copy="Choose another filter to see the campaign content."
            />
          )}
        </section>
        <section className="post-preview-region" aria-label="Selected post preview">
          <div className="column-heading">
            <h2>Post preview</h2>
            <span>Preview only · Not published</span>
          </div>
          <article className="social-preview">
            <header>
              <span>
                <ChannelIcon channel={selected.channel} /> {selected.channel} post
              </span>
              <small>Preview</small>
            </header>
            <div className="social-preview-body">
              <ProductMark
                className="author-mark"
                name={campaign.product_name}
                iconUrl={campaign.product_icon_url}
              />
              <div className="author-copy">
                <strong>{campaign.product_name}</strong>
                <small>{campaign.name}</small>
              </div>
              {editingBody !== null ? (
                <textarea
                  aria-label="Edit post text"
                  value={editingBody}
                  onChange={(event) => setEditingBody(event.target.value)}
                />
              ) : (
                <>
                  <p>{selected.content}</p>
                  <p className="post-cta">{selected.call_to_action}</p>
                </>
              )}
            </div>
            <footer>
              <span>Publication preview</span>
              <span>{selectedStatus}</span>
            </footer>
          </article>
        </section>
        <ReviewActions
          key={selected.id}
          campaign={campaign}
          post={selected}
          editing={editingBody !== null}
          saving={saving}
          approveCampaign={approveCampaign}
          approvePost={approvePost}
          requestChanges={requestChanges}
          startEditing={() => setEditingBody(selected.content)}
          saveEdits={saveEdits}
          openCheckout={openCheckout}
        />
      </section>
    </>
  );
}

function ReviewActions({
  campaign,
  post,
  editing,
  saving,
  approveCampaign,
  approvePost,
  requestChanges,
  startEditing,
  saveEdits,
  openCheckout,
}: {
  campaign: Campaign;
  post: Post;
  editing: boolean;
  saving: boolean;
  openCheckout: () => void;
  approveCampaign: () => void;
  approvePost: () => void;
  requestChanges: (note: string) => Promise<boolean>;
  startEditing: () => void;
  saveEdits: () => Promise<void>;
}) {
  const [note, setNote] = useState<string | null>(null);

  async function submitNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (note?.trim() && (await requestChanges(note.trim()))) setNote(null);
  }

  return (
    <aside className="review-actions" aria-label="Review notes and actions">
      <div className="column-heading">
        <h2>Review notes</h2>
      </div>
      {post.status === "changes_requested" ? (
        <>
          <span className="eyebrow">Requested change</span>
          <p>{post.review_note ?? "Revise the draft before it is scheduled."}</p>
        </>
      ) : (
        <>
          <span className="eyebrow">Campaign context</span>
          <p>
            {campaign.name} · Day {post.day} · {post.theme}
          </p>
        </>
      )}
      {note !== null ? (
        <form className="note-form" onSubmit={(event) => void submitNote(event)}>
          <label htmlFor="review-note">What should change?</label>
          <textarea
            id="review-note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="form-actions">
            <button className="button dark" type="submit" disabled={saving || !note.trim()}>
              Send request
            </button>
            <button className="button secondary" type="button" onClick={() => setNote(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <div className="action-stack">
        <button
          className="button secondary"
          type="button"
          disabled={saving}
          onClick={() => (editing ? void saveEdits() : startEditing())}
        >
          <PencilLine aria-hidden="true" /> {editing ? "Save edits" : "Edit post"}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={saving || note !== null}
          onClick={() => setNote("")}
        >
          <FileText aria-hidden="true" /> Request changes
        </button>
        {post.status === "approved" ? (
          <TestPurchaseButton className="button accent" onClick={openCheckout} />
        ) : (
          <button
            className="button accent"
            type="button"
            onClick={approvePost}
            disabled={saving || editing}
          >
            <Check aria-hidden="true" /> Approve post
          </button>
        )}
        {campaign.status === "approved" ? null : (
          <button
            className="button dark"
            type="button"
            onClick={approveCampaign}
            disabled={saving || editing}
          >
            <Check aria-hidden="true" /> Approve all posts
          </button>
        )}
      </div>
    </aside>
  );
}

function CalendarPage({ campaign }: { campaign: Campaign }) {
  return (
    <>
      <PageHeader
        title="Calendar"
        description="A quiet view of what is planned, approved, and ready to publish."
        action={<span className="eyebrow">{scheduleRange(campaign)}</span>}
      />
      <section className="calendar-board">
        {campaign.posts.map((post) => (
          <article key={post.id}>
            <span className="date-chip" aria-hidden="true">
              <small>{postDate(campaign, post).split(" ")[0]}</small>
              <strong>{postDate(campaign, post).split(" ")[1]}</strong>
            </span>
            <div>
              <ChannelIcon channel={post.channel} />
              <span>{post.channel}</span>
            </div>
            <h2>{post.theme}</h2>
            <span className={`status-tag ${statusClass(statusFor(post))}`}>{statusFor(post)}</span>
          </article>
        ))}
      </section>
    </>
  );
}

function ResultsPage({
  revenue,
  revenueError,
  recommendation,
  recommendationError,
  recommendationLoading,
  findNextMove,
  openCheckout,
  navigate,
}: {
  revenue: RevenueSummary | null;
  revenueError: boolean;
  recommendation: Recommendation | null;
  recommendationError: string | null;
  recommendationLoading: boolean;
  findNextMove: () => Promise<void>;
  openCheckout: () => void;
  navigate: (view: View) => void;
}) {
  const hasRevenue = Boolean(revenue?.completed_orders);
  return (
    <>
      <PageHeader
        title="Results"
        description="Verified outcomes from connected providers, separated from estimates."
        action={
          <button
            className="button secondary"
            type="button"
            onClick={() => navigate("integrations")}
          >
            Manage sources
          </button>
        }
      />
      <section className="metric-strip results-metrics">
        <Metric
          icon={<CreditCard aria-hidden="true" />}
          label="Verified revenue"
          value={
            revenue
              ? formatMoney(revenue.gross_revenue, revenue.currency)
              : revenueError
                ? "Unavailable"
                : "Loading"
          }
          detail="PayPal Sandbox"
          tone={revenue?.completed_orders ? "success" : "neutral"}
        />
        <Metric
          icon={<Receipt aria-hidden="true" />}
          label="Completed orders"
          value={String(revenue?.completed_orders ?? 0)}
          detail={revenue?.latest_capture_id ? "Capture verified" : "No capture yet"}
          tone={revenue?.latest_capture_id ? "success" : "neutral"}
        />
        <Metric
          icon={<TrendingUp aria-hidden="true" />}
          label="Trial to paid"
          value="Not connected"
          detail="Connect PostHog"
          tone="neutral"
          muted
        />
        <Metric
          icon={<Send aria-hidden="true" />}
          label="Published reach"
          value="Not connected"
          detail="Connect a social channel"
          tone="neutral"
          muted
        />
      </section>
      <section className="results-body">
        <div className="plain-panel">
          <div className="provider-heading">
            <SiPaypal aria-hidden="true" />
            <span>PayPal</span>
          </div>
          <h2>{hasRevenue ? "Verified purchase activity" : "No purchase activity yet"}</h2>
          <p>
            {hasRevenue
              ? `GrowthReceipt received ${revenue?.completed_orders} completed sandbox order${revenue?.completed_orders === 1 ? "" : "s"}.`
              : "Complete a sandbox checkout to verify attribution from campaign to revenue."}
          </p>
          <button className="button dark" type="button" onClick={openCheckout}>
            Preview checkout
          </button>
        </div>
        <div className="plain-panel">
          <div className="provider-heading">
            <TrendingUp aria-hidden="true" />
            <span>Next move</span>
          </div>
          {recommendation ? (
            <>
              <span className="status-tag success">{recommendation.confidence} confidence</span>
              <h2>{recommendation.recommendation}</h2>
              <p>{recommendation.rationale}</p>
              <strong className="expected-signal">
                Look for: {recommendation.expected_signal}
              </strong>
            </>
          ) : (
            <>
              <h2>Choose the next test from real results.</h2>
              <p>
                GrowthReceipt needs at least one verified purchase before it recommends a message,
                channel, or audience test.
              </p>
              <button
                className="button accent"
                disabled={!hasRevenue || recommendationLoading}
                type="button"
                onClick={() => void findNextMove()}
              >
                {recommendationLoading ? "Reviewing results" : "Find next move"}
              </button>
            </>
          )}
          {recommendationError ? <p className="inline-error">{recommendationError}</p> : null}
        </div>
      </section>
    </>
  );
}

function ExperimentPage({
  revenue,
  recommendation,
  recommendationError,
  recommendationLoading,
  findNextMove,
  navigate,
}: {
  revenue: RevenueSummary | null;
  recommendation: Recommendation | null;
  recommendationError: string | null;
  recommendationLoading: boolean;
  findNextMove: () => Promise<void>;
  navigate: (view: View) => void;
}) {
  const ready = Boolean(revenue?.completed_orders);
  return (
    <>
      <PageHeader
        title="Next experiment"
        description="One evidence based test, chosen after the current campaign has something real to teach us."
      />
      <section className="experiment-stage">
        {recommendation ? (
          <div>
            <span className="status-tag success">{recommendation.confidence} confidence</span>
            <h2>{recommendation.recommendation}</h2>
            <p>{recommendation.rationale}</p>
            <dl>
              <div>
                <dt>Evidence</dt>
                <dd>{recommendation.evidence_summary}</dd>
              </div>
              <div>
                <dt>Expected signal</dt>
                <dd>{recommendation.expected_signal}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div>
            <span className={`status-tag ${ready ? "success" : "neutral"}`}>
              {ready ? "Ready" : "Waiting for evidence"}
            </span>
            <h2>
              {ready
                ? "A recommendation is ready to prepare."
                : "Complete one verified purchase first."}
            </h2>
            <p>
              {ready
                ? "GrowthReceipt can now inspect the campaign result and propose one controlled next step."
                : "This keeps the recommendation grounded in a real outcome instead of invented performance data."}
            </p>
            <div className="form-actions">
              {!ready ? (
                <button className="button dark" type="button" onClick={() => navigate("checkout")}>
                  Open checkout preview
                </button>
              ) : null}
              <button
                className={`button ${ready ? "dark" : "outline"}`}
                type="button"
                disabled={!ready || recommendationLoading}
                onClick={() => void findNextMove()}
              >
                {recommendationLoading ? "Reviewing results" : "Prepare next experiment"}
              </button>
            </div>
            {recommendationError ? <p className="inline-error">{recommendationError}</p> : null}
          </div>
        )}
      </section>
    </>
  );
}

function IntegrationsPage({
  navigate,
  notify,
}: {
  navigate: (view: View) => void;
  notify: (message: string) => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Integrations"
        description="Connect the sources GrowthReceipt needs to publish work and verify what happened."
      />
      <section className="integration-list">
        <Integration
          provider="PayPal Sandbox"
          description="Checkout, capture, and verified campaign revenue."
          icon={<SiPaypal aria-hidden="true" />}
          status="Connected"
          action="Open checkout"
          onAction={() => navigate("checkout")}
        />
        <Integration
          provider="PostHog"
          description="Product activation, trials, and conversion events."
          icon={<SiPosthog aria-hidden="true" />}
          status="Not connected"
          action="Connect"
          onAction={() => notify("PostHog connection is planned for the next integration slice.")}
        />
        {channels.map((channel) => (
          <Integration
            key={channel}
            provider={channel}
            description={channelIntegration[channel]}
            icon={<ChannelIcon channel={channel} />}
            status="Not connected"
            action="Connect"
            onAction={() => notify(`${channel} publishing is not connected yet.`)}
          />
        ))}
      </section>
    </>
  );
}

function SettingsPage({ notify }: { notify: (message: string) => void }) {
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Workspace defaults for review, publishing, and measurement."
      />
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          notify("Workspace settings saved.");
        }}
      >
        <fieldset>
          <legend>Workspace</legend>
          <label htmlFor="workspace-name">Workspace name</label>
          <input id="workspace-name" defaultValue="GrowthReceipt demo" />
          <label htmlFor="timezone">Timezone</label>
          <select id="timezone" defaultValue="Europe/Stockholm">
            <option value="Europe/Stockholm">Europe / Stockholm</option>
            <option value="UTC">UTC</option>
          </select>
        </fieldset>
        <fieldset>
          <legend>Approval</legend>
          <label className="check-row">
            <input type="checkbox" defaultChecked />
            <span>
              <strong>Require approval before publishing</strong>
              <small>
                GrowthReceipt will never publish campaign content without a human decision.
              </small>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" defaultChecked />
            <span>
              <strong>Keep verified and estimated results separate</strong>
              <small>Unverified values will remain visibly labelled.</small>
            </span>
          </label>
        </fieldset>
        <button className="button dark" type="submit">
          Save settings
        </button>
      </form>
    </>
  );
}

function CheckoutPage({
  post,
  revenue,
  openCheckout,
}: {
  post: Post | null;
  revenue: RevenueSummary | null;
  openCheckout: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Customer view"
        title="Buy as your customer"
        description="This is what a customer sees after clicking one of your posts. Pay with a PayPal sandbox account. The payment goes to you, and GrowthReceipt credits it to the post that brought it."
      />
      <section className="checkout-preview-card">
        <div>
          <span className="eyebrow">LaunchCheck scan pack</span>
          <h2>Find what breaks a launch before your visitors do.</h2>
          <p>10 extra page scans, paid once. Use them across your launch week.</p>
          <ul>
            <li>
              <Check aria-hidden="true" /> 10 scans for speed, SEO and page structure
            </li>
            <li>
              <Check aria-hidden="true" /> A clear fix for every problem found
            </li>
            <li>
              <Check aria-hidden="true" /> One payment, no subscription
            </li>
          </ul>
        </div>
        <div className="checkout-offer">
          <SiPaypal aria-hidden="true" />
          <span>PayPal Sandbox</span>
          <strong>{formatMoney("9.00", "USD")}</strong>
          <p>Sandbox only. No real money moves.</p>
          {post ? (
            <small>
              Credited to day {post.day} · {post.channel} · {post.theme}
            </small>
          ) : null}
          <button className="button dark" type="button" onClick={openCheckout} disabled={!post}>
            Pay with PayPal
          </button>
          {post ? null : (
            <small>Approve a post first. Customers arrive from posts you approved.</small>
          )}
          {revenue?.latest_capture_id ? (
            <small>Latest capture: {revenue.latest_capture_id}</small>
          ) : null}
        </div>
      </section>
    </>
  );
}

function TestPurchaseButton({ className, onClick }: { className: string; onClick: () => void }) {
  const tipId = useId();
  return (
    <span className="tip-anchor">
      <button className={className} type="button" onClick={onClick} aria-describedby={tipId}>
        <CreditCard aria-hidden="true" /> Make a test purchase
      </button>
      <span className="tip" id={tipId} role="tooltip">
        You act as your own customer. Pay with a PayPal sandbox account, so no real money moves. The
        payment is credited to the post it came from.
      </span>
    </span>
  );
}

function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && onAction ? (
        <button type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
function EmptyState({
  title,
  copy,
  action,
  onAction,
  boxed = false,
}: {
  title: string;
  copy: string;
  action?: string;
  onAction?: () => void;
  boxed?: boolean;
}) {
  return (
    <div className={`empty-state ${boxed ? "boxed" : ""}`} role={boxed ? "alert" : undefined}>
      <strong>{title}</strong>
      <p>{copy}</p>
      {action && onAction ? (
        <button className="text-button" type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
function WorkspaceSkeleton() {
  return (
    <section className="skeleton" aria-busy="true" aria-label="Loading your campaign">
      <div className="skeleton-block heading" />
      <div className="skeleton-row">
        <div className="skeleton-block card" />
        <div className="skeleton-block card" />
        <div className="skeleton-block card" />
      </div>
      <div className="skeleton-block panel" />
    </section>
  );
}

function AgentSteps({
  progress,
  thought,
  productName,
}: {
  progress: DraftProgress | null;
  thought: string | null;
  productName: string;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const current = progress ? draftSteps.findIndex(([stage]) => stage === progress.stage) : 0;
  return (
    <section className="agent-steps" aria-label="Campaign agent progress">
      <div className="agent-steps-heading">
        <strong>Drafting {productName || "your"} campaign</strong>
        <span aria-hidden="true">{seconds}s</span>
      </div>
      <ol>
        {draftSteps.map(([stage, label], index) => {
          const state = index < current ? "done" : index === current ? "active" : "pending";
          const writing = stage === "writing" && progress && index <= current;
          return (
            <li
              className={`agent-step ${state}`}
              key={stage}
              aria-current={state === "active" ? "step" : undefined}
            >
              <span className="agent-step-marker" aria-hidden="true">
                {state === "done" ? <Check /> : null}
              </span>
              <div>
                <span>
                  {writing
                    ? `Writing post ${Math.max(progress.items, 1)} of ${progress.total}`
                    : label}
                </span>
                {stage === "thinking" && thought && state !== "pending" ? (
                  <p className="agent-thought">{thought}</p>
                ) : null}
                {writing ? (
                  <div
                    className="agent-meter"
                    role="progressbar"
                    aria-label="Posts written"
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.items}
                  >
                    <span style={{ width: `${(progress.items / progress.total) * 100}%` }} />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status">
        {progress ? draftSteps[current]?.[1] : "Sending brief"}
      </p>
    </section>
  );
}

function Integration({
  provider,
  description,
  icon,
  status,
  action,
  onAction,
}: {
  provider: string;
  description: string;
  icon: React.ReactNode;
  status: "Connected" | "Not connected";
  action: string;
  onAction: () => void;
}) {
  return (
    <article className="integration-row">
      <span className="integration-icon">{icon}</span>
      <div>
        <h2>{provider}</h2>
        <p>{description}</p>
      </div>
      <span className={`status-tag ${status === "Connected" ? "success" : "neutral"}`}>
        {status}
      </span>
      <button className="button secondary" type="button" onClick={onAction}>
        {action}
      </button>
    </article>
  );
}
function statusClass(status: string) {
  if (status === "Approved" || status === "Connected") return "success";
  if (status === "Changes requested") return "danger";
  if (status === "Review" || status === "Needs review") return "review";
  return "neutral";
}
const ICON_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ICON_SIZE = 160;

// Crop to a centered square and shrink, so the icon is small enough to store with the campaign.
async function squareIcon(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  const side = Math.min(bitmap.width, bitmap.height);
  const left = (bitmap.width - side) / 2;
  const top = (bitmap.height - side) / 2;
  context.drawImage(bitmap, left, top, side, side, 0, 0, ICON_SIZE, ICON_SIZE);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.9);
  // Older Safari cannot encode WebP and silently returns PNG instead.
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

function ProductMark({
  name,
  iconUrl,
  className,
  onLoadResult,
}: {
  name: string;
  iconUrl: string | null;
  className: string;
  onLoadResult?: (loaded: boolean) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showIcon = iconUrl && iconUrl !== failedUrl;
  return (
    <span className={`product-mark ${className}`} aria-hidden="true">
      {showIcon ? (
        // Product icons are arbitrary user links, so next/image remote patterns do not fit.
        // biome-ignore lint/performance/noImgElement: see above
        <img
          src={iconUrl}
          alt=""
          onLoad={() => onLoadResult?.(true)}
          onError={() => {
            setFailedUrl(iconUrl);
            onLoadResult?.(false);
          }}
        />
      ) : (
        name.trim().charAt(0).toUpperCase() || "P"
      )}
    </span>
  );
}

const channelIntegration: Record<Channel, string> = {
  LinkedIn: "Publish approved posts and collect delivery results.",
  Facebook: "Publish approved posts to Pages and collect delivery results.",
  X: "Publish approved posts and collect delivery results.",
  Instagram: "Publish approved posts and collect delivery results.",
};

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === "LinkedIn") return <FaLinkedinIn aria-hidden="true" />;
  if (channel === "Facebook") return <FaFacebookF aria-hidden="true" />;
  if (channel === "Instagram") return <FaInstagram aria-hidden="true" />;
  return <FaXTwitter aria-hidden="true" />;
}
