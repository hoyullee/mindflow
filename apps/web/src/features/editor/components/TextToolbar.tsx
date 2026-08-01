import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ListOp } from '@mindflow/mindmap-core';
import { normalizeUrl } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';

/** 팝업 최대 폭 — 두 줄 중 넓은 쪽(색상 10 + 지우기)이 이 안에 들어간다.
 * 화면 오른쪽 끝 clamp도 이 값을 쓴다. */
const TOOLBAR_W = 320;

interface TextToolbarProps {
  controller: EditorController;
}

/**
 * Floating partial-style toolbar — "B" (bold) / color swatches / "지우기"
 * (clear) — port of the `.mf-tctx` template block + `tctxBold`/`tctxColor`/
 * `tctxClear` (MindFlow.dc.html:433-442, 3088-3100).
 *
 * The original opens this via a right-click INSIDE an active text selection
 * (`Component#onCtxMenu`'s `.mf-richedit` branch, MindFlow.dc.html:2777-2785).
 * This port instead opens it directly off a drag-selection in the node editor
 * (`NodeEditBox`'s own `onMouseUp`/`onKeyUp`, via `controller.openTextCtx`) —
 * an explicit, documented deviation: right-click-while-selecting is an
 * awkward two-handed desktop-only gesture (and the original ALSO overloads
 * right-click-drag for canvas panning elsewhere in this port), whereas a
 * plain drag-selection works identically with mouse, trackpad, AND touch.
 * CLAUDE.md's task brief explicitly allows either trigger ("우클릭-inside-
 * selection 분기 (또는 selection change)").
 */
