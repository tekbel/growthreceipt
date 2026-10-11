"use client";

import { CornerDownLeft } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchItem = {
  id: string;
  group: "Actions" | "Pages" | "Posts" | "Purchases";
  title: string;
  detail?: string;
  /** Extra words people may type for this item, such as "sales" for Results. */
  keywords?: string;
  run: () => void;
};

const LIMIT = 8;

function rank(item: SearchItem, terms: string[]): number {
  const title = item.title.toLowerCase();
  const text = `${title} ${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  // Every word must match somewhere. Title matches rank above body matches.
  if (!terms.every((term) => text.includes(term))) return 0;
  const phrase = terms.join(" ");
  if (title.startsWith(phrase)) return 4;
  if (title.includes(phrase)) return 3;
  if (terms.every((term) => title.includes(term))) return 2;
  return 1;
}

export function WorkspaceSearch({ items, onClose }: { items: SearchItem[]; onClose: () => void }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return items.filter((item) => item.group !== "Posts").slice(0, LIMIT);
    return items
      .map((item, order) => ({ item, order, score: rank(item, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, LIMIT)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [onClose]);

  function choose(item: SearchItem | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  const selected = Math.min(active, Math.max(results.length - 1, 0));
  return (
    <div className="search-box" ref={root}>
      <input
        className="topbar-search"
        role="combobox"
        aria-label="Search workspace"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-activedescendant={results.length ? `${listId}-${selected}` : undefined}
        placeholder="Search posts, pages, purchases"
        // biome-ignore lint/a11y/noAutofocus: the field opens because the person asked to search.
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(results[selected]);
          } else if (event.key === "Escape") {
            onClose();
          }
        }}
      />
      <div className="search-results">
        {results.length ? (
          <div id={listId} role="listbox" aria-label="Search results">
            {results.map((item, index) => {
              const showGroup = index === 0 || results[index - 1].group !== item.group;
              return (
                <div key={item.id} role="presentation">
                  {showGroup ? <span className="search-group">{item.group}</span> : null}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === selected}
                    className="search-option"
                    onPointerMove={() => setActive(index)}
                    onClick={() => choose(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") choose(item);
                    }}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      {item.detail ? <small>{item.detail}</small> : null}
                    </span>
                    {index === selected ? <CornerDownLeft aria-hidden="true" /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="search-empty" role="status">
            Nothing matches “{query}”. Try a word from a post, a day such as “day 3”, or an order
            ID.
          </p>
        )}
      </div>
    </div>
  );
}
