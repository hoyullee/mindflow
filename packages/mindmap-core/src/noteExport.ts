// 공책 내보내기 — 페이지의 블록을 **글자 형식 셋**으로 옮긴다.
//
// 맵의 `toMarkdown`은 트리(노드의 부모-자식)를 들여쓰기로 펴는 일이고, 공책은 그게
// 아니라 **블록의 나열**이다. 그래서 별도 파일이고, 여기 있는 것은 전부 순수 함수다
// (DOM·파일 저장은 웹 쪽 몫 — 코어 순수성 lint가 그것을 강제한다).
//
// 세 형식이 같은 뼈대를 쓴다: `walk`가 블록을 한 줄씩 넘겨 주고, 형식마다 그 줄을
// 어떻게 적을지만 다르다. 표·체크·토글처럼 줄이 여럿인 블록도 여기서 한 번만 푼다.

import type { Doc, NoteBlock, NotePage, RichRun } from './model';
import { runsText } from './note';

/** 어느 범위를 내보내는가 — 이 페이지 한 장인지, 공책 전체인지. */
export type NoteExportScope = 'page' | 'book';

/** 내보낼 페이지들 — 범위와 지금 보고 있는 페이지로 정해진다. */
export function notePagesFor(doc: Doc, scope: NoteExportScope, pageId: string | null): NotePage[] {
  const pages = doc.pages ?? [];
  if (scope === 'book') return pages;
  const one = pages.find((p) => p.id === pageId) ?? pages[0];
  return one ? [one] : [];
}

