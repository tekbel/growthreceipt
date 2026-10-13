import type { Campaign, Offer } from "@/lib/campaign";
import type { Checkout } from "./data";

const DAY = 86_400_000;
export const SAMPLE_ORDER_PREFIX = "SAMPLE-";

// Sample checkouts for a campaign nobody has bought from yet, so the dashboard has something to
// show. They are labelled as samples on screen, use SAMPLE order IDs and carry no PayPal receipts.
export function sampleCheckouts(campaign: Campaign, offers: Offer[]): Checkout[] {
  if (!offers.length) return [];
  const now = Date.now();
  return campaign.posts.slice(0, 6).flatMap((post, index) =>
    Array.from({ length: 6 - index }, (_, k) => {
      const offer = offers[(index + k) % offers.length];
      const completed = (index + k) % 3 !== 2;
      const at = new Date(now - (((index * 3 + k * 5) % 13) + 1) * DAY).toISOString();
      return {
        order_id: `${SAMPLE_ORDER_PREFIX}${index + 1}${k + 1}`,
        content_id: post.id,
        offer_id: offer.id,
        amount: offer.amount,
        currency: offer.currency,
        completed,
        ordered_at: at,
        captured_at: completed ? at : null,
      };
    }),
  );
}
