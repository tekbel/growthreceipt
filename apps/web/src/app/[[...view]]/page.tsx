import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { isView, views } from "@/lib/views";

type Params = Promise<{ view?: string[] }>;

// "/" and every workspace page, such as /today, are known at build time, so each one is prerendered.
export function generateStaticParams() {
  return [{ view: [] }, ...views.map((view) => ({ view: [view] }))];
}

// Other paths are only known per request, so they are read inside a Suspense boundary.
export default function Home({ params }: { params: Params }) {
  return (
    <Suspense>
      <Workspace params={params} />
    </Suspense>
  );
}

// The shell picks the page from the address. Any other path shows the not found page.
async function Workspace({ params }: { params: Params }) {
  const { view } = await params;
  if (view && (view.length > 1 || !isView(view[0]))) notFound();
  return <AuthShell />;
}
