"use client";

import {
  ArrowRight,
  BarChart3,
  Box,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Lock,
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
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { FaFacebookF, FaInstagram, FaLinkedinIn, FaXTwitter } from "react-icons/fa6";
import { SiPaypal, SiPosthog } from "react-icons/si";
import { AgentRuns } from "@/components/agent-runs";
import { EvidenceGrid } from "@/components/evidence-grid";
import { InfoTip } from "@/components/info-tip";
import {
  ElapsedSeconds,
  type Receipt as PayPalReceipt,
  type ProvenMove,
  ReceiptChain,
} from "@/components/receipt-proof";
import { type SearchItem, WorkspaceSearch } from "@/components/workspace-search";
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
import { shareTarget, shareText, xLength } from "@/lib/share";
import {
  allTimeZones,
  browserTimeZone,
  formatMoment,
  timeZoneLabel,
  workspaceHour,
} from "@/lib/time";

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

type MoveEvidence = {
  completed_orders: number;
  gross_revenue: string;
  currency: string;
  paid_posts?: {
    content_id: string;
    day: number;
    channel: string;
    theme: string;
    completed_orders: number;
    revenue: string;
  }[];
};

type MoveContext = {
  evidence: MoveEvidence | null;
  model: string | null;
  turnId?: string | null;
  durationMs?: number | null;
};

type MoveDecision = {
  decision: "approved" | "rejected";
  headline: string;
  recommendation: string;
  edited: boolean;
  decided_at: string;
};

type Recommendation = {
  headline: string;
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
// Words people type when they look for a page, so "sales" finds Results.
const viewKeywords: Partial<Record<View, string>> = {
  today: "home dashboard overview",
  content: "posts review approve drafts queue",
  results: "revenue sales money paid orders paypal proof receipts",
  experiment: "next move recommendation agent learn",
  checkout: "buy link pay purchase customer",
  calendar: "schedule publish dates",
  "new-campaign": "create draft generate brief",
};

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
  next_action_approved: "Next move approved",
  next_action_rejected: "Next move rejected",
  follow_up_drafted: "Post drafted from the approved next move",
  post_revised: "Post revised by the agent from your note",
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
  /** Null follows the viewer's browser time zone. */
  timezone: string | null;
};

function statusFor(post: Post): ReviewStatus {
  return reviewLabels[post.status];
}

export function CampaignWorkspace({
  identity,
  onIdentityChange,
  onSignOut,
  onResetDemo,
}: {
  identity: WorkspaceIdentity;
  onIdentityChange?: (update: Pick<WorkspaceIdentity, "displayName" | "timezone">) => void;
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
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [revenueError, setRevenueError] = useState(false);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendedAt, setRecommendedAt] = useState<string | null>(null);
  const [moveContext, setMoveContext] = useState<MoveContext | null>(null);
  const [moveDecision, setMoveDecision] = useState<MoveDecision | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [followUpId, setFollowUpId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [revising, setRevising] = useState(false);
  const [receipts, setReceipts] = useState<PayPalReceipt[] | null>(null);
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
      const [summary, proof] = await Promise.all([
        apiFetch(`/v1/paypal/revenue/${campaignId}`),
        apiFetch(`/v1/paypal/receipts/${campaignId}`),
      ]);
      if (!summary.ok || !proof.ok) throw new Error("Results are unavailable");
      setRevenue((await summary.json()) as RevenueSummary);
      setReceipts(((await proof.json()) as { receipts: PayPalReceipt[] }).receipts);
      setRevenueError(false);
    } catch {
      setRevenueError(true);
    }
  }, [campaignId]);

  useEffect(() => {
    setRevenue(null);
    setReceipts(null);
    setRecommendation(null);
    setRecommendedAt(null);
    setMoveContext(null);
    setMoveDecision(null);
    setFollowUpId(null);
    void loadRevenue();
  }, [loadRevenue]);

  // Bring back the last next move after a reload. Every recommendation is a recorded event.
  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    campaignApi
      .events(campaignId)
      .then((events) => {
        const index = events.findIndex((event) => event.action === "next_action_recommended");
        const latest = events[index];
        const nextAction = latest?.detail.next_action as Recommendation | undefined;
        if (!active || !latest || !nextAction) return;
        // Events come newest first, so a decision on this move sits before it.
        const decided = events
          .slice(0, index)
          .find((event) => event.action.startsWith("next_action_") && event.actor === "human");
        setRecommendation((current) => current ?? nextAction);
        setRecommendedAt((current) => current ?? latest.created_at);
        setMoveContext(
          (current) =>
            current ?? {
              evidence: (latest.detail.evidence as MoveEvidence | undefined) ?? null,
              model: typeof latest.detail.model === "string" ? latest.detail.model : null,
              turnId: typeof latest.detail.turn_id === "string" ? latest.detail.turn_id : null,
              durationMs:
                typeof latest.detail.duration_ms === "number" ? latest.detail.duration_ms : null,
            },
        );
        if (decided) setMoveDecision((current) => current ?? (decided.detail as MoveDecision));
        const drafted = events
          .slice(0, index)
          .find((event) => event.action === "follow_up_drafted" && event.post_id);
        if (drafted?.post_id) setFollowUpId((current) => current ?? drafted.post_id);
      })
      .catch(() => {
        // Activity is optional here. The next move can still be requested.
      });
    return () => {
      active = false;
    };
  }, [campaignId]);

  // Customers pay on the public buy page, often in another tab or on a phone.
  // Refresh results when the founder comes back, and every 15 seconds while visible.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadRevenue();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadRevenue]);

  const seenOrders = useRef<{ campaignId: string; count: number } | null>(null);
  useEffect(() => {
    if (!revenue || !campaignId) return;
    const previous = seenOrders.current;
    seenOrders.current = { campaignId, count: revenue.completed_orders };
    if (previous?.campaignId !== campaignId || revenue.completed_orders <= previous.count) return;
    setRecommendation(null);
    setRecommendedAt(null);
    setMoveContext(null);
    setMoveDecision(null);
    setFollowUpId(null);
    setToast({
      message: "New PayPal purchase verified and credited to this campaign.",
      action: { label: "Find next move", view: "experiment" },
    });
    window.setTimeout(() => setToast(null), 7000);
  }, [revenue, campaignId]);

  const provenMove: ProvenMove | null =
    recommendation && recommendedAt
      ? { headline: recommendation.headline, at: recommendedAt, decision: moveDecision?.decision }
      : null;

  async function decideNextMove(decision: MoveDecision["decision"], edited?: string) {
    if (!campaign) return;
    setDeciding(true);
    try {
      const response = await apiFetch("/v1/agents/next-action/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaign.id, decision, recommendation: edited }),
      });
      if (!response.ok) throw new Error("decision failed");
      setMoveDecision((await response.json()) as MoveDecision);
    } catch {
      notify("Your decision could not be saved. Please try again.");
      setDeciding(false);
      return;
    }
    setDeciding(false);
    if (decision === "approved") await draftFollowUp();
    else notify("Next move rejected. Ask for a different one when you are ready.");
  }

  // The agent writes the post the approved plan asks for. It waits in review like any other.
  async function draftFollowUp() {
    if (!campaign) return;
    setDrafting(true);
    try {
      const response = await apiFetch("/v1/agents/follow-up-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaign.id }),
      });
      const body = (await response.json().catch(() => null)) as {
        post_id?: string;
        campaign?: Campaign;
        detail?: unknown;
      } | null;
      if (!response.ok || !body?.post_id || !body.campaign) {
        throw new Error(
          typeof body?.detail === "string"
            ? body.detail
            : "The post could not be drafted right now.",
        );
      }
      const day = body.campaign.posts.find((post) => post.id === body.post_id)?.day;
      setCampaign(body.campaign);
      setFollowUpId(body.post_id);
      openPost(body.post_id);
      notify(`Day ${day} post drafted from your approved plan. Review it before it goes out.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The post could not be drafted right now.");
    } finally {
      setDrafting(false);
    }
  }

  // The agent applies the founder's change request. The new version goes back to review.
  async function revisePost(postId: string) {
    if (!campaign) return;
    setRevising(true);
    try {
      const response = await apiFetch("/v1/agents/revise-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaign.id, post_id: postId }),
      });
      const body = (await response.json().catch(() => null)) as {
        campaign?: Campaign;
        detail?: unknown;
      } | null;
      if (!response.ok || !body?.campaign) {
        throw new Error(
          typeof body?.detail === "string"
            ? body.detail
            : "The post could not be revised right now.",
        );
      }
      setCampaign(body.campaign);
      setEditingBody(null);
      notify("The agent revised the post from your note. Review the new version.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The post could not be revised right now.");
    } finally {
      setRevising(false);
    }
  }

  function openPost(postId: string) {
    setSelectedId(postId);
    setFilter("All");
    setEditingBody(null);
    navigate("content");
  }

  function openBuyPage(contentId: string) {
    // The marker only adds a way back to the workspace on the thank you screen.
    window.open(`${buyLink(contentId)}?preview=founder`, "_blank", "noopener");
  }

  function openCustomerView() {
    if (checkoutPost) openBuyPage(checkoutPost.id);
    else navigate("checkout");
  }

  function notify(message: string, action?: Toast["action"]) {
    setToast({ message, action });
    // Leave time to reach the button when the toast offers a next step.
    window.setTimeout(() => setToast(null), action ? 7000 : 2800);
  }

  // After a page change, move focus to the new heading so screen readers announce it.
  // Command K or Control K opens search from anywhere in the workspace.
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);

  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest === 0 || loadState !== "ready") return;
    const heading = document.querySelector<HTMLElement>(".page-shell h1");
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }, [focusRequest, loadState]);

  // What the evidence table shows as the next action for each post.
  function evidenceNextActions(): Record<string, string> {
    const actions: Record<string, string> = {};
    const source = moveContext?.evidence?.paid_posts?.[0]?.content_id;
    if (source && recommendation) {
      actions[source] = moveDecision
        ? `${recommendation.headline} (${moveDecision.decision})`
        : `${recommendation.headline} (awaiting your decision)`;
    }
    if (followUpId) actions[followUpId] = "Experiment post from the approved next move";
    return actions;
  }

  function searchItems(): SearchItem[] {
    const items: SearchItem[] = [
      {
        id: "action-purchase",
        group: "Actions",
        title: "Make a test purchase",
        detail: "Open a buy link as your own customer",
        keywords: "buy pay paypal checkout sandbox",
        run: openCustomerView,
      },
      {
        id: "action-next-move",
        group: "Actions",
        title: "Find next move",
        detail: "Ask the agent what to try next",
        keywords: "recommendation agent experiment",
        run: () => navigate("experiment"),
      },
      ...views.map((page) => ({
        id: `page-${page}`,
        group: "Pages" as const,
        title: viewLabels[page],
        keywords: viewKeywords[page],
        run: () => navigate(page),
      })),
    ];
    for (const post of campaign?.posts ?? []) {
      items.push({
        id: `post-${post.id}`,
        group: "Posts",
        title: `Day ${post.day} · ${post.channel} · ${post.theme}`,
        detail: excerpt(post.content),
        keywords: `${post.content} ${post.call_to_action} ${reviewLabels[post.status]} day${post.day}`,
        run: () => openPost(post.id),
      });
    }
    for (const receipt of receipts ?? []) {
      items.push({
        id: `purchase-${receipt.order_id}`,
        group: "Purchases",
        title: `${formatMoney(receipt.amount, receipt.currency)} purchase`,
        detail: `Order ${receipt.order_id}`,
        keywords: `${receipt.capture_id} paypal order capture receipt`,
        run: () => navigate("results"),
      });
    }
    return items;
  }

  function navigate(nextView: View) {
    if (nextView !== view) window.history.pushState(null, "", `#${nextView}`);
    setView(nextView);
    setMobileNavigationOpen(false);
    setSearchOpen(false);
    // A new page starts at the top at once, like any route change.
    window.scrollTo({ top: 0, behavior: "instant" });
    setFocusRequest((count) => count + 1);
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
      const result = (await response.json()) as {
        next_action: Recommendation;
        evidence: MoveEvidence;
        model: string;
        turn_id: string;
        duration_ms: number;
      };
      setRecommendation(result.next_action);
      setMoveContext({
        evidence: result.evidence,
        model: result.model,
        turnId: result.turn_id,
        durationMs: result.duration_ms,
      });
      setMoveDecision(null);
      setFollowUpId(null);
      // Never earlier than the newest capture, so a small clock difference cannot hide it.
      const newest = Math.max(0, ...(receipts ?? []).map((item) => Date.parse(item.captured_at)));
      setRecommendedAt(new Date(Math.max(Date.now(), newest)).toISOString());
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
            receipts={receipts}
            move={provenMove}
            moveLoading={recommendationLoading}
            findNextMove={findNextMove}
            recommendation={recommendation}
            decisionPanel={
              recommendation ? (
                <MoveDecisionPanel
                  recommendation={recommendation}
                  decision={moveDecision}
                  deciding={deciding}
                  decide={decideNextMove}
                  followUp={campaign.posts.find((post) => post.id === followUpId) ?? null}
                  drafting={drafting}
                  draftFollowUp={draftFollowUp}
                  openPost={openPost}
                  findNextMove={findNextMove}
                  recommendationLoading={recommendationLoading}
                />
              ) : null
            }
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
            openCustomerView={openCustomerView}
          />
        );
      case "content":
        return (
          <ContentPage
            campaign={campaign}
            openCheckout={() => (selected ? openBuyPage(selected.id) : navigate("checkout"))}
            notify={notify}
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
            revisePost={revisePost}
            revising={revising}
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
            campaign={campaign}
            nextActions={evidenceNextActions()}
            openPost={openPost}
            runsKey={`${recommendedAt}-${moveDecision?.decision}-${followUpId}`}
            revenue={revenue}
            revenueError={revenueError}
            receipts={receipts}
            move={provenMove}
            recommendation={recommendation}
            recommendationError={recommendationError}
            recommendationLoading={recommendationLoading}
            findNextMove={findNextMove}
            openCheckout={openCustomerView}
            navigate={navigate}
          />
        );
      case "experiment":
        return (
          <ExperimentPage
            revenue={revenue}
            context={moveContext}
            decision={moveDecision}
            deciding={deciding}
            decide={decideNextMove}
            followUp={campaign.posts.find((post) => post.id === followUpId) ?? null}
            drafting={drafting}
            draftFollowUp={draftFollowUp}
            openPost={openPost}
            recommendation={recommendation}
            recommendationError={recommendationError}
            recommendationLoading={recommendationLoading}
            findNextMove={findNextMove}
            navigate={navigate}
          />
        );
      case "integrations":
        return <IntegrationsPage navigate={navigate} />;
      case "settings":
        return <SettingsPage notify={notify} onSaved={onIdentityChange} />;
      case "checkout":
        return (
          <CheckoutPage
            post={checkoutPost}
            posts={posts}
            revenue={revenue}
            openBuyPage={openBuyPage}
            navigate={navigate}
            notify={notify}
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
          // Outside clicks close search, so the icon only opens it.
          onSearch={() => setSearchOpen(true)}
          onSearchClose={() => setSearchOpen(false)}
          searchItems={searchItems()}
          onTheme={toggleTheme}
          onHelp={() => setHelpOpen(true)}
          identity={identity}
          onSettings={() => navigate("settings")}
          onResetDemo={identity.mode === "judge" ? onResetDemo : undefined}
          onSignOut={onSignOut}
        />
        {identity.mode === "judge" && onResetDemo ? (
          <JudgeBar onReset={onResetDemo} notify={notify} />
        ) : null}
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
        <button className="product-picker" type="button" onClick={() => navigate("products")}>
          {productIcon ? (
            <ProductMark className="picker-mark" name={productName} iconUrl={productIcon} />
          ) : (
            <span className="product-dot" />
          )}
          <strong>{productName}</strong>
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
          <button type="button" onClick={() => navigate("settings")}>
            <span className="avatar">{initial}</span>
            <strong>{identity.displayName}</strong>
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

function JudgeBar({
  onReset,
  notify,
}: {
  onReset: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function reset() {
    setResetting(true);
    try {
      await onReset();
    } catch {
      notify("The judge demo could not be reset.");
      setResetting(false);
      setConfirming(false);
    }
  }

  return (
    <section className="judge-bar" aria-label="Judge demo">
      <span className="status-tag review">Judge demo</span>
      <p>
        PayPal sandbox. No real money moves.
        <InfoTip label="About the judge demo" align="end">
          Private demo workspace, prepared with a sample LaunchCheck campaign. Payments run in
          PayPal's sandbox, and each recommendation is generated live.
        </InfoTip>
      </p>
      {confirming ? (
        <div className="judge-bar-actions">
          <span>Start over with the seeded campaign and no purchases?</span>
          <button
            className="text-button"
            type="button"
            disabled={resetting}
            aria-busy={resetting}
            onClick={() => void reset()}
          >
            {resetting ? "Resetting" : "Reset"}
          </button>
          <button
            className="text-button muted"
            type="button"
            disabled={resetting}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button className="text-button" type="button" onClick={() => setConfirming(true)}>
          Reset demo
        </button>
      )}
    </section>
  );
}

function AccountMenu({
  initial,
  identity,
  onSettings,
  onResetDemo,
  onSignOut,
}: {
  initial: string;
  identity: WorkspaceIdentity;
  onSettings: () => void;
  onResetDemo?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="account-menu" ref={root}>
      <button
        className="topbar-avatar"
        type="button"
        aria-label={`Account, ${identity.displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {initial}
      </button>
      {open ? (
        <div className="account-menu-list" id={menuId} role="menu">
          <p>
            <strong>{identity.displayName}</strong>
            <small>{identity.mode === "judge" ? "Judge demo" : "Signed in"}</small>
          </p>
          <button type="button" role="menuitem" onClick={() => choose(onSettings)}>
            Settings
          </button>
          {onResetDemo ? (
            <button type="button" role="menuitem" onClick={() => choose(() => void onResetDemo())}>
              Reset demo
            </button>
          ) : null}
          {onSignOut ? (
            <button type="button" role="menuitem" onClick={() => choose(() => void onSignOut())}>
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
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
  onSearchClose,
  searchItems,
  onSettings,
  onResetDemo,
  onSignOut,
  onTheme,
  onHelp,
  identity,
}: {
  currentView: View;
  productName: string;
  theme: Theme;
  searchOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  onSearchClose: () => void;
  searchItems: SearchItem[];
  onSettings: () => void;
  onResetDemo?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
  onTheme: () => void;
  onHelp: () => void;
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
        {searchOpen ? <WorkspaceSearch items={searchItems} onClose={onSearchClose} /> : null}
        <button
          type="button"
          onClick={onTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} appearance`}
        >
          {theme === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        </button>
        <button type="button" onClick={onSearch} aria-label="Search" title="Search (⌘K)">
          <Search aria-hidden="true" />
        </button>
        <button type="button" onClick={onHelp} aria-label="Help">
          <CircleHelp aria-hidden="true" />
        </button>
        <AccountMenu
          initial={initial}
          identity={identity}
          onSettings={onSettings}
          onResetDemo={onResetDemo}
          onSignOut={onSignOut}
        />
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
      copy: "Buy from your own post in PayPal's sandbox. No real money moves.",
      action: "Open checkout",
      view: "checkout",
      complete: hasRevenue,
    },
    {
      title: "Read verified results",
      copy: "Trace each purchase back to the post that earned it.",
      action: "View results",
      view: "results",
      complete: hasRevenue,
    },
    {
      title: "Choose the next test",
      copy: "Let the agent turn verified revenue into one next experiment.",
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
            <p>Five steps from a product brief to a next move backed by real revenue.</p>
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
  receipts,
  move,
  moveLoading,
  findNextMove,
  recommendation,
  decisionPanel,
  stage,
  needsReview,
  navigate,
}: {
  campaign: Campaign;
  revenue: RevenueSummary | null;
  revenueError: boolean;
  receipts: PayPalReceipt[] | null;
  move: ProvenMove | null;
  moveLoading: boolean;
  findNextMove: () => Promise<void>;
  recommendation: Recommendation | null;
  decisionPanel: ReactNode;
  stage: Stage;
  needsReview: number;
  navigate: (view: View) => void;
}) {
  const [clock, setClock] = useState<{ date: string; greeting: string } | null>(null);

  // Formatted on the client so server and browser render the same markup.
  useEffect(() => {
    const now = new Date();
    setClock({
      date: formatMoment(now, { weekday: "long", day: "numeric", month: "long" }),
      greeting: greetingFor(workspaceHour(now)),
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
      {receipts?.length ? (
        <TodayResultCard
          campaign={campaign}
          receipts={receipts}
          move={move}
          moveLoading={moveLoading}
          findNextMove={findNextMove}
          recommendation={recommendation}
          decisionPanel={decisionPanel}
          navigate={navigate}
        />
      ) : null}
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
      {receipts?.length ? null : (
        <section className="today-grid">
          <article>
            <SectionTitle title="Recent results" />
            <QuietState
              icon={<BarChart3 aria-hidden="true" />}
              title="No results yet"
              copy="A PayPal sandbox purchase shows up here, linked to the post that earned it."
              action="Open checkout"
              onAction={() => navigate("checkout")}
            />
          </article>
          <article>
            <SectionTitle title="Next experiment" />
            <QuietState
              icon={<FlaskConical aria-hidden="true" />}
              title="No recommendation yet"
              copy="The agent suggests a test once a purchase is verified."
              action="See what is needed"
              onAction={() => navigate("experiment")}
            />
          </article>
        </section>
      )}
    </>
  );
}

function TodayResultCard({
  campaign,
  receipts,
  move,
  moveLoading,
  findNextMove,
  recommendation,
  decisionPanel,
  navigate,
}: {
  campaign: Campaign;
  receipts: PayPalReceipt[];
  move: ProvenMove | null;
  moveLoading: boolean;
  findNextMove: () => Promise<void>;
  recommendation: Recommendation | null;
  decisionPanel: ReactNode;
  navigate: (view: View) => void;
}) {
  const latest = receipts[0];
  const post = campaign.posts.find((item) => item.id === latest.content_id);
  const verified = latest.webhooks.some(
    (event) => event.event_type === "PAYMENT.CAPTURE.COMPLETED",
  );
  // A recommendation belongs to this purchase only if the agent made it after the money arrived.
  const fresh = move && new Date(move.at) >= new Date(latest.captured_at) ? recommendation : null;
  const captured = formatMoment(latest.captured_at);
  return (
    <section className="result-card" aria-labelledby="result-card-title">
      <div className="result-card-payment">
        <span className="status-tag success">
          <Check aria-hidden="true" /> Payment verified
        </span>
        <h2 id="result-card-title">
          <strong>{formatMoney(latest.amount, latest.currency)}</strong> captured through PayPal
          sandbox
        </h2>
        <dl className="result-facts">
          <div>
            <dt>Campaign</dt>
            <dd>{campaign.name}</dd>
          </div>
          <div>
            <dt>Attributed post</dt>
            <dd>
              {post ? `Day ${post.day} on ${post.channel}` : "Campaign post"}
              {post ? <small>{post.theme}</small> : null}
            </dd>
          </div>
          <div>
            <dt>Attribution</dt>
            <dd className={verified ? "verified" : "pending"}>
              {verified ? "Verified by PayPal webhook" : "Captured. Webhook on its way"}
            </dd>
          </div>
          <div>
            <dt>Captured</dt>
            <dd>
              {captured}
              {receipts.length > 1 ? <small>{receipts.length} purchases in total</small> : null}
            </dd>
          </div>
        </dl>
        <button className="text-button" type="button" onClick={() => navigate("results")}>
          See the PayPal proof
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
      <div className="result-card-move">
        {fresh ? (
          <>
            <span className="eyebrow">New recommendation</span>
            <h3>{fresh.headline}</h3>
            <p>{fresh.recommendation}</p>
            <p className="result-reason">
              <strong>Reason.</strong> {fresh.rationale}
            </p>
            <span className="eyebrow">Your decision</span>
            {decisionPanel}
          </>
        ) : (
          <>
            <span className="eyebrow">Next step</span>
            <h3>Let the agent learn from this purchase</h3>
            <p>
              It reads which post earned the money and proposes one experiment. Nothing changes
              until you approve it.
            </p>
            <button
              className="button accent"
              type="button"
              disabled={moveLoading}
              aria-busy={moveLoading}
              onClick={() => void findNextMove()}
            >
              {moveLoading ? <BusyLabel text="Reviewing results" elapsed /> : "Find next move"}
            </button>
          </>
        )}
      </div>
    </section>
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
    // A verified purchase is the moment the loop closes, so it outranks pending reviews.
    sales
      ? {
          label: "Next move",
          title: "Results are in. Choose the next experiment",
          note: `${sales} verified PayPal purchase${sales === 1 ? "" : "s"} so far. The agent reads this payment evidence and proposes one next experiment for you to approve.`,
          action: "Find next move",
          view: "experiment" as View,
        }
      : needsReview
        ? {
            label: "Next decision",
            title: `${needsReview} post${needsReview === 1 ? "" : "s"} need your review`,
            action: "Review posts",
            view: "content" as View,
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
        description="What GrowthReceipt knows about what you sell."
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
  openCustomerView,
}: {
  campaign: Campaign;
  counts: Record<Filter, number>;
  stage: Stage;
  saving: boolean;
  navigate: (view: View) => void;
  approveCampaign: () => void;
  openCustomerView: () => void;
}) {
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="One campaign at a time, from brief to verified revenue."
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
            <TestPurchaseButton className="button accent" onClick={openCustomerView} />
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
            <time dateTime={event.created_at}>{formatMoment(event.created_at)}</time>
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
  revisePost,
  revising,
  saveEdits,
  selectFilter,
  selectPost,
  setEditingBody,
  openCheckout,
  notify,
}: {
  campaign: Campaign;
  openCheckout: () => void;
  notify: (message: string) => void;
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
  revisePost: (postId: string) => Promise<void>;
  revising: boolean;
  saveEdits: () => Promise<void>;
  selectFilter: (filter: Filter) => void;
  selectPost: (id: string) => void;
  setEditingBody: (body: string | null) => void;
}) {
  const selectedStatus = statusFor(selected);
  return (
    <>
      <PageHeader title="Content" description="Review each post before it goes out." />
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
                  onClick={() => {
                    selectPost(post.id);
                    // On narrow screens the preview sits below the list, so bring it into view.
                    if (window.matchMedia("(max-width: 900px)").matches) {
                      document
                        .querySelector(".post-preview-region")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
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
          revisePost={revisePost}
          revising={revising}
          startEditing={() => setEditingBody(selected.content)}
          saveEdits={saveEdits}
          openCheckout={openCheckout}
          notify={notify}
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
  revisePost,
  revising,
  startEditing,
  saveEdits,
  openCheckout,
  notify,
}: {
  campaign: Campaign;
  post: Post;
  editing: boolean;
  saving: boolean;
  openCheckout: () => void;
  notify: (message: string) => void;
  approveCampaign: () => void;
  approvePost: () => void;
  requestChanges: (note: string) => Promise<boolean>;
  revisePost: (postId: string) => Promise<void>;
  revising: boolean;
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
          <div className="revise-action">
            <button
              className="button accent"
              type="button"
              disabled={revising || !post.review_note}
              aria-busy={revising}
              onClick={() => void revisePost(post.id)}
            >
              {revising ? <BusyLabel text="Revising" elapsed /> : "Revise with agent"}
            </button>
            <span>Or edit the post yourself. Either way it comes back for your approval.</span>
          </div>
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
          <>
            <PublishButton className="button secondary" post={post} notify={notify} />
            <TestPurchaseButton className="button accent" onClick={openCheckout} />
          </>
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
        description="What goes out when, and what still needs your approval."
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
  campaign,
  nextActions,
  openPost,
  runsKey,
  revenue,
  revenueError,
  receipts,
  move,
  recommendation,
  recommendationError,
  recommendationLoading,
  findNextMove,
  openCheckout,
  navigate,
}: {
  campaign: Campaign;
  revenue: RevenueSummary | null;
  revenueError: boolean;
  receipts: PayPalReceipt[] | null;
  move: ProvenMove | null;
  nextActions: Record<string, string>;
  openPost: (postId: string) => void;
  runsKey: string;
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
        description="Revenue verified by PayPal and attributed to the post that earned it."
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
      {receipts?.length ? (
        <section className="results-receipts" aria-labelledby="receipts-title">
          <div className="column-heading">
            <h2 id="receipts-title">
              From post to payment to next move
              <InfoTip label="How this is proven" align="start">
                Every step is a recorded event. PayPal confirms the order and the capture, each
                webhook is signature checked before it is stored, and every agent run is logged with
                its ID. Nothing here is estimated.
              </InfoTip>
            </h2>
            <span>Every step below is a recorded PayPal or GrowthReceipt event</span>
          </div>
          <ReceiptChain
            receipt={receipts[0]}
            receipts={receipts}
            posts={campaign.posts}
            move={move}
            moveLoading={recommendationLoading}
            onFindNextMove={() => void findNextMove()}
            onReview={() => navigate("experiment")}
          />
          {receipts.length > 1 ? (
            <div className="earlier-receipts">
              <h3>Earlier purchases</h3>
              <ul>
                {receipts.slice(1, 11).map((item) => {
                  const post = campaign.posts.find((entry) => entry.id === item.content_id);
                  return (
                    <li key={item.order_id}>
                      <time dateTime={item.captured_at}>{formatMoment(item.captured_at)}</time>
                      <span>{post ? `Day ${post.day} · ${post.channel}` : "Campaign post"}</span>
                      <code>{item.order_id}</code>
                      <strong>{formatMoney(item.amount, item.currency)}</strong>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="results-evidence" aria-labelledby="evidence-title">
        <div className="column-heading">
          <h2 id="evidence-title">
            Which post earned real revenue
            <InfoTip label="About this table" align="start">
              One row per post. Payment and attribution come from PayPal captures and signature
              checked webhooks. Built with AG Grid.
            </InfoTip>
          </h2>
          <span>Sorted by revenue. Filter by payment, approval or channel.</span>
        </div>
        <EvidenceGrid
          campaign={campaign}
          receipts={receipts ?? []}
          nextActions={nextActions}
          currency={revenue?.currency ?? "USD"}
          onOpenPost={openPost}
        />
      </section>
      <AgentRuns campaign={campaign} refreshKey={runsKey} />
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
            Open as customer
          </button>
        </div>
        <div className="plain-panel">
          <div className="provider-heading">
            <TrendingUp aria-hidden="true" />
            <span>Next move</span>
          </div>
          {recommendation ? (
            <>
              <ConfidenceTag confidence={recommendation.confidence} />
              <h2>{recommendation.headline}</h2>
              <p>{recommendation.recommendation}</p>
              <strong className="expected-signal">
                Look for: {recommendation.expected_signal}
              </strong>
            </>
          ) : (
            <>
              <h2>Choose the next test from real results.</h2>
              <p>The agent needs one verified purchase before it recommends what to test next.</p>
              <button
                className="button accent"
                disabled={!hasRevenue || recommendationLoading}
                aria-busy={recommendationLoading}
                type="button"
                onClick={() => void findNextMove()}
              >
                {recommendationLoading ? (
                  <BusyLabel text="Reviewing results" elapsed />
                ) : (
                  "Find next move"
                )}
              </button>
            </>
          )}
          {recommendationError ? <p className="inline-error">{recommendationError}</p> : null}
        </div>
      </section>
    </>
  );
}

function WhyThisMove({
  recommendation,
  context,
}: {
  recommendation: Recommendation;
  context: MoveContext | null;
}) {
  const evidence = context?.evidence;
  return (
    <details className="why-move">
      <summary>
        Why this recommendation
        <ChevronDown aria-hidden="true" />
      </summary>
      <dl>
        <div>
          <dt>Evidence the agent read</dt>
          <dd>
            {evidence
              ? `${evidence.completed_orders} verified PayPal purchase${evidence.completed_orders === 1 ? "" : "s"}, ${formatMoney(evidence.gross_revenue, evidence.currency)} in total.`
              : "Verified PayPal revenue for this campaign."}
          </dd>
        </div>
        {evidence?.paid_posts?.length ? (
          <div>
            <dt>Posts that earned it</dt>
            <dd>
              <ul>
                {evidence.paid_posts.map((post) => (
                  <li key={post.content_id}>
                    Day {post.day} · {post.channel} · {post.theme}.{" "}
                    {formatMoney(post.revenue, evidence.currency)} from {post.completed_orders}{" "}
                    purchase{post.completed_orders === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Confidence</dt>
          <dd>
            {confidenceCopy[recommendation.confidence]}
            {recommendation.needs_more_data
              ? " The agent asks for more purchases before you rely on it."
              : ""}
          </dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>
            {context?.model ? <code>{context.model}</code> : "OpenAI"} with a fixed output schema.
            It reads the campaign brief and these PayPal numbers, never buyer details.
          </dd>
        </div>
        <div>
          <dt>Limits</dt>
          <dd>
            The agent cannot publish, change a price, start a payment, or spend money. Nothing
            happens until you approve.
          </dd>
        </div>
      </dl>
    </details>
  );
}

const confidenceCopy: Record<Recommendation["confidence"], string> = {
  low: "Low. Fewer than 10 purchases is too small a sample to rely on.",
  medium: "Medium. Several purchases point the same way. Still worth testing.",
  high: "High. Many purchases point the same way.",
};

function MoveDecisionPanel({
  recommendation,
  decision,
  deciding,
  decide,
  followUp,
  drafting,
  draftFollowUp,
  openPost,
  findNextMove,
  recommendationLoading,
}: {
  recommendation: Recommendation;
  decision: MoveDecision | null;
  deciding: boolean;
  decide: (decision: MoveDecision["decision"], edited?: string) => Promise<void>;
  followUp: Post | null;
  drafting: boolean;
  draftFollowUp: () => Promise<void>;
  openPost: (postId: string) => void;
  findNextMove: () => Promise<void>;
  recommendationLoading: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (decision) {
    const approved = decision.decision === "approved";
    return (
      <div className="move-decision" role="status">
        <span className={`status-tag ${approved ? "success" : "neutral"}`}>
          {approved ? (decision.edited ? "Approved with your edits" : "Approved") : "Rejected"}
        </span>
        <p>
          {approved
            ? decision.recommendation
            : "This move will not run. The agent can propose a different one from the same evidence."}
        </p>
        {approved ? (
          followUp ? (
            <div className="move-follow-up">
              <span>
                The agent drafted the day {followUp.day} {followUp.channel} post from this plan.
                {followUp.status === "approved"
                  ? " You approved it."
                  : " It waits for your review."}
              </span>
              <button className="button dark" type="button" onClick={() => openPost(followUp.id)}>
                Open the post
              </button>
            </div>
          ) : (
            <button
              className="button accent"
              type="button"
              disabled={drafting}
              aria-busy={drafting}
              onClick={() => void draftFollowUp()}
            >
              {drafting ? <BusyLabel text="Drafting the post" elapsed /> : "Draft the post"}
            </button>
          )
        ) : null}
        {!approved ? (
          <button
            className="button outline"
            type="button"
            disabled={recommendationLoading}
            aria-busy={recommendationLoading}
            onClick={() => void findNextMove()}
          >
            {recommendationLoading ? (
              <BusyLabel text="Reviewing results" elapsed />
            ) : (
              "Ask for a different move"
            )}
          </button>
        ) : null}
      </div>
    );
  }
  if (draft !== null) {
    return (
      <div className="move-decision">
        <label htmlFor="move-edit">Edit the plan before you approve it</label>
        <textarea
          id="move-edit"
          rows={4}
          maxLength={1200}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="form-actions">
          <button
            className="button accent"
            type="button"
            disabled={deciding || !draft.trim()}
            onClick={() => void decide("approved", draft.trim())}
          >
            {deciding ? <BusyLabel text="Saving" /> : "Save, approve and draft"}
          </button>
          <button className="button outline" type="button" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="move-decision">
      <p>
        Approving asks the agent to draft the post this plan describes. It waits in review, so
        nothing goes out until you approve it too.
      </p>
      <div className="form-actions">
        <button
          className="button accent"
          type="button"
          disabled={deciding}
          onClick={() => void decide("approved")}
        >
          {deciding ? <BusyLabel text="Saving" /> : "Approve and draft post"}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={deciding}
          onClick={() => setDraft(recommendation.recommendation)}
        >
          Edit
        </button>
        <button
          className="button outline"
          type="button"
          disabled={deciding}
          onClick={() => void decide("rejected")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ExperimentPage({
  revenue,
  context,
  decision,
  deciding,
  decide,
  followUp,
  drafting,
  draftFollowUp,
  openPost,
  recommendation,
  recommendationError,
  recommendationLoading,
  findNextMove,
  navigate,
}: {
  revenue: RevenueSummary | null;
  context: MoveContext | null;
  decision: MoveDecision | null;
  deciding: boolean;
  decide: (decision: MoveDecision["decision"], edited?: string) => Promise<void>;
  followUp: Post | null;
  drafting: boolean;
  draftFollowUp: () => Promise<void>;
  openPost: (postId: string) => void;
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
        description="One next experiment, chosen from what customers actually paid for."
      />
      <section className="experiment-stage">
        {recommendation ? (
          <div>
            <ConfidenceTag confidence={recommendation.confidence} />
            <h2>{recommendation.headline}</h2>
            {context?.model && context.durationMs ? (
              <p className="move-run">
                Written by the agent with <code>{context.model}</code> in{" "}
                {(context.durationMs / 1000).toFixed(1)} s
                {context.turnId ? (
                  <>
                    {" "}
                    · run <code title={context.turnId}>{context.turnId.slice(-8)}</code>
                  </>
                ) : null}
                <InfoTip label="About this agent run" align="start">
                  The time is measured on the server around the model call. The run ID is OpenAI's
                  turn ID, and it is also saved in the campaign activity.
                </InfoTip>
              </p>
            ) : null}
            <p className="experiment-plan">{recommendation.recommendation}</p>
            <p>{recommendation.rationale}</p>
            <dl>
              <div>
                <dt>Evidence</dt>
                <dd>{recommendation.evidence_summary}</dd>
              </div>
              <div>
                <dt>What to watch</dt>
                <dd>{recommendation.expected_signal}</dd>
              </div>
            </dl>
            <WhyThisMove recommendation={recommendation} context={context} />
            <MoveDecisionPanel
              recommendation={recommendation}
              decision={decision}
              deciding={deciding}
              decide={decide}
              followUp={followUp}
              drafting={drafting}
              draftFollowUp={draftFollowUp}
              openPost={openPost}
              findNextMove={findNextMove}
              recommendationLoading={recommendationLoading}
            />
          </div>
        ) : (
          <div>
            <span className={`status-tag ${ready ? "success" : "neutral"}`}>
              {ready ? "Ready" : "Waiting for evidence"}
            </span>
            <h2>
              {ready ? "Ready for a recommendation." : "Complete one verified purchase first."}
            </h2>
            <p>
              {ready
                ? "There is a verified purchase to learn from. Ask the agent for one next experiment."
                : "Recommendations begin with real purchases, not assumptions."}
            </p>
            <div className="form-actions">
              {!ready ? (
                <button className="button dark" type="button" onClick={() => navigate("checkout")}>
                  Open checkout
                </button>
              ) : null}
              <button
                className={`button ${ready ? "dark" : "outline"}`}
                type="button"
                disabled={!ready || recommendationLoading}
                aria-busy={recommendationLoading}
                onClick={() => void findNextMove()}
              >
                {recommendationLoading ? (
                  <BusyLabel text="Reviewing results" elapsed />
                ) : (
                  "Prepare next experiment"
                )}
              </button>
            </div>
            {recommendationError ? <p className="inline-error">{recommendationError}</p> : null}
          </div>
        )}
      </section>
    </>
  );
}

function IntegrationsPage({ navigate }: { navigate: (view: View) => void }) {
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Integrations"
        description="Connect where you publish and where you get paid."
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
          status="Planned"
        />
        {channels.map((channel) => (
          <Integration
            key={channel}
            provider={channel}
            description={channelIntegration[channel]}
            icon={<ChannelIcon channel={channel} />}
            status={channel === "Instagram" ? "Planned" : "Share link"}
          />
        ))}
      </section>
    </>
  );
}

type WorkspaceSettings = { name: string; timezone: string | null };

/** Zones grouped by region, so the long list reads like a directory. */
function timeZoneGroups(): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const zone of allTimeZones()) {
    const region = zone.includes("/") ? zone.split("/")[0] : "Other";
    groups.set(region, [...(groups.get(region) ?? []), zone]);
  }
  return [...groups];
}

function SettingsPage({
  notify,
  onSaved,
}: {
  notify: (message: string) => void;
  onSaved?: (update: Pick<WorkspaceIdentity, "displayName" | "timezone">) => void;
}) {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(timeZoneGroups, []);
  const browserZone = useMemo(browserTimeZone, []);

  useEffect(() => {
    let active = true;
    apiFetch("/v1/workspace/settings")
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<WorkspaceSettings>;
      })
      .then((loaded) => active && setSettings(loaded))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const response = await apiFetch("/v1/workspace/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error();
      const saved = (await response.json()) as WorkspaceSettings;
      setSettings(saved);
      onSaved?.({ displayName: saved.name, timezone: saved.timezone });
      notify("Workspace settings saved.");
    } catch {
      notify("Settings could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const previewZone = settings?.timezone ?? browserZone;
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Your workspace name, the time zone for every date and time, and the rules that keep you in control."
      />
      {failed ? (
        <p className="inline-error" role="alert">
          Settings could not be loaded. Refresh the page to try again.
        </p>
      ) : null}
      <form className="settings-form" onSubmit={save} aria-busy={!settings && !failed}>
        <fieldset disabled={!settings || saving}>
          <legend>Workspace</legend>
          <label htmlFor="workspace-name">Workspace name</label>
          <input
            id="workspace-name"
            maxLength={60}
            required
            value={settings?.name ?? ""}
            onChange={(event) =>
              setSettings((current) => current && { ...current, name: event.target.value })
            }
          />
          <label htmlFor="timezone">Time zone</label>
          <select
            id="timezone"
            value={settings?.timezone ?? ""}
            onChange={(event) =>
              setSettings(
                (current) => current && { ...current, timezone: event.target.value || null },
              )
            }
          >
            <option value="">Use my browser time zone ({timeZoneLabel(browserZone)})</option>
            {zones.map(([region, list]) => (
              <optgroup key={region} label={region}>
                {list.map((zone) => (
                  <option key={zone} value={zone}>
                    {timeZoneLabel(zone)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <small className="settings-hint">
            Times read like this: {formatPreview(previewZone)}. Payments, agent runs and activity
            all follow this zone.
          </small>
        </fieldset>
        <fieldset>
          <legend>Approval</legend>
          <div className="policy-row">
            <Lock aria-hidden="true" />
            <span>
              <strong>Nothing goes out without your approval</strong>
              <small>
                The agent drafts, revises and recommends. It cannot publish. A post gets a working
                buy link only after you approve it.
              </small>
            </span>
            <em>Always on</em>
          </div>
          <div className="policy-row">
            <Lock aria-hidden="true" />
            <span>
              <strong>Revenue counts only payments PayPal captured</strong>
              <small>
                Each purchase is marked verified once the PayPal webhook confirms the capture.
                Nothing is estimated.
              </small>
            </span>
            <em>Always on</em>
          </div>
        </fieldset>
        <button className="button dark" type="submit" disabled={!settings || saving}>
          {saving ? "Saving" : "Save settings"}
        </button>
      </form>
    </>
  );
}

function formatPreview(zone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
  }).format(new Date());
}

function buyLink(contentId: string) {
  return `${window.location.origin}/buy/${contentId}`;
}

function CheckoutPage({
  post,
  posts,
  revenue,
  openBuyPage,
  navigate,
  notify,
}: {
  post: Post | null;
  posts: Post[];
  revenue: RevenueSummary | null;
  openBuyPage: (contentId: string) => void;
  navigate: (view: View) => void;
  notify: (message: string) => void;
}) {
  const approved = posts.filter((item) => item.status === "approved");

  async function copyLink(contentId: string) {
    try {
      await navigator.clipboard.writeText(buyLink(contentId));
      notify("Buy link copied.");
    } catch {
      notify("Copy is blocked in this browser. Open the link and copy it from the address bar.");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Customer view"
        title="Buy as your customer"
        description="Every approved post has its own buy link. A customer who clicks it pays on a simple checkout page and never sees GrowthReceipt. Open a link as your customer to make a test purchase. The payment goes to you and is credited to the post that brought it."
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
            <>
              <small>
                Opens the buy link for day {post.day} · {post.channel}
              </small>
              <button className="button dark" type="button" onClick={() => openBuyPage(post.id)}>
                <ExternalLink aria-hidden="true" /> Open as customer
              </button>
            </>
          ) : (
            <>
              <small>Approve a post first. Every approved post gets its own buy link.</small>
              <button className="button dark" type="button" onClick={() => navigate("content")}>
                Review posts
              </button>
            </>
          )}
          {revenue?.latest_capture_id ? (
            <small>Latest PayPal receipt: {revenue.latest_capture_id}</small>
          ) : null}
        </div>
      </section>
      {approved.length ? (
        <section className="buy-links" aria-labelledby="buy-links-title">
          <h2 id="buy-links-title">Buy links</h2>
          <p>
            Publish opens the channel with the post and its link filled in, and you press Post.
            Purchases are credited to the post whose link was used.
          </p>
          <ul>
            {approved.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    Day {item.day} · {item.channel}
                  </strong>
                  <span>{item.theme}</span>
                </div>
                <div className="buy-link-actions">
                  <PublishButton className="button outline" post={item} notify={notify} />
                  <button
                    className="button outline"
                    type="button"
                    onClick={() => void copyLink(item.id)}
                  >
                    <Copy aria-hidden="true" /> Copy link
                  </button>
                  <button
                    className="button outline"
                    type="button"
                    onClick={() => openBuyPage(item.id)}
                  >
                    <ExternalLink aria-hidden="true" /> Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

const confidenceTone = { low: "review", medium: "neutral", high: "success" } as const;

function ConfidenceTag({ confidence }: { confidence: Recommendation["confidence"] }) {
  return (
    <span className={`status-tag ${confidenceTone[confidence]}`}>
      {confidence[0].toUpperCase() + confidence.slice(1)} confidence
    </span>
  );
}

function BusyLabel({ text, elapsed = false }: { text: string; elapsed?: boolean }) {
  return (
    <span className="busy-label">
      <span className="spinner" aria-hidden="true" />
      {text}…{elapsed ? <ElapsedSeconds /> : null}
    </span>
  );
}

/** Opens the channel's own composer with the post and its buy link. The founder presses Post. */
function PublishButton({
  className,
  post,
  notify,
}: {
  className: string;
  post: Post;
  notify: (message: string) => void;
}) {
  const tipId = useId();
  const link = buyLink(post.id);
  const text = shareText(post, link);
  const target = shareTarget(post.channel, text, link);

  async function publish() {
    // Start the copy while this page has focus, then open the composer inside the same click.
    const copied = target.copyFirst ? navigator.clipboard.writeText(text) : null;
    if (target.url) window.open(target.url, "_blank", "noopener");
    if (!copied) {
      if (post.channel === "X" && xLength(text) > 280)
        notify("This post is longer than 280 characters. Shorten it in X before posting.");
      return;
    }
    try {
      await copied;
      notify(
        target.url
          ? `Post copied. Paste it into ${post.channel}, then press Post.`
          : "Post copied with its buy link. Paste it into a new Instagram post in the app.",
      );
    } catch {
      notify("Copy is blocked in this browser. Select the post text and copy it yourself.");
    }
  }

  const label = target.url ? `Publish on ${post.channel}` : "Copy for Instagram";
  return (
    <span className="tip-anchor">
      <button
        className={className}
        type="button"
        onClick={() => void publish()}
        aria-describedby={tipId}
      >
        <ChannelIcon channel={post.channel} /> {label}
      </button>
      <span className="tip" id={tipId} role="tooltip">
        {target.url
          ? `Opens ${post.channel} with this post and its buy link filled in. You review it and press Post. GrowthReceipt never posts for you.`
          : "Instagram has no web composer, so the post and its buy link are copied for the Instagram app."}
      </span>
    </span>
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
        Opens your buy page in a new tab, where you act as your own customer. Pay with a PayPal
        sandbox account, so no real money moves. The payment is credited to the post it came from.
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
  status: "Connected" | "Share link" | "Planned";
  action?: string;
  onAction?: () => void;
}) {
  return (
    <article className="integration-row">
      <span className="integration-icon">{icon}</span>
      <div>
        <h2>{provider}</h2>
        <p>{description}</p>
      </div>
      <span
        className={`status-tag ${status === "Connected" ? "success" : status === "Share link" ? "review" : "neutral"}`}
      >
        {status}
      </span>
      {action && onAction ? (
        <button className="button secondary" type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
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
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const showIcon = iconUrl && iconUrl !== failedUrl;
  const loaded = showIcon && loadedUrl === iconUrl;
  return (
    <span className={`product-mark ${className}`} aria-hidden="true">
      {/* The letter holds the space, and the icon fades in over it once it has loaded. */}
      {loaded ? null : name.trim().charAt(0).toUpperCase() || "P"}
      {showIcon ? (
        // Product icons are arbitrary user links, so next/image remote patterns do not fit.
        // biome-ignore lint/performance/noImgElement: see above
        <img
          className={loaded ? "loaded" : undefined}
          src={iconUrl}
          alt=""
          decoding="async"
          onLoad={() => {
            setLoadedUrl(iconUrl);
            onLoadResult?.(true);
          }}
          onError={() => {
            setFailedUrl(iconUrl);
            onLoadResult?.(false);
          }}
        />
      ) : null}
    </span>
  );
}

const channelIntegration: Record<Channel, string> = {
  LinkedIn:
    "Publish from Content opens LinkedIn with the post and its buy link filled in. Automatic posting is planned.",
  Facebook:
    "Publish from Content opens Facebook with the buy link and copies the post for you to paste.",
  X: "Publish from Content opens X with the post and its buy link filled in. Automatic posting is planned.",
  Instagram: "Instagram has no web composer. Content copies the post and its link for the app.",
};

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === "LinkedIn") return <FaLinkedinIn aria-hidden="true" />;
  if (channel === "Facebook") return <FaFacebookF aria-hidden="true" />;
  if (channel === "Instagram") return <FaInstagram aria-hidden="true" />;
  return <FaXTwitter aria-hidden="true" />;
}
