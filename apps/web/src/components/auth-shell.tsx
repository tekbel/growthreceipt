"use client";

import { ArrowRight, BadgeCheck, Bot, Check, Mail, ReceiptText } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { SiPaypal } from "react-icons/si";

import {
  BusyLabel,
  CampaignWorkspace,
  type WorkspaceIdentity,
} from "@/components/campaign-workspace";
import { apiFetch, DEMO_RESET_KEY, setApiAccessToken } from "@/lib/campaign";
import { getSupabase, googleAuthEnabled, supabaseConfigured } from "@/lib/supabase";
import { setWorkspaceTimeZone } from "@/lib/time";

type AuthState = "loading" | "signed-out" | "bootstrapping" | "ready" | "error";

export function AuthShell() {
  const [state, setState] = useState<AuthState>(supabaseConfigured ? "loading" : "ready");
  const [identity, setIdentity] = useState<WorkspaceIdentity>({
    mode: "local",
    displayName: "Workspace owner",
    isAnonymous: true,
    timezone: null,
  });
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Which button started the wait, so only that one shows the busy label.
  const [pending, setPending] = useState<"judge" | "google" | "email" | null>(null);
  const captcha = useTurnstile();
  const captchaPending = Boolean(turnstileSiteKey) && !captcha.token;

  // The user whose workspace is loaded. Token refreshes for the same user only swap the token.
  const loadedUser = useRef<string | null>(null);

  const bootstrap = useCallback(async (accessToken: string, userId: string) => {
    if (loadedUser.current === userId) {
      setApiAccessToken(accessToken);
      return;
    }
    loadedUser.current = userId;
    setState("bootstrapping");
    setApiAccessToken(accessToken);
    try {
      const response = await apiFetch("/v1/auth/bootstrap", { method: "POST" });
      if (!response.ok) throw new Error("Your workspace could not be prepared.");
      const workspace = (await response.json()) as {
        mode: WorkspaceIdentity["mode"];
        display_name: string;
        is_anonymous: boolean;
        timezone: string | null;
      };
      setWorkspaceTimeZone(workspace.timezone);
      setIdentity({
        mode: workspace.mode,
        displayName: workspace.display_name,
        isAnonymous: workspace.is_anonymous,
        timezone: workspace.timezone,
      });
      setError(null);
      setState("ready");
    } catch (reason) {
      loadedUser.current = null;
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
      if (data.session) void bootstrap(data.session.access_token, data.session.user.id);
      else {
        setApiAccessToken(null);
        setState("signed-out");
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) void bootstrap(session.access_token, session.user.id);
      else {
        loadedUser.current = null;
        setApiAccessToken(null);
        if (window.location.pathname !== "/" || window.location.hash)
          window.history.replaceState(null, "", "/");
        // A finished sign in leaves the buttons busy, so clear that on sign out.
        setSubmitting(false);
        setEmailSent(false);
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
    setPending("judge");
    setError(null);
    const { error: signInError } = await supabase.auth.signInAnonymously({
      options: { captchaToken: captcha.token ?? undefined },
    });
    captcha.reset();
    if (signInError) {
      setError("The judge demo could not be opened. Please try again.");
      setSubmitting(false);
    }
  }

  async function signInWithGoogle() {
    const supabase = getSupabase();
    if (!supabase) return;
    setSubmitting(true);
    setPending("google");
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
    await requestLink();
  }

  async function requestLink() {
    const supabase = getSupabase();
    if (!supabase || !email.trim()) return;
    setSubmitting(true);
    setPending("email");
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin,
        captchaToken: captcha.token ?? undefined,
      },
    });
    captcha.reset();
    if (signInError) setError("The sign in email could not be sent.");
    else {
      setEmailSent(true);
      // Supabase allows one link per address every 60 seconds.
      setResendIn(60);
    }
    setSubmitting(false);
  }

  async function signOut() {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    // Signed out visitors start at the clean home address, not the page they left.
    window.history.replaceState(null, "", "/");
  }

  async function resetJudgeDemo() {
    const response = await apiFetch("/v1/auth/demo/reset", { method: "POST" });
    if (!response.ok) throw new Error("The judge demo could not be reset.");
    // The fresh demo looks like the old one, so the next page load confirms the reset.
    try {
      sessionStorage.setItem(DEMO_RESET_KEY, "1");
    } catch {
      // The reset still happened. Only the confirmation is lost.
    }
    window.location.replace("/today");
  }

  // Settings saves update the name and time zone everywhere without a reload.
  function updateIdentity(update: Pick<WorkspaceIdentity, "displayName" | "timezone">) {
    setWorkspaceTimeZone(update.timezone);
    setIdentity((current) => ({ ...current, ...update }));
  }

  if (!supabaseConfigured) {
    return <CampaignWorkspace identity={identity} onIdentityChange={updateIdentity} />;
  }
  if (state === "loading" || state === "bootstrapping") {
    return (
      <AuthLoading
        copy={state === "loading" ? "Checking your session" : "Preparing your private demo"}
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
            <span className="eyebrow">
              For indie founders and small teams selling digital products
            </span>
            <h1>Know which posts generate revenue.</h1>
            <p>
              See how each post contributes to sales through purchases verified by PayPal. The AI
              agent identifies your best performing content and recommends what to post next to
              increase sales, with every recommendation subject to your approval.
            </p>
            <ul className="auth-proof" aria-label="Built with">
              <li>
                <SiPaypal aria-hidden="true" />
                PayPal Orders, Web SDK v6 and verified webhooks
              </li>
              <li>
                <Bot aria-hidden="true" />
                OpenAI agents with human approval
              </li>
            </ul>
          </div>
          <aside className="auth-example" aria-label="About the example product">
            <span className="auth-example-mark" aria-hidden="true">
              {/* biome-ignore lint/performance/noImgElement: a small static icon. */}
              <img src="/products/launchcheck.svg" alt="" width={36} height={36} decoding="async" />
            </span>
            <p>
              The demo markets{" "}
              <a href="https://launchcheck.addisstack.com" target="_blank" rel="noopener">
                LaunchCheck
              </a>
              , an example SaaS product that scans a launch page for speed, SEO and structure
              issues. Every campaign, post and purchase you see is for it.
            </p>
          </aside>
          <SampleFlow />
        </section>
        <section className="auth-card" aria-labelledby="sign-in-title">
          <div>
            <span className="eyebrow">PayPal AI Hackathon 2026</span>
            <h2 id="sign-in-title">The loop in 90 seconds</h2>
            <p>
              Approve a post, buy it through PayPal sandbox, and watch the payment change the
              agent's next recommendation.
            </p>
          </div>
          <button
            className="button accent auth-demo-button"
            type="button"
            disabled={submitting || captchaPending}
            onClick={() => void enterJudgeDemo()}
          >
            {submitting && pending === "judge" ? (
              <BusyLabel text="Opening your demo" />
            ) : (
              "Try the judge demo"
            )}
            <ArrowRight aria-hidden="true" />
          </button>
          <ul className="auth-demo-facts">
            <li>No account</li>
            <li>PayPal sandbox</li>
            <li>No real money</li>
          </ul>
          <div className="auth-next">
            <span>Planned</span>
            <p>We plan to add PayPal subscriptions, refunds and more publishing channels.</p>
          </div>
          {turnstileSiteKey ? <div className="auth-captcha" ref={captcha.ref} /> : null}
          <div className="auth-divider">
            <span>or keep your workspace</span>
          </div>
          {googleAuthEnabled ? (
            <button
              className="button secondary auth-provider-button"
              type="button"
              disabled={submitting || captchaPending}
              onClick={() => void signInWithGoogle()}
            >
              {submitting && pending === "google" ? (
                <BusyLabel text="Opening Google" />
              ) : (
                "Continue with Google"
              )}
            </button>
          ) : null}
          {emailSent ? (
            <div className="auth-sent" role="status">
              <span className="auth-sent-mark">
                <Mail aria-hidden="true" />
              </span>
              <strong>Check your email</strong>
              <p>
                We sent a sign in link to <b>{email.trim()}</b>. It works once and expires in one
                hour.
              </p>
              <button
                className="button secondary"
                type="button"
                disabled={submitting || captchaPending || resendIn > 0}
                onClick={() => void requestLink()}
              >
                {resendIn > 0 ? `Resend link in ${resendIn}s` : "Resend link"}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setEmailSent(false);
                  setResendIn(0);
                }}
              >
                Use a different email
              </button>
            </div>
          ) : (
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
              <button
                className="button secondary"
                type="submit"
                disabled={submitting || captchaPending}
              >
                {submitting && pending === "email" ? (
                  <BusyLabel text="Sending your link" />
                ) : (
                  "Email me a sign in link"
                )}
              </button>
            </form>
          )}
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <a className="auth-legal" href="/privacy">
            Privacy policy
          </a>
        </section>
      </main>
    );
  }
  return (
    <CampaignWorkspace
      identity={identity}
      onIdentityChange={updateIdentity}
      onSignOut={signOut}
      onResetDemo={identity.mode === "judge" ? resetJudgeDemo : undefined}
    />
  );
}

