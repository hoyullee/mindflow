import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import type { Float, RichRun } from '@mindflow/mindmap-core';
import { listDisplayLine } from '@mindflow/mindmap-core';
import { ListTextBlock, domMarkerSignature, listSigOf, listSignature, markerSignature, nodeContentLines, plainContentLines, renderListEdit } from '../listLines';
import { hexA } from '../theme';
import { isPanButton } from '../pointerButtons';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import { peersSelecting } from '../presenceSelection';
import { useIsTouchDevice } from '../../../hooks/useMediaQuery';
import { RemotePeerTag } from './RemotePeerTag';
import { ResizeHandle } from './ResizeHandle';
import { domToRuns, linearize, listArrowLeft, listArrowVertical, selectedRawText, snapCaretOffListMarker } from '../richtextDom';
import { isLinkOpenModifier, linkInk, openLink } from '../richSpans';
import { insertLineBreak, listBackspaceOpAt, maybeContinueList } from './NodeLayer';

interface FloatLayerProps {
  floats: Float[];
  theme: Theme;
  controller: EditorController;
}

/**
 * Free-floating memo cards — port of `Component#renderFloats`
 * (MindFlow.dc.html:1441-1510): selection ring, drag-to-move, resize handle,
 * fold/unfold toggle, and double-click/F2 text editing are wired (Editor-b).
 */
