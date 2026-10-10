# GrowthReceipt architecture for judges

![GrowthReceipt architecture](../architecture/overview.png)

The source is [overview.svg](../architecture/overview.svg). The PNG is 1920 by 1080, so it can go straight into the demo video and the Devpost gallery.

## What the system does

GrowthReceipt is a marketing agent that learns from verified PayPal payments instead of likes. A founder briefs a product, the agent drafts a campaign, the founder approves it, buyers pay through a PayPal checkout tied to that campaign, and the agent plans the next move from the payments it can prove.

## The loop

1. **Brief.** The founder gives the product, price, audience and channels in the web app.
2. **Agent drafts.** The API calls the OpenAI agent, which returns typed campaign output. Progress streams to the browser as each real step finishes.
3. **Founder approves.** Every post can be edited, and nothing goes out without approval. Each change is logged as a campaign event.
4. **Buyer checks out.** The buyer opens the campaign's checkout. The API creates a PayPal order tied to that campaign, and the buyer pays in PayPal through the JavaScript SDK v6.
5. **Capture.** The API captures the order with a request ID, so a repeated capture is never counted twice.
6. **Webhook verified.** PayPal sends the capture event. The API checks its signature with PayPal before trusting it.
7. **Revenue attributed.** The captured amount is stored against the campaign in Postgres.
8. **Next move.** The agent reads the payment evidence and proposes one next action with its confidence. The founder approves it.

## Who pays whom

The PayPal payment is a buyer paying the founder for the founder's product. It is not a fee for using GrowthReceipt.

In the demo, the founder sells LaunchCheck (launchcheck.addisstack.com), a scanner that finds launch problems on a public page. The offer is a one time pack of 10 scans for 9 USD. A buyer who arrives from a campaign post pays 9 USD, and GrowthReceipt credits that revenue to the campaign. LaunchCheck takes card payments through Stripe on its own site, and the demo shows the same pack sold through PayPal.

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

Releases go through `dev`. CI runs the web checks, the API checks and both production images. When all pass on a `dev` push, CI fast forwards `main` to that commit, and Railway deploys from `main`.

## Using it in the demo video

Show the diagram for about ten seconds right after the opening problem statement. Point at the numbered loop on the right, then cut to the live product and follow the same numbers in order.