function AuthLoading({ copy }: { copy: string }) {
  // A slow start should never look frozen, so offer a retry after a while.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <main className="auth-stage auth-loading" aria-busy="true">
      <div className="auth-loading-mark">
        <ReceiptText aria-hidden="true" />
      </div>
      <div className="skeleton-line wide" />
      <div className="skeleton-line short" />
      <span className="visually-hidden">{copy}</span>
      {slow ? (
        <p role="status">
          Still preparing the demo.{" "}
          <button className="text-button" type="button" onClick={() => window.location.reload()}>
            Refresh to retry
          </button>
        </p>
      ) : null}
    </main>
  );
}

// Mirrors the seeded judge demo, so every line here is something the demo really does.
const flowSteps = [
  { label: "Brief", detail: "LaunchCheck, a launch page scanner", actor: "You" },
  { label: "Campaign drafted", detail: "7 posts for 3 channels", actor: "Agent" },
  { label: "Approved", detail: "Nothing publishes without you", actor: "You" },
  { label: "PayPal checkout", detail: "10 scan pack at 9.00 USD", actor: "Buyer" },
  { label: "Payment verified", detail: "Capture and webhook match", actor: "PayPal" },
  { label: "Next move", detail: "Learned from the purchase", actor: "Agent" },
];

function SampleFlow() {
  const last = flowSteps.length - 1;
  return (
    <figure className="flow" aria-labelledby="flow-caption">
      <figcaption id="flow-caption" className="flow-head">
        <span>How it works</span>
        <span>Sample from the judge demo</span>
      </figcaption>
      <ol className="flow-steps">
        {flowSteps.map(({ label, detail, actor }, index) => (
          <li
            key={label}
            className={index === last ? "flow-step current" : "flow-step"}
            style={{ "--i": index } as CSSProperties}
          >
            <span className="flow-mark">
              {index === last ? index + 1 : <Check aria-hidden="true" />}
            </span>
            <span className="flow-copy">
              <strong>{label}</strong>
              <span>{detail}</span>
            </span>
            <span className="flow-actor">{actor}</span>
          </li>
        ))}
      </ol>
      <div className="flow-result" style={{ "--i": flowSteps.length } as CSSProperties}>
        <BadgeCheck aria-hidden="true" />
        <span>Attributed revenue</span>
        <strong>
          <CountUp to={9} delayMs={(flowSteps.length + 1) * 160} /> USD
        </strong>
      </div>
    </figure>
  );
}

