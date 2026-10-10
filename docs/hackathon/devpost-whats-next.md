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

The hosted demo runs every checkout through one PayPal sandbox merchant. In production each founder connects their own PayPal account through PayPal partner onboarding (the Partner Referrals API). Buyers pay the founder directly, and GrowthReceipt only reads the order, capture and subscription events it needs for attribution.

## Offers from the product

The demo offer is fixed to Scribe Pro at 12 USD. Next, the offer comes from the founder's brief: product, plan, price and currency, with several offers per campaign so the agent can compare them.

## Publishing

Channel publishing is not connected yet. Next, approved posts publish straight to the connected channels, with the same human approval step before anything goes live.
