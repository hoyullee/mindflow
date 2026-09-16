// 공책 에디터 — 캔버스가 아니라 **페이지의 글**.
//
// 화면은 둘로 갈린다(디자인 원본):
//   왼쪽  페이지 목록 — 이 공책의 페이지들. 제목 + 첫 줄 + 태그.
//   가운데 페이지 본문 — 제목 한 줄 + 블록들. 위에 서식 툴바가 붙는다.
//
// 팬·줌·미니맵·그리기·레이아웃이 없다(에디터가 `isNote`로 그 UI를 통째로 걷어낸다).
// 대신 다루는 것이 순서와 글이고, 규칙은 전부 코어 `note.ts`에 있다.

import { useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { NoteBlock, NoteBlockKind, NotePage, RichRun } from '@mindflow/mindmap-core';
import {
  NOTE_COVERS,
  NOTE_HIGHLIGHTS,
  NOTE_TAGS,
  noteBlockShape,
  noteCoverColor,
  noteHighlightColor,
  noteTagColor,
  pageExcerpt,
  runsText,
} from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import type { Theme } from '../theme';
import { applyNoteFormat, noteEditBoxInSelection } from '../noteRichDom';
import { NoteLine } from './NoteLine';
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
  { kind: 'hr', name: '구분선', hint: '섹션 나누기' },
];

