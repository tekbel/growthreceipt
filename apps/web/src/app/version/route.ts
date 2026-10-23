import { connection } from "next/server";

// Railway sets this on every deploy from GitHub. CI compares it with the pushed commit.
export async function GET() {
  await connection();
  return Response.json(
    { commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
