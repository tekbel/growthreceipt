export type HealthResponse = {
  status: "ok" | "not_ready";
  database?: "ok" | "unavailable" | null;
};

export class NorthstarApi {
  constructor(private readonly baseUrl: string) {}

  async live(signal?: AbortSignal): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health/live`, { signal });
    if (!response.ok) throw new Error(`Northstar API returned ${response.status}`);
    return response.json() as Promise<HealthResponse>;
  }
}

