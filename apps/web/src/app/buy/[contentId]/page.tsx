import type { Metadata } from "next";

import { BuyCheckout } from "@/components/paypal-checkout";

export const metadata: Metadata = {
  title: "LaunchCheck scan pack | Checkout",
  description: "Buy the LaunchCheck 10 scan pack with PayPal.",
  robots: { index: false },
};

export default async function BuyPage({ params }: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params;
  return <BuyCheckout contentId={contentId} />;
}
