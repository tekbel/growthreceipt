"use client";

import { ArrowRight, Check, Copy, LockKeyhole } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { InfoTip } from "@/components/info-tip";
import { API_URL } from "@/lib/campaign";

// The customer side of GrowthReceipt. It needs no sign in: the post id in the
// buy link decides the campaign and the offer on the server.

type PublicOffer = {
  content_id: string;
  product_name: string;
  product_icon_url: string | null;
  offer_id: string;
  offer_name: string;
  offer_description: string;
  credits: number;
  amount: string;
  currency: string;
  client_id: string;
  environment: string;
  sandbox_buyer_email: string | null;
  sandbox_buyer_password: string | null;
};

type PayPalPaymentSession = {
  start: (
    options: { presentationMode: "auto" },
    order: Promise<{ orderId: string }>,
  ) => Promise<void>;
};

type PayPalSdkInstance = {
  findEligibleMethods: (options: { currencyCode: string }) => Promise<{
    isEligible: (method: string) => boolean;
  }>;
  createPayPalOneTimePaymentSession: (options: {
    onApprove: (data: { orderId: string }) => Promise<void>;
    onCancel: () => void;
    onError: () => void;
  }) => PayPalPaymentSession;
};

type PayPalNamespace = {
  createInstance: (options: {
    clientId: string;
    components: string[];
    pageType: "checkout";
    clientMetadataId: string;
  }) => Promise<PayPalSdkInstance>;
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

function publicFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export function BuyCheckout({ contentId }: { contentId: string }) {
  const buttonContainer = useRef<HTMLDivElement>(null);
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [founderPreview, setFounderPreview] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const [iconLoaded, setIconLoaded] = useState(false);
  const [buttonReady, setButtonReady] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState("Preparing secure checkout…");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    captureId: string;
    amount: string;
    currency: string;
  } | null>(null);

  // Set by the workspace when the founder opens their own buy link. Customer links lack it.
  useEffect(() => {
    setFounderPreview(new URLSearchParams(window.location.search).get("preview") === "founder");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadOffer() {
      try {
        const response = await publicFetch(`/v1/public/offers/${contentId}`, {
          signal: controller.signal,
        });
        if (response.status === 404 || response.status === 422) {
          setUnavailable(true);
          return;
        }
        if (!response.ok) throw new Error("Checkout could not be loaded. Please try again.");
        setOffer((await response.json()) as PublicOffer);
        setStatus("Loading PayPal…");
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Checkout could not be loaded.");
      }
    }
    void loadOffer();
    return () => controller.abort();
  }, [contentId]);

  useEffect(() => {
    const container = buttonContainer.current;
    const paypal = window.paypal;
    if (!sdkReady || !offer || !container || !paypal || receipt) return;
    const checkoutOffer = offer;
    const checkoutContainer = container;
    const sdkNamespace: PayPalNamespace = paypal;

    let disposed = false;
    let paypalButton: HTMLElement | null = null;

    async function createOrder(): Promise<{ orderId: string }> {
      setError(null);
      setStatus("Creating your order…");
      const response = await publicFetch("/v1/public/orders", {
        method: "POST",
        body: JSON.stringify({ content_id: contentId, offer_id: checkoutOffer.offer_id }),
      });
      if (response.status === 429) {
        throw new Error("Too many checkout attempts. Please try again later.");
      }
      if (response.status === 409) {
        throw new Error("This offer changed. Reload the page to see the new price.");
      }
      if (!response.ok) throw new Error("PayPal could not create the order.");
      const order = (await response.json()) as { order_id: string };
      setStatus("Complete approval in PayPal.");
      return { orderId: order.order_id };
    }

    async function captureOrder(orderId: string) {
      setError(null);
      setStatus("Capturing your payment…");
      const response = await publicFetch(`/v1/public/orders/${orderId}/capture`, {
        method: "POST",
      });
      if (response.status === 409) {
        const message = "PayPal has not completed this payment yet, so no receipt was issued.";
        setError(message);
        setStatus("Checkout needs attention.");
        throw new Error(message);
      }
      if (!response.ok) throw new Error("The approved order could not be captured.");
      const capture = (await response.json()) as {
        capture_id: string;
        amount: string;
        currency: string;
      };
      if (disposed) return;
      setReceipt({
        captureId: capture.capture_id,
        amount: capture.amount,
        currency: capture.currency,
      });
      setStatus("Payment complete.");
    }

    async function initializeCheckout() {
      try {
        setStatus("Checking PayPal availability…");
        const sdk = await sdkNamespace.createInstance({
          clientId: checkoutOffer.client_id,
          components: ["paypal-payments"],
          pageType: "checkout",
          clientMetadataId: crypto.randomUUID(),
        });
        if (!sdk || disposed) return;
        const methods = await sdk.findEligibleMethods({ currencyCode: checkoutOffer.currency });
        if (disposed) return;
        if (!methods.isEligible("paypal")) {
          throw new Error("PayPal is not available for this sandbox account.");
        }

        const paymentSession = sdk.createPayPalOneTimePaymentSession({
          onApprove: ({ orderId }) => captureOrder(orderId),
          onCancel: () => setStatus("Checkout cancelled. You can try again when ready."),
          onError: () => {
            setError("PayPal could not complete checkout. Please try again.");
            setStatus("Checkout needs attention.");
          },
        });
        paypalButton = document.createElement("paypal-button");
        paypalButton.setAttribute("type", "pay");
        paypalButton.setAttribute("aria-label", "Pay with PayPal");
        paypalButton.addEventListener("click", () => {
          setError(null);
          void paymentSession
            .start({ presentationMode: "auto" }, createOrder())
            .catch((reason: unknown) => {
              if (disposed) return;
              setError(
                reason instanceof Error
                  ? reason.message
                  : "PayPal could not start checkout. Please try again.",
              );
              setStatus("Checkout needs attention.");
            });
        });
        checkoutContainer.replaceChildren(paypalButton);
        setButtonReady(true);
        setStatus("Choose PayPal to continue.");
      } catch (reason) {
        if (disposed) return;
        setError(reason instanceof Error ? reason.message : "PayPal could not be initialized.");
        setStatus("Checkout needs attention.");
      }
    }

    void initializeCheckout();

    return () => {
      disposed = true;
      paypalButton?.remove();
    };
  }, [contentId, offer, receipt, sdkReady]);

  if (unavailable) {
    return (
      <main className="buy-page">
        <section className="buy-unavailable" role="alert">
          <h1>This offer is not available</h1>
          <p>The link may be out of date, or the post it came from is not approved yet.</p>
          <a className="button secondary" href="/">
            Go to GrowthReceipt
            <ArrowRight aria-hidden="true" />
          </a>
        </section>
      </main>
    );
  }

  const productName = offer?.product_name ?? "LaunchCheck";

  return (
    <main className="buy-page">
      <section className="checkout-dialog" aria-labelledby="checkout-title">
        <div className="checkout-product">
          <div className="checkout-product-mark" aria-hidden="true">
            {/* The founder's uploaded icon when there is one, otherwise the first letter. */}
            {/* The letter holds the space, and the icon fades in over it once it has loaded. */}
            {productName[0]?.toUpperCase()}
            {offer?.product_icon_url && !iconFailed ? (
              // biome-ignore lint/performance/noImgElement: icons can be any uploaded URL, so next/image is not used.
              <img
                className={iconLoaded ? "loaded" : undefined}
                src={offer.product_icon_url}
                alt=""
                decoding="async"
                fetchPriority="high"
                onLoad={() => setIconLoaded(true)}
                onError={() => setIconFailed(true)}
              />
            ) : null}
          </div>
          <div>
            <span className="checkout-label">{productName}</span>
            <h1 id="checkout-title">{offer?.offer_name ?? "LaunchCheck scan pack"}</h1>
            <p>Find what breaks a launch before your visitors do.</p>
          </div>
          <div className="checkout-price">
            {/* The campaign decides the pack, so no price shows until the server says it. */}
            <strong>{offer ? `$${offer.amount}` : "\u00a0"}</strong>
            <span>{offer?.currency ?? "USD"} · one payment</span>
          </div>
          <ul className="checkout-benefits">
            <li>
              <Check aria-hidden="true" /> {offer ? `${offer.credits} scans` : "Page scans"} for
              speed, SEO and page structure
            </li>
            <li>
              <Check aria-hidden="true" /> A clear fix for every issue found
            </li>
            <li>
              <Check aria-hidden="true" /> One payment, no subscription
            </li>
          </ul>
        </div>

        <div className="checkout-payment">
          {receipt ? (
            <div className="checkout-success" role="status">
              <span className="success-icon">
                <Check aria-hidden="true" />
              </span>
              <h2>Thanks for your purchase</h2>
              <p>
                Your payment is complete. This was a sandbox purchase, so no scans are delivered. In
                a live store {productName} would deliver them now.
              </p>
              <dl>
                <div>
                  <dt>Amount</dt>
                  <dd>
                    {receipt.amount} {receipt.currency}
                  </dd>
                </div>
                <div>
                  <dt>PayPal receipt</dt>
                  <dd>{receipt.captureId}</dd>
                </div>
              </dl>
              {founderPreview ? (
                <div className="buy-founder-note">
                  <p>This purchase is already credited to the post that brought it.</p>
                  <span className="buy-founder-action">
                    <a className="button dark" href="/today">
                      See it on Today
                      <ArrowRight aria-hidden="true" />
                    </a>
                    <InfoTip label="About this button" align="start">
                      Demo only. It appears because you opened your own buy link. A real customer's
                      visit ends at this thank you screen.
                    </InfoTip>
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="checkout-payment-head">
                <h2>Pay securely</h2>
                <p>Pay with a PayPal sandbox account. No real money moves.</p>
              </div>
              {offer?.sandbox_buyer_email && offer.sandbox_buyer_password ? (
                <div className="test-buyer">
                  <p className="test-buyer-title">
                    Test buyer login
                    <InfoTip label="About the test buyer" align="start">
                      A PayPal sandbox account with play money, shown so judges can pay without
                      signing up. A live store never shows this.
                    </InfoTip>
                  </p>
                  <p>
                    Demo credentials for PayPal sandbox only. When PayPal asks you to log in, use
                    them.
                  </p>
                  <dl>
                    <CopyRow label="Email" value={offer.sandbox_buyer_email} />
                    <CopyRow label="Password" value={offer.sandbox_buyer_password} />
                  </dl>
                </div>
              ) : null}
              {offer ? (
                <Script
                  id="paypal-web-sdk-v6"
                  src={`${offer.environment === "sandbox" ? "https://www.sandbox.paypal.com" : "https://www.paypal.com"}/web-sdk/v6/core`}
                  strategy="afterInteractive"
                  onReady={() => {
                    setSdkReady(true);
                    setStatus("Checking PayPal availability…");
                  }}
                  onError={() => setError("The PayPal SDK could not be loaded.")}
                />
              ) : null}
              {/* PayPal draws its own button. A same size placeholder holds the space until then. */}
              <div className="paypal-button-frame">
                <div
                  className={`paypal-button-slot${buttonReady ? " ready" : ""}`}
                  ref={buttonContainer}
                />
                {!buttonReady && !error ? (
                  <div className="paypal-button-skeleton" aria-hidden="true" />
                ) : null}
              </div>
              <p className={`checkout-status ${error ? "error" : ""}`} aria-live="polite">
                {error ?? status}
              </p>
              <div className="checkout-secure">
                <LockKeyhole aria-hidden="true" />
                PayPal handles your payment details securely.
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
        <button
          className="icon-button"
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </dd>
    </div>
  );
}