/** 인라인 서식 — 코어 `applyPartialStyle`의 종류와 1:1. */
const MARKS: { kind: 'b' | 'i' | 's' | 'u' | 'k'; label: string; name: string; css: CSSProperties }[] = [
  { kind: 'b', label: 'B', name: '굵게', css: { fontWeight: 800 } },
  { kind: 'i', label: 'I', name: '기울임', css: { fontStyle: 'italic' } },
  { kind: 's', label: 'S', name: '취소선', css: { textDecoration: 'line-through' } },
  { kind: 'u', label: 'U', name: '밑줄', css: { textDecoration: 'underline' } },
  { kind: 'k', label: '<>', name: '인라인 코드', css: { fontFamily: 'ui-monospace, monospace', fontSize: 11 } },
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

  if (!page) return null;

  return (
    <div
      data-note-editor
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', background: theme.canvasBg, overflow: 'hidden' }}
    >
      <PageList controller={controller} />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!readOnly && <FormatToolbar controller={controller} boxRef={boxRef} rememberBox={rememberBox} />}
        <div className="lnb-scroll" data-note-page style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '30px 0 120px' }}>
          <div style={{ width: 720, maxWidth: 'calc(100% - 48px)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
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
              />
            ))}
            {/* 본문 아래의 빈 자리 — 누르면 마지막에 문단을 더한다. 글 끝에서 아래를
                눌러 이어 쓰는 것이 문서 편집기의 몸에 익은 동작이다. */}
            {!readOnly && (
              <button
                type="button"
                data-note-append
                onClick={() => setFreshId(controller.addNoteBlock('p'))}
                className="btn"
                style={{ height: 120, border: 'none', background: 'transparent', cursor: 'text', display: 'block', width: '100%' }}
                aria-label="문단 추가"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 페이지 목록 ───────────────────────────────────────────────────────────── */

function PageList({ controller }: { controller: EditorController }) {
  const pages = controller.notePages;
  const curId = controller.notePage?.id ?? null;
  const cover = noteCoverColor(controller.doc.cover);
  return (
    <aside
      data-note-pages
      className="lnb-scroll"
      style={{
        width: 268,
        flex: '0 0 auto',
        borderRight: '1px solid var(--mf-border-soft)',
        background: 'var(--mf-panel)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '14px 10px 24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 10px' }}>
        <span aria-hidden="true" style={{ width: 4, height: 16, borderRadius: 2, background: cover, flex: '0 0 auto' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-subtext)', flex: 1 }}>페이지</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--mf-faint)' }}>{pages.length}</span>
      </div>

      {pages.map((pg, i) => (
        <PageRow key={pg.id} controller={controller} page={pg} index={i} active={pg.id === curId} />
      ))}

      {!controller.readOnly && (
        <button
          type="button"
          data-note-new-page
          onClick={() => controller.addNotePage()}
          className="btn"
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            height: 34,
            padding: '0 10px',
            borderRadius: 10,
            border: '1px dashed var(--mf-border)',
            background: 'transparent',
            color: 'var(--mf-subtext)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          새 페이지
        </button>
      )}
    </aside>
  );
}

function PageRow({ controller, page, index, active }: { controller: EditorController; page: NotePage; index: number; active: boolean }) {
  const excerpt = pageExcerpt(page, 60);
  const tag = page.tag ?? null;
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
        flexDirection: 'column',
        gap: 3,
        padding: '9px 10px',
        borderRadius: 10,
        background: active ? 'var(--mf-accent-soft)' : 'transparent',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'var(--mf-faint)', flex: '0 0 auto' }}>{index + 1}</span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: active ? 800 : 600,
            letterSpacing: '-.01em',
            color: 'var(--mf-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
        >
          {page.title.trim() || '제목 없는 페이지'}
        </span>
        {tag && (
          <span
            data-note-page-tag
            style={{
              flex: '0 0 auto',
              height: 16,
              padding: '0 6px',
              borderRadius: 999,
              background: `color-mix(in srgb, ${noteTagColor(tag)} 20%, transparent)`,
              color: `color-mix(in srgb, ${noteTagColor(tag)} 78%, var(--mf-text))`,
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {tag}
          </span>
        )}
      </div>
      {excerpt && (
        <div style={{ fontSize: 11, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 18 }}>{excerpt}</div>
      )}
      {page.updatedAt && (
        <div style={{ fontSize: 10, color: 'var(--mf-faint2)', paddingLeft: 18 }}>{formatLastEdited(page.updatedAt)}</div>
      )}
    </div>
  );
}

/* ── 페이지 머리(제목·태그·페이지 조작) ───────────────────────────────────── */

function PageHead({ controller, page }: { controller: EditorController; page: NotePage }) {
  const [tagOpen, setTagOpen] = useState(false);
  const readOnly = controller.readOnly;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
      <input
        data-note-title
        value={page.title}
        readOnly={readOnly}
        placeholder="제목 없는 페이지"
        onChange={(e) => controller.setNotePageTitle(page.id, e.target.value)}
        style={{
          border: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: '-.035em',
          color: 'var(--mf-text)',
          outline: 'none',
          padding: 0,
          width: '100%',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
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
        <span style={{ flex: 1 }} />
        {!readOnly && (
          <>
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
          </>
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
}: {
  controller: EditorController;
  boxRef: { current: HTMLElement | null };
  rememberBox: () => void;
}) {
  const [open, setOpen] = useState<'hl' | 'ink' | null>(null);

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
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      <button type="button" data-note-clear className="btn" title="서식 지우기" onMouseDown={stop} onClick={() => apply('clear')} style={{ ...TOOL_BTN, width: 'auto', padding: '0 9px', fontSize: 11.5 }}>
        서식 지우기
      </button>
      <span style={{ flex: 1 }} />
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
}

function BlockView({ controller, block, index, freshId, setFreshId, rememberBox, focusBox }: BlockProps) {
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
      <div data-note-block={block.id} data-note-kind={block.kind} style={{ padding: '14px 0' }}>
        <hr style={{ border: 'none', borderTop: '1px solid var(--mf-border)', margin: 0 }} />
      </div>
    );
  }

  if (shape === 'items') {
    return (
      <div data-note-block={block.id} data-note-kind={block.kind} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
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
      <div data-note-block={block.id} data-note-kind="table" style={{ padding: '10px 0' }}>
        <div style={{ overflowX: 'auto', border: '1px solid var(--mf-border-soft)', borderRadius: 10 }}>
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
        {!readOnly && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
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
  return (
    <div
      data-note-block={block.id}
      data-note-kind={block.kind}
      onMouseUp={rememberBox}
      style={{
        padding: block.kind === 'q' || block.kind === 'code' ? '4px 0' : '1px 0',
        ...(block.kind === 'q' ? { borderLeft: '3px solid var(--mf-accent-mute)', paddingLeft: 14 } : {}),
        ...(block.kind === 'code' ? { background: 'var(--mf-panel2)', border: '1px solid var(--mf-border-soft)', borderRadius: 8, padding: '10px 12px' } : {}),
      }}
    >
      <NoteLine
        onFocusLine={focusBox}
        lineKey={block.id}
        runs={block.runs}
        readOnly={readOnly}
        placeholder={index === 0 ? '여기에 글을 쓰세요' : ''}
        autoFocus={freshId === block.id}
        onChange={(runs) => controller.setNoteBlockRuns(block.id, runs)}
        onEnter={enterBlock}
        onBackspaceAtStart={backBlock}
        style={style}
      />
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
