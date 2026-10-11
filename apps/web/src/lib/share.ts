import type { Channel, Post } from "@/lib/campaign";

export type ShareTarget = {
  /** The composer to open, or null when the channel has no web composer. */
  url: string | null;
  /** True when the composer cannot take the text, so it goes to the clipboard first. */
  copyFirst: boolean;
};

/** The full post as it should go out, ending with its attributed buy link. */
export function shareText(post: Post, link: string): string {
  return `${post.content}\n\n${post.call_to_action} ${link}`;
}

/**
 * Official share links open the channel's own composer with the post filled in.
 * The founder still presses Post, so nothing is published on their behalf.
 */
export function shareTarget(channel: Channel, text: string, link: string): ShareTarget {
  const encoded = encodeURIComponent(text);
  switch (channel) {
    case "LinkedIn":
      return {
        url: `https://www.linkedin.com/feed/?shareActive=true&text=${encoded}`,
        copyFirst: false,
      };
    case "X":
      return { url: `https://x.com/intent/post?text=${encoded}`, copyFirst: false };
    case "Facebook":
      // Facebook's sharer takes only a link, so the text is copied for pasting.
      return {
        url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
        copyFirst: true,
      };
    case "Instagram":
      return { url: null, copyFirst: true };
  }
}

/** X counts every link as 23 characters. */
export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}
