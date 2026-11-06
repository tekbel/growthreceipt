"use client";

import { ArrowRight, BadgeCheck, Bot, Check, Mail, ReceiptText } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
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
import { HeroSequence } from "@/components/hero-sequence";
import { apiFetch, DEMO_RESET_KEY, setApiAccessToken } from "@/lib/campaign";
import { revealOnScroll } from "@/lib/reveal";
import { getSupabase, googleAuthEnabled, supabaseConfigured } from "@/lib/supabase";
import { setWorkspaceTimeZone } from "@/lib/time";

// The dialog code loads only when a visitor opens it. The hero loop shares its drawing.
const RevenueLoop = dynamic(() => import("@/components/revenue-loop"), { ssr: false });

type AuthState = "loading" | "signed-out" | "bootstrapping" | "ready" | "error";
type JudgeButton = "header" | "hero" | "end";

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
  // Three buttons open the demo, so a failure shows next to the one that was used.
  const [judgeFrom, setJudgeFrom] = useState<JudgeButton>("hero");
  const [loopOpen, setLoopOpen] = useState(false);
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

  async function enterJudgeDemo(from: JudgeButton) {
    const supabase = getSupabase();
    if (!supabase) return;
    setSubmitting(true);
    setPending("judge");
    setJudgeFrom(from);
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

  // The header Sign in goes to the sign in panel at the end of the page and puts focus there.
  function showSignIn() {
    const panel = document.getElementById("sign-in");
    if (!panel) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    (document.getElementById("sign-in-email") ?? panel).focus({ preventScroll: true });
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
    const demoButton = (from: JudgeButton, className: string) => (
      <button
        className={`button accent home-demo ${className}`}
        type="button"
        disabled={submitting || captchaPending}
        onClick={() => void enterJudgeDemo(from)}
      >
        {submitting && pending === "judge" && judgeFrom === from ? (
          <BusyLabel text="Opening your demo" />
        ) : (
          "Try the judge demo"
        )}
        <ArrowRight aria-hidden="true" />
      </button>
    );
    const loopButton = (className: string) => (
      <button
        className={`button ${className}`}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setLoopOpen(true)}
      >
        Play the revenue loop
      </button>
    );
    const judgeError = (where: "top" | "end") =>
      error && pending === "judge" && (judgeFrom === "end") === (where === "end") ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null;
    const demoFacts = (
      <ul className="auth-demo-facts">
        <li>No account</li>
        <li>PayPal sandbox</li>
        <li>No real money</li>
      </ul>
    );
    return (
      <div className="home" ref={revealOnScroll}>
        <header className="home-header">
          <div className="home-wrap">
            <div className="auth-wordmark">
              <span>
                <ReceiptText aria-hidden="true" />
              </span>
              GrowthReceipt
            </div>
            <nav aria-label="Get started">
              <button
                className="home-nav-link"
                type="button"
                aria-haspopup="dialog"
                onClick={() => setLoopOpen(true)}
              >
                Revenue loop
              </button>
              <button className="button secondary" type="button" onClick={showSignIn}>
                Sign in
              </button>
              <span className="home-header-demo">{demoButton("header", "")}</span>
            </nav>
          </div>
        </header>
        <main>
          <section className="home-wrap home-hero">
            <div className="home-copy">
              <span className="eyebrow home-pill">
                <span className="home-pill-dot" aria-hidden="true" />
                For founders selling digital products
              </span>
              <h1>
                The marketing posts that drive sales,{" "}
                <span className="home-h1-accent">and what to post next.</span>
              </h1>
              <p>
                Each approved post gets its own PayPal buy link. Verified purchases show which post
                earned each sale, and the agent proposes your next experiment. Nothing runs until
                you approve it.
              </p>
              <div className="home-actions">
                {demoButton("hero", "")}
                {loopButton("outline")}
              </div>
              {demoFacts}
              {turnstileSiteKey ? <div className="auth-captcha" ref={captcha.ref} /> : null}
              {judgeError("top")}
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
            <HeroSequence />
          </section>
          <section className="home-band" id="the-loop" data-reveal>
            <SampleFlow loopButton={loopButton("outline")} />
          </section>
          <section className="home-wrap home-cta" aria-labelledby="sign-in-title" data-reveal>
            <div className="home-cta-copy">
              <span className="home-kicker">PayPal AI Hackathon 2026</span>
              <h2 id="sign-in-title">The loop in 90 seconds</h2>
              <p>
                Approve a post, buy LaunchCheck from its link in the PayPal sandbox, and watch the
                purchase change what the agent suggests for your next post.
              </p>
              <div className="home-actions">{demoButton("end", "")}</div>
              {demoFacts}
              {judgeError("end")}
            </div>
            <div className="home-signin" id="sign-in" tabIndex={-1}>
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
                    We sent a sign in link to <b>{email.trim()}</b>. It works once and expires in
                    one hour.
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
              {error && pending !== "judge" ? (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </section>
        </main>
        <footer className="home-wrap home-footer">
          <p className="auth-next">
            <span>Planned</span>
            PayPal subscriptions, disputes and more publishing channels.
          </p>
          <a className="auth-legal" href="/privacy">
            Privacy policy
          </a>
        </footer>
        {loopOpen ? <RevenueLoop onClose={() => setLoopOpen(false)} /> : null}
      </div>
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
  { label: "PayPal checkout", detail: "10 scans for $9.00", actor: "Buyer" },
  { label: "Payment verified", detail: "Capture and webhook match", actor: "PayPal" },
  { label: "Next move", detail: "Learned from the purchase", actor: "Agent" },
];

function SampleFlow({ loopButton }: { loopButton: ReactNode }) {
  const last = flowSteps.length - 1;
  return (
    <figure className="home-wrap flow" aria-labelledby="flow-caption">
      <figcaption id="flow-caption" className="flow-head">
        <span className="home-kicker">From the judge demo</span>
        <span>Sample values. No real order.</span>
      </figcaption>
      <div className="flow-grid">
        <ol className="flow-steps">
          {flowSteps.map(({ label, detail, actor }, index) => (
            <li
              key={label}
              className={index === last ? "flow-step current" : "flow-step"}
              style={{ "--i": index } as CSSProperties}
            >
              <span className="flow-step-top">
                <span className="flow-actor">{actor}</span>
                <span className="flow-mark">
                  {index === last ? index + 1 : <Check aria-hidden="true" />}
                </span>
              </span>
              <strong>{label}</strong>
              <span>{detail}</span>
            </li>
          ))}
        </ol>
        <div className="flow-side">
          <p className="flow-example">
            {/* biome-ignore lint/performance/noImgElement: a small static icon. */}
            <img src="/products/launchcheck.svg" alt="" width={22} height={22} decoding="async" />
            <span>
              The demo markets{" "}
              <a href="https://launchcheck.addisstack.com" target="_blank" rel="noopener">
                LaunchCheck
              </a>
              , an example product that scans a launch page for speed, SEO and structure issues.
            </span>
          </p>
          <div className="flow-result" style={{ "--i": flowSteps.length } as CSSProperties}>
            <BadgeCheck aria-hidden="true" />
            <span>Attributed revenue</span>
            <strong>$9.00</strong>
          </div>
          {loopButton}
        </div>
      </div>
      <figure className="home-shot flow-shot">
        <div className="home-shot-bar" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="home-shot-media">
          {/* The crop skips the app top bar and the offer table, so the numbers read larger. */}
          <div className="home-shot-crop">
            {(["light", "dark"] as const).map((theme) => (
              // biome-ignore lint/performance/noImgElement: static screenshots swapped by theme in CSS.
              <img
                key={theme}
                className={`${theme}-only`}
                src={`/home/results-${theme}.webp`}
                alt="Results in the judge demo after a PayPal sandbox purchase. $9.00 of verified revenue is credited to the Day 3 X post."
                width={1600}
                height={1081}
                decoding="async"
                loading="lazy"
              />
            ))}
          </div>
          <ul className="home-callouts">
            <li className="home-callout home-callout-paypal">
              <span>
                <BadgeCheck aria-hidden="true" />
                Verified by PayPal webhook
              </span>
            </li>
            <li className="home-callout home-callout-post">
              <span>
                <Check aria-hidden="true" />
                Credited to the Day 3 post
              </span>
            </li>
          </ul>
        </div>
      </figure>
    </figure>
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
