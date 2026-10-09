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
  Search,
  Send,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FaInstagram, FaLinkedinIn, FaXTwitter } from "react-icons/fa6";
import { SiPaypal, SiPosthog } from "react-icons/si";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { type Channel, type ContentItem, contentItems } from "@/lib/campaign";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

type View =
  | "today"
  | "products"
  | "campaigns"
  | "content"
  | "calendar"
  | "results"
  | "experiment"
  | "integrations"
  | "settings"
  | "checkout";
type Filter = "All" | "Needs review" | "Changes requested" | "Approved";
type ReviewStatus = Exclude<Filter, "All">;

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
  ["checkout", "Checkout preview", CreditCard],
] as const;
const viewLabels: Record<View, string> = {
  today: "Today",
  products: "Products",
  campaigns: "Campaigns",
  content: "Content",
  calendar: "Calendar",
  results: "Results",
  experiment: "Next experiment",
  integrations: "Integrations",
  settings: "Settings",
  checkout: "Checkout preview",
};
const reviewNotes: Partial<Record<number, string>> = {
  2: "Make the opening more specific to the moment of interruption. Keep the final sentence.",
};

export function CampaignWorkspace() {
  const [view, setView] = useState<View>("today");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(1);
  const [filter, setFilter] = useState<Filter>("All");
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState(contentItems);
  const [approvedIds, setApprovedIds] = useState(() => new Set<number>([3]));
  const [toast, setToast] = useState<string | null>(null);
  const [campaignStatus, setCampaignStatus] = useState("In review");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [revenueError, setRevenueError] = useState(false);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);

  const selected = useMemo(
    () => drafts.find((item) => item.id === selectedId) ?? drafts[0],
    [drafts, selectedId],
  );
  const statusFor = useCallback(
    (item: ContentItem): ReviewStatus => {
      if (approvedIds.has(item.id)) return "Approved";
      if (item.status === "Changes requested") return "Changes requested";
      return "Needs review";
    },
    [approvedIds],
  );
  const filteredDrafts = useMemo(
    () => drafts.filter((item) => filter === "All" || statusFor(item) === filter),
    [drafts, filter, statusFor],
  );
  const counts = useMemo(
    () => ({
      All: drafts.length,
      "Needs review": drafts.filter((item) => statusFor(item) === "Needs review").length,
      "Changes requested": drafts.filter((item) => statusFor(item) === "Changes requested").length,
      Approved: drafts.filter((item) => statusFor(item) === "Approved").length,
    }),
    [drafts, statusFor],
  );

  const loadRevenue = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/paypal/revenue/${CAMPAIGN_ID}`);
      if (!response.ok) throw new Error("Results are unavailable");
      setRevenue((await response.json()) as RevenueSummary);
      setRevenueError(false);
    } catch {
      setRevenueError(true);
    }
  }, []);

  useEffect(() => {
    void loadRevenue();
  }, [loadRevenue]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }

  function navigate(nextView: View) {
    setView(nextView);
    setMobileNavigationOpen(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    const firstMatch = drafts.find(
      (item) => nextFilter === "All" || statusFor(item) === nextFilter,
    );
    if (firstMatch) setSelectedId(firstMatch.id);
    setIsEditing(false);
  }

  function saveBody(body: string) {
    setDrafts((items) => items.map((item) => (item.id === selected.id ? { ...item, body } : item)));
  }

  function approvePost() {
    setApprovedIds((ids) => new Set(ids).add(selected.id));
    setDrafts((items) =>
      items.map((item) => (item.id === selected.id ? { ...item, status: "Ready" } : item)),
    );
    notify("Post approved.");
  }

  function approveCampaign() {
    setApprovedIds(new Set(drafts.map((item) => item.id)));
    setCampaignStatus("Approved");
    notify("Campaign approved. Connect a channel when you are ready to publish.");
  }

  function requestChanges() {
    setApprovedIds((ids) => {
      const next = new Set(ids);
      next.delete(selected.id);
      return next;
    });
    setDrafts((items) =>
      items.map((item) =>
        item.id === selected.id ? { ...item, status: "Changes requested" } : item,
      ),
    );
    setCampaignStatus("Changes requested");
    notify(`Changes requested for day ${selected.day}.`);
  }

  async function findNextMove() {
    setRecommendationLoading(true);
    setRecommendationError(null);
    try {
      const response = await fetch(`${API_URL}/v1/agents/next-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: CAMPAIGN_ID,
          product_name: "Scribe",
          campaign_name: "Professional communication week",
          objective: "Increase qualified app installs",
          audience: "Knowledge workers aged 25 to 40",
        }),
      });
      if (!response.ok) throw new Error("A next move could not be prepared right now.");
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

  return (
    <div className="northstar-app" data-theme={theme}>
      <Sidebar
        currentView={view}
        isOpen={mobileNavigationOpen}
        navigate={navigate}
        onClose={() => setMobileNavigationOpen(false)}
        notify={notify}
      />
      <div className="app-stage">
        <Topbar
          currentView={view}
          theme={theme}
          searchOpen={searchOpen}
          onMenu={() => setMobileNavigationOpen(true)}
          onSearch={() => setSearchOpen((open) => !open)}
          onTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
          notify={notify}
        />
        <main className="page-shell">
          {view === "today" ? (
            <TodayPage
              revenue={revenue}
              revenueError={revenueError}
              campaignStatus={campaignStatus}
              needsReview={counts["Needs review"] + counts["Changes requested"]}
              navigate={navigate}
            />
          ) : null}
          {view === "products" ? <ProductsPage navigate={navigate} /> : null}
          {view === "campaigns" ? (
            <CampaignsPage
              campaignStatus={campaignStatus}
              counts={counts}
              navigate={navigate}
              approveCampaign={approveCampaign}
            />
          ) : null}
          {view === "content" ? (
            <ContentPage
              approvedIds={approvedIds}
              counts={counts}
              drafts={filteredDrafts}
              filter={filter}
              isEditing={isEditing}
              selected={selected}
              approveCampaign={approveCampaign}
              approvePost={approvePost}
              requestChanges={requestChanges}
              saveBody={saveBody}
              selectFilter={selectFilter}
              selectPost={(id) => {
                setSelectedId(id);
                setIsEditing(false);
              }}
              setIsEditing={setIsEditing}
              statusFor={statusFor}
              notify={notify}
            />
          ) : null}
          {view === "calendar" ? <CalendarPage drafts={drafts} statusFor={statusFor} /> : null}
          {view === "results" ? (
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
          ) : null}
          {view === "experiment" ? (
            <ExperimentPage
              revenue={revenue}
              recommendation={recommendation}
              recommendationError={recommendationError}
              recommendationLoading={recommendationLoading}
              findNextMove={findNextMove}
              navigate={navigate}
            />
          ) : null}
          {view === "integrations" ? (
            <IntegrationsPage navigate={navigate} notify={notify} />
          ) : null}
          {view === "settings" ? <SettingsPage notify={notify} /> : null}
          {view === "checkout" ? (
            <CheckoutPage revenue={revenue} openCheckout={() => setCheckoutOpen(true)} />
          ) : null}
        </main>
      </div>
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
      {checkoutOpen ? (
        <PayPalCheckout
          onClose={() => setCheckoutOpen(false)}
          onCaptured={async () => {
            await loadRevenue();
            setRecommendation(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Sidebar({
  currentView,
  isOpen,
  navigate,
  onClose,
  notify,
}: {
  currentView: View;
  isOpen: boolean;
  navigate: (view: View) => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
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
              <Send aria-hidden="true" />
            </span>
            <span>northstar</span>
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
          <span className="product-dot" />
          <strong>Scribe</strong>
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
            <span /> Demo workspace · Local
          </div>
          <button
            type="button"
            onClick={() => notify("Workspace settings are available from Settings.")}
          >
            <span className="avatar">S</span>
            <strong>Workspace owner</strong>
            <ChevronDown aria-hidden="true" />
          </button>
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
  theme,
  searchOpen,
  onMenu,
  onSearch,
  onTheme,
  notify,
}: {
  currentView: View;
  theme: "light" | "dark";
  searchOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  onTheme: () => void;
  notify: (message: string) => void;
}) {
  return (
    <header className="topbar">
      <button className="mobile-menu" type="button" onClick={onMenu} aria-label="Open navigation">
        <Menu aria-hidden="true" />
      </button>
      <div className="breadcrumbs">
        <span>Scribe</span>
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
        <button
          type="button"
          onClick={() => notify("Help center is not connected in this prototype.")}
          aria-label="Help"
        >
          <CircleHelp aria-hidden="true" />
        </button>
        <button
          className="topbar-avatar"
          type="button"
          onClick={() => notify("Signed in as workspace owner.")}
          aria-label="Workspace owner"
        >
          S
        </button>
      </div>
    </header>
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

function CampaignProgress({
  status = "Approval",
}: {
  status?: "Approval" | "Publishing" | "Measurement";
}) {
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

function TodayPage({
  revenue,
  revenueError,
  campaignStatus,
  needsReview,
  navigate,
}: {
  revenue: RevenueSummary | null;
  revenueError: boolean;
  campaignStatus: string;
  needsReview: number;
  navigate: (view: View) => void;
}) {
  const [date, setDate] = useState("Today in Stockholm");

  useEffect(() => {
    setDate(
      new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Stockholm",
      }).format(new Date()),
    );
  }, []);
  return (
    <>
      <PageHeader
        eyebrow={date}
        title="Today"
        description="The small set of decisions that keeps Scribe moving."
        action={
          <button className="button dark" type="button" onClick={() => navigate("campaigns")}>
            Continue campaign
          </button>
        }
      />
      <CampaignProgress />
      <section className="signal-row" aria-label="Workspace summary">
        <Signal
          label="Campaign status"
          value={campaignStatus}
          detail={`${needsReview} posts need a decision`}
        />
        <Signal label="Next publish" value="Thu 10:00" detail="LinkedIn · Launch week" />
        <Signal
          label="Verified revenue"
          value={
            revenue
              ? `${revenue.gross_revenue} ${revenue.currency}`
              : revenueError
                ? "Unavailable"
                : "Loading"
          }
          detail={revenue?.latest_capture_id ? "Verified by PayPal" : "Waiting for PayPal data"}
        />
        <Signal label="Trial to paid" value="Not connected" detail="Waiting for PostHog data" />
      </section>
      <section className="two-column-section">
        <div>
          <SectionTitle
            title="Needs your attention"
            action="View content queue"
            onAction={() => navigate("content")}
          />
          <AttentionRow
            channel="LinkedIn"
            title="A clearer way to write at work"
            detail="Launch week · LinkedIn post"
            status="Review"
          />
          <AttentionRow
            channel="X"
            title="Turn ideas into clear messages"
            detail="Changes requested before it can be scheduled"
            status="Changes requested"
          />
        </div>
        <div>
          <SectionTitle
            title="Publishing next"
            action="Open calendar"
            onAction={() => navigate("calendar")}
          />
          <AttentionRow
            channel="LinkedIn"
            title="A better writing flow for busy days"
            detail="Launch week · Thu 10:00"
            status="Scheduled"
          />
          <AttentionRow
            channel="Instagram"
            title="Scribe in one sentence"
            detail="Launch week · Fri 12:30"
            status="Approved"
          />
        </div>
      </section>
      <section className="lower-grid">
        <div className="plain-panel">
          <h2>Recent results</h2>
          {revenue?.completed_orders ? (
            <>
              <strong className="result-value">
                {revenue.gross_revenue} {revenue.currency}
              </strong>
              <p>
                {revenue.completed_orders} verified PayPal sandbox purchase
                {revenue.completed_orders === 1 ? "" : "s"}.
              </p>
            </>
          ) : (
            <EmptyState
              title="No connected results yet"
              copy="Complete a PayPal sandbox purchase or connect PostHog to see verified activity."
              action="Open checkout"
              onAction={() => navigate("checkout")}
            />
          )}
        </div>
        <div className="plain-panel">
          <h2>Next experiment</h2>
          <EmptyState
            title="No recommendation yet"
            copy="Northstar will use verified campaign results to choose a useful test."
            action="See what is needed"
            onAction={() => navigate("experiment")}
          />
        </div>
      </section>
    </>
  );
}

function ProductsPage({ navigate }: { navigate: (view: View) => void }) {
  return (
    <>
      <PageHeader
        title="Products"
        description="The source material Northstar uses to understand what you sell."
        action={
          <button className="button dark" type="button">
            <Plus aria-hidden="true" /> Add product
          </button>
        }
      />
      <section className="product-hero">
        <div className="product-avatar">S</div>
        <div>
          <span className="status-tag success">Active</span>
          <h2>Scribe</h2>
          <p>
            A writing keyboard that helps professionals turn rough thoughts into clear messages
            wherever they type.
          </p>
        </div>
        <button className="button secondary" type="button" onClick={() => navigate("campaigns")}>
          View campaigns
        </button>
      </section>
      <section className="detail-columns">
        <div>
          <span className="eyebrow">Positioning</span>
          <h3>Clear writing without another place to work.</h3>
          <p>
            Scribe stays close to the moment of writing. It improves the words without interrupting
            the thought.
          </p>
        </div>
        <div>
          <span className="eyebrow">Audience</span>
          <h3>Professionals who write all day.</h3>
          <p>Knowledge workers aged 25 to 40 who value speed, clarity, and a natural voice.</p>
        </div>
        <div>
          <span className="eyebrow">Primary goal</span>
          <h3>Qualified app installs.</h3>
          <p>Attract people whose daily work depends on clear communication.</p>
        </div>
      </section>
    </>
  );
}

function CampaignsPage({
  campaignStatus,
  counts,
  navigate,
  approveCampaign,
}: {
  campaignStatus: string;
  counts: Record<Filter, number>;
  navigate: (view: View) => void;
  approveCampaign: () => void;
}) {
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Plan, review, publish, and measure one focused campaign at a time."
        action={
          <button className="button dark" type="button">
            <Plus aria-hidden="true" /> New campaign
          </button>
        }
      />
      <CampaignProgress />
      <section className="campaign-feature">
        <div className="campaign-number">01</div>
        <div className="campaign-feature-copy">
          <span className="status-tag review">{campaignStatus}</span>
          <h2>Launch week</h2>
          <p>
            Introduce Scribe through seven concise examples of better writing in the moments
            professionals already know.
          </p>
          <dl>
            <div>
              <dt>Objective</dt>
              <dd>Increase qualified app installs</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>12 to 18 October</dd>
            </div>
            <div>
              <dt>Content</dt>
              <dd>{counts.All} posts across three channels</dd>
            </div>
          </dl>
        </div>
        <div className="campaign-feature-actions">
          <button className="button secondary" type="button" onClick={() => navigate("content")}>
            Review content
          </button>
          <button className="button accent" type="button" onClick={approveCampaign}>
            <Check aria-hidden="true" /> Approve campaign
          </button>
        </div>
      </section>
    </>
  );
}

function ContentPage({
  approvedIds,
  counts,
  drafts,
  filter,
  isEditing,
  selected,
  approveCampaign,
  approvePost,
  requestChanges,
  saveBody,
  selectFilter,
  selectPost,
  setIsEditing,
  statusFor,
  notify,
}: {
  approvedIds: Set<number>;
  counts: Record<Filter, number>;
  drafts: ContentItem[];
  filter: Filter;
  isEditing: boolean;
  selected: ContentItem;
  approveCampaign: () => void;
  approvePost: () => void;
  requestChanges: () => void;
  saveBody: (body: string) => void;
  selectFilter: (filter: Filter) => void;
  selectPost: (id: number) => void;
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  statusFor: (item: ContentItem) => ReviewStatus;
  notify: (message: string) => void;
}) {
  const selectedStatus = statusFor(selected);
  return (
    <>
      <PageHeader
        title="Content"
        description="A compact review queue for the work that is almost ready to publish."
        action={
          <button
            className="button dark"
            type="button"
            onClick={() => notify("A new draft flow is planned for the next build.")}
          >
            <Plus aria-hidden="true" /> Add post
          </button>
        }
      />
      <CampaignProgress />
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
            <h2>Launch week</h2>
            <span>{drafts.length} posts</span>
          </div>
          {drafts.length ? (
            drafts.map((item) => {
              const status = statusFor(item);
              return (
                <button
                  type="button"
                  className={`queue-item ${item.id === selected.id ? "selected" : ""}`}
                  aria-pressed={item.id === selected.id}
                  onClick={() => selectPost(item.id)}
                  key={item.id}
                >
                  <span className={`status-tag ${statusClass(status)}`}>{status}</span>
                  <strong>{item.theme}</strong>
                  <small>
                    {item.channel} · {item.date}
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
              <div className="author-mark">S</div>
              <div className="author-copy">
                <strong>Scribe</strong>
                <small>Launch week</small>
              </div>
              {isEditing ? (
                <textarea
                  aria-label="Edit post text"
                  value={selected.body}
                  onChange={(event) => saveBody(event.target.value)}
                />
              ) : (
                <p>{selected.body}</p>
              )}
            </div>
            <footer>
              <span>Publication preview</span>
              <span>{selectedStatus}</span>
            </footer>
          </article>
        </section>
        <aside className="review-actions" aria-label="Review notes and actions">
          <div className="column-heading">
            <h2>Review notes</h2>
          </div>
          {selectedStatus === "Changes requested" ? (
            <>
              <span className="eyebrow">Requested change</span>
              <p>{reviewNotes[selected.id] ?? "Revise the draft before it is scheduled."}</p>
            </>
          ) : (
            <>
              <span className="eyebrow">Campaign context</span>
              <p>Launch week · Scribe</p>
            </>
          )}
          <div className="action-stack">
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                if (isEditing) notify("Post edits saved.");
                setIsEditing((value) => !value);
              }}
            >
              <PencilLine aria-hidden="true" /> {isEditing ? "Save edits" : "Edit post"}
            </button>
            <button className="button secondary" type="button" onClick={requestChanges}>
              <FileText aria-hidden="true" /> Request changes
            </button>
            <button
              className="button accent"
              type="button"
              onClick={approvePost}
              disabled={approvedIds.has(selected.id)}
            >
              <Check aria-hidden="true" />{" "}
              {approvedIds.has(selected.id) ? "Post approved" : "Approve post"}
            </button>
            <button className="button dark" type="button" onClick={approveCampaign}>
              <Check aria-hidden="true" /> Approve campaign
            </button>
          </div>
        </aside>
      </section>
    </>
  );
}

function CalendarPage({
  drafts,
  statusFor,
}: {
  drafts: ContentItem[];
  statusFor: (item: ContentItem) => ReviewStatus;
}) {
  return (
    <>
      <PageHeader
        title="Calendar"
        description="A quiet view of what is planned, approved, and ready to publish."
        action={
          <button className="button secondary" type="button">
            October 2026 <ChevronDown aria-hidden="true" />
          </button>
        }
      />
      <section className="calendar-board">
        {drafts.map((item) => (
          <article key={item.id}>
            <span className="calendar-date">{item.date.replace("Oct ", "")}</span>
            <div>
              <ChannelIcon channel={item.channel} />
              <span>{item.channel}</span>
            </div>
            <h2>{item.theme}</h2>
            <span className={`status-tag ${statusClass(statusFor(item))}`}>{statusFor(item)}</span>
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
      <section className="signal-row results-signals">
        <Signal
          label="Verified revenue"
          value={
            revenue
              ? `${revenue.gross_revenue} ${revenue.currency}`
              : revenueError
                ? "Unavailable"
                : "Loading"
          }
          detail="PayPal Sandbox"
        />
        <Signal
          label="Completed orders"
          value={String(revenue?.completed_orders ?? 0)}
          detail={revenue?.latest_capture_id ? "Capture verified" : "No capture yet"}
        />
        <Signal label="Trial to paid" value="Not connected" detail="Connect PostHog" />
        <Signal label="Published reach" value="Not connected" detail="Connect a social channel" />
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
              ? `Northstar received ${revenue?.completed_orders} completed sandbox order${revenue?.completed_orders === 1 ? "" : "s"}.`
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
                Northstar needs at least one verified purchase before it recommends a message,
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
        <span className="experiment-number">01</span>
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
            <span className="eyebrow">Waiting for evidence</span>
            <h2>
              {ready
                ? "A recommendation is ready to prepare."
                : "Complete one verified purchase first."}
            </h2>
            <p>
              {ready
                ? "Northstar can now inspect the campaign result and propose one controlled next step."
                : "This keeps the recommendation grounded in a real outcome instead of invented performance data."}
            </p>
            <button
              className="button dark"
              type="button"
              disabled={!ready || recommendationLoading}
              onClick={() => void findNextMove()}
            >
              {recommendationLoading ? "Reviewing results" : "Prepare next experiment"}
            </button>
            {!ready ? (
              <button className="text-button" type="button" onClick={() => navigate("checkout")}>
                Open checkout preview
              </button>
            ) : null}
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
        description="Connect the sources Northstar needs to publish work and verify what happened."
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
        <Integration
          provider="LinkedIn"
          description="Publish approved posts and collect delivery results."
          icon={<FaLinkedinIn aria-hidden="true" />}
          status="Not connected"
          action="Connect"
          onAction={() => notify("LinkedIn publishing is not connected yet.")}
        />
        <Integration
          provider="X"
          description="Publish approved posts and collect delivery results."
          icon={<FaXTwitter aria-hidden="true" />}
          status="Not connected"
          action="Connect"
          onAction={() => notify("X publishing is not connected yet.")}
        />
        <Integration
          provider="Instagram"
          description="Publish approved posts and collect delivery results."
          icon={<FaInstagram aria-hidden="true" />}
          status="Not connected"
          action="Connect"
          onAction={() => notify("Instagram publishing is not connected yet.")}
        />
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
          <input id="workspace-name" defaultValue="Scribe marketing" />
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
              <small>Northstar will never publish campaign content without a human decision.</small>
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
  revenue,
  openCheckout,
}: {
  revenue: RevenueSummary | null;
  openCheckout: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Checkout preview"
        description="Test the exact PayPal Sandbox purchase flow connected to this campaign."
      />
      <section className="checkout-preview-card">
        <div>
          <span className="eyebrow">Scribe Pro</span>
          <h2>Clearer writing, wherever you type.</h2>
          <p>One month of professional rewrites inside the Scribe keyboard.</p>
          <ul>
            <li>
              <Check aria-hidden="true" /> Professional rewrites
            </li>
            <li>
              <Check aria-hidden="true" /> Works inside your keyboard
            </li>
            <li>
              <Check aria-hidden="true" /> One month of access
            </li>
          </ul>
        </div>
        <div className="checkout-offer">
          <SiPaypal aria-hidden="true" />
          <span>PayPal Sandbox</span>
          <strong>12.00 USD</strong>
          <p>No live money is charged in Sandbox.</p>
          <button className="button dark" type="button" onClick={openCheckout}>
            Open secure checkout
          </button>
          {revenue?.latest_capture_id ? (
            <small>Latest capture: {revenue.latest_capture_id}</small>
          ) : null}
        </div>
      </section>
    </>
  );
}

function Signal({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="signal">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <button type="button" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
function AttentionRow({
  channel,
  title,
  detail,
  status,
}: {
  channel: Channel;
  title: string;
  detail: string;
  status: string;
}) {
  return (
    <article className="attention-row">
      <span className={`provider-icon ${channel.toLowerCase()}`}>
        <ChannelIcon channel={channel} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <span className={`status-tag ${statusClass(status)}`}>{status}</span>
    </article>
  );
}
function EmptyState({
  title,
  copy,
  action,
  onAction,
}: {
  title: string;
  copy: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
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
function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === "LinkedIn") return <FaLinkedinIn aria-hidden="true" />;
  if (channel === "Instagram") return <FaInstagram aria-hidden="true" />;
  return <FaXTwitter aria-hidden="true" />;
}
