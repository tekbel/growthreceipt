# Judge FAQ

Short answers to questions you may have. The same answers are in the app's Help panel.

## How is a purchase linked to a post?

Every approved post gets its own buy link. When a customer pays through it, the PayPal order carries that post's attribution ID in `custom_id` and the offer in `reference_id`. When PayPal captures the payment, GrowthReceipt stores the capture and credits the purchase to that post. PayPal's signed webhook for the same capture is stored as a second proof.

## What if the agent is wrong?

Nothing the agent writes goes out until you approve it. You approve every post, and every next move waits for your decision. Before the agent runs, code decides how strong the purchase evidence is, so with one or two purchases it says the signal is early instead of claiming a winner. The agent can also look up the campaign's own orders in PayPal, and each lookup is recorded so you can see what PayPal said.

## Why PayPal?

The loop needs proof of payment, not clicks. PayPal gives a captured order, a capture ID and a signed webhook for every purchase and refund, which is the evidence the agent learns from. The demo uses the PayPal sandbox, so no real money moves.

## What data does the agent see?

The campaign (product, positioning, goal, audience, channels and post counts), the purchases PayPal confirmed for that campaign, summed by post and offer, and the offer catalog. It does not see buyer names, emails or payment details. It can read only this campaign's paid orders from PayPal.

## What does an agent run cost?

Each run records its model, duration and OpenAI token counts, shown under the run. Cost is those tokens times OpenAI's price for the model. Daily limits per workspace and in total keep spend bounded.

## What does a refund do?

A fully refunded purchase stops counting as revenue and is left out of the agent's evidence. A partial refund counts what the buyer kept. PayPal's signed refund webhook confirms it, and the receipt keeps its proof.
