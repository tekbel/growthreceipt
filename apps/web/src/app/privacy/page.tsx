import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy | GrowthReceipt",
  description: "What GrowthReceipt stores, why it stores it, and how to remove it.",
};

const UPDATED = "11 October 2026";
const CONTACT = "support@addisstack.com";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <article className="legal-article">
        <a className="legal-home" href="/">
          GrowthReceipt
        </a>
        <h1>Privacy policy</h1>
        <p className="legal-updated">Last updated {UPDATED}</p>

        <p>
          GrowthReceipt is made by Addis Stack. It drafts marketing posts for your offer, waits for
          your approval, and links each PayPal purchase to the post that brought the customer. This
          page explains what it stores and how to remove it.
        </p>

        <h2>What we store</h2>
        <h3>Your account</h3>
        <p>
          Your email address when you sign in. If you try the demo without signing up, the session
          has no email attached.
        </p>
        <h3>Your workspace and campaigns</h3>
        <p>
          The workspace name and time zone you choose, the product brief you write, the posts the
          agent drafts, your edits and review notes, and a log of what happened to each post.
        </p>
        <h3>Purchases</h3>
        <p>
          For each checkout we keep the PayPal order and capture IDs, the amount, the currency, the
          status, and the post the buyer came from. We also keep the event records PayPal sends us
          to confirm a payment. Card and bank details go to PayPal only. We never see them.
        </p>
        <h3>LinkedIn, when you connect it</h3>
        <p>
          Your LinkedIn name, your member ID, an access token, when that token expires, and whether
          automatic publishing is on. The token is encrypted before it is stored. GrowthReceipt only
          posts approved posts, either when you press Post it or on the scheduled day when you
          turned automatic publishing on. It does not read your feed, messages or connections.
        </p>

        <h2>Who processes it</h2>
        <ul>
          <li>Supabase hosts the database and handles sign in.</li>
          <li>Railway runs the app and the API.</li>
          <li>OpenAI receives your product brief and review notes to draft and revise posts.</li>
          <li>PayPal processes checkout and confirms payments.</li>
          <li>LinkedIn receives the posts you publish there.</li>
        </ul>
        <p>We do not sell your data, show ads, or use analytics or tracking cookies.</p>

        <h2>In your browser</h2>
        <p>
          Your browser keeps your sign in session and your light or dark theme choice. During a
          LinkedIn connection it holds the reply from LinkedIn for a moment, then clears it.
        </p>

        <h2>Keeping and removing data</h2>
        <p>
          Disconnecting LinkedIn in Integrations revokes the token with LinkedIn and deletes it from
          GrowthReceipt. Tokens also expire on their own after 60 days. To delete your account and
          everything in your workspace, email us from the address you signed in with and we will
          remove it within 30 days.
        </p>

        <h2>Test payments</h2>
        <p>
          Checkout currently runs in the PayPal sandbox. No real money moves and no real card is
          charged.
        </p>

        <h2>Contact</h2>
        <p>
          Questions or requests go to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </article>
    </main>
  );
}
