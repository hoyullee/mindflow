// 공책 에디터 — 캔버스가 아니라 **페이지의 글**.
//
// 화면은 둘로 갈린다(디자인 원본):
//   왼쪽  페이지 목록 — 이 공책의 페이지들. 제목 + 첫 줄 + 태그.
//   가운데 페이지 본문 — 제목 한 줄 + 블록들. 위에 서식 툴바가 붙는다.
//
// 팬·줌·미니맵·그리기·레이아웃이 없다(에디터가 `isNote`로 그 UI를 통째로 걷어낸다).
// 대신 다루는 것이 순서와 글이고, 규칙은 전부 코어 `note.ts`에 있다.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { NoteBlock, NoteBlockKind, NoteCalloutTone, NotePage, RichRun } from '@mindflow/mindmap-core';
import {
  NOTE_COVERS,
  NOTE_HIGHLIGHTS,
  NOTE_TAGS,
  noteBlockShape,
  noteCoverColor,
  noteHighlightColor,
  noteTagColor,
  pageExcerpt,
  pageText,
  runsText,
  blockText,
} from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import type { Theme } from '../theme';
import { applyNoteFormat, noteEditBoxInSelection } from '../noteRichDom';
import { NoteLine } from './NoteLine';
import { DocChip } from './DocChip';
import { Avatar } from './commentPinShape';
import { formatLastEdited } from '../../home/timeFormat';

interface Props {
  controller: EditorController;
  theme: Theme;
}

/** 블록 종류 메뉴 — 이름과 아이콘(디자인의 `BLOCKS`). 2판에서 붙는 종류는 없다. */
const BLOCK_TYPES: { kind: NoteBlockKind; name: string; hint: string }[] = [
  { kind: 'p', name: '문단', hint: '일반 글' },
  { kind: 'h1', name: '제목 1', hint: '가장 큰 제목' },
  { kind: 'h2', name: '제목 2', hint: '섹션 제목' },
  { kind: 'h3', name: '제목 3', hint: '작은 제목' },
  { kind: 'ul', name: '글머리 목록', hint: '점으로 나열' },
  { kind: 'ol', name: '번호 목록', hint: '순서가 있는 나열' },
  { kind: 'ck', name: '체크리스트', hint: '할 일 · 결정 사항' },
  { kind: 'q', name: '인용', hint: '다른 글이나 말을 인용' },
  { kind: 'code', name: '코드', hint: '고정폭' },
  { kind: 'table', name: '표', hint: '행과 열' },
  { kind: 'callout', name: '콜아웃', hint: '주의 · 결정 · 질문 박스' },
  { kind: 'toggle', name: '토글', hint: '긴 내용을 접어 두기' },
  { kind: 'img', name: '이미지', hint: '파일을 올려 본문에 넣기' },
  { kind: 'link', name: '문서 링크', hint: '마인드맵 · 화이트보드 · 칸반' },
  { kind: 'hr', name: '구분선', hint: '섹션 나누기' },
];

/** 콜아웃 어조 셋 — 디자인의 `CALLOUTS`(이름, 바탕, 잉크). */
const TONES: { tone: NoteCalloutTone; name: string; bg: string; ink: string }[] = [
  { tone: 'warn', name: '주의', bg: 'var(--mf-accent-soft)', ink: 'var(--mf-accent-deep)' },
  { tone: 'decide', name: '결정', bg: 'var(--mf-success-soft)', ink: 'var(--mf-success)' },
  { tone: 'ask', name: '질문', bg: 'var(--mf-info-soft)', ink: 'var(--mf-info)' },
];

/** 인라인 서식 — 코어 `applyPartialStyle`의 종류와 1:1. */
const MARKS: { kind: 'b' | 'i' | 's' | 'u' | 'k'; label: string; name: string; css: CSSProperties }[] = [
  { kind: 'b', label: 'B', name: '굵게', css: { fontWeight: 800 } },
  { kind: 'i', label: 'I', name: '기울임', css: { fontStyle: 'italic' } },
  { kind: 's', label: 'S', name: '취소선', css: { textDecoration: 'line-through' } },
  { kind: 'u', label: 'U', name: '밑줄', css: { textDecoration: 'underline' } },
  { kind: 'k', label: '<>', name: '인라인 코드', css: { fontFamily: 'ui-monospace, monospace', fontSize: 11 } },
];

