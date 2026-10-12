# What's next for GrowthReceipt

Draft for the Devpost "What's next" section. Keep it in sync with what the demo really does.

## Subscriptions

Today GrowthReceipt attributes one time PayPal orders. Most indie software sells subscriptions, so the next step is the PayPal Subscriptions API.

1. Each campaign link opens a PayPal subscription checkout for the founder's plan, tagged with the campaign.
2. Webhooks follow the whole subscriber lifecycle:
   * `BILLING.SUBSCRIPTION.ACTIVATED` credits a new subscriber to the campaign.
   * `PAYMENT.SALE.COMPLETED` adds every renewal payment to that campaign's revenue.
   * `BILLING.SUBSCRIPTION.CANCELLED` records churn.
3. Results show subscribers, recurring revenue, renewal rate and churn for each campaign.
4. The agent learns which message brings subscribers who stay, not just sign ups. For example, it can see that a LinkedIn story keeps subscribers twice as long as an X thread and shift the next campaign there.

Retention by campaign is a signal that engagement based marketing tools cannot show at all.

## Founders get paid directly

The hosted demo runs every checkout through one PayPal sandbox merchant. In production each founder connects their own PayPal account through PayPal partner onboarding (the Partner Referrals API). Buyers pay the founder directly, and GrowthReceipt only reads the order, capture and subscription events it needs for attribution. On the free Starter plan, a 3% platform fee is split out of each payment by PayPal at capture, so GrowthReceipt does not hold the founder's money. The step by step flow is in [architecture.md](./architecture.md#how-the-money-moves-in-production-planned-not-built).

## Offers from the product

The demo offer is fixed to the LaunchCheck 10 scan pack at 9 USD. Next, the offer comes from the founder's brief: product, plan, price and currency, with several offers per campaign so the agent can compare them.

## Publishing

LinkedIn publishing is live for personal profiles. A founder connects LinkedIn, then posts an approved post with one click or turns on automatic publishing, which posts each approved post on its scheduled day. Only approved posts are sent.

Next:

* X, with the same approval step and the same buy link per post
* LinkedIn Company Pages, which need LinkedIn's Community Management API review
* Reading each live post's views and clicks next to its verified purchases, so the gap between engagement and revenue is visible per post