export function FloatLayer({ floats, theme: th, controller }: FloatLayerProps) {
  if (!floats.length) return null;
  return (
    <>
      {floats.map((f) => {
        // port of `MSEL.floats.includes(f.id)` — a marquee multi-selection rings every target.
        const selected = controller.multiGroups.floats.includes(f.id);
        const editing = controller.editingFloatId === f.id;
        const collapsed = !!f.collapsed;
        const fFpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
        // presence: a remote peer's selection ring (see `NodeLayer`'s identical pattern).
        const remotePeer = peersSelecting(controller.presence.peers, 'floats', f.id)[0];
        let boxShadow = selected ? `0 0 0 2px ${th.panel}, 0 0 0 4px ${hexA(th.accent, 0.55)}, 0 3px 10px rgba(0,0,0,.10)` : '0 3px 10px rgba(0,0,0,.10)';
        if (remotePeer) boxShadow += `, 0 0 0 3px ${hexA(remotePeer.user.color, 0.9)}`;
        // 검색 일치 링 — 노드와 같은 앰버(NodeLayer 참고).
        if (controller.searchMarks?.floats.has(f.id)) boxShadow += `, 0 0 0 3px ${hexA('#e0b23c', 0.9)}`;
        const boxStyle: CSSProperties = {
          position: 'absolute',
          left: f.x,
          top: f.y,
          width: f.w,
          minHeight: f.h || 44,
          background: f.bg ? f.bg : th.appBg === '#191512' ? '#3a2f22' : '#fff6cf',
          color: f.textColor || th.text,
          border: `1px solid ${f.bg ? hexA('#000000', 0.14) : th.appBg === '#191512' ? '#5a4a2f' : '#f0e3a0'}`,
          borderRadius: 8,
          padding: '9px 11px 9px 32px',
          fontFamily: 'Pretendard, sans-serif',
          fontSize: fFpx,
          fontWeight: f.bold ? 700 : 400,
          lineHeight: 1.55,
          boxShadow,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          boxSizing: 'border-box',
          zIndex: selected || editing ? 20 : 10,
          userSelect: 'none',
          cursor: 'grab',
        };
        if (collapsed && !editing) {
          boxStyle.minHeight = 38;
          boxStyle.whiteSpace = 'nowrap';
        }
        // 이미지 플로트: 메모 카드가 아니라 이미지 자체가 박스를 채운다 —
        // 패딩/메모 배경/접기 토글/텍스트 편집 전부 미적용 (Float.img 참고).
        const isImage = !!f.img;
        if (isImage) {
          boxStyle.padding = 0;
          boxStyle.background = th.panel;
          boxStyle.minHeight = undefined;
          boxStyle.height = f.h || Math.round(f.w * 0.75);
          boxStyle.overflow = 'hidden';
        }
        // 접힌 메모의 한 줄 표시도 리스트 글리프(`- `→단계 글리프)를 치환해 펼친 모습과 일치.
        const shown = collapsed ? listDisplayLine(String(f.text || '').split('\n')[0] || '') : f.text;
        // 링크 글자색 — 노드와 같은 규칙(글자색 밝기 기반, `richSpans.linkInk`).
        (boxStyle as Record<string, unknown>)['--mf-link'] = linkInk((boxStyle.color as string) || null);
        // rich(부분 서식)가 있으면 노드와 같은 줄 단위 rich 렌더(리스트 포함),
        // 평문 리스트는 기존 경로, 그 외 평문은 기존 단일 div — 무회귀 우선.
        const richLines = !collapsed && !editing && f.rich && f.rich.length ? nodeContentLines({ text: f.text, rich: f.rich }) : null;
        const floatLines = !richLines && !collapsed && !editing && f.text ? plainContentLines(f.text) : null;
        const hasList = !!floatLines && floatLines.some((l) => l.list);
        return (
          <div
            key={f.id}
            data-float-id={f.id}
            style={boxStyle}
            onPointerDown={(e) => controller.beginFloatDrag(e, f.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              controller.startEditFloat(f.id);
            }}
          >
            {!isImage && (() => {
              // 접기/펼치기 토글 — 예전 코럴 원의 ＋/−는 "추가/삭제"로 읽혔다(제보:
              // 직관적인 아이콘으로). 표준 디스클로저 관례인 **회전 셰브론**으로:
              // 펼침=아래(내용이 아래로 이어짐), 접힘=오른쪽(더 있음). 색은 메모의
              // 글자색에서 따와(커스텀 배경/다크 카드에서도 톤이 맞는다) 은은한
              // 칩으로 두고, 호버에서만 또렷해진다(editor.css `.mf-float-fold`).
              const ink = f.textColor || th.text;
              return (
                <div
                  className="mf-float-fold"
                  role="button"
                  aria-label={collapsed ? '메모 펼치기' : '메모 접기'}
                  aria-expanded={!collapsed}
                  data-fold-toggle
                  title={collapsed ? '펼치기' : '접기'}
                  onPointerDown={(e) => {
                    if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동
                    e.stopPropagation();
                    controller.toggleFloatCollapse(f.id);
                  }}
                  style={{
                    position: 'absolute',
                    left: 5,
                    top: 7,
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    background: hexA(ink, 0.07),
                    border: `1px solid ${hexA(ink, 0.14)}`,
                    color: ink,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    userSelect: 'none',
                    zIndex: 4,
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                  }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 10 10"
                    aria-hidden="true"
                    style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .16s ease' }}
                  >
                    <path d="M2 3.4 L5 6.4 L8 3.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              );
            })()}
            {remotePeer && !editing && <RemotePeerTag color={remotePeer.user.color} name={remotePeer.user.name} style={{ left: 0, top: -22 }} />}
            {isImage ? (
              <img
                src={f.img}
                alt=""
                draggable={false}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }}
              />
            ) : editing ? (
              <FloatEditBox f={f} controller={controller} />
            ) : richLines ? (
              <div style={{ pointerEvents: 'none', minHeight: 18 }}>
                <ListTextBlock lines={richLines} align="left" lineHeight={1.55} />
              </div>
            ) : hasList && floatLines ? (
              <div style={{ pointerEvents: 'none', minHeight: 18 }}>
                <ListTextBlock lines={floatLines} align="left" lineHeight={1.55} />
              </div>
            ) : (
              <div
                style={{
                  pointerEvents: 'none',
                  minHeight: 18,
                  color: f.text ? 'inherit' : hexA(th.text, 0.4),
                  overflow: collapsed ? 'hidden' : undefined,
                  textOverflow: collapsed ? 'ellipsis' : undefined,
                  whiteSpace: collapsed ? 'nowrap' : undefined,
                }}
              >
                {shown || '메모 입력…'}
              </div>
            )}
            {/* resize handle only for a true single selection (port of `this.state.selFloat`,
                MindFlow.dc.html:1486 — hidden during a marquee multi-selection) */}
            {controller.selection?.kind === 'float' && controller.selection.id === f.id && !editing && (
              <ResizeHandle title="크기 조절" accent={th.accent} panel={th.panel} right={-6} bottom={-6} zIndex={6} onPointerDown={(e) => controller.beginFloatResize(e, f.id)} />
            )}
          </div>
        );
      })}
    </>
  );
}

