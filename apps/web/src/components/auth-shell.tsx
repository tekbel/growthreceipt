"use client";

import {
  ArrowRight,
  BadgeCheck,
  Check,
  Compass,
  FileText,
  Mail,
  ReceiptText,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from "react";
import { SiPaypal } from "react-icons/si";

import { CampaignWorkspace, type WorkspaceIdentity } from "@/components/campaign-workspace";
import { apiFetch, setApiAccessToken } from "@/lib/campaign";
import { getSupabase, googleAuthEnabled, supabaseConfigured } from "@/lib/supabase";

type AuthState = "loading" | "signed-out" | "bootstrapping" | "ready" | "error";

export function AuthShell() {
  const [state, setState] = useState<AuthState>(supabaseConfigured ? "loading" : "ready");
  const [identity, setIdentity] = useState<WorkspaceIdentity>({
    mode: "local",
    displayName: "Workspace owner",
    isAnonymous: true,
  });
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bootstrap = useCallback(async (accessToken: string) => {
    setState("bootstrapping");
    setApiAccessToken(accessToken);
    try {
      const response = await apiFetch("/v1/auth/bootstrap", { method: "POST" });
      if (!response.ok) throw new Error("Your workspace could not be prepared.");
      const workspace = (await response.json()) as {
        mode: WorkspaceIdentity["mode"];
        display_name: string;
        is_anonymous: boolean;
      };
      setIdentity({
        mode: workspace.mode,
        displayName: workspace.display_name,
        isAnonymous: workspace.is_anonymous,
      });
      setError(null);
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your workspace could not be prepared.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) void bootstrap(data.session.access_token);
      else {
        setApiAccessToken(null);
        setState("signed-out");
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) void bootstrap(session.access_token);
      else {
        setApiAccessToken(null);
        setState("signed-out");
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [bootstrap]);

  async function enterJudgeDemo() {
    const supabase = getSupabase();
    if (!supabase) return;
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) {
      setError("The judge demo could not be opened. Please try again.");
      setSubmitting(false);
    }
  }

  async function signInWithGoogle() {
    const supabase = getSupabase();
    if (!supabase) return;
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (signInError) {
      setError("Google sign in could not be started.");
      setSubmitting(false);
    }
  }

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase || !email.trim()) return;
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (signInError) setError("The sign in email could not be sent.");
    else setEmailSent(true);
    setSubmitting(false);
  }

  async function signOut() {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  async function resetJudgeDemo() {
    const response = await apiFetch("/v1/auth/demo/reset", { method: "POST" });
    if (!response.ok) throw new Error("The judge demo could not be reset.");
    window.location.hash = "today";
    window.location.reload();
  }

  if (!supabaseConfigured) {
    return <CampaignWorkspace identity={identity} />;
  }
  if (state === "loading" || state === "bootstrapping") {
    return (
      <AuthLoading
        copy={state === "loading" ? "Checking your session" : "Preparing your workspace"}
      />
    );
  }
  if (state === "error") {
    return (
      <main className="auth-stage">
        <section className="auth-error" role="alert">
          <ReceiptText aria-hidden="true" />
          <h1>Workspace unavailable</h1>
          <p>{error}</p>
          <button className="button primary" type="button" onClick={() => void signOut()}>
            Return to sign in
          </button>
        </section>
      </main>
    );
  }
  if (state === "signed-out") {
    return (
      <main className="auth-stage">
        <section className="auth-intro">
          <div className="auth-wordmark">
            <span>
              <ReceiptText aria-hidden="true" />
            </span>
            GrowthReceipt
          </div>
          <div className="auth-promise">
            <span className="eyebrow">Marketing backed by payments</span>
            <h1>Know what to do next.</h1>
            <p>An AI marketing agent that learns from what people paid for, not what they liked.</p>
          </div>
          <SampleReceipt />
        </section>
        <section className="auth-card" aria-labelledby="sign-in-title">
          <div>
            <span className="eyebrow">Welcome</span>
            <h2 id="sign-in-title">Open your workspace</h2>
            <p>
              Explore the complete demo without creating an account, or sign in to keep your work.
            </p>
          </div>
          <button
            className="button primary auth-demo-button"
            type="button"
            disabled={submitting}
            onClick={() => void enterJudgeDemo()}
          >
            {submitting ? "Opening demo" : "Try the judge demo"}
            <ArrowRight aria-hidden="true" />
          </button>
          <div className="auth-divider">
            <span>or keep your workspace</span>
          </div>
          {googleAuthEnabled ? (
            <button
              className="button secondary auth-provider-button"
              type="button"
              disabled={submitting}
              onClick={() => void signInWithGoogle()}
            >
              Continue with Google
            </button>
          ) : null}
          <form className="auth-email" onSubmit={sendMagicLink}>
            <label htmlFor="sign-in-email">Email address</label>
            <div>
              <Mail aria-hidden="true" />
              <input
                id="sign-in-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <button className="button secondary" type="submit" disabled={submitting}>
              Email me a sign in link
            </button>
          </form>
          {emailSent ? (
            <p className="auth-success" role="status">
              Check your inbox for the sign in link.
            </p>
          ) : null}
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="auth-note">The judge demo uses PayPal Sandbox. No real money moves.</p>
        </section>
      </main>
    );
  }
  return (
    <CampaignWorkspace
      identity={identity}
      onSignOut={signOut}
      onResetDemo={identity.mode === "judge" ? resetJudgeDemo : undefined}
    />
  );
}

function AuthLoading({ copy }: { copy: string }) {
  return (
    <main className="auth-stage auth-loading" aria-busy="true">
      <div className="auth-loading-mark">
        <ReceiptText aria-hidden="true" />
      </div>
      <div className="skeleton-line wide" />
      <div className="skeleton-line short" />
      <span className="visually-hidden">{copy}</span>
    </main>
  );
}

// Mirrors the seeded judge demo, so every line here is something the demo really does.
const receiptLines = [
  { icon: FileText, label: "Brief", detail: "Scribe, a writing keyboard", value: "You" },
  { icon: Sparkles, label: "Campaign drafted", detail: "7 posts for 3 channels", value: "Agent" },
  { icon: UserCheck, label: "Approved", detail: "Nothing publishes without you", value: "You" },
  { icon: SiPaypal, label: "PayPal checkout", detail: "Scribe Pro", value: "12.00 USD" },
  {
    icon: BadgeCheck,
    label: "Payment verified",
    detail: "Capture and webhook match",
    value: "PayPal",
  },
  { icon: Compass, label: "Next move", detail: "Learned from the sale", value: "Agent" },
];

function SampleReceipt() {
  return (
    <figure className="receipt" aria-labelledby="receipt-caption">
      <figcaption id="receipt-caption" className="receipt-head">
        <span>Growth receipt</span>
        <span>Sample from the judge demo</span>
      </figcaption>
      <ol className="receipt-lines">
        {receiptLines.map(({ icon: Icon, label, detail, value }, index) => (
          <li key={label} className="receipt-line" style={{ "--i": index } as CSSProperties}>
            <span className="receipt-icon">
              <Icon aria-hidden="true" />
            </span>
            <span className="receipt-copy">
              <strong>{label}</strong>
              <span>{detail}</span>
            </span>
            <span className="receipt-value">{value}</span>
          </li>
        ))}
      </ol>
      <div className="receipt-total" style={{ "--i": receiptLines.length } as CSSProperties}>
        <span>
          <Check aria-hidden="true" /> Attributed revenue
        </span>
        <strong>12.00 USD</strong>
      </div>
    </figure>
  );
}
