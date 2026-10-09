export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type Channel = "LinkedIn" | "X" | "Instagram";
export const channels: Channel[] = ["LinkedIn", "X", "Instagram"];

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
  product_name: "Scribe",
  product_description:
    "A writing keyboard that helps professionals turn rough thoughts into clear messages wherever they type.",
  audience: "Knowledge workers aged 25 to 40 who value speed, clarity, and a natural voice.",
  objective: "Turn readers into paying Scribe Pro subscribers",
  channels: ["LinkedIn", "X", "Instagram"],
  days: 7,
  brand_voice: "Clear, confident, useful",
};

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : null;
    throw new ApiError(detail ?? `Northstar API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
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