function FloatEditBox({ f, controller }: { f: Float; controller: EditorController }) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** IME 조합 중 — 캐럿 스냅·재구성 보류(노드 편집과 동일). */
  const composingRef = useRef(false);
  /** 조합 중에 들어온 줄바꿈 의도 — compositionend에서 잇는다(노드 편집과 동일). */
  const pendingBreakRef = useRef(false);
  /** 터치 기기(소프트 키보드)에서는 Enter가 줄바꿈이다 — 노드 편집과 같은 이유. */
  const softKeyboard = useIsTouchDevice();

  /** 편집 값을 리스트 구조까지 반영해 다시 그리고 캐럿을 복원한다(노드 편집과
   * 같은 경로 — 메모는 좌측 정렬 고정, 라이브 크기 갱신은 필요 없다: 편집 박스가
   * 메모 카드 **안**에 있어 내용이 늘면 카드가 자연히 자란다). */
  const render = (el: HTMLDivElement, v: { text: string; rich: RichRun[] | null }, caret: number): void => {
    renderListEdit(el, v, 'left', caret, caret);
  };

  /** 줄바꿈 단일 경로(노드 편집의 `doBreak`와 동일) — 기본 줄바꿈은 행을 쪼갠다. */
  const doBreak = (el: HTMLDivElement): void => {
    if (!maybeContinueList({ preventDefault: () => {} }, el, (v, caret) => render(el, v, caret))) {
      insertLineBreak(el, (v, caret) => render(el, v, caret));
    }
  };

  /** 다음 페인트 직전(rAF) 캐럿 스냅 — 방향키·클릭 기본 동작으로 마커에 떨어진
   * 캐럿이 한 프레임 그려지는 것 방지(노드 편집의 `scheduleSnap`과 동일, 제보). */
  const scheduleSnap = (): void => {
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      if (!composingRef.current && ref.current) snapCaretOffListMarker(ref.current);
    });
  };

  /** 입력 후 줄 구조(마커 생성/삭제·마커 드리프트)가 바뀌었으면 다시 그린다 —
   * `NodeEditBox.syncListStructure`와 같은 규칙. */
  const syncListStructure = (el: HTMLDivElement): void => {
    const v = domToRuns(el, true);
    const drifted = markerSignature(v) !== domMarkerSignature(el);
    if (!drifted && listSignature(v) === listSigOf(el)) return;
    const ws = window.getSelection();
    let caret = v.text.length;
    if (ws && ws.rangeCount) {
      const r = ws.getRangeAt(0);
      caret = linearize(el, [{ container: r.startContainer, offset: r.startOffset }]).pos[0] ?? caret;
    }
    render(el, v, caret);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 시작부터 리스트/서식 모양으로(노드와 동일) — 마커 글자 수가 같아 캐럿은 그대로.
    renderListEdit(el, { text: f.text, rich: f.rich ?? null }, 'left', 0, 0);
    controller.setRichEditorEl(el);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // 서식 툴바 상시 노출 — 노드 편집과 같은 규칙(메모 카드 위에 고정).
    const box = el.closest('[data-float-id]') as HTMLElement | null;
    const vpEl = el.closest('.mf-ed-vp');
    if (box && vpEl && typeof box.getBoundingClientRect === 'function' && typeof vpEl.getBoundingClientRect === 'function') {
      const br = box.getBoundingClientRect();
      const vr = vpEl.getBoundingClientRect();
      controller.openTextCtx(br.left + br.width / 2 - vr.left, br.top - vr.top);
    } else {
      controller.openTextCtx(0, 60); // jsdom 폴백
    }
    // 캐럿이 리스트 마커 구역에 앉지 못하게(노드 편집과 같은 규칙 — 제보:
    // 마커 앞에 캐럿이 서서 친 글자가 마커 앞에 쌓임).
    const onSelChange = (): void => {
      if (!composingRef.current && ref.current) snapCaretOffListMarker(ref.current);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      document.removeEventListener('selectionchange', onSelChange);
      controller.setRichEditorEl(null);
    };
    // Mount-once: 이 박스는 한 편집 세션 동안만 존재한다(NodeEditBox와 동일).
  }, []);

  return (
    <div
      ref={ref}
      className="mf-edit mf-richedit"
      contentEditable
      suppressContentEditableWarning
      // 마우스 캐럿 배치(기본 동작)도 마커 위에 떨어질 수 있다 — 페인트 전 스냅.
      onMouseDown={(e) => {
        e.stopPropagation();
        scheduleSnap();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => {
        e.stopPropagation();
        scheduleSnap();
      }}
      // 편집 중에도 Ctrl/⌘+클릭으로 링크 열기(노드와 동일).
      onClick={(e) => {
        if (!isLinkOpenModifier(e)) return;
        const href = (e.target as HTMLElement | null)?.closest?.('[data-href]')?.getAttribute('data-href');
        if (!href) return;
        e.preventDefault();
        e.stopPropagation();
        openLink(href);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      // 리스트 마커 복사 보존 — 노드 편집과 같은 규칙(마커는 user-select:none이라
      // 기본 복사에서 빠진다).
      onCopy={(e) => {
        const el = ref.current;
        if (!el || !el.querySelector('[data-list-marker]')) return;
        const t = selectedRawText(el);
        if (t == null) return;
        e.preventDefault();
        e.clipboardData.setData('text/plain', t);
      }}
      onInput={(e) => {
        const el = ref.current;
        if (el && !(e.nativeEvent as InputEvent).isComposing) syncListStructure(el);
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        const el = ref.current;
        if (!el) return;
        // 조합 중에 눌린 Shift+Enter — IME 확정 뒤 여기서 잇는다(노드와 동일).
        if (pendingBreakRef.current) {
          pendingBreakRef.current = false;
          doBreak(el);
          return;
        }
        syncListStructure(el);
      }}
      // 기본 줄바꿈 차단 안전망(노드 편집과 동일 — 행을 쪼개 캐럿이 깜빡인다).
      onBeforeInput={(e) => {
        const it = (e.nativeEvent as InputEvent).inputType;
        if (it !== 'insertLineBreak' && it !== 'insertParagraph') return;
        e.preventDefault();
        const el = ref.current;
        if (!el) return;
        if (composingRef.current) pendingBreakRef.current = true;
        else doBreak(el);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const composing = e.nativeEvent.isComposing || e.keyCode === 229;
        // 조합 중 Enter/Shift+Enter — 기본 줄바꿈을 막고 의도는 compositionend에서
        // (노드 편집과 동일: Shift=줄바꿈 잇기, 맨 Enter=IME 확정만).
        if (composing && e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey || softKeyboard) pendingBreakRef.current = true;
          return;
        }
        // 캐럿이 마커 구역이면 입력 전에 내용 시작으로 + ArrowLeft는 마커를 건너
        // 앞 줄 끝으로(노드 편집과 같은 규칙 — selectionchange 스냅의 이중화).
        // 방향키 기본 동작은 이 핸들러 뒤에 실행되므로 rAF 스냅도 예약(페인트 전 교정).
        if (!composing && ref.current) {
          snapCaretOffListMarker(ref.current);
          scheduleSnap();
          const plainKey = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
          if (e.key === 'ArrowLeft' && plainKey && listArrowLeft(ref.current)) {
            e.preventDefault();
            return;
          }
          // ↑/↓ 세로 이동은 우리가 직접 — 크롬 기본이 리스트 행을 못 건넌다(노드와 동일).
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plainKey && listArrowVertical(ref.current, e.key === 'ArrowUp' ? -1 : 1)) {
            e.preventDefault();
            return;
          }
        }
        // Ctrl/Cmd+B·I는 브라우저 기본 토글 대신 툴바와 같은 applyPartial로
        // (노드 편집과 동일 — 기본 토글은 굵은 박스에서 거꾸로 동작한다).
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !composing) {
          const k = e.key.toLowerCase();
          if (k === 'b' || k === 'i') {
            e.preventDefault();
            controller.applyPartial(k);
            return;
          }
          if (k === 'u') {
            e.preventDefault(); // 밑줄은 모델에 없다 — 커밋 때 사라질 서식을 안 보여준다
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          controller.cancelFloatEdit();
          return;
        }
        // 마커 안 Backspace는 마커를 한 덩어리로(노드와 동일).
        if (e.key === 'Backspace' && !composing) {
          const el = ref.current;
          const act = el ? listBackspaceOpAt(el) : null;
          if (act) {
            e.preventDefault();
            if (act.kind === 'op') controller.applyListOp(act.op);
            else controller.applyListEdits(act.edits);
            return;
          }
        }
        // Tab = 들여쓰기 / Shift+Tab = 내어쓰기. 리스트가 아니어도, 조합 중에도
        // 기본 동작은 막는다(포커스 이탈 = blur 커밋으로 편집이 끊긴다).
        if (e.key === 'Tab') {
          e.preventDefault();
          if (composing) return;
          controller.applyListOp({ type: 'indent', dir: e.shiftKey ? -1 : 1 });
          return;
        }
        // Enter = 편집 확정, Shift+Enter = 줄바꿈(리스트 이어쓰기 포함) —
        // 도형(노드) 편집과 동일한 키 규칙(요청). 줄바꿈은 언제나 doBreak 한 경로.
        if (e.key === 'Enter' && !composing && !e.shiftKey && softKeyboard) {
          // 터치 기기: 소프트 키보드의 줄바꿈 키는 줄바꿈이다(편집 유지 — 노드와 동일).
          e.preventDefault();
          if (ref.current) doBreak(ref.current);
        } else if (e.key === 'Enter' && !composing && !e.shiftKey) {
          e.preventDefault();
          controller.commitFloatRichText(f.id, ref.current);
        } else if (e.key === 'Enter' && !composing && e.shiftKey) {
          e.preventDefault();
          if (ref.current) doBreak(ref.current);
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
      // 링크 주소 입력창이 열려 있는 동안엔 커밋하지 않는다(노드와 동일).
      onBlur={() => {
        if (!controller.isBlurCommitPaused()) controller.commitFloatRichText(f.id, ref.current);
      }}
      style={{
        display: 'block',
        width: '100%',
        minHeight: 18,
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        lineHeight: 'inherit',
        outline: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        padding: 0,
        cursor: 'text',
        userSelect: 'text',
      }}
    />
  );
}