/** 표의 한 칸을 글자로 — 칸 안의 줄바꿈은 공백으로 눕힌다(표가 깨지지 않게). */
function cell(runs: RichRun[] | undefined): string {
  return runsText(runs).replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * 한 블록이 만드는 줄들 — 형식과 무관한 **중간 표현**.
 *
 * `kind`는 적는 쪽이 모양을 정할 때 쓴다(제목은 `#`/`<h2>`, 목록은 `-`/`<li>`…).
 * `depth`는 들여쓰기 단계(`NoteBlock.indent`)다.
 */
export interface NoteLineOut {
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'oli' | 'todo' | 'done' | 'quote' | 'code' | 'hr' | 'table' | 'img' | 'link';
  text: string;
  depth: number;
  /** `table`일 때만 — 첫 행이 머리다. */
  rows?: string[][];
}

/** 일정 블록이 보여 주던 것 — 내보낸 글에 남기는 이름. */
const SCHED_LABEL: Record<NonNullable<NoteBlock['sched']>, string> = { today: '오늘 일정', week: '이번 주 일정', month: '달력', next: '다가오는 일정' };

/** 블록 하나를 줄들로 편다. */
function linesOf(b: NoteBlock): NoteLineOut[] {
  const depth = b.indent ?? 0;
  const one = (kind: NoteLineOut['kind'], text: string): NoteLineOut[] => (text || kind === 'hr' ? [{ kind, text, depth }] : []);
  switch (b.kind) {
    case 'h1':
    case 'h2':
    case 'h3':
      return one(b.kind, runsText(b.runs));
    case 'hr':
      return one('hr', '');
    case 'q':
      return one('quote', runsText(b.runs));
    case 'code':
      return one('code', runsText(b.runs));
    case 'callout':
      // 콜아웃은 인용으로 적는다 — 세 형식 어디에도 "콜아웃"이 없고, 뜻(눈에 띄게
      // 떼어 둔 한 마디)이 가장 가까운 것이 인용이다.
      return one('quote', runsText(b.runs));
    // 항목의 단계(`NoteListItem.indent`)는 블록의 단계 **위에** 얹힌다 — 내보낸 글에도
    // 화면과 같은 층이 보여야 한다(마크다운은 두 칸, 인쇄는 18px씩).
    case 'ul':
      return (b.items ?? []).map((it) => ({ kind: 'li' as const, text: runsText(it.runs), depth: depth + (it.indent ?? 0) })).filter((l) => l.text);
    case 'ol':
      return (b.items ?? []).map((it) => ({ kind: 'oli' as const, text: runsText(it.runs), depth: depth + (it.indent ?? 0) })).filter((l) => l.text);
    case 'ck':
      return (b.items ?? []).map((it) => ({ kind: it.done ? ('done' as const) : ('todo' as const), text: runsText(it.runs), depth: depth + (it.indent ?? 0) })).filter((l) => l.text);
    case 'toggle': {
      const head = runsText(b.runs);
      const body = runsText(b.items?.[0]?.runs);
      return [...one('p', head), ...(body ? [{ kind: 'p' as const, text: body, depth: depth + 1 }] : [])];
    }
    case 'table': {
      const rows = (b.rows ?? []).map((r) => r.map((c) => cell(c)));
      return rows.length ? [{ kind: 'table', text: '', depth, rows }] : [];
    }
    case 'img':
      // 이미지 본체는 형식 밖이다(참조만 남는다) — 글자 형식에 그림을 넣을 길이 없다.
      return one('img', '(이미지)');
    case 'link':
      return one('link', b.docId ? `문서 링크: ${b.docId}` : '문서 링크');
    case 'sched':
      /**
       * 일정 블록은 **그때그때 캘린더에서 읽는 것**이라 문서에 본문이 없다. 내보낸
       * 글에는 "여기에 무엇이 있었는지"만 한 줄로 남긴다 — 이미지·문서 링크와 같은
       * 태도다(베껴 적으면 내보낸 순간의 일정이 화석으로 굳는다).
       */
      return one('link', `일정 블록: ${SCHED_LABEL[b.sched ?? 'today']}`);
    default:
      return one('p', runsText(b.runs));
  }
}

/** 페이지의 모든 줄. */
export function noteLines(page: NotePage): NoteLineOut[] {
  return page.blocks.flatMap(linesOf);
}

/** 마크다운 — 다른 도구로 옮기는 기본 형식. */
export function noteMarkdown(doc: Doc, title: string, scope: NoteExportScope, pageId: string | null): string {
  const pages = notePagesFor(doc, scope, pageId);
  const out: string[] = [];
  if (scope === 'book' && title) out.push(`# ${title}`, '');
  for (const page of pages) {
    out.push(`${scope === 'book' ? '##' : '#'} ${page.title.trim() || '제목 없는 페이지'}`, '');
    for (const l of noteLines(page)) {
      const pad = '  '.repeat(l.depth);
      if (l.kind === 'h1') out.push(`${pad}# ${l.text}`, '');
      else if (l.kind === 'h2') out.push(`${pad}## ${l.text}`, '');
      else if (l.kind === 'h3') out.push(`${pad}### ${l.text}`, '');
      else if (l.kind === 'li') out.push(`${pad}- ${l.text}`);
      else if (l.kind === 'oli') out.push(`${pad}1. ${l.text}`);
      else if (l.kind === 'todo') out.push(`${pad}- [ ] ${l.text}`);
      else if (l.kind === 'done') out.push(`${pad}- [x] ${l.text}`);
      else if (l.kind === 'quote') out.push(`${pad}> ${l.text}`, '');
      else if (l.kind === 'code') out.push('```', l.text, '```', '');
      else if (l.kind === 'hr') out.push('---', '');
      else if (l.kind === 'table' && l.rows?.length) {
        const [head, ...body] = l.rows;
        out.push(`| ${head!.join(' | ')} |`, `| ${head!.map(() => '---').join(' | ')} |`);
        for (const r of body) out.push(`| ${r.join(' | ')} |`);
        out.push('');
      } else out.push(`${pad}${l.text}`, '');
    }
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** 서식 없는 글 — 메일이나 메모장에 그대로 붙이는 용도. */
export function notePlainText(doc: Doc, title: string, scope: NoteExportScope, pageId: string | null): string {
  const pages = notePagesFor(doc, scope, pageId);
  const out: string[] = [];
  if (scope === 'book' && title) out.push(title, '');
  for (const page of pages) {
    out.push(page.title.trim() || '제목 없는 페이지', '');
    for (const l of noteLines(page)) {
      const pad = '  '.repeat(l.depth);
      if (l.kind === 'li') out.push(`${pad}· ${l.text}`);
      else if (l.kind === 'oli') out.push(`${pad}- ${l.text}`);
      else if (l.kind === 'todo') out.push(`${pad}[ ] ${l.text}`);
      else if (l.kind === 'done') out.push(`${pad}[v] ${l.text}`);
      else if (l.kind === 'hr') out.push('—'.repeat(20));
      else if (l.kind === 'table' && l.rows?.length) for (const r of l.rows) out.push(`${pad}${r.join('\t')}`);
      else out.push(`${pad}${l.text}`);
    }
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