export function TextToolbar({ controller }: TextToolbarProps) {
  // 팝업 전체(크롬 + 스와치 값)를 **고정** `uiTheme`으로 그린다 — 문서 테마를 바꿔도
  // 이 팝업은 변하지 않는다. 예전엔 문서 테마를 그대로 써서 다크/모노로 바꾸면 팝업이
  // 어두워지고 스와치 색까지 달라졌다(제보).
  //
  // 크롬은 이 코드베이스의 관례(메뉴·패널 = `uiTheme`)와 일치한다. 스와치 **값**은
  // 관례상 문서 테마 쪽이었지만(`panel/NodePanel.tsx`의 `ct.palette`), 여기서는
  // "팝업은 항상 같은 색을 제안한다"를 택했다 — 제보자의 요청이고, 테마를 바꿀 때마다
  // 방금 쓴 색이 목록에서 사라지는 편이 더 혼란스럽다.
  // (트레이드오프: 파랑·초록·보라 테마의 테마-맞춤 색은 이 팝업에서 고를 수 없다.
  //  그 색들은 속성 패널의 텍스트 색 스와치에 그대로 남아 있다.)
  const { textCtx, editingNodeId, uiTheme: th, vw } = controller;
  // 링크 입력창 — 열 때 **선택 범위를 잡아 두고**(입력창에 포커스가 가면 편집 박스의
  // Selection이 사라진다) 적용 시 그 범위에 건다.
  const [link, setLink] = useState<{ a: number; b: number; value: string; had: boolean } | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (link) linkInputRef.current?.focus();
  }, [link]);
  // 편집이 끝나면(툴바가 닫히면) 입력창 상태와 blur 잠금을 반드시 푼다.
  useEffect(() => {
    if (textCtx && editingNodeId) return;
    setLink(null);
    controller.pauseBlurCommit(false);
  }, [textCtx, editingNodeId, controller]);

  const openLinkInput = (): void => {
    const r = controller.selectionRange();
    if (!r) return;
    const had = controller.selectionLink();
    controller.pauseBlurCommit(true);
    setLink({ a: r.a, b: r.b, value: had || '', had: !!had });
  };
  const closeLinkInput = (): void => {
    controller.pauseBlurCommit(false);
    setLink(null);
  };
  const commitLink = (): void => {
    if (!link) return;
    const href = normalizeUrl(link.value);
    if (!href) return; // 못 쓰는 주소면 입력창을 열어 둔 채 기다린다(아래 안내 문구)
    controller.pauseBlurCommit(false);
    controller.applyPartialRange(link.a, link.b, 'link', href);
    setLink(null);
  };
  const removeLink = (): void => {
    if (!link) return;
    controller.pauseBlurCommit(false);
    controller.applyPartialRange(link.a, link.b, 'link', null);
    setLink(null);
  };

  // 편집 세션 동안 상시 노출(사용자 결정 — NodeEditBox 마운트에서 열림). 그래서
  // 편집 박스 안 클릭(캐럿 이동·드래그 선택)은 닫지 않는다 — 닫히는 경우는
  // ① 편집 종료(커밋/취소가 textCtx를 지움) ② 다른 메뉴 열림(openCtxAt)
  // ③ 그 외 바깥 mousedown(어차피 blur 커밋으로 편집도 끝난다 — 방어적 유지).
  useEffect(() => {
    if (!textCtx) return;
    function onDown(e: MouseEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && target.closest && (target.closest('.mf-tctx') || target.closest('.mf-richedit'))) return;
      controller.closeTextCtx();
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [textCtx, controller]);

  if (!textCtx || !editingNodeId) return null;

  // port of `textCtxStyle` (MindFlow.dc.html:3089-3092) — clamped so the toolbar never
  // overflows past the right edge of the viewport, and never sits above its top edge.
  //
  // 행은 **명시적인 두 줄**이다(서식·리스트 / 색상·지우기). 예전엔 한 줄 flex에
  // `flexWrap`만 걸어 폭이 넘치면 알아서 접히게 뒀는데, 접히는 지점이 색상 스와치
  // 중간이라 앞 두 개가 리스트 버튼 뒤에 매달렸다(제보). 줄을 직접 나누면 어떤
  // 테마·폭에서도 색상 줄이 항상 새 줄에서 시작한다.
  const style: CSSProperties = {
    position: 'absolute',
    left: Math.max(8, Math.min(textCtx.sx, (vw || 600) - TOOLBAR_W - 8)),
    top: Math.max(8, textCtx.sy - 92),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 7,
    maxWidth: TOOLBAR_W,
    background: th.panel,
    border: `1px solid ${th.border}`,
    borderRadius: 11,
    boxShadow: '0 10px 30px rgba(0,0,0,.16)',
    padding: '7px 9px',
    zIndex: 45,
  };
  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };

  // port of `tctxSwatches`: `[th.text].concat(th.palette)` (MindFlow.dc.html:3097-3100).
  // `th`는 고정 `uiTheme`이므로 이 목록도 문서 테마와 무관하다(위 주석 참고).
  const swatches = [th.text, ...th.palette];

  return (
    <div
      className="mf-tctx"
      style={style}
      // Same trap as `ContextMenu.tsx`'s root: this toolbar is a child of `.mf-ed-vp`
      // (which owns `onBackgroundPointerDown`). A real click's `pointerdown` fires BEFORE
      // any button's `mousedown` here — left unstopped, it would bubble to the viewport
      // and start a background marquee drag whose no-move `pointerup` clears the node's
      // text selection out from under the button that's about to act on it. Stopping
      // `pointerdown` at the root keeps every toolbar interaction off the canvas.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 1행 — 글자 서식과 줄 단위 리스트 */}
      <div style={rowStyle}>
        <button type="button" title="선택 영역 굵게 (**굵게**)" onMouseDown={(e) => applyAndGuard(e, controller, 'b')} style={boldButtonStyle(th)}>
          B
        </button>
        <button type="button" title="선택 영역 기울임 (*기울임*)" onMouseDown={(e) => applyAndGuard(e, controller, 'i')} style={{ ...boldButtonStyle(th), fontStyle: 'italic', fontWeight: 600, fontFamily: 'Georgia, serif' }}>
          I
        </button>
        <button type="button" title="선택 영역 취소선 (~~취소선~~)" onMouseDown={(e) => applyAndGuard(e, controller, 's')} style={{ ...boldButtonStyle(th), fontWeight: 600, textDecoration: 'line-through' }}>
          S
        </button>
        {/* 하이퍼링크 — 주소 입력창을 연다(적용은 아래 3행). */}
        <button
          type="button"
          title="하이퍼링크"
          aria-label="하이퍼링크"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openLinkInput();
          }}
          style={{ ...boldButtonStyle(th), color: link ? th.accent : th.text }}
        >
          <LinkGlyph />
        </button>
        <div style={dividerStyle(th)} />
        {/* 줄 단위 리스트 — 번호/글머리 토글과 들여쓰기/내어쓰기. 규칙은 코어
            `applyListOp`가 단일 소스이고 Tab/Shift+Tab과 같은 경로를 쓴다.
            번호가 글머리보다 앞이다(사용자 선정 순서). */}
        <button type="button" title="번호 매기기" onMouseDown={(e) => listAndGuard(e, controller, { type: 'toggle', kind: 'ol' })} style={{ ...boldButtonStyle(th), fontSize: 11 }}>
          1.
        </button>
        <button type="button" title="글머리 기호" onMouseDown={(e) => listAndGuard(e, controller, { type: 'toggle', kind: 'ul' })} style={boldButtonStyle(th)}>
          •
        </button>
        <button type="button" title="내어쓰기 (Shift+Tab)" onMouseDown={(e) => listAndGuard(e, controller, { type: 'indent', dir: -1 })} style={boldButtonStyle(th)}>
          <IndentGlyph dir={-1} />
        </button>
        <button type="button" title="들여쓰기 (Tab)" onMouseDown={(e) => listAndGuard(e, controller, { type: 'indent', dir: 1 })} style={boldButtonStyle(th)}>
          <IndentGlyph dir={1} />
        </button>
      </div>
      {/* 3행(열렸을 때) — 링크 주소 입력. 편집 박스의 Selection은 이미 잡아 뒀다. */}
      {link && (
        <div style={{ ...rowStyle, width: '100%' }} data-link-row>
          <input
            ref={linkInputRef}
            value={link.value}
            onChange={(e) => setLink({ ...link, value: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitLink();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeLinkInput();
              }
            }}
            placeholder="https://example.com"
            aria-label="링크 주소"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              height: 26,
              padding: '0 8px',
              border: `1px solid ${normalizeUrl(link.value) || !link.value ? th.border : '#d9542f'}`,
              borderRadius: 7,
              background: th.panel,
              color: th.text,
              fontFamily: 'inherit',
              fontSize: 12,
              outline: 'none',
            }}
          />
          <button type="button" title="링크 적용" onMouseDown={(e) => e.preventDefault()} onClick={commitLink} disabled={!normalizeUrl(link.value)} style={{ ...clearButtonStyle(th), color: normalizeUrl(link.value) ? th.text : th.subtext }}>
            적용
          </button>
          {link.had && (
            <button type="button" title="링크 제거" onMouseDown={(e) => e.preventDefault()} onClick={removeLink} style={clearButtonStyle(th)}>
              제거
            </button>
          )}
        </div>
      )}

      {/* 2행 — 텍스트 색상과 서식 지우기 */}
      <div style={rowStyle} data-toolbar-colors>
        {swatches.map((hex) => (
          <button key={hex} type="button" title={hex} onMouseDown={(e) => applyAndGuard(e, controller, 'c', hex)} style={swatchButtonStyle(hex, th)} />
        ))}
        <div style={dividerStyle(th)} />
        <button type="button" title="부분 스타일 지우기" onMouseDown={(e) => applyAndGuard(e, controller, 'clear')} style={clearButtonStyle(th)}>
          지우기
        </button>
      </div>
    </div>
  );
}

