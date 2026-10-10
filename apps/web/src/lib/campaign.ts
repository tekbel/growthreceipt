export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

let accessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export type Channel = "LinkedIn" | "Facebook" | "X" | "Instagram";
// One list drives both campaign creation and the Integrations page.
export const channels: Channel[] = ["LinkedIn", "Facebook", "X", "Instagram"];

export type PostStatus = "needs_review" | "changes_requested" | "approved";
export type CampaignStatus = "in_review" | "changes_requested" | "approved";

export type Post = {
  id: string;
  day: number;
  channel: Channel;
  theme: string;
  content: string;
  call_to_action: string;
  status: PostStatus;
  review_note: string | null;
};

export type Campaign = {
  id: string;
  name: string;
  positioning: string;
  product_name: string;
  product_icon_url: string | null;
  product_description: string;
  audience: string;
  objective: string;
  channels: Channel[];
  brand_voice: string;
  starts_on: string;
  created_at: string;
  status: CampaignStatus;
  posts: Post[];
};

export type CampaignBrief = {
  product_name: string;
  product_icon_url: string;
  product_description: string;
  audience: string;
  objective: string;
  channels: Channel[];
  days: number;
  brand_voice: string;
};

export type CampaignEvent = {
  id: number;
  post_id: string | null;
  actor: "agent" | "human" | "system";
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type PostUpdate = {
  content?: string;
  status?: "approved" | "changes_requested";
  review_note?: string;
};

export const exampleBrief: CampaignBrief = {
  product_name: "LaunchCheck",
  product_icon_url: "/products/launchcheck.svg",
  product_description:
    "Checks a public page and finds launch problems in speed, SEO and page structure, with clear fixes for indie builders.",
  audience: "Indie builders and small teams about to launch a product page.",
  objective: "Sell the 10 scan pack to builders preparing a launch",
  channels: ["LinkedIn", "X", "Instagram"],
  days: 7,
  brand_voice: "Direct, practical, encouraging",
};

export type DraftStage =
  | "brief_received"
  | "session_started"
  | "thinking"
  | "writing"
  | "checking"
  | "saving";

export type DraftProgress = {
  stage: DraftStage;
  detail?: string | null;
  items: number;
  total: number;
};

export class ApiError extends Error {}

async function errorFrom(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = typeof body?.detail === "string" ? body.detail : null;
  return new ApiError(detail ?? `GrowthReceipt API returned ${response.status}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<T>;
}

/** Drafts a campaign and reports each step the agent reaches until the saved campaign arrives. */
async function streamCreate(
  brief: CampaignBrief,
  onProgress: (progress: DraftProgress) => void,
): Promise<Campaign> {
  const response = await apiFetch("/v1/campaigns/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(brief),
  });
  if (!response.ok || !response.body) throw await errorFrom(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "null");
      if (event === "progress") onProgress(data as DraftProgress);
      if (event === "error") throw new ApiError((data as { detail: string }).detail);
      if (event === "campaign") {
        await reader.cancel();
        return data as Campaign;
      }
    }
  }
  throw new ApiError("The campaign agent stopped before it finished.");
}

export const campaignApi = {
  async latest(): Promise<Campaign | null> {
    try {
      return await request<Campaign>("/v1/campaigns/latest");
    } catch (error) {
      if (error instanceof ApiError && error.message === "Campaign not found") return null;
      throw error;
    }
  },
  create: (brief: CampaignBrief) =>
    request<Campaign>("/v1/campaigns", { method: "POST", body: JSON.stringify(brief) }),
  streamCreate,
  updatePost: (campaignId: string, postId: string, update: PostUpdate) =>
    request<Campaign>(`/v1/campaigns/${campaignId}/posts/${postId}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    }),
  approve: (campaignId: string) =>
    request<Campaign>(`/v1/campaigns/${campaignId}/approve`, { method: "POST" }),
  events: (campaignId: string) => request<CampaignEvent[]>(`/v1/campaigns/${campaignId}/events`),
};

export function postDate(campaign: Campaign, post: Post): string {
  const date = new Date(`${campaign.starts_on}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + post.day - 1);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function scheduleRange(campaign: Campaign): string {
  const days = Math.max(...campaign.posts.map((post) => post.day), 1);
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const start = new Date(`${campaign.starts_on}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + days - 1);
  return `${format.format(start)} to ${format.format(end)}`;
}
