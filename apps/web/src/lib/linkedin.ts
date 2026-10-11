import { apiFetch } from "@/lib/campaign";

export const LINKEDIN_CALLBACK_KEY = "growthreceipt-linkedin-callback";

export type LinkedInStatus = {
  configured: boolean;
  connected: boolean;
  member_name: string | null;
  expires_at: string | null;
  expired: boolean;
  auto_publish: boolean;
  can_connect: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/v1/integrations/linkedin${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new Error(
      typeof body?.detail === "string" ? body.detail : "LinkedIn could not be reached.",
    );
  }
  return (await response.json()) as T;
}

export const linkedinApi = {
  status: () => request<LinkedInStatus>(""),
  authorize: () => request<{ url: string }>("/authorize", { method: "POST" }),
  connect: (code: string, state: string) =>
    request<LinkedInStatus>("/connect", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    }),
  setAutoPublish: (autoPublish: boolean) =>
    request<LinkedInStatus>("", {
      method: "PATCH",
      body: JSON.stringify({ auto_publish: autoPublish }),
    }),
  disconnect: () => request<LinkedInStatus>("", { method: "DELETE" }),
  publish: (postId: string) =>
    request<{ url: string }>(`/posts/${postId}/publish`, { method: "POST" }),
};

/** Reads and clears the result LinkedIn sent back to the callback page. */
export function takeLinkedInCallback(): {
  code: string | null;
  state: string | null;
  error: string | null;
} | null {
  try {
    const raw = sessionStorage.getItem(LINKEDIN_CALLBACK_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(LINKEDIN_CALLBACK_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
