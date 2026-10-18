import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/figtree";
import "./globals.css";

export const metadata: Metadata = {
  title: "GrowthReceipt | Know which posts generate revenue",
  description: "Turn verified PayPal purchases into your next approved marketing experiment.",
};

// Runs before first paint so a saved or OS dark preference never flashes light.
const themeScript = `try{var t=localStorage.getItem("growthreceipt-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme script, no user input */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
