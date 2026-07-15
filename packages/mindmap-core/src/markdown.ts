// Markdown outline export — pure port of `Component#exportOutline`
// (MindFlow.dc.html:617-637), minus the `this.setState`/`downloadFile` side
// effects. Returns the exact string the original writes to the `.md` file.

import type { Doc } from './model';
import { ROOT_ID } from './model';

/** The subset of `Doc` that `toMarkdown` reads. */
export type MarkdownSource = Pick<Doc, 'nodes' | 'floats'>;

/**
 * Port of `Component#exportOutline` (MindFlow.dc.html:617-637):
 *
 * - Walks the tree from `ROOT_ID`: root becomes an H1 (`# `), each deeper
 *   level becomes a `- ` bullet indented two spaces per level, with an
 *   optional `> note` line directly under a node that has a non-blank `note`.
 * - If any node has `free: true` (a standalone shape), appends a
 *   `## 개별 주제` section listing each free node as its own one-level walk.
 * - If any float has non-blank text, appends a `## 메모` section listing
 *   each float's trimmed, newline-flattened text as a bullet.
 * - Joined with `\n`, no trailing newline (matches `out.join('\n')`).
 */
export function toMarkdown(doc: MarkdownSource): string {
  const nodes = doc.nodes;
  const out: string[] = [];

  const walk = (id: string, depth: number): void => {
    const n = nodes[id];
    if (!n) return;
    const label = ((n.emoji ? n.emoji + ' ' : '') + (n.text || '').replace(/\n/g, ' ')).trim();
    if (depth === 0) out.push('# ' + label);
    else out.push('  '.repeat(depth - 1) + '- ' + label);
    if (n.note && n.note.trim()) {
      out.push('  '.repeat(Math.max(0, depth - 1)) + '  > ' + n.note.trim().replace(/\n/g, ' '));
    }
    (n.children || []).forEach((c) => walk(c, depth + 1));
  };

  walk(ROOT_ID, 0);

  const frees = Object.keys(nodes).filter((k) => nodes[k]?.free);
  if (frees.length) {
    out.push('', '## 개별 주제');
    frees.forEach((k) => walk(k, 1));
  }

  const floats = doc.floats || [];
  if (floats.some((f) => (f.text || '').trim())) {
    out.push('', '## 메모');
    floats.forEach((f) => {
      if ((f.text || '').trim()) out.push('- ' + f.text.trim().replace(/\n/g, ' '));
    });
  }

  return out.join('\n');
}