/** 넣기 — 디자인 원본의 `TOOL_ICONS`. 아이콘은 그 파일의 path를 그대로 옮겼다. */
const INSERTS: { kind: NoteBlockKind; name: string; icon: JSX.Element }[] = [
  { kind: 'ul', name: '글머리 목록', icon: (<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" /></>) },
  { kind: 'ol', name: '번호 목록', icon: (<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5.5h1.5V9M4 9h3M4 13.5c0-1 2-1.2 2-.2 0 .6-.6.9-2 2.2h2.4M4.2 17.5h1.6c1.2 0 1.2 1.5 0 1.5h-1.6" /></>) },
  { kind: 'ck', name: '체크리스트', icon: (<><rect x="3" y="4" width="7" height="7" rx="1.6" /><path d="m4.6 7.4 1.6 1.6L9 6.2" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><path d="M13 7.5h8M13 17.5h8" /></>) },
  { kind: 'table', name: '표', icon: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17M9.5 10v9M15 10v9" /></>) },
  { kind: 'img', name: '이미지', icon: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17 4.5-4.5L14 17l3-3 3 3" /></>) },
  { kind: 'hr', name: '구분선', icon: (<><path d="M4 12h16" /><path d="M8 6h8M8 18h8" opacity=".35" /></>) },
  { kind: 'link', name: '문서 링크', icon: (<><rect x="3.5" y="4" width="4.6" height="16" rx="1.3" /><rect x="9.7" y="4" width="4.6" height="10" rx="1.3" /><rect x="15.9" y="4" width="4.6" height="13" rx="1.3" /></>) },
];

/** 가로 정렬 셋 — 디자인의 `alignTools` 앞 세 개. */
const ALIGNS: { align: 'left' | 'center' | 'right'; name: string; icon: JSX.Element }[] = [
  { align: 'left', name: '왼쪽 정렬', icon: <path d="M4 6h16M4 12h10M4 18h14" /> },
  { align: 'center', name: '가운데 정렬', icon: <path d="M4 6h16M7 12h10M5 18h14" /> },
  { align: 'right', name: '오른쪽 정렬', icon: <path d="M4 6h16M10 12h10M6 18h14" /> },
];

/** 들여쓰기 둘 — 같은 목록의 뒤 두 개. */
const INDENTS: { delta: number; name: string; icon: JSX.Element }[] = [
  { delta: -1, name: '내어쓰기', icon: (<><path d="M11 6h9M11 12h9M11 18h9" /><path d="m7 9-3 3 3 3" /></>) },
  { delta: 1, name: '들여쓰기', icon: (<><path d="M11 6h9M11 12h9M11 18h9" /><path d="m4 9 3 3-3 3" /></>) },
];

/** 글자색 — 스와치. 맵의 색 팔레트와 같은 값을 쓴다(한 앱에서 색이 두 벌이 되지 않게). */
const INKS: [string, string][] = [
  ['', '기본'],
  ['#d92626', '빨강'],
  ['#d98026', '주황'],
  ['#2f7d57', '초록'],
  ['#3e66b8', '파랑'],
  ['#8e5a80', '자두'],
];

export function NoteEditor({ controller, theme }: Props) {
  const page = controller.notePage;
  const readOnly = controller.readOnly;
  /**
   * 서식 버튼을 누르면 포커스가 버튼으로 옮겨 가 선택이 풀린다. 그래서 **누르기
   * 전에**(mousedown) 지금 선택이 들어 있던 박스를 기억해 둔다.
   */
  const boxRef = useRef<HTMLElement | null>(null);
  const rememberBox = () => {
    const el = noteEditBoxInSelection();
    if (el) boxRef.current = el;
  };
  /** 포커스가 온 줄도 기억한다 — 선택이 접혀 있거나 툴바를 먼저 눌러도 대상을 잃지 않게. */
  const focusBox = (el: HTMLElement) => {
    boxRef.current = el;
  };
  /** 방금 만든 블록·항목 — 캐럿을 그리로 보낸다. */
  const [freshId, setFreshId] = useState<string | null>(null);
  /**
   * `/` 커맨드 — **빈 블록에서 `/`를 치면** 종류 목록이 뜬다(디자인).
   *
   * 글자 사이에서는 뜨지 않는다: 코드나 주소를 적다 `/`를 칠 때마다 메뉴가 끼어들면
   * 방해다. "빈 줄에서 시작한다"는 조건 하나로 그 오탐이 사라진다.
   */
  const [slashFor, setSlashFor] = useState<string | null>(null);
  const [slashQ, setSlashQ] = useState('');

  // Escape로 닫는다 — 팝업이 열려 있는 동안 본문 타이핑은 그대로 이어진다.
  useEffect(() => {
    if (!slashFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSlashFor(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [slashFor]);

  if (!page) return null;

  return (
    <div
      data-note-editor
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', background: theme.canvasBg, overflow: 'hidden' }}
    >
      <PageList controller={controller} />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!readOnly && (
          <FormatToolbar
            controller={controller}
            boxRef={boxRef}
            rememberBox={rememberBox}
            onInserted={setFreshId}
            openSlash={(id) => {
              setSlashFor(id);
              setSlashQ('');
            }}
          />
        )}
        <div className="lnb-scroll" data-note-page style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '26px 0 56px' }}>
          {/* 본문 단 — 디자인 원본의 700px. 블록 사이는 19px로 벌어진다(글이 숨 쉬는
              간격이고, 이 리듬이 없으면 제목과 본문이 한 덩어리로 뭉쳐 보인다). */}
          <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 30px', display: 'flex', flexDirection: 'column', gap: 19, minWidth: 0 }}>
            <PageHead controller={controller} page={page} />
            {page.blocks.map((block, i) => (
              <BlockView
                key={block.id}
                controller={controller}
                block={block}
                index={i}
                freshId={freshId}
                setFreshId={setFreshId}
                rememberBox={rememberBox}
                focusBox={focusBox}
                openSlash={(id) => {
                  setSlashFor(id);
                  setSlashQ('');
                }}
              />
            ))}
            {slashFor && !readOnly && (
              <SlashMenu
                query={slashQ}
                onQuery={setSlashQ}
                onClose={() => setSlashFor(null)}
                onPick={(kind) => {
                  controller.retypeNoteBlock(slashFor, kind);
                  setSlashFor(null);
                  setFreshId(slashFor);
                }}
              />
            )}

            {/* 본문 끝의 빈 줄 — 디자인은 여기에 **무엇을 할 수 있는지**를 적는다.
                예전에는 아무것도 없는 120px 빈 버튼이라, 이어 쓸 수 있다는 것을
                알아채려면 우연히 눌러 보는 수밖에 없었다. */}
            {!readOnly && (
              <button
                type="button"
                data-note-append
                onClick={() => setFreshId(controller.addNoteBlock('p'))}
                className="btn"
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0, border: 'none', background: 'transparent', cursor: 'text', textAlign: 'left' }}
              >
                <span aria-hidden="true" style={{ width: 26, height: 26, flex: '0 0 auto', borderRadius: 8, border: '1px dashed var(--mf-border)', color: 'var(--mf-faint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--mf-faint)' }}>여기에 입력하거나 / 를 눌러 블록을 넣으세요</span>
              </button>
            )}

            <PageStats page={page} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 상단 바 — 디자인 원본의 공책 머리. 왼쪽부터 [문서 칩(뒤로·이름·저장)] · [경로] ·
 * [공유·댓글·기록].
 *
 * 문서 칩이 여기 **줄 안에** 선다(`inline`). 캔버스 위에 떠 있던 예전 자리는 공책에서는
 * 왼쪽 페이지 목록의 머리와 검색칸을 덮었다 — 제보의 "UI가 틀어져 있다" 중 첫 번째다.
 */
export function NoteTopBar({ controller, theme }: Props) {
  const page = controller.notePage;
  const space = controller.noteSpaceName;
  const tabs: { name: string; on: boolean; onPick: () => void }[] = [
    { name: '댓글', on: controller.commentsOpen, onPick: () => (controller.commentsOpen ? controller.closeComments() : controller.openComments()) },
    { name: '기록', on: controller.historyOpen, onPick: () => controller.setHistoryOpen(!controller.historyOpen) },
  ];
  return (
    <div
      data-note-topbar
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: theme.appBg,
        borderBottom: `1px solid ${theme.border}`,
        minWidth: 0,
      }}
    >
      <DocChip controller={controller} inline />
      {/* 경로 — `스페이스 › 공책 › 페이지`. 스페이스 이름은 워크스페이스 블롭에서 오고
          (공책일 때만 읽는다), 아직 못 읽었으면 그 조각만 빠진다. */}
      <nav aria-label="위치" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        {space && (
          <>
            <button
              type="button"
              className="mf-ed-btn"
              onClick={controller.goBack}
              style={{ flex: '0 0 auto', height: 26, padding: '0 9px', border: 0, borderRadius: 8, background: 'transparent', color: theme.subtext, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {space}
            </button>
            <Caret theme={theme} />
          </>
        )}
        <span style={{ flex: '0 1 auto', minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 9px', fontSize: 12, fontWeight: 600, color: theme.subtext, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: 2.5, background: noteCoverColor(controller.doc.cover), display: 'block' }} />
          {controller.docTitle || '제목 없는 공책'}
        </span>
        <Caret theme={theme} />
        <span style={{ flex: '0 1 auto', minWidth: 0, height: 26, padding: '0 9px', display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 800, letterSpacing: '-.015em', color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {page?.title?.trim() || '제목 없는 페이지'}
        </span>
      </nav>
      {/* 오른쪽 — 디자인은 [공유 · 댓글 · 기록]을 한 알약에 묶는다. 우리는 **공유를 빼고**
          둘만 둔다: 디자인의 공책 화면에는 GNB가 없지만 우리에겐 있고 거기 이미 공유가
          있다. 같은 일을 하는 단추가 한 화면에 둘이면 어느 쪽이 무엇인지 되레 흐려진다
          (댓글·기록은 GNB 메뉴 안에 있어 이 자리에서 값을 한다). */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 8px', borderRadius: 14, background: theme.panel, border: `1px solid ${theme.border}` }}>
        <span style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 11, background: theme.panel2, border: `1px solid ${theme.border}` }}>
          {tabs.map((t) => (
            <button
              key={t.name}
              type="button"
              className="mf-ed-btn"
              data-note-tab={t.name}
              aria-pressed={t.on}
              onClick={t.onPick}
              style={{
                height: 24,
                padding: '0 11px',
                borderRadius: 8,
                border: 0,
                background: t.on ? theme.panel : 'transparent',
                color: t.on ? theme.text : theme.subtext,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: t.on ? 800 : 600,
                cursor: 'pointer',
                boxShadow: t.on ? '0 1px 2px rgba(46,42,38,.16)' : 'none',
              }}
            >
              {t.name}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}

/** 경로의 `›` — 한 벌로 써서 간격이 어긋나지 않게. */
function Caret({ theme }: { theme: Theme }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.subtext} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/* ── 페이지 목록 ───────────────────────────────────────────────────────────── */

/** 목록 정렬 둘 — 디자인 원본의 `noteSorts`. */
type PageSort = 'edited' | 'title';

function PageList({ controller }: { controller: EditorController }) {
  const pages = controller.notePages;
  const curId = controller.notePage?.id ?? null;
  const cover = noteCoverColor(controller.doc.cover);
  /**
   * 이 공책 안에서 **페이지 이름과 본문을 함께** 찾는다(요청 12번).
   *
   * 홈 검색이 문서를 찾아 주는 자리라면 여기는 **한 권 안에서** 찾는 자리다 —
   * 회의록처럼 같은 틀이 수십 장 쌓이면 제목만으로는 못 고른다. 걸린 줄을
   * 그 자리에 보여 줘 "이 장이 맞나"를 목록에서 판단할 수 있게 한다.
   */
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<PageSort>('edited');
  const [tag, setTag] = useState<string>('전체');
  const query = q.trim().toLowerCase();
  const searching = query.length > 0;

  /** 이 공책에 실제로 쓰인 태그들 — 쓰지 않은 태그로 거르는 칩은 뜻이 없다. */
  const tags = useMemo(() => {
    const seen: string[] = [];
    for (const pg of pages) {
      const t = pg.tag?.trim();
      if (t && !seen.includes(t)) seen.push(t);
    }
    return seen;
  }, [pages]);

  const shown = useMemo(() => {
    // 검색 중에는 **태그·정렬을 적용하지 않는다** — 찾는 사람은 "어디 있나"를 묻는
    // 것이지 "어떤 순서로 보고 싶다"를 말하는 게 아니다(디자인도 그때 두 줄을 감춘다).
    if (searching) {
      return pages.map((pg) => ({ pg, hit: pageHit(pg, query) })).filter((x) => x.hit !== null);
    }
    const rows = pages.filter((pg) => tag === '전체' || (pg.tag ?? '') === tag).map((pg) => ({ pg, hit: null as string | null }));
    if (sort === 'title') {
      // 제목순은 **화면에 보이는 이름**을 기준으로 — 빈 제목은 뒤로 민다.
      return [...rows].sort((a, b) => (a.pg.title.trim() || '￿').localeCompare(b.pg.title.trim() || '￿', 'ko'));
    }
    // 수정순 — 시각을 모르는 페이지(옛 문서)는 문서 안 순서를 그대로 지킨다.
    return [...rows].sort((a, b) => (b.pg.updatedAt ?? '').localeCompare(a.pg.updatedAt ?? ''));
  }, [pages, query, searching, sort, tag]);

  return (
    <aside
      data-note-pages
      style={{
        width: 292,
        minWidth: 196,
        flex: '0 1 292px',
        borderRight: '1px solid var(--mf-border-soft)',
        background: 'var(--mf-panel)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* 머리 — 검색 + 새 페이지가 **한 줄**이다(디자인). 예전에는 검색이 가운데,
          새 페이지가 목록 맨 아래에 따로 있어 둘이 한 벌로 읽히지 않았다. */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 9px', borderRadius: 10, border: '1px solid var(--mf-border)', background: 'var(--mf-card)' }}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" style={{ flex: '0 0 auto' }}>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.5-4.5" />
            </svg>
            <input
              data-note-search
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('');
              }}
              placeholder="제목과 본문에서 찾기"
              aria-label="제목과 본문에서 찾기"
              style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 12, outline: 'none' }}
            />
            {searching && (
              <button
                type="button"
                data-note-search-clear
                onClick={() => setQ('')}
                title="지우기"
                aria-label="검색어 지우기"
                style={{ width: 18, height: 18, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </span>
          {!controller.readOnly && (
            <button
              type="button"
              data-note-new-page
              onClick={() => controller.addNotePage()}
              title="새 페이지"
              aria-label="새 페이지"
              style={{ width: 30, height: 30, flex: '0 0 auto', border: 0, borderRadius: 10, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>

        {searching ? (
          <div data-note-search-count style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 0', fontSize: 11, color: 'var(--mf-subtext)', minWidth: 0 }}>
            <span style={{ fontWeight: 700, color: 'var(--mf-accent)' }}>{shown.length}</span>
            <span>장에서 찾음</span>
            <span style={{ flex: 1, minWidth: 0 }} />
            <span style={{ fontSize: 9.5, color: 'var(--mf-faint)' }}>Esc 목록으로</span>
          </div>
        ) : (
          <>
            {/* 정렬 — 회의록처럼 쌓이는 공책은 **최근 것**이 먼저이고, 템플릿 모음처럼
                이름으로 찾는 공책은 제목순이 맞다. 둘 다 흔해서 고르게 둔다. */}
            <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 10, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)' }}>
              {([['edited', '수정순'], ['title', '제목순']] as const).map(([key, name]) => (
                <button
                  key={key}
                  type="button"
                  data-note-sort={key}
                  aria-pressed={sort === key}
                  onClick={() => setSort(key)}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    height: 25,
                    border: 0,
                    borderRadius: 8,
                    background: sort === key ? 'var(--mf-card)' : 'transparent',
                    color: sort === key ? 'var(--mf-text)' : 'var(--mf-subtext)',
                    fontFamily: 'inherit',
                    fontSize: 11.5,
                    fontWeight: sort === key ? 800 : 600,
                    cursor: 'pointer',
                    boxShadow: sort === key ? '0 1px 2px rgba(46,42,38,.16)' : 'none',
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            {/* 태그 거르개 — 이 공책에 쓰인 태그가 둘 이상일 때만 뜻이 있다. */}
            {tags.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {['전체', ...tags].map((name) => {
                  const on = tag === name;
                  const dot = name === '전체' ? null : noteTagColor(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      data-note-tag-filter={name}
                      aria-pressed={on}
                      onClick={() => setTag(name)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        height: 24,
                        padding: '0 9px',
                        borderRadius: 999,
                        border: `1px solid ${on ? 'var(--mf-border-hover)' : 'var(--mf-border)'}`,
                        background: on ? 'var(--mf-accent-soft)' : 'transparent',
                        color: on ? 'var(--mf-text)' : 'var(--mf-subtext)',
                        fontFamily: 'inherit',
                        fontSize: 11,
                        fontWeight: on ? 800 : 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {dot && <span aria-hidden="true" style={{ width: 6, height: 6, flex: '0 0 auto', borderRadius: 999, background: dot, display: 'block' }} />}
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="lnb-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {shown.map(({ pg, hit }) => (
          <PageRow key={pg.id} controller={controller} page={pg} index={pages.indexOf(pg)} active={pg.id === curId} hit={hit} cover={cover} />
        ))}

        {shown.length === 0 && (
          <div data-note-search-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '26px 12px', textAlign: 'center' }}>
            <span style={{ fontSize: 12.5, color: 'var(--mf-faint)', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              {searching ? '이 공책의 제목과 본문을 모두 찾아봤어요' : '검색과 태그에 맞는 페이지가 없어요'}
            </span>
            {!searching && !controller.readOnly && (
              <button
                type="button"
                onClick={() => controller.addNotePage()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', border: '1.5px dashed var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                새 페이지 만들기
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function PageRow({ controller, page, index, active, hit, cover }: { controller: EditorController; page: NotePage; index: number; active: boolean; hit?: string | null; cover: string }) {
  // 검색 중이면 **걸린 줄**을 보여 준다 — 첫 줄은 왜 걸렸는지를 말해 주지 못한다.
  const excerpt = hit ?? pageExcerpt(page, 90);
  const tag = page.tag ?? null;
  const who = page.updatedBy?.trim();
  return (
    <div
      data-note-page-row={page.id}
      data-active={active ? '1' : undefined}
      onClick={() => controller.setNotePageId(page.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          controller.setNotePageId(page.id);
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 9,
        padding: '10px 11px',
        border: `1px solid ${active ? 'var(--mf-border-hover)' : 'transparent'}`,
        borderRadius: 12,
        background: active ? 'var(--mf-card)' : 'transparent',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      {/* 고른 줄의 왼쪽 띠 — 표지 색. 배경 톤만으로 가르면 테마에 따라 거의 안 보인다. */}
      <span aria-hidden="true" style={{ width: 3, flex: '0 0 auto', borderRadius: 999, background: active ? cover : 'transparent', display: 'block' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ flex: '0 0 auto', fontFamily: 'ui-monospace, monospace', fontSize: 10, fontWeight: 700, color: 'var(--mf-faint)', whiteSpace: 'nowrap' }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              fontWeight: active ? 800 : 700,
              letterSpacing: '-.015em',
              color: 'var(--mf-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {page.title.trim() || '제목 없는 페이지'}
          </span>
          {page.updatedAt && (
            <span style={{ flex: '0 0 auto', fontSize: 10, color: 'var(--mf-faint)', whiteSpace: 'nowrap' }}>{formatLastEdited(page.updatedAt)}</span>
          )}
        </div>
        {excerpt && (
          <div
            data-note-page-hit={hit ? '1' : undefined}
            style={{ fontSize: 11.5, color: 'var(--mf-subtext)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'keep-all' }}
          >
            {excerpt}
          </div>
        )}
        {(tag || who) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            {tag && (
              <span data-note-page-tag style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto' }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: noteTagColor(tag), display: 'block' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: noteTagColor(tag) }}>{tag}</span>
              </span>
            )}
            {who && (
              <span style={{ minWidth: 0, fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who} 님이 씀</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 이 페이지가 질의에 걸리는가 — 걸렸으면 **보여 줄 한 줄**, 아니면 `null`.
 *
 * 제목에서 걸리면 빈 문자열을 돌려준다(행이 제목을 이미 보여 주므로 같은 말을
 * 두 번 쓰지 않는다 — 호출부는 `!== null`로 판단한다).
 */
function pageHit(page: NotePage, query: string): string | null {
  if (page.title.toLowerCase().includes(query)) return '';
  for (const b of page.blocks) {
    const line = blockText(b)
      .split('\n')
      .find((l) => l.toLowerCase().includes(query));
    if (line) return line.length > 70 ? `${line.slice(0, 69)}…` : line;
  }
  return null;
}

/* ── 페이지 머리(제목·태그·페이지 조작) ───────────────────────────────────── */

/**
 * 글의 부피 — `176자 · 56단어 · 읽기 1분`(디자인 원본의 본문 맨 아래 줄).
 *
 * 회의록·정책처럼 **읽을 사람이 있는 글**에서 "이거 길어요?"에 답해 주는 줄이다.
 * 읽기 시간은 한국어 분당 500자(일반적인 추정치)로, 1분 미만도 `1분`으로 적는다.
 */
function PageStats({ page }: { page: NotePage }) {
  const text = pageText(page);
  const chars = [...text.replace(/\s+/g, '')].length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(chars / 500));
  return (
    <div data-note-stats style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: 'var(--mf-faint)' }}>
      <span>{chars}자</span>
      <span aria-hidden="true">·</span>
      <span>{words}단어</span>
      <span aria-hidden="true">·</span>
      <span>읽기 {minutes}분</span>
      <span style={{ flex: 1, minWidth: 0 }} />
      {page.updatedAt && <span>{formatLastEdited(page.updatedAt)} 수정</span>}
    </div>
  );
}

function PageHead({ controller, page }: { controller: EditorController; page: NotePage }) {
  const [tagOpen, setTagOpen] = useState(false);
  const readOnly = controller.readOnly;
  const who = page.updatedBy?.trim() || controller.myName || '나';
  const mine = !page.updatedBy?.trim();
  const linked = page.linkedDocId ? controller.linkTargets.find((t) => t.docId === page.linkedDocId) : undefined;
  return (
    <div className="mf-note-head" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <input
        data-note-title
        value={page.title}
        readOnly={readOnly}
        placeholder="제목 없는 페이지"
        onChange={(e) => controller.setNotePageTitle(page.id, e.target.value)}
        title="눌러서 제목 수정"
        style={{
          border: 'none',
          // 눌러서 고칠 수 있다는 것을 **밑줄이 나타났다 사라지며** 알린다(디자인 원본).
          borderBottom: '1.5px dashed transparent',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: 27,
          fontWeight: 800,
          letterSpacing: '-.04em',
          lineHeight: 1.3,
          color: 'var(--mf-text)',
          outline: 'none',
          padding: '2px 0 5px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, position: 'relative', minWidth: 0 }}>
        {/* 페이지 태그 — 공책 표지의 태그와 **별개**다(페이지마다 다를 수 있다). */}
        <button
          type="button"
          data-note-tag-pick
          disabled={readOnly}
          onClick={() => setTagOpen((v) => !v)}
          className="btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 10px',
            borderRadius: 999,
            border: '1px solid var(--mf-border)',
            background: page.tag ? `color-mix(in srgb, ${noteTagColor(page.tag)} 16%, transparent)` : 'var(--mf-panel2)',
            color: page.tag ? `color-mix(in srgb, ${noteTagColor(page.tag)} 80%, var(--mf-text))` : 'var(--mf-subtext)',
            fontFamily: 'inherit',
            fontSize: 11.5,
            fontWeight: 700,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          {page.tag || '태그 붙이기'}
        </button>
        {tagOpen && !readOnly && (
          <div
            data-note-tag-menu
            style={{
              position: 'absolute',
              top: 30,
              left: 0,
              zIndex: 20,
              width: 168,
              padding: 6,
              borderRadius: 12,
              background: 'var(--mf-card)',
              border: '1px solid var(--mf-border)',
              boxShadow: '0 20px 40px -22px rgba(46,42,38,.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            {NOTE_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                className="btn"
                onClick={() => {
                  controller.setNotePageTag(page.id, page.tag === t ? null : t);
                  setTagOpen(false);
                }}
                style={{ ...MENU_ITEM, background: page.tag === t ? 'var(--mf-accent-soft)' : 'transparent' }}
              >
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: noteTagColor(t) }} />
                {t}
              </button>
            ))}
            <button type="button" className="btn" onClick={() => { controller.setNotePageTag(page.id, null); setTagOpen(false); }} style={{ ...MENU_ITEM, color: 'var(--mf-muted)' }}>
              태그 없음
            </button>
          </div>
        )}
        {/* 누가 · 언제 — 디자인 원본은 태그 바로 옆에 이 둘을 둔다. 얼굴이 있으면
            "남이 고쳤다"가 이름을 읽기 전에 보인다. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto', minWidth: 0 }}>
          <Avatar name={who} size={20} src={mine ? controller.myAvatar : null} />
          <span style={{ fontSize: 11.5, color: 'var(--mf-subtext)', whiteSpace: 'nowrap' }}>{mine ? '나' : who}</span>
        </span>
        {page.updatedAt && <span style={{ fontSize: 11, color: 'var(--mf-faint)', flex: '0 0 auto', whiteSpace: 'nowrap' }}>{formatLastEdited(page.updatedAt)} 수정</span>}
        {/* 연결 문서 — 이 페이지가 어느 보드의 회의록인지. 눌러서 그리로 간다. */}
        {linked && (
          <a
            data-note-linked-doc
            href={linked.href}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', flex: '0 0 auto', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3.5" y="4" width="4.6" height="16" rx="1.3" />
              <rect x="9.7" y="4" width="4.6" height="10" rx="1.3" />
              <rect x="15.9" y="4" width="4.6" height="13" rx="1.3" />
            </svg>
            {linked.title}
          </a>
        )}
        <span style={{ flex: 1, minWidth: 0 }} />
        {/* 페이지 조작 — 디자인은 이 줄을 **읽는 줄**로 두고 조작은 목록의 우클릭에
            맡긴다. 우리에겐 그 메뉴가 없으므로 자리는 지키되 **마우스를 얹었을 때만**
            나타나게 해 평소의 읽기를 방해하지 않는다(`editor.css`). */}
        {!readOnly && (
          <span className="mf-note-pageact" style={{ display: 'inline-flex', gap: 6, flex: '0 0 auto' }}>
            <button type="button" data-note-dup-page className="btn" onClick={() => controller.duplicateNotePage(page.id)} style={GHOST_BTN}>
              페이지 복제
            </button>
            {/* 마지막 한 장은 지울 수 없다(코어 `removePage`) — **버튼을 끈다.**
                누를 수는 있는데 아무 일도 안 나는 버튼은 고장으로 읽히고, 이 에디터에는
                이유를 말해 줄 토스트 자리가 없다. 끄고 툴팁으로 이유를 붙인다. */}
            <button
              type="button"
              data-note-del-page
              className="btn"
              disabled={controller.notePages.length <= 1}
              title={controller.notePages.length <= 1 ? '공책에는 페이지가 한 장 이상 있어야 해요' : '이 페이지를 삭제'}
              onClick={() => controller.removeNotePage(page.id)}
              style={{
                ...GHOST_BTN,
                color: controller.notePages.length <= 1 ? 'var(--mf-faint)' : 'var(--mf-danger)',
                cursor: controller.notePages.length <= 1 ? 'default' : 'pointer',
              }}
            >
              페이지 삭제
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/* ── 서식 툴바 ─────────────────────────────────────────────────────────────── */

function FormatToolbar({
  controller,
  boxRef,
  rememberBox,
  onInserted,
  openSlash,
}: {
  controller: EditorController;
  boxRef: { current: HTMLElement | null };
  rememberBox: () => void;
  /** 새로 만든 블록·항목으로 캐럿을 보낸다(루트의 `freshId`). */
  onInserted: (id: string | null) => void;
  /** `/` 단추 — 지금 줄에서 블록 목록을 연다(빈 줄에서 `/`를 치는 것과 같은 자리). */
  openSlash: (blockId: string) => void;
}) {
  const [open, setOpen] = useState<'hl' | 'ink' | null>(null);

  /**
   * 지금 **다루는 블록** — 캐럿이 들어 있던 줄. 아직 아무 데도 두지 않았으면
   * 마지막 블록으로 본다(툴바를 먼저 누르는 사람이 아무 일도 못 하게 두지 않는다).
   */
  const curBlockId = (): string | null => {
    const key = boxRef.current?.getAttribute('data-note-line') || '';
    const id = blockIdOf(key);
    if (id) return id;
    const blocks = controller.notePage?.blocks ?? [];
    return blocks.length ? blocks[blocks.length - 1]!.id : null;
  };

  /**
   * 넣기 — **줄 종류를 바꿀 수 있으면 바꾸고, 아니면 아래에 새로 만든다.**
   *
   * 빈 문단에서 「글머리 목록」을 누르면 그 줄이 목록이 되는 것이 기대이고(새 줄이
   * 하나 더 생기면 빈 문단이 남는다), 글이 들어 있는 줄에서는 새로 만드는 것이 맞다.
   * 표·이미지·구분선·문서 링크는 글을 담지 않으므로 언제나 새로 만든다.
   */
  const insert = (kind: NoteBlockKind) => {
    const id = curBlockId();
    const blocks = controller.notePage?.blocks ?? [];
    const cur = blocks.find((b) => b.id === id);
    const textLike = noteBlockShape(kind) === 'items';
    if (cur && textLike && noteBlockShape(cur.kind) === 'runs' && runsText(cur.runs) === '') {
      controller.retypeNoteBlock(cur.id, kind);
      onInserted(cur.id);
      return;
    }
    onInserted(controller.addNoteBlock(kind, id ?? undefined));
  };

  /**
   * 서식을 걸고 **그 결과를 문서에 커밋한다**.
   *
   * 박스가 어느 블록·항목·칸의 것인지는 `data-note-line`에 실어 둔 키로 안다 —
   * 툴바가 블록 구조를 다시 알아내지 않아도 되고, 목록 항목·표 칸도 같은 길을 쓴다.
   */
  const apply = (kind: 'b' | 'i' | 's' | 'u' | 'k' | 'c' | 'hl' | 'clear', val?: string | null) => {
    const el = boxRef.current;
    if (!el) return;
    const runs = applyNoteFormat(el, kind, val);
    if (!runs) return;
    commitLine(controller, el.getAttribute('data-note-line') || '', runs);
    setOpen(null);
  };

  const stop = (e: ReactMouseEvent) => {
    // **선택을 잃지 않는다**: mousedown의 기본 동작이 포커스를 옮겨 캐럿이 풀린다.
    rememberBox();
    e.preventDefault();
  };

  return (
    <div
      data-note-toolbar
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
        padding: '8px 14px',
        borderBottom: '1px solid var(--mf-border-soft)',
        background: 'var(--mf-panel)',
      }}
    >
      <BlockTypeMenu controller={controller} rememberBox={rememberBox} boxRef={boxRef} />
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {MARKS.map((m) => (
        <button
          key={m.kind}
          type="button"
          data-note-mark={m.kind}
          title={m.name}
          aria-label={m.name}
          className="btn"
          onMouseDown={stop}
          onClick={() => apply(m.kind)}
          style={{ ...TOOL_BTN, ...m.css }}
        >
          {m.label}
        </button>
      ))}
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {/* 형광펜 */}
      <div style={{ position: 'relative' }}>
        <button type="button" data-note-hl className="btn" title="형광펜" onMouseDown={stop} onClick={() => setOpen((v) => (v === 'hl' ? null : 'hl'))} style={TOOL_BTN}>
          <span aria-hidden="true" style={{ width: 13, height: 13, borderRadius: 3, background: noteHighlightColor('yellow') ?? '#FBEFC0', border: '1px solid var(--mf-border)' }} />
        </button>
        {open === 'hl' && (
          <div style={SWATCH_POP}>
            {NOTE_HIGHLIGHTS.map(([key, name]) => (
              <button key={key} type="button" title={name} aria-label={name} className="btn" onMouseDown={stop} onClick={() => apply('hl', key)} style={{ ...SWATCH, background: noteHighlightColor(key) ?? 'transparent' }} />
            ))}
            <button type="button" title="형광펜 지우기" aria-label="형광펜 지우기" className="btn" onMouseDown={stop} onClick={() => apply('hl', '')} style={{ ...SWATCH, background: 'transparent', fontSize: 11 }}>
              ✕
            </button>
          </div>
        )}
      </div>
      {/* 글자색 */}
      <div style={{ position: 'relative' }}>
        <button type="button" data-note-ink className="btn" title="글자색" onMouseDown={stop} onClick={() => setOpen((v) => (v === 'ink' ? null : 'ink'))} style={{ ...TOOL_BTN, fontWeight: 800 }}>
          A
        </button>
        {open === 'ink' && (
          <div style={SWATCH_POP}>
            {INKS.map(([ink, name]) => (
              <button
                key={name}
                type="button"
                title={name}
                aria-label={name}
                className="btn"
                onMouseDown={stop}
                onClick={() => apply('c', ink || null)}
                style={{ ...SWATCH, background: ink || 'var(--mf-panel2)', color: 'var(--mf-text)', fontSize: 11 }}
              >
                {ink ? '' : 'A'}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" data-note-clear className="btn" title="서식 지우기" onMouseDown={stop} onClick={() => apply('clear')} style={{ ...TOOL_BTN, width: 'auto', padding: '0 9px', fontSize: 11.5 }}>
        서식 지우기
      </button>
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {/* 넣기 — 디자인 원본의 `TOOL_ICONS`. 모델에는 처음부터 있던 블록들인데 넣는
          길이 `/` 커맨드 하나뿐이었다(그래서 있는 줄도 몰랐다). */}
      {INSERTS.map((t) => (
        <button key={t.kind} type="button" data-note-insert={t.kind} title={t.name} aria-label={t.name} className="btn" onMouseDown={stop} onClick={() => insert(t.kind)} style={TOOL_BTN}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {t.icon}
          </svg>
        </button>
      ))}
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {/* 정렬·들여쓰기 — `NoteBlock.align`·`indent`는 모델에 있었는데 버튼이 없어
          화면에 나타난 적이 없다. 지금 줄에 걸린다(선택 범위가 아니라 블록 단위다). */}
      {ALIGNS.map((t) => {
        const on = (controller.notePage?.blocks.find((b) => b.id === curBlockId())?.align ?? 'left') === t.align;
        return (
          <button
            key={t.align}
            type="button"
            data-note-align={t.align}
            aria-pressed={on}
            title={t.name}
            aria-label={t.name}
            className="btn"
            onMouseDown={stop}
            onClick={() => {
              const id = curBlockId();
              if (id) controller.setNoteBlockAlign(id, t.align);
            }}
            style={{ ...TOOL_BTN, background: on ? 'var(--mf-accent-soft)' : 'transparent', color: on ? 'var(--mf-accent)' : 'var(--mf-subtext)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              {t.icon}
            </svg>
          </button>
        );
      })}
      {INDENTS.map((t) => (
        <button
          key={t.name}
          type="button"
          data-note-indent={t.delta > 0 ? 'in' : 'out'}
          title={t.name}
          aria-label={t.name}
          className="btn"
          onMouseDown={stop}
          onClick={() => {
            const id = curBlockId();
            if (id) controller.setNoteBlockIndent(id, t.delta);
          }}
          style={TOOL_BTN}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {t.icon}
          </svg>
        </button>
      ))}
      <span style={{ flex: 1 }} />
      {/* `/` — 빈 줄에서 `/`를 치는 것과 같은 자리를 **버튼으로도** 연다. 그 규칙을
          아는 사람만 쓸 수 있는 기능이 되지 않게(디자인 원본도 이 단추를 둔다). */}
      <button
        type="button"
        data-note-slash-btn
        title="블록 넣기 (/)"
        aria-label="블록 넣기"
        className="btn"
        onMouseDown={stop}
        onClick={() => {
          const id = curBlockId();
          if (id) openSlash(id);
        }}
        style={{ ...TOOL_BTN, fontSize: 12, fontWeight: 700 }}
      >
        /
      </button>
      <CoverMenu controller={controller} />
    </div>
  );
}

/** 블록 종류 바꾸기 — 캐럿이 있는 블록에 걸린다. */
function BlockTypeMenu({ controller, rememberBox, boxRef }: { controller: EditorController; rememberBox: () => void; boxRef: { current: HTMLElement | null } }) {
  const [open, setOpen] = useState(false);
  const cur = controller.notePage?.blocks.find((b) => b.id === blockIdOf(boxRef.current?.getAttribute('data-note-line') || ''));
  const name = BLOCK_TYPES.find((t) => t.kind === (cur?.kind ?? 'p'))?.name ?? '문단';
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        data-note-blocktype
        className="btn"
        onMouseDown={(e) => {
          rememberBox();
          e.preventDefault();
        }}
        onClick={() => setOpen((v) => !v)}
        style={{ ...TOOL_BTN, width: 'auto', padding: '0 10px', gap: 6, fontSize: 12, fontWeight: 700 }}
      >
        {name}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          data-note-blocktype-menu
          style={{
            position: 'absolute',
            top: 32,
            left: 0,
            zIndex: 30,
            width: 214,
            padding: 6,
            borderRadius: 12,
            background: 'var(--mf-card)',
            border: '1px solid var(--mf-border)',
            boxShadow: '0 20px 40px -22px rgba(46,42,38,.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            maxHeight: 320,
            overflowY: 'auto',
          }}
          className="lnb-scroll"
        >
          {BLOCK_TYPES.map((t) => (
            <button
              key={t.kind}
              type="button"
              data-note-blocktype-item={t.kind}
              className="btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const key = boxRef.current?.getAttribute('data-note-line') || '';
                const id = blockIdOf(key);
                if (id) controller.retypeNoteBlock(id, t.kind);
                setOpen(false);
              }}
              style={{ ...MENU_ITEM, flexDirection: 'column', alignItems: 'flex-start', gap: 1, background: cur?.kind === t.kind ? 'var(--mf-accent-soft)' : 'transparent' }}
            >
              <span style={{ fontWeight: 700 }}>{t.name}</span>
              <span style={{ fontSize: 10.5, color: 'var(--mf-faint)' }}>{t.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 공책 표지 — 색·스케치는 홈의 우클릭 메뉴와 같은 값을 쓴다(여기서도 바꿀 수 있다). */
function CoverMenu({ controller }: { controller: EditorController }) {
  const [open, setOpen] = useState(false);
  const cover = controller.doc.cover;
  const color = noteCoverColor(cover);
  if (controller.readOnly) return null;
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" data-note-cover-btn className="btn" title="표지 색" onClick={() => setOpen((v) => !v)} style={{ ...TOOL_BTN, width: 'auto', padding: '0 9px', gap: 6, fontSize: 11.5 }}>
        <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: color }} />
        표지
      </button>
      {open && (
        <div data-note-cover-menu style={{ ...SWATCH_POP, right: 0, left: 'auto' }}>
          {NOTE_COVERS.map(([hex, name]) => (
            <button
              key={hex}
              type="button"
              title={name}
              aria-label={name}
              className="btn"
              onClick={() => {
                controller.setNoteCover({ color: hex });
                setOpen(false);
              }}
              style={{ ...SWATCH, background: hex, border: color === hex ? '2px solid var(--mf-accent)' : '1px solid var(--mf-border)' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 블록 ─────────────────────────────────────────────────────────────────── */

interface BlockProps {
  controller: EditorController;
  block: NoteBlock;
  index: number;
  freshId: string | null;
  setFreshId: (id: string | null) => void;
  rememberBox: () => void;
  focusBox: (el: HTMLElement) => void;
  /** 빈 블록에서 `/`를 쳤다 — 종류 목록을 연다. */
  openSlash: (blockId: string) => void;
}

function BlockView({ controller, block, index, freshId, setFreshId, rememberBox, focusBox, openSlash }: BlockProps) {
  const readOnly = controller.readOnly;
  const shape = noteBlockShape(block.kind);

  /** 엔터 — 같은 종류의 새 블록을 아래에 만든다(제목 뒤에는 문단이 자연스럽다). */
  const enterBlock = (): boolean => {
    if (readOnly) return false;
    const next = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3' ? 'p' : block.kind;
    setFreshId(controller.addNoteBlock(next === 'hr' || next === 'table' ? 'p' : next, block.id));
    return true;
  };

  /** 맨 앞 백스페이스 — 빈 블록이면 지우고, 글이 있으면 문단으로 되돌린다. */
  const backBlock = (): boolean => {
    if (readOnly) return false;
    const empty = runsText(block.runs) === '';
    if (empty && index > 0) {
      controller.removeNoteBlock(block.id);
      return true;
    }
    if (block.kind !== 'p') {
      controller.retypeNoteBlock(block.id, 'p');
      return true;
    }
    return false;
  };

  if (shape === 'empty') {
    return (
      <div data-note-block={block.id} data-note-kind={block.kind} style={blockFlow(block)}>
        <hr style={{ border: 'none', borderTop: '1px solid var(--mf-border)', margin: 0 }} />
      </div>
    );
  }

  if (shape === 'img') {
    return <ImageBlock controller={controller} block={block} />;
  }

  if (shape === 'link') {
    return <LinkBlock controller={controller} block={block} />;
  }

  if (block.kind === 'callout') {
    const tone = TONES.find((t) => t.tone === (block.tone ?? 'warn')) ?? TONES[0]!;
    return (
      <div
        data-note-block={block.id}
        data-note-kind="callout"
        onMouseUp={rememberBox}
        style={{ ...blockFlow(block), display: 'flex', gap: 10, alignItems: 'flex-start', padding: '13px 15px', borderRadius: 13, background: tone.bg, borderLeft: `3px solid ${tone.ink}` }}
      >
        {/* 어조는 **왼쪽 칩을 눌러** 돈다 — 세 가지뿐이라 메뉴보다 한 번 누르는 쪽이 빠르다. */}
        <button
          type="button"
          data-note-tone={block.tone ?? 'warn'}
          disabled={readOnly}
          title="주의 · 결정 · 질문"
          onClick={() => {
            const i = TONES.findIndex((t) => t.tone === (block.tone ?? 'warn'));
            controller.setNoteCalloutTone(block.id, TONES[(i + 1) % TONES.length]!.tone);
          }}
          className="btn"
          style={{
            flex: '0 0 auto',
            height: 20,
            marginTop: 2,
            padding: '0 8px',
            borderRadius: 999,
            border: 'none',
            background: 'transparent',
            color: tone.ink,
            fontFamily: 'inherit',
            fontSize: 11,
            fontWeight: 800,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          {tone.name}
        </button>
        <NoteLine
          onFocusLine={focusBox}
          lineKey={block.id}
          runs={block.runs}
          readOnly={readOnly}
          placeholder="알려 둘 것"
          autoFocus={freshId === block.id}
          onChange={(runs) => controller.setNoteBlockRuns(block.id, runs)}
          onEnter={enterBlock}
          onBackspaceAtStart={backBlock}
          style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.75, color: 'var(--mf-text)' }}
        />
      </div>
    );
  }

  if (block.kind === 'toggle') {
    const open = block.open ?? true;
    return (
      <div data-note-block={block.id} data-note-kind="toggle" onMouseUp={rememberBox} style={blockFlow(block)}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <button
            type="button"
            data-note-toggle={open ? 'open' : 'closed'}
            aria-expanded={open}
            aria-label={open ? '접기' : '펼치기'}
            onClick={() => controller.toggleNoteOpen(block.id)}
            className="btn"
            style={{ flex: '0 0 auto', width: 18, height: 24, border: 'none', background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .14s ease' }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
          <NoteLine
            onFocusLine={focusBox}
            lineKey={block.id}
            runs={block.runs}
            readOnly={readOnly}
            placeholder="접어 둘 제목"
            autoFocus={freshId === block.id}
            onChange={(runs) => controller.setNoteBlockRuns(block.id, runs)}
            onEnter={enterBlock}
            onBackspaceAtStart={backBlock}
            style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 700, lineHeight: 1.8, color: 'var(--mf-text)' }}
          />
        </div>
        {/* 접힌 토글의 **안쪽 내용은 다음 블록들**이 아니라 이 한 줄이다(이번 판).
            구조를 중첩으로 들면 모델이 트리가 되고, 그러면 순서·이동·삭제가 전부
            달라진다 — 접는 쓰임의 대부분은 "긴 설명을 감춰 두기"라 한 줄로 충분하다. */}
        {open && (
          <div style={{ paddingLeft: 24, paddingTop: 2 }}>
            <NoteLine
              onFocusLine={focusBox}
              lineKey={`${block.id}:body`}
              runs={block.items?.[0]?.runs}
              readOnly={readOnly}
              placeholder="펼쳤을 때 보일 내용"
              onChange={(runs) => {
                const itemId = block.items?.[0]?.id;
                if (itemId) controller.setNoteItemRuns(block.id, itemId, runs);
                else controller.addNoteItem(block.id);
              }}
              style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--mf-subtext)' }}
            />
          </div>
        )}
      </div>
    );
  }

  if (shape === 'items') {
    return (
      <div data-note-block={block.id} data-note-kind={block.kind} style={{ ...blockFlow(block), display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(block.items ?? []).map((item, j) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {block.kind === 'ck' ? (
              <button
                type="button"
                data-note-check={item.id}
                role="checkbox"
                aria-checked={!!item.done}
                aria-label="완료 표시"
                disabled={readOnly}
                onClick={() => controller.toggleNoteCheck(block.id, item.id)}
                className="btn"
                style={{
                  width: 17,
                  height: 17,
                  marginTop: 5,
                  flex: '0 0 auto',
                  borderRadius: 5,
                  border: `1.5px solid ${item.done ? 'var(--mf-accent)' : 'var(--mf-border)'}`,
                  background: item.done ? 'var(--mf-accent)' : 'transparent',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: readOnly ? 'default' : 'pointer',
                  padding: 0,
                }}
              >
                {item.done && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                )}
              </button>
            ) : (
              <span aria-hidden="true" style={{ flex: '0 0 auto', width: 18, marginTop: 3, textAlign: 'right', fontSize: 13, color: 'var(--mf-faint)', fontFamily: block.kind === 'ol' ? 'ui-monospace, monospace' : undefined }}>
                {block.kind === 'ol' ? `${j + 1}.` : '•'}
              </span>
            )}
            <NoteLine
              onFocusLine={focusBox}
              lineKey={`${block.id}:${item.id}`}
              runs={item.runs}
              readOnly={readOnly}
              placeholder={j === 0 ? '항목' : ''}
              autoFocus={freshId === item.id}
              onChange={(runs) => controller.setNoteItemRuns(block.id, item.id, runs)}
              onEnter={() => {
                if (readOnly) return false;
                // 빈 항목에서 엔터 = 목록을 **끝낸다**(문단으로 빠져나온다) —
                // 문서 편집기의 몸에 익은 동작이고, 없으면 빈 항목이 쌓인다.
                if (runsText(item.runs) === '' && (block.items ?? []).length > 1) {
                  controller.removeNoteItem(block.id, item.id);
                  setFreshId(controller.addNoteBlock('p', block.id));
                  return true;
                }
                setFreshId(controller.addNoteItem(block.id, item.id));
                return true;
              }}
              onBackspaceAtStart={() => {
                if (readOnly) return false;
                if (runsText(item.runs) !== '') return false;
                if ((block.items ?? []).length > 1) {
                  controller.removeNoteItem(block.id, item.id);
                  return true;
                }
                controller.retypeNoteBlock(block.id, 'p');
                return true;
              }}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14.5,
                lineHeight: 1.75,
                color: 'var(--mf-text)',
                textDecoration: block.kind === 'ck' && item.done ? 'line-through' : undefined,
                opacity: block.kind === 'ck' && item.done ? 0.55 : 1,
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (shape === 'table') {
    const rows = block.rows ?? [];
    return (
      <div className="mf-note-table" data-note-block={block.id} data-note-kind="table" style={blockFlow(block)}>
        <div style={{ overflowX: 'auto', border: '1px solid var(--mf-border-soft)', borderRadius: 13 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    const head = ri === 0;
                    return (
                      <td
                        key={ci}
                        style={{
                          border: '1px solid var(--mf-border-soft)',
                          padding: '7px 10px',
                          verticalAlign: 'top',
                          background: head ? 'var(--mf-panel2)' : 'transparent',
                          fontWeight: head ? 700 : 400,
                          minWidth: 90,
                        }}
                      >
                        <NoteLine
                          onFocusLine={focusBox}
                          lineKey={`${block.id}:r${ri}c${ci}`}
                          runs={cell}
                          readOnly={readOnly}
                          placeholder={head ? '머리' : ''}
                          onChange={(runs) => controller.setNoteCell(block.id, ri, ci, runs)}
                          style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--mf-text)' }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 행·열 추가는 **표에 마우스를 얹었을 때만** 뜬다(`editor.css`) — 디자인의
            표는 종이에 그린 표처럼 보여야 하고, 늘 붙어 있는 버튼 둘이 그 인상을 깬다. */}
        {!readOnly && (
          <div className="mf-note-tableact" style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" data-note-table-row className="btn" onClick={() => controller.addNoteTableRow(block.id)} style={GHOST_BTN}>
              행 추가
            </button>
            <button type="button" data-note-table-col className="btn" onClick={() => controller.addNoteTableCol(block.id)} style={GHOST_BTN}>
              열 추가
            </button>
          </div>
        )}
      </div>
    );
  }

  // 글 한 덩이(문단·제목·인용·코드) — 종류가 겉모습만 정한다.
  const style = runStyleOf(block.kind);
  const heading = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3';
  const line = (
    <NoteLine
      onFocusLine={focusBox}
      lineKey={block.id}
      runs={block.runs}
      readOnly={readOnly}
      placeholder={index === 0 ? '여기에 글을 쓰세요 — / 로 블록 넣기' : ''}
      autoFocus={freshId === block.id}
      onChange={(runs) => controller.setNoteBlockRuns(block.id, runs)}
      onEnter={enterBlock}
      onBackspaceAtStart={backBlock}
      onSlash={() => {
        if (readOnly) return false;
        openSlash(block.id);
        return true;
      }}
      style={heading ? { ...style, flex: 1, minWidth: 0 } : style}
    />
  );
  return (
    <div
      data-note-block={block.id}
      data-note-kind={block.kind}
      onMouseUp={rememberBox}
      style={{
        ...blockFlow(block),
        ...(heading ? { display: 'flex', alignItems: 'center', gap: 9 } : {}),
        ...(block.kind === 'q' ? { padding: '14px 16px', borderRadius: 13, background: 'var(--mf-panel2)', borderLeft: '3px solid var(--mf-accent-mute)' } : {}),
        ...(block.kind === 'code' ? { background: 'var(--mf-panel2)', border: '1px solid var(--mf-border-soft)', borderRadius: 13, padding: '13px 15px' } : {}),
      }}
    >
      {/* 제목의 왼쪽 강조 바 — 디자인 원본. 굵기만으로 가른 제목은 긴 글에서 본문과
          섞여 보인다(스크롤하며 훑을 때 눈이 걸릴 자리가 없다). */}
      {heading && <span aria-hidden="true" style={{ width: 3, height: block.kind === 'h1' ? 21 : 17, flex: '0 0 auto', borderRadius: 999, background: noteCoverColor(controller.doc.cover), display: 'block' }} />}
      {line}
    </div>
  );
}

/**
 * 블록의 **흐름 속성** — 가로 정렬과 들여쓰기. 모델에는 처음부터 있던 칸인데
 * (`NoteBlock.align`·`indent`) 그릴 곳이 없어 화면에 나타나지 않았다. 툴바에 버튼이
 * 생기면서 이제 둘 다 보인다. 들여쓰기 한 단은 24px(체크·목록의 글머리 너비와 같다).
 */
function blockFlow(block: NoteBlock): CSSProperties {
  return {
    ...(block.align && block.align !== 'left' ? { textAlign: block.align } : {}),
    ...(block.indent ? { paddingLeft: block.indent * 24 } : {}),
  };
}

/**
 * 이미지 블록 — 파일을 올리면 본문에는 **참조만** 남는다(플로트 이미지와 같은 길:
 * `attachImageFile` → 저장소 업로드 → `mfimg:…`). 저장소가 없으면 데이터 URL로
 * 물러서고, 그때는 문서가 무거워지므로 `noteIfInlined`가 이미 경고를 켠다.
 */
function ImageBlock({ controller, block }: { controller: EditorController; block: NoteBlock }) {
  const readOnly = controller.readOnly;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const url = block.src ? (controller.imageUrls[block.src] ?? (block.src.startsWith('data:') ? block.src : '')) : '';
  return (
    <div data-note-block={block.id} data-note-kind="img" style={{ padding: '8px 0' }}>
      {url ? (
        <img
          src={url}
          alt=""
          data-note-image
          style={{ display: 'block', maxWidth: '100%', borderRadius: 10, border: '1px solid var(--mf-border-soft)' }}
        />
      ) : (
        <button
          type="button"
          data-note-image-pick
          disabled={readOnly}
          onClick={() => inputRef.current?.click()}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 96,
            borderRadius: 10,
            border: '1.5px dashed var(--mf-border)',
            background: 'transparent',
            color: 'var(--mf-muted)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m5 17 4.5-4.5L14 17l3-3 3 3" />
          </svg>
          {block.src ? '이미지를 불러오는 중…' : '이미지 올리기'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // 같은 파일을 다시 골라도 change가 오게
          if (file) void controller.setNoteImage(block.id, file);
        }}
      />
    </div>
  );
}

/**
 * 문서 링크 블록 — 이 앱의 **다른 문서**를 본문에 꽂는다(디자인의 `보드 링크`).
 *
 * 주소를 적는 것이 아니라 **문서를 고른다**: 제목이 바뀌어도 링크가 살아 있고,
 * 무엇보다 여기서 고를 수 있는 것이 곧 "내가 볼 수 있는 문서"라 끊어진 링크가
 * 생기지 않는다.
 */
function LinkBlock({ controller, block }: { controller: EditorController; block: NoteBlock }) {
  const [open, setOpen] = useState(false);
  const readOnly = controller.readOnly;
  const targets = controller.linkTargets;
  const target = targets.find((t) => t.docId === block.docId) ?? null;
  return (
    <div className="mf-note-link" data-note-block={block.id} data-note-kind="link" style={{ ...blockFlow(block), position: 'relative' }}>
      {target ? (
        /* 디자인의 링크 카드 — 종류 타일 · 이름 · `종류 · 스페이스` · 열기 표시.
           예전에는 점 하나 + `문서` 한 낱말이라 무엇으로 가는 링크인지 알 수 없었다. */
        <a
          href={target.href}
          data-note-link={target.docId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '11px 13px',
            borderRadius: 13,
            border: '1px solid var(--mf-border-soft)',
            background: 'var(--mf-card)',
            color: 'inherit',
            textDecoration: 'none',
            minWidth: 0,
          }}
        >
          <span aria-hidden="true" style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, background: `color-mix(in srgb, ${target.color} 16%, var(--mf-card))`, color: target.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7" />
              <path d="M9 9h7M9 13h7M9 17h4" />
            </svg>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.title}</span>
            <span style={{ fontSize: 11, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {target.kindName}
              {target.spaceName ? ` · ${target.spaceName}` : ''}
            </span>
          </span>
          {!readOnly && (
            <button type="button" className="btn mf-note-linkact" onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }} style={{ ...GHOST_BTN, height: 22, flex: '0 0 auto' }}>
              바꾸기
            </button>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
            <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      ) : (
        <button
          type="button"
          data-note-link-pick
          disabled={readOnly}
          onClick={() => setOpen((v) => !v)}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 52,
            borderRadius: 10,
            border: '1.5px dashed var(--mf-border)',
            background: 'transparent',
            color: 'var(--mf-muted)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          문서 고르기
        </button>
      )}
      {open && !readOnly && (
        <div
          data-note-link-menu
          className="lnb-scroll"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 30,
            maxHeight: 260,
            overflowY: 'auto',
            padding: 6,
            borderRadius: 12,
            background: 'var(--mf-card)',
            border: '1px solid var(--mf-border)',
            boxShadow: '0 20px 40px -22px rgba(46,42,38,.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {targets.length === 0 && <div style={{ padding: '10px 9px', fontSize: 11.5, color: 'var(--mf-faint)' }}>연결할 문서가 아직 없어요.</div>}
          {targets.map((t) => (
            <button
              key={t.docId}
              type="button"
              data-note-link-option={t.docId}
              className="btn"
              onClick={() => {
                controller.setNoteLinkDoc(block.id, t.docId);
                setOpen(false);
              }}
              style={MENU_ITEM}
            >
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: t.color, flex: '0 0 auto' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              <span style={{ fontSize: 10.5, color: 'var(--mf-faint)' }}>{t.kindName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * `/` 커맨드 목록 — 지금 블록의 **종류를 바꾼다**(새 블록을 만들지 않는다).
 *
 * 빈 블록에서만 열리므로 "이 줄을 무엇으로 만들까"가 곧 요청이고, 새로 만들면
 * 빈 줄이 하나 남는다. 좁혀 찾을 수 있게 입력칸을 함께 둔다(블록이 열다섯이다).
 */
function SlashMenu({
  query,
  onQuery,
  onPick,
  onClose,
}: {
  query: string;
  onQuery: (v: string) => void;
  onPick: (kind: NoteBlockKind) => void;
  onClose: () => void;
}) {
  const q = query.trim().toLowerCase();
  const hits = BLOCK_TYPES.filter((t) => !q || `${t.name}${t.hint}`.toLowerCase().includes(q));
  return (
    <div data-note-slash style={{ position: 'relative' }}>
      <div
        className="lnb-scroll"
        style={{
          position: 'absolute',
          top: 4,
          left: 0,
          zIndex: 40,
          width: 264,
          maxHeight: 320,
          overflowY: 'auto',
          padding: 6,
          borderRadius: 12,
          background: 'var(--mf-card)',
          border: '1px solid var(--mf-border)',
          boxShadow: '0 22px 44px -22px rgba(46,42,38,.55)',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <input
          data-note-slash-input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) {
              e.preventDefault();
              onPick(hits[0].kind);
            }
            if (e.key === 'Escape') onClose();
          }}
          placeholder="블록 찾기"
          aria-label="블록 찾기"
          style={{
            height: 30,
            margin: '0 0 4px',
            padding: '0 9px',
            borderRadius: 8,
            border: '1px solid var(--mf-border)',
            background: 'var(--mf-panel2)',
            color: 'var(--mf-text)',
            fontFamily: 'inherit',
            fontSize: 12,
            outline: 'none',
          }}
        />
        {hits.length === 0 && <div style={{ padding: '10px 9px', fontSize: 11.5, color: 'var(--mf-faint)' }}>맞는 블록이 없어요.</div>}
        {hits.map((t) => (
          <button
            key={t.kind}
            type="button"
            data-note-slash-item={t.kind}
            className="btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(t.kind)}
            style={{ ...MENU_ITEM, flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}
          >
            <span style={{ fontWeight: 700 }}>{t.name}</span>
            <span style={{ fontSize: 10.5, color: 'var(--mf-faint)' }}>{t.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 종류별 글자 모양 — 제목 셋이 크기·굵기로 갈리고 코드는 고정폭이다. */
function runStyleOf(kind: NoteBlockKind): CSSProperties {
  switch (kind) {
    case 'h1':
      return { fontSize: 23, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.45, marginTop: 14 };
    case 'h2':
      return { fontSize: 18.5, fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.5, marginTop: 12 };
    case 'h3':
      return { fontSize: 15.5, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.55, marginTop: 8 };
    case 'q':
      return { fontSize: 14, lineHeight: 1.8, color: 'var(--mf-subtext)', fontStyle: 'italic' };
    case 'code':
      return { fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12.5, lineHeight: 1.7, color: 'var(--mf-text)' };
    default:
      return { fontSize: 14.5, lineHeight: 1.85, color: 'var(--mf-text)' };
  }
}

/**
 * 편집 박스의 키(`data-note-line`)로 **어디에 커밋할지** 정한다.
 *
 * 키는 셋 중 하나다: `<블록id>` · `<블록id>:<항목id>` · `<블록id>:r<행>c<칸>`.
 * 툴바가 블록 구조를 다시 알아내지 않아도 되게, 그린 쪽이 자기 주소를 실어 둔다.
 */
function commitLine(controller: EditorController, key: string, runs: RichRun[]): void {
  if (!key) return;
  const [blockId, rest] = key.split(':');
  if (!blockId) return;
  if (!rest) {
    controller.setNoteBlockRuns(blockId, runs);
    return;
  }
  const cell = /^r(\d+)c(\d+)$/.exec(rest);
  if (cell) {
    controller.setNoteCell(blockId, Number(cell[1]), Number(cell[2]), runs);
    return;
  }
  controller.setNoteItemRuns(blockId, rest, runs);
}

/** 편집 박스 키에서 블록 id만. */
function blockIdOf(key: string): string {
  return key.split(':')[0] ?? '';
}

const TOOL_BTN: CSSProperties = {
  height: 28,
  width: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid var(--mf-border)',
  background: 'var(--mf-card)',
  color: 'var(--mf-subtext)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  cursor: 'pointer',
  padding: 0,
};

const GHOST_BTN: CSSProperties = {
  height: 26,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--mf-border)',
  background: 'transparent',
  color: 'var(--mf-subtext)',
  fontFamily: 'inherit',
  fontSize: 11.5,
  fontWeight: 700,
  cursor: 'pointer',
};

const MENU_ITEM: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  height: 'auto',
  minHeight: 30,
  padding: '6px 9px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--mf-text)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  textAlign: 'left',
  cursor: 'pointer',
  width: '100%',
};

const SWATCH_POP: CSSProperties = {
  position: 'absolute',
  top: 32,
  left: 0,
  zIndex: 30,
  display: 'flex',
  gap: 5,
  padding: 7,
  borderRadius: 10,
  background: 'var(--mf-card)',
  border: '1px solid var(--mf-border)',
  boxShadow: '0 18px 36px -20px rgba(46,42,38,.5)',
};

const SWATCH: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 5,
  border: '1px solid var(--mf-border)',
  cursor: 'pointer',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
