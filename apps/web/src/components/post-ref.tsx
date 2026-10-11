"use client";

import { ExternalLink } from "lucide-react";

type PostLike = { id: string; day: number; channel: string; published_url?: string | null };

/** "Day 3 · X" that opens the post in the workspace, plus the live post when it was published. */
export function PostRef({ post, onOpen }: { post: PostLike; onOpen?: (postId: string) => void }) {
  const label = `Day ${post.day} · ${post.channel}`;
  return (
    <span className="post-ref">
      {onOpen ? (
        <button className="text-button" type="button" onClick={() => onOpen(post.id)}>
          {label}
        </button>
      ) : (
        label
      )}
      {post.published_url ? (
        <a
          href={post.published_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View the live ${label} post`}
          title="View the live post"
        >
          <ExternalLink aria-hidden="true" />
        </a>
      ) : null}
    </span>
  );
}
