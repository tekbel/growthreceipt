// Fades marked sections in once as they scroll into view. Used as a ref callback, so it runs only
// while the element is mounted. Without it, or with reduced motion, everything stays visible.
export function revealOnScroll(root: HTMLElement | null) {
  if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.revealed = "";
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.15 },
  );
  for (const target of root.querySelectorAll("[data-reveal]")) observer.observe(target);
  root.dataset.revealReady = "";
  return () => {
    observer.disconnect();
    delete root.dataset.revealReady;
  };
}
