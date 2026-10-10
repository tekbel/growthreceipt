"use client";

import { Check, LockKeyhole, X } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/campaign";

type PayPalConfig = {
  client_id: string;
  environment: string;
  currency: string;
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

export function PayPalCheckout({
  campaignId,
  contentId,
  onClose,
  onCaptured,
}: {
  campaignId: string;
  contentId: string;
  onClose: () => void;
  onCaptured: () => void;
}) {
  const buttonContainer = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<PayPalConfig | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState("Preparing secure checkout…");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    captureId: string;
    amount: string;
    currency: string;
  } | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadConfig() {
      try {
        const response = await apiFetch("/v1/paypal/config", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("PayPal checkout is not configured.");
        const value = (await response.json()) as PayPalConfig;
        setConfig(value);
        setStatus("Loading PayPal…");
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Checkout could not be loaded.");
      }
    }
    void loadConfig();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const container = buttonContainer.current;
    const paypal = window.paypal;
    if (!sdkReady || !config || !container || !paypal || receipt) return;
    const checkoutConfig = config;
    const checkoutContainer = container;
    const sdkNamespace: PayPalNamespace = paypal;

    let disposed = false;
    let paypalButton: HTMLElement | null = null;

    async function createOrder(): Promise<{ orderId: string }> {
      setError(null);
      setStatus("Creating your sandbox order…");
      const response = await apiFetch("/v1/paypal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer_id: "launchcheck-scan-pack",
          campaign_id: campaignId,
          content_id: contentId,
        }),
      });
      if (!response.ok) throw new Error("PayPal could not create the order.");
      const order = (await response.json()) as { order_id: string };
      setStatus("Complete approval in PayPal.");
      return { orderId: order.order_id };
    }

    async function captureOrder(orderId: string) {
      setError(null);
      setStatus("Capturing your payment…");
      const response = await apiFetch(`/v1/paypal/orders/${orderId}/capture`, {
        method: "POST",
      });
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
      onCaptured();
      setStatus("Sandbox payment completed.");
    }

    async function initializeCheckout() {
      try {
        setStatus("Checking PayPal availability…");
        const sdk = await sdkNamespace.createInstance({
          clientId: checkoutConfig.client_id,
          components: ["paypal-payments"],
          pageType: "checkout",
          clientMetadataId: crypto.randomUUID(),
        });
        if (!sdk || disposed) return;
        const methods = await sdk.findEligibleMethods({ currencyCode: checkoutConfig.currency });
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
  }, [campaignId, config, contentId, onCaptured, receipt, sdkReady]);

  return (
    <div className="checkout-backdrop">
      <section
        className="checkout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
      >
        <button
          className="checkout-close"
          type="button"
          onClick={onClose}
          aria-label="Close checkout"
        >
          <X aria-hidden="true" />
        </button>

        <div className="checkout-product">
          <div className="checkout-product-mark">S</div>
          <div>
            <span className="checkout-label">Sandbox checkout</span>
            <h2 id="checkout-title">LaunchCheck scan pack</h2>
            <p>200 writing actions every day wherever you type.</p>
          </div>
          <div className="checkout-price">
            <strong>$9.00</strong>
            <span>USD · sandbox purchase</span>
          </div>
          <ul className="checkout-benefits">
            <li>
              <Check aria-hidden="true" /> 200 actions every day
            </li>
            <li>
              <Check aria-hidden="true" /> Works inside your keyboard
            </li>
            <li>
              <Check aria-hidden="true" /> Monthly Pro plan
            </li>
          </ul>
        </div>

        <div className="checkout-payment">
          {receipt ? (
            <div className="checkout-success" role="status">
              <span className="success-icon">
                <Check aria-hidden="true" />
              </span>
              <h3>Payment complete</h3>
              <p>Your PayPal Sandbox capture was successful.</p>
              <dl>
                <div>
                  <dt>Amount</dt>
                  <dd>
                    {receipt.amount} {receipt.currency}
                  </dd>
                </div>
                <div>
                  <dt>Capture ID</dt>
                  <dd>{receipt.captureId}</dd>
                </div>
              </dl>
              <button className="button primary checkout-done" type="button" onClick={onClose}>
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="checkout-payment-head">
                <h3>Pay securely</h3>
                <p>Use a PayPal personal sandbox account. No real money will move.</p>
              </div>
              {config ? (
                <Script
                  id="paypal-web-sdk-v6"
                  src={`${config.environment === "sandbox" ? "https://www.sandbox.paypal.com" : "https://www.paypal.com"}/web-sdk/v6/core`}
                  strategy="afterInteractive"
                  onReady={() => {
                    setSdkReady(true);
                    setStatus("Checking PayPal availability…");
                  }}
                  onError={() => setError("The PayPal SDK could not be loaded.")}
                />
              ) : null}
              <div className="paypal-button-slot" ref={buttonContainer} />
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
    </div>
  );
}
