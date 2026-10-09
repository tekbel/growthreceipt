export type HealthResponse = {
  status: "ok" | "not_ready";
  database?: "ok" | "unavailable" | null;
};

export class GrowthReceiptApi {
  constructor(private readonly baseUrl: string) {}

  async live(signal?: AbortSignal): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health/live`, { signal });
    if (!response.ok) throw new Error(`GrowthReceipt API returned ${response.status}`);
    return response.json() as Promise<HealthResponse>;
  }
}
