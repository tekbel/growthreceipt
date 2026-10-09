"use client";

import { Check, LockKeyhole, X } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const CONTENT_ID = "22222222-2222-4222-8222-222222222222";

type PayPalConfig = {
  client_id: string;
  environment: string;
  currency: string;
};

type PayPalButtonsInstance = {
  render: (container: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
};

type PayPalNamespace = {
  Buttons: (options: {
    style: Record<string, string | boolean | number>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel: () => void;
    onError: () => void;
  }) => PayPalButtonsInstance;
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

export function PayPalCheckout({
  onClose,
  onCaptured,
}: {
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
        const response = await fetch(`${API_URL}/v1/paypal/config`, {
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
    if (!sdkReady || !buttonContainer.current || !window.paypal || receipt) return;

    const buttons = window.paypal.Buttons({
      style: {
        color: "gold",
        height: 46,
        label: "paypal",
        layout: "vertical",
        shape: "rect",
        tagline: false,
      },
      createOrder: async () => {
        setError(null);
        setStatus("Creating your sandbox order…");
        const response = await fetch(`${API_URL}/v1/paypal/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offer_id: "scribe-pro",
            campaign_id: CAMPAIGN_ID,
            content_id: CONTENT_ID,
          }),
        });
        if (!response.ok) throw new Error("PayPal could not create the order.");
        const order = (await response.json()) as { order_id: string };
        setStatus("Complete approval in PayPal.");
        return order.order_id;
      },
      onApprove: async ({ orderID }) => {
        setError(null);
        setStatus("Capturing your payment…");
        const response = await fetch(`${API_URL}/v1/paypal/orders/${orderID}/capture`, {
          method: "POST",
        });
        if (!response.ok) throw new Error("The approved order could not be captured.");
        const capture = (await response.json()) as {
          capture_id: string;
          amount: string;
          currency: string;
        };
        setReceipt({
          captureId: capture.capture_id,
          amount: capture.amount,
          currency: capture.currency,
        });
        onCaptured();
        setStatus("Sandbox payment completed.");
      },
      onCancel: () => setStatus("Checkout cancelled. You can try again when ready."),
      onError: () => {
        setError("PayPal could not complete checkout. Please try again.");
        setStatus("Checkout needs attention.");
      },
    });

    void buttons
      .render(buttonContainer.current)
      .then(() => setStatus("Choose PayPal or card to continue."))
      .catch(() => {
        setError("The PayPal button could not be displayed.");
      });

    return () => {
      void buttons.close();
    };
  }, [onCaptured, receipt, sdkReady]);

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
            <h2 id="checkout-title">Scribe Pro</h2>
            <p>One month of clearer writing wherever you type.</p>
          </div>
          <div className="checkout-price">
            <strong>$12.00</strong>
            <span>USD · sandbox purchase</span>
          </div>
          <ul className="checkout-benefits">
            <li>
              <Check aria-hidden="true" /> Professional rewrites
            </li>
            <li>
              <Check aria-hidden="true" /> Works inside your keyboard
            </li>
            <li>
              <Check aria-hidden="true" /> One month of access
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
                  id="paypal-checkout-sdk"
                  src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.client_id)}&currency=${config.currency}&intent=capture&components=buttons`}
                  strategy="afterInteractive"
                  onReady={() => {
                    setSdkReady(true);
                    setStatus("Choose PayPal or card to continue.");
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
