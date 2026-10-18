// Workspace pages. Each one has its own address, such as /today.
export const views = [
  "today",
  "products",
  "campaigns",
  "new-campaign",
  "content",
  "calendar",
  "results",
  "dashboard",
  "experiment",
  "integrations",
  "settings",
  "checkout",
] as const;
export type View = (typeof views)[number];

export function isView(value: string | undefined): value is View {
  return (views as readonly string[]).includes(value ?? "");
}