/** Every toolbar button shares this `mousedown` handler — port of `tctxBold`/`tctxColor`/
 * `tctxClear`'s shared shape (MindFlow.dc.html:3093-3100): `preventDefault` keeps the
 * `contentEditable` focused (so its Selection survives the click instead of collapsing on
 * blur) — this IS the original's `_tctxHold` role (MindFlow.dc.html:2652-2654), just achieved
 * without a hold flag, since these buttons call `applyPartial` directly rather than going
 * through `execCommand` (the only call path that actually sets `_tctxHold`). `stopPropagation`
 * is redundant with the root's own `onPointerDown` stop above but kept for defense in depth
 * (matches `ContextMenu.tsx`'s per-button belt-and-suspenders convention). */
function applyAndGuard(e: ReactMouseEvent<HTMLButtonElement>, controller: EditorController, kind: 'b' | 'i' | 's' | 'c' | 'clear', val?: string | null): void {
  e.preventDefault();
  e.stopPropagation();
  controller.applyPartial(kind, val ?? null);
}

/** 리스트 버튼도 서식 버튼과 같은 가드(`applyAndGuard` 참고) — `preventDefault`로
 * 편집 박스의 포커스/선택을 지켜야 연산이 그 선택에 적용된다. */
function listAndGuard(e: ReactMouseEvent<HTMLButtonElement>, controller: EditorController, op: ListOp): void {
  e.preventDefault();
  e.stopPropagation();
  controller.applyListOp(op);
}

/** 하이퍼링크 글리프 — 사슬 두 고리. */
function LinkGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block', margin: '0 auto' }}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

/** 들여쓰기/내어쓰기 글리프 — 세 줄과 방향 화살표(텍스트 아이콘보다 뜻이 분명하다). */
function IndentGlyph({ dir }: { dir: 1 | -1 }) {
  return (
    <svg width={14} height={12} viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden style={{ display: 'block', margin: '0 auto' }}>
      <line x1={dir === 1 ? 6 : 1} y1={1} x2={13} y2={1} />
      <line x1={dir === 1 ? 6 : 1} y1={6} x2={13} y2={6} />
      <line x1={dir === 1 ? 6 : 1} y1={11} x2={13} y2={11} />
      {dir === 1 ? <polyline points="1,3 3.5,6 1,9" /> : <polyline points="3.5,3 1,6 3.5,9" />}
    </svg>
  );
}

function dividerStyle(th: EditorController['theme']): CSSProperties {
  return { width: 1, height: 18, background: th.border, flexShrink: 0 };
}

function boldButtonStyle(th: EditorController['theme']): CSSProperties {
  return {
    width: 28,
    height: 26,
    border: `1px solid ${th.border}`,
    borderRadius: 7,
    background: th.panel,
    color: th.text,
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
    flexShrink: 0,
  };
}

function clearButtonStyle(th: EditorController['theme']): CSSProperties {
  return {
    height: 26,
    padding: '0 9px',
    border: `1px solid ${th.border}`,
    borderRadius: 7,
    background: th.panel,
    color: th.subtext,
    fontSize: 11.5,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  };
}

function swatchButtonStyle(hex: string, th: EditorController['theme']): CSSProperties {
  return {
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: hex,
    border: `2px solid ${th.panel}`,
    boxShadow: `0 0 0 1px ${th.border}`,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  };
}
