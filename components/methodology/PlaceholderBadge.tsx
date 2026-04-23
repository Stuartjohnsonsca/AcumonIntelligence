'use client';

import { useState } from 'react';
import { Hash, Copy, Check } from 'lucide-react';

/**
 * Small hover-reveal chip that shows a Handlebars placeholder path for a
 * schedule question (or any other piece of data) and lets the admin copy
 * it to the clipboard with one click. Intended for use in schedule
 * renderers so SuperAdmin / MethodologyAdmin users can discover the
 * merge-field path without leaving the page.
 *
 * Hidden by default — only visible when the parent row is hovered
 * (controlled by the Tailwind `group-hover:` utility on the parent).
 */
export function PlaceholderBadge({ path, title }: { path: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const text = `{{${path}}}`;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers / iframes — never hit in modern Chrome/Edge
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.top = '-1000px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* silent — admin will see the path in the tooltip anyway */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={title || `Copy placeholder`}
      className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 inline-flex items-center gap-1 text-[9px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1 py-0.5 hover:bg-indigo-100 max-w-[340px] whitespace-nowrap overflow-hidden text-ellipsis"
    >
      {copied ? <Check className="h-2.5 w-2.5 flex-none" /> : <Hash className="h-2.5 w-2.5 flex-none" />}
      <span className="truncate">{copied ? 'Copied!' : `{{${path}}}`}</span>
      {!copied && <Copy className="h-2.5 w-2.5 flex-none opacity-60" />}
    </button>
  );
}
