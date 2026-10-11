import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found | GrowthReceipt",
};

export default function NotFound() {
  return (
    <main className="notice-page">
      <section className="notice-card">
        <h1>Page not found</h1>
        <p>
          This address does not match a page in GrowthReceipt. The link may be mistyped or out of
          date.
        </p>
        <a className="button secondary" href="/">
          Go to GrowthReceipt
          <ArrowRight aria-hidden="true" />
        </a>
      </section>
    </main>
  );
}