/** Counts the sample revenue up once the flow has played. Reduced motion shows the final value. */
function CountUp({ to, delayMs }: { to: number; delayMs: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(to);
      return;
    }
    let frame = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - start) / 700, 1);
        setValue(to * (1 - (1 - progress) ** 3));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [to, delayMs]);
  return (
    <>
      <span aria-hidden="true">{value.toFixed(2)}</span>
      <span className="visually-hidden">{to.toFixed(2)}</span>
    </>
  );
}

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

// Supabase requires a Turnstile token for sign ins on this project. Tokens are single use.
function useTurnstile() {
  // Callback ref, because the widget slot only mounts once the sign in card shows.
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!turnstileSiteKey || !element) return;
    const render = () => {
      const turnstile = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (!turnstile || widget.current) return;
      widget.current = turnstile.render(element, {
        sitekey: turnstileSiteKey,
        theme: "auto",
        size: "flexible",
        callback: (value: string) => setToken(value),
        "expired-callback": () => setToken(null),
        "error-callback": () => setToken(null),
      });
    };
    let script = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset.turnstile = "";
      document.head.append(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      script?.removeEventListener("load", render);
      const turnstile = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (widget.current) turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [element]);

  const reset = useCallback(() => {
    const turnstile = (window as unknown as { turnstile?: Turnstile }).turnstile;
    if (widget.current) turnstile?.reset(widget.current);
    setToken(null);
  }, []);

  return { ref, token, reset };
}
