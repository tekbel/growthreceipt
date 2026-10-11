"use client";

import { useEffect } from "react";

import { LINKEDIN_CALLBACK_KEY } from "@/lib/linkedin";

// LinkedIn returns here after sign in. The workspace finishes the connection with the
// signed-in session, so this page only hands the result over and leaves.
export default function LinkedInCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    try {
      sessionStorage.setItem(
        LINKEDIN_CALLBACK_KEY,
        JSON.stringify({
          code: params.get("code"),
          state: params.get("state"),
          error: params.get("error_description") ?? params.get("error"),
        }),
      );
    } catch {
      // Without storage the workspace simply shows LinkedIn as not connected.
    }
    window.location.replace("/#integrations");
  }, []);

  return <main className="buy-page" aria-busy="true" />;
}
