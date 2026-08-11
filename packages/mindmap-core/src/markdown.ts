// Markdown outline export — pure port of `Component#exportOutline`
// (MindFlow.dc.html:617-637), minus the `this.setState`/`downloadFile` side
// effects. Returns the exact string the original writes to the `.md` file.

import type { Doc } from './model';
import { ROOT_ID } from './model';
import { richToMarkdown } from './richtext';

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
/**
 * @param title 루트 노드가 없는 문서(화이트보드)의 H1 제목 — 그 문서의 제목은
 *   본문(루트 텍스트)이 아니라 메타에 있으므로 호출부가 넘겨 준다. 루트가
 *   있으면 무시된다(루트 텍스트가 곧 제목 — 기존 동작 무변경).
 */
export function toMarkdown(doc: MarkdownSource, title?: string): string {
  const nodes = doc.nodes;
  const out: string[] = [];
  if (!nodes[ROOT_ID] && title && title.trim()) out.push('# ' + title.trim());

  const walk = (id: string, depth: number): void => {
    const n = nodes[id];
    if (!n) return;
    // rich 서식은 마크다운 인라인 문법으로 되살린다(굵게/기울임/취소선/링크 — 색은 평문).
    const label = ((n.emoji ? n.emoji + ' ' : '') + richToMarkdown(n).replace(/\n/g, ' ')).trim();
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
      if ((f.text || '').trim()) out.push('- ' + richToMarkdown(f).trim().replace(/\n/g, ' '));
    });
  }

  // 루트 없는 문서에서 첫 구획의 구분용 '' 항목이 선두 빈 줄로 남지 않게.
  return out.join('\n').replace(/^\n+/, '');
}
