# GrowthReceipt design system

## Direction

GrowthReceipt uses a quiet editorial workspace system. It should feel precise, useful, and authored by a product team. The interface is compact enough for daily work without becoming a generic administration dashboard.

The home view answers one question: what needs attention today? Campaign review, content, checkout, results, and the next decision appear in that order.

## Brand principles

1. Clarity comes from structure, not decoration.
2. Use one type family throughout the product.
3. Use scale, alignment, weight, and spacing before adding containers.
4. Every visible divider must explain a relationship.
5. A single accent is more recognizable than a broad palette.
6. The campaign progress ribbon is the shared product signature.

## Visual system

1. Use warm white and charcoal surfaces with subtle neutral separation.
2. Use `#087A72` as the interface accent.
3. Use self hosted Instrument Sans for display, body, labels, controls, and tabular numbers.
4. Use hairline rules to organize related information.
5. Use restrained four to seven pixel corners for controls and working surfaces.
6. Keep typography left aligned.
7. Avoid decorative gradients, grain, glass effects, glow, and excessive shadows.
8. Avoid card grids when a list, rule, or open composition communicates the same hierarchy.
9. Official providers may retain their real brand colors.

## Content rules

1. Write standard product language that says what an action does.
2. Do not use sparkle symbols, robot imagery, magic language, or assistant language.
3. Do not describe normal features as intelligent, smart, powered, or agentic in the interface.
4. Do not invent comments, users, metrics, notifications, or activity.
5. Do not use dash punctuation in visible interface copy.
6. Use real provider names and official brand marks for connected services.
7. Keep technical implementation terms out of customer facing screens.

## Interaction rules

1. Primary actions use charcoal. Deep teal identifies progress, selection, and approval.
2. Hover feedback changes surface or border color without moving the layout.
3. Focus uses a visible teal ring.
4. Loading controls remain disabled until the action completes.
5. Reduced motion preferences disable nonessential motion.
6. Motion uses `--duration-fast` (120ms), `--duration-base` (220ms) and `--ease`. Lists reveal with a 45ms stagger. Reduced motion sets both durations to zero.
7. Loading uses skeleton blocks shaped like the page, never a bare text line.
8. Agent work shows only steps the agent actually reached, reported by the API stream. Never simulate progress with timers.
9. The theme comes from the saved choice, then the OS, and is applied to `<html>` before first paint.
10. Selection and active states use a soft tinted background and accent text. No thick accent side bars on rows, navigation, or toasts.
11. Page content aligns left to the sidebar with a 40px gutter (24px tablet, 16px phone) and a 1320px max width. Never center the page column.
12. Raise only the single most important element on a page into a card. Other sections are headings over divided lists, and metrics are a strip with dividers.
13. Every font size uses a `--type-*` token (2xs 11 to hero clamp) and every radius a `--corner-*` token (6, 10, 14), plus 50% circles and 999px pills. Tailwind owns `--text-*` and `--radius-*`, so do not reuse those names.
14. Text on an accent fill uses `--on-accent`, which flips to dark ink in dark mode.
15. Form fields are 16px on phones so iOS does not zoom on focus.
16. The current page is in the URL hash (`#content`), so refresh, back, and shared links land on the same page.
17. Every page title uses `--type-title` and section headings stay at `--type-2xl` or below. Fixed min heights on headers and panels are not used, content sets the height. Filters are soft pills, not bordered boxes.
18. Visual direction follows Otter.ai: Figtree (a free stand in for Averta and Circular), light 400 weight on large headings with little tracking, cool slate neutrals, and a dimmed blue accent (#3a5bc7) instead of Otter's bright #144fff. Primary actions are blue filled, a paired second action is a blue outline (`.button.outline`), everything else stays neutral.
19. Every button variant shares one disabled look (subtle surface, muted text). Previews of third party UI such as the LinkedIn post use theme tokens, so dark mode has no white slabs. On wide screens the topbar actions line up with the content edge (page max width 1480px).
20. Label and value rows (metrics, product brief, campaign details) all use the metric strip pattern: one hairline above and below, vertical dividers, muted 12px label, value under it. Results reuses the Today `Metric` component, and money always goes through `formatMoney`.
21. Status is always a pill (`status-tag`), including neutral states like "Not connected". A pair of actions sits side by side, primary fill then outline. Form section headings sit inside their section with a 10px gap to the first field.
22. The product is always shown with `ProductMark`: the optional product icon when the brief has one, otherwise the first letter on a soft accent tile. It appears in the product switcher, the Products hero, next to the campaign name, and as the author in post previews. The icon is either an https link (or a path served by the web app) or an upload. Uploads are cropped to a 160px square in the browser and stored with the campaign as a PNG, JPEG, or WebP data URL of at most 150 KB. SVG is rejected. The form previews the icon and says when a link does not load an image.
23. Publishing channels come from one list, `channels` in `apps/web/src/lib/campaign.ts`. The New campaign form and the channel rows on Integrations both render from it. Adding a channel means adding it there, to `Channel` in `apps/api/app/campaigns/models.py`, to the `campaign_posts` channel check in a migration, and an icon in `ChannelIcon`.

## Responsive rules

Desktop uses persistent navigation and a three region review workspace. Mobile uses a navigation drawer and a single reading column. The campaign ribbon and filter row may scroll horizontally on narrow screens, with the rest of the page free from horizontal overflow.
