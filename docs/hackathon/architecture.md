# GrowthReceipt architecture for judges

![GrowthReceipt architecture](../architecture/overview.png)

The source is [overview.svg](../architecture/overview.svg). The PNG is 1920 by 1080, so it can go straight into the demo video and the Devpost gallery.

## What the system does

GrowthReceipt is a marketing agent that learns from verified PayPal payments instead of likes. A founder briefs a product, the agent drafts a campaign, the founder approves it, buyers pay through a PayPal checkout tied to that campaign, and the agent plans the next move from the payments it can prove.

## The loop

1. **Brief.** The founder gives the product, price, audience and channels in the web app. They can also paste a link to the product page. The API reads that public page and the agent suggests the brief fields for the founder to edit. The API fetches only https pages on public addresses, checks every redirect the same way, and stops at 1 MB or 8 seconds. Page text goes to the model as data, never as instructions. A link that cannot be read does not count toward the daily agent limit.
2. **Agent drafts.** The API calls the OpenAI agent, which returns typed campaign output. Progress streams to the browser as each real step finishes.
3. **Founder approves.** Every post can be edited, and nothing goes out without approval. Each change is logged as a campaign event.
4. **Buyer checks out.** Each approved post carries a public buy link. The buyer opens it without signing in and never sees GrowthReceipt. The API finds the campaign from the post, refuses posts that are not approved, creates a PayPal order tied to that post, and the buyer pays in PayPal through the JavaScript SDK v6. Public order creation is limited to 20 an hour per address.
5. **Capture.** The API captures the order with a request ID, so a repeated capture is never counted twice.
6. **Webhook verified.** PayPal sends the capture event. The API checks its signature with PayPal before trusting it.
7. **Revenue attributed.** The captured amount is stored against the campaign in Postgres.
8. **Next move.** The agent reads the payment evidence and proposes one next action with its confidence. The founder approves it. Code, not the model, ranks the paying posts and labels the evidence: none, early signal (the leading post has fewer than 3 purchases), clear leader, or tie. A tie asks for a controlled comparison instead of a winner. Each recommendation shows the time of the latest purchase it read, and the Next experiment page flags new purchases that arrived after it.

## Who pays whom

The PayPal payment is a buyer paying the founder for the founder's product. It is not a fee for using GrowthReceipt.

In the demo, Teklie Belay, the maker of GrowthReceipt, promotes LaunchCheck (launchcheck.addisstack.com), a scanner Teklie also built that finds launch issues on a public page. The offer is a one time pack of 10 scans for 9 USD. A buyer who arrives from a campaign post buys the pack for 9 USD, and GrowthReceipt credits that revenue to the campaign. LaunchCheck takes card payments through Stripe on its own site, and in the demo customers buy the same pack through PayPal.

Hosted demo limits:

* All checkouts run through one PayPal sandbox merchant account owned by GrowthReceipt. No real money moves.
* The checkout offer is fixed to the LaunchCheck 10 scan pack at 9 USD.

In production each founder connects their own PayPal account through PayPal partner onboarding (the Partner Referrals API), so buyers pay the founder directly and GrowthReceipt only reads the order and capture events it needs for attribution.

## Hosting

| Part | Where |
| --- | --- |
| Web app | Next.js on Railway, `growthreceipt.addisstack.com` |
| API | FastAPI on Railway, `growthreceipt-api.addisstack.com` |
| Database and sign in | Supabase Postgres and Auth, tables in the `growthreceipt` schema |
| Agent | OpenAI, called only from the API |
| Payments | PayPal sandbox Orders API, JavaScript SDK v6 and webhooks |

Judges enter with one click. Each judge gets an anonymous session and a private seeded workspace.

Model calls are capped. Each workspace can run the agent 20 times a day, and all workspaces together 300 times a day. The API records every run in `growthreceipt.agent_runs` and answers 429 with a plain message once a limit is reached. Both limits are settings (`AGENT_RUNS_PER_WORKSPACE_DAY`, `AGENT_RUNS_PER_DAY`).

Releases go through `dev`. CI runs the web checks, the API checks and both production images. When all pass on a `dev` push, CI fast forwards `main` to that commit, and Railway deploys from `main`. The source lives in the private repository `tekbel/growthreceipt` until the submission audit makes it public. Manual `railway up` deploys are retired.

## Using it in the demo video

Show the diagram for about ten seconds right after the opening problem statement. Point at the numbered loop on the right, then cut to the live product and follow the same numbers in order.
