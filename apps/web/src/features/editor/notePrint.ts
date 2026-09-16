// 공책 → PDF — **브라우저의 인쇄**를 거친다.
//
// 왜 직접 만들지 않나: 우리 PDF 생성기(`pdf.ts`)는 캔버스를 JPEG로 구워 한 장에
// 얹는 것이다. 공책은 글이라 그렇게 하면 글자가 아니라 **그림**이 되고(검색·복사 불가,
// 여러 쪽으로 나뉘지도 않는다), 글자로 넣으려면 PDF에 **한글 글꼴을 심어야** 한다 —
// 서브셋 도구가 필요한 별개의 일이다.
//
// 인쇄 창은 그 둘을 다 피한다: 브라우저가 글자 그대로, 쪽 나눔까지 해서 "PDF로 저장"을
// 만들어 준다. 그래서 여기서 하는 일은 **깨끗한 인쇄용 HTML 한 장**을 띄우는 것뿐이다.

import type { Doc } from '@mindflow/mindmap-core';
import { noteLines, notePagesFor, type NoteExportScope } from '@mindflow/mindmap-core';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 인쇄용 본문 HTML — 테스트가 이 문자열을 확인한다(창을 띄우지 않고). */
export function notePrintHtml(doc: Doc, title: string, scope: NoteExportScope, pageId: string | null): string {
  const pages = notePagesFor(doc, scope, pageId);
  const body: string[] = [];
  if (scope === 'book' && title) body.push(`<h1 class="book">${esc(title)}</h1>`);
  pages.forEach((page, i) => {
    // 공책 전체를 인쇄하면 **페이지마다 쪽을 넘긴다** — 종이에서도 한 장이 한 장이다.
    body.push(`<section${i > 0 ? ' class="brk"' : ''}><h2>${esc(page.title.trim() || '제목 없는 페이지')}</h2>`);
    let list: string | null = null;
    const closeList = (): void => {
      if (list) body.push(`</${list}>`);
      list = null;
    };
    for (const l of noteLines(page)) {
      const pad = l.depth ? ` style="margin-left:${l.depth * 18}px"` : '';
      if (l.kind === 'li' || l.kind === 'todo' || l.kind === 'done' || l.kind === 'oli') {
        const want = l.kind === 'oli' ? 'ol' : 'ul';
        if (list !== want) {
          closeList();
          body.push(`<${want}>`);
          list = want;
        }
        const mark = l.kind === 'done' ? '☑ ' : l.kind === 'todo' ? '☐ ' : '';
        body.push(`<li${pad}>${mark}${esc(l.text)}</li>`);
        continue;
      }
      closeList();
      if (l.kind === 'h1') body.push(`<h1${pad}>${esc(l.text)}</h1>`);
      else if (l.kind === 'h2') body.push(`<h3${pad}>${esc(l.text)}</h3>`);
      else if (l.kind === 'h3') body.push(`<h4${pad}>${esc(l.text)}</h4>`);
      else if (l.kind === 'quote') body.push(`<blockquote${pad}>${esc(l.text)}</blockquote>`);
      else if (l.kind === 'code') body.push(`<pre${pad}>${esc(l.text)}</pre>`);
      else if (l.kind === 'hr') body.push('<hr/>');
      else if (l.kind === 'table' && l.rows?.length) {
        const [head, ...rest] = l.rows;
        body.push(`<table><thead><tr>${head!.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      } else body.push(`<p${pad}>${esc(l.text)}</p>`);
    }
    closeList();
    body.push('</section>');
  });
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title || '공책')}</title><style>
  @page { margin: 18mm; }
  body { font-family: Pretendard, system-ui, -apple-system, sans-serif; color: #2b2723; line-height: 1.75; font-size: 11pt; }
  h1.book { font-size: 22pt; margin: 0 0 18px; }
  h2 { font-size: 17pt; margin: 0 0 12px; }
  h1 { font-size: 15pt; margin: 22px 0 8px; }
  h3 { font-size: 13pt; margin: 20px 0 8px; }
  h4 { font-size: 12pt; margin: 16px 0 6px; }
  p { margin: 0 0 9px; }
  ul, ol { margin: 0 0 9px; padding-left: 20px; }
  li { margin: 0 0 4px; }
  blockquote { margin: 0 0 12px; padding: 8px 14px; border-left: 3px solid #d8cabb; background: #faf6f1; }
  pre { margin: 0 0 12px; padding: 10px 12px; background: #f4efe9; white-space: pre-wrap; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 12px; }
  th, td { border: 1px solid #ded3c6; padding: 6px 9px; text-align: left; font-size: 10.5pt; }
  th { background: #f7f2ec; }
  hr { border: none; border-top: 1px solid #ded3c6; margin: 16px 0; }
  section.brk { break-before: page; page-break-before: always; }
</style></head><body>${body.join('')}</body></html>`;
}

/**
 * 인쇄 창을 띄운다 — 사용자가 거기서 "PDF로 저장"을 고른다.
 *
 * 팝업이 막히면 `null`이 오므로 그때는 조용히 `false`를 돌려 호출부가 안내하게 한다.
 */
export function openNotePrint(doc: Doc, title: string, scope: NoteExportScope, pageId: string | null): boolean {
  if (typeof window === 'undefined') return false;
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  w.document.write(notePrintHtml(doc, title, scope, pageId));
  w.document.close();
  // 글꼴·레이아웃이 자리를 잡은 뒤에 인쇄 대화상자를 연다(바로 부르면 빈 쪽이 뜬다).
  w.setTimeout(() => {
    w.focus();
    w.print();
  }, 350);
  return true;
}
