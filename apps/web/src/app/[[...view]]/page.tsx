import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { isView } from "@/lib/views";

// "/" and every workspace page, such as /today, render the same shell. The shell shows the page.
export default async function Home({ params }: { params: Promise<{ view?: string[] }> }) {
  const { view } = await params;
  if (view && (view.length > 1 || !isView(view[0]))) notFound();
  return <AuthShell />;
}
