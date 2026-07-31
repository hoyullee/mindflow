import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import type { Float } from '@mindflow/mindmap-core';
import { applyListOp, continueListMarker, listDisplayLine, shiftOffset } from '@mindflow/mindmap-core';
import { ListTextBlock, plainContentLines } from '../listLines';
import { hexA } from '../theme';
import { isPanButton } from '../pointerButtons';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import { peersSelecting } from '../presenceSelection';
import { RemotePeerTag } from './RemotePeerTag';
import { ResizeHandle } from './ResizeHandle';

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
        // 리스트 마커가 있는 펼친 메모만 줄 단위 렌더(행잉 인덴트) — 없으면 기존 경로.
        const floatLines = !collapsed && !editing && f.text ? plainContentLines(f.text) : null;
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
            {!isImage && (
            <div
              title={collapsed ? '펼치기' : '접기'}
              onPointerDown={(e) => {
                if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동
                e.stopPropagation();
                controller.toggleFloatCollapse(f.id);
              }}
              style={{
                position: 'absolute',
                left: 6,
                top: 6,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: th.accent,
                color: th.accentInk,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                userSelect: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                zIndex: 4,
                cursor: 'pointer',
              }}
            >
              {collapsed ? '＋' : '−'}
            </div>
            )}
            {remotePeer && !editing && <RemotePeerTag color={remotePeer.user.color} name={remotePeer.user.name} style={{ left: 0, top: -22 }} />}
            {isImage ? (
              <img
                src={f.img}
                alt=""
                draggable={false}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }}
              />
            ) : editing ? (
              <FloatEditBox f={f} onCommit={(text) => controller.commitFloatText(f.id, text)} onCancel={controller.cancelFloatEdit} />
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

function FloatEditBox({ f, onCommit, onCancel }: { f: Float; onCommit: (text: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Grow the textarea to fit its content so the editor shows the SAME wrapped
  // height as the committed memo (a plain textarea caps at its rows and scrolls,
  // showing only ~2 lines — the reported mismatch).
  const autoSize = (el: HTMLTextAreaElement | null): void => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    autoSize(el);
    el.focus();
    el.select();
  }, []);
  return (
    <textarea
      ref={ref}
      className="mf-edit"
      rows={1}
      defaultValue={f.text}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => autoSize(e.currentTarget)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
          return;
        }
        // Tab = 들여쓰기 / Shift+Tab = 내어쓰기 (노드 편집과 같은 코어 규칙).
        // 리스트가 아니어도 기본 동작은 막는다 — 포커스가 나가면 blur 커밋으로
        // 편집이 끝나 버린다.
        if (e.key === 'Tab' && !(e.nativeEvent.isComposing || e.keyCode === 229)) {
          e.preventDefault();
          const el = e.currentTarget;
          const a = el.selectionStart ?? 0;
          const b = el.selectionEnd ?? a;
          const edits = applyListOp(el.value, a, b, { type: 'indent', dir: e.shiftKey ? -1 : 1 });
          if (edits.length) {
            let next = el.value;
            [...edits].sort((x, y) => y.at - x.at).forEach((ed) => {
              next = next.slice(0, ed.at) + ed.insert + next.slice(ed.at + ed.remove);
            });
            el.value = next;
            el.selectionStart = shiftOffset(a, edits);
            el.selectionEnd = shiftOffset(b, edits);
            autoSize(el);
          }
          return;
        }
        // 리스트 자동 이어쓰기 — 리스트 줄에서 Enter를 치면 다음 줄에 마커를
        // 이어 넣고, 마커만 남은 빈 줄이면 마커를 지워 리스트를 끝낸다.
        // (textarea라 char-model이 필요 없다 — 값/캐럿을 직접 조작.)
        const composing = e.nativeEvent.isComposing || e.keyCode === 229;
        if (e.key === 'Enter' && !composing) {
          const el = e.currentTarget;
          const caret = el.selectionStart ?? el.value.length;
          const selEnd = el.selectionEnd ?? caret;
          const lineStart = el.value.lastIndexOf('\n', caret - 1) + 1;
          const lineEndIdx = el.value.indexOf('\n', caret);
          const line = el.value.slice(lineStart, lineEndIdx === -1 ? el.value.length : lineEndIdx);
          const cont = continueListMarker(line);
          if (cont) {
            e.preventDefault();
            if ('end' in cont) {
              // 마커만 남은 빈 줄 → 접두를 `replaceWith`로(들여쓴 줄은 한 단계
              // 내어쓰기, 최상위는 제거로 리스트 종료)
              const lineEnd = lineEndIdx === -1 ? el.value.length : lineEndIdx;
              el.value = el.value.slice(0, lineStart) + cont.replaceWith + el.value.slice(lineEnd);
              el.selectionStart = el.selectionEnd = lineStart + cont.replaceWith.length;
            } else {
              const insert = `\n${cont.next}`;
              el.value = el.value.slice(0, caret) + insert + el.value.slice(selEnd);
              el.selectionStart = el.selectionEnd = caret + insert.length;
            }
            autoSize(el);
          }
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      placeholder="메모 입력…"
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
        resize: 'none',
        overflow: 'hidden',
        padding: 0,
        cursor: 'text',
      }}
    />
  );
}
