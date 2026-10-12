import type { Metadata } from "next";
import { Suspense } from "react";

import { BuyCheckout } from "@/components/paypal-checkout";

export const metadata: Metadata = {
  title: "LaunchCheck scan pack | Checkout",
  description: "Buy a LaunchCheck scan pack with PayPal.",
  robots: { index: false },
};

type Params = Promise<{ contentId: string }>;

// The post id is only known per request, so it is read inside a Suspense boundary.
export default function BuyPage({ params }: { params: Params }) {
  return (
    <>
      {/* Open the PayPal connections early, so the button script arrives sooner. React hoists these to the head. */}
      <link rel="preconnect" href="https://www.sandbox.paypal.com" />
      <link rel="preconnect" href="https://www.paypalobjects.com" />
      <Suspense fallback={<main className="buy-page" aria-busy="true" />}>
        <BuyForPost params={params} />
      </Suspense>
    </>
  );
}

async function BuyForPost({ params }: { params: Params }) {
  const { contentId } = await params;
  return <BuyCheckout contentId={contentId} />;
}
