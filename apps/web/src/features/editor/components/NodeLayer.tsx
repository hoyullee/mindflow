import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { LayoutMode, Node, NodeMap, RichRun } from '@mindflow/mindmap-core';
import { ROOT_ID, charsToRuns, continueListMarker, isStyledRuns, listBackspaceOp, parseListPrefix, renumberEdits, runsToChars, shiftOffset } from '@mindflow/mindmap-core';
import { colorOf, descendants } from '../tree';
import { isPanButton } from '../pointerButtons';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import type { GeomMap } from '../types';
import { peersSelecting } from '../presenceSelection';
import { RemotePeerTag } from './RemotePeerTag';
import { ResizeHandle } from './ResizeHandle';
import { domToRuns, linearize, listArrowLeft, listArrowVertical, liveEditValue, selectedRawText, snapCaretOffListMarker } from '../richtextDom';
import { ListTextBlock, domMarkerSignature, listLinesOf, listSigOf, listSignature, markerSignature, nodeTextAlign, renderListEdit } from '../listLines';
import { RichSpan, isLinkOpenModifier, linkInk, openLink } from '../richSpans';
import { useIsTouchDevice } from '../../../hooks/useMediaQuery';
import { useSoftKeyboardOpen } from '../../../hooks/useKeyboardInset';
import { AttachedImg } from './AttachedImg';

interface NodeLayerProps {
  nodes: NodeMap;
  geom: GeomMap;
  mode: LayoutMode;
  theme: Theme;
  controller: EditorController;
}

/**
 * Node boxes — port of the node half of `Component#renderCanvas`
 * (MindFlow.dc.html:1136-1265): selection ring, drag-to-move/detach,
 * double-click/F2 text editing, resize handle, and the collapse toggle are
 * all wired (Editor-b). Rich partial-run styling (bold/color on a text
 * *selection* within a node, `NodeEditBox` + `TextToolbar.tsx`) is wired too;
 * the drag-ghost→drop-target reattach gesture remains out of scope here (that
 * one's Editor-c, unrelated to text editing).
 */
export function NodeLayer({ nodes, geom, mode, theme, controller }: NodeLayerProps) {
  const rootGeom = geom[ROOT_ID];
  const ghost = controller.dragGhost;
  const ghostGeom = ghost ? geom[ghost.id] : null;
  return (
    <>
      {Object.keys(geom).map((id) => {
        const n = nodes[id];
        const g = geom[id];
        if (!n || !g) return null;
        return <NodeBox key={id} id={id} node={n} g={g} nodes={nodes} mode={mode} theme={theme} rootX={rootGeom?.x ?? 0} controller={controller} />;
      })}
      {ghost &&
        ghostGeom &&
        (() => {
          // 잡은 노드만이 아니라 **하위 도형들도** 같은 이동량(delta)만큼 점선
          // 윤곽으로 따라온다(요청) — 서브트리째 움직인다는 것이 드래그 중에
          // 보인다. 접힌 가지의 자식은 geom에 없어 자연히 빠진다.
          const dx = ghost.x - ghostGeom.x;
          const dy = ghost.y - ghostGeom.y;
          const ids: string[] = [];
          const walk = (id: string): void => {
            ids.push(id);
            nodes[id]?.children.forEach((c) => {
              if (nodes[c]) walk(c);
            });
          };
          walk(ghost.id);
          return ids.map((gid) => {
            const g = geom[gid];
            if (!g) return null;
            return (
              <div
                key={`ghost-${gid}`}
                aria-hidden="true"
                data-drag-ghost
                style={{
                  position: 'absolute',
                  left: g.x - g.w / 2 + dx,
                  top: g.y - g.h / 2 + dy,
                  width: g.w,
                  height: g.h,
                  borderRadius: 10,
                  border: `2px dashed ${theme.accent}`,
                  background: hexA(theme.accent, 0.1),
                  opacity: 0.85,
                  pointerEvents: 'none',
                  zIndex: 40,
                  boxSizing: 'border-box',
                }}
              />
            );
          });
        })()}
    </>
  );
}

interface NodeBoxProps {
  id: string;
  node: Node;
  g: GeomMap[string];
  nodes: NodeMap;
  mode: LayoutMode;
  theme: Theme;
  rootX: number;
  controller: EditorController;
}

function NodeBox({ id, node: n, g, nodes, mode, theme: th, rootX, controller }: NodeBoxProps) {
  const depth = g.depth;
  const col = colorOf(id, nodes, th);
  // port of `MSEL.nodes.includes(v.id)` (MindFlow.dc.html:1138) — a marquee multi-selection
  // rings EVERY targeted node, not just a single `selection`.
  const selected = controller.multiGroups.nodes.includes(id);
  const editing = controller.editingNodeId === id;
  const resizing = controller.resizingNodeId === id;
  // While actively editing or resizing, this box grows but neighbours only get
  // magneted away on release — so lift it to the top layer meanwhile, so it
  // cleanly covers whatever it overlaps instead of the two texts mixing.
  const raised = editing || resizing;
  const attach = controller.attachTarget?.id === id;
  // presence: a remote peer's selection ring, distinct from `th.accent` above
  // (single-user/no-peers is a no-op — `peersSelecting` returns `[]`).
  const remoteSelectors = peersSelecting(controller.presence.peers, 'nodes', id);
  const remotePeer = remoteSelectors[0];

  const boxStyle: CSSProperties = {
    position: 'absolute',
    left: g.x - g.w / 2,
    top: g.y - g.h / 2,
    width: g.w,
    height: g.h,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: n.emoji ? 7 : 0,
    borderRadius: depth === 0 ? 15 : depth === 1 ? 12 : 10,
    cursor: 'grab',
    userSelect: 'none',
    fontFamily: 'Pretendard, sans-serif',
    boxSizing: 'border-box',
    whiteSpace: 'pre-wrap',
    textAlign: 'center',
  };

  const userFill = n.fill || null;
  const userStroke = n.stroke || null;
  const fillA = n.fillA == null ? 1 : n.fillA;
  const strokeA = n.strokeA == null ? (depth >= 2 ? 0.5 : 1) : n.strokeA;
  const dFill = userFill || (depth === 0 ? th.accent : th.panel);
  const dStroke = userStroke || (depth === 0 ? th.accent : col);
  const fillCss = hexA(dFill, fillA);
  const strokeCss = hexA(dStroke, strokeA);

  if (depth === 0) {
    boxStyle.background = fillCss;
    boxStyle.color = th.accentInk;
    boxStyle.fontWeight = 700;
    boxStyle.fontSize = 20;
    boxStyle.padding = '0 24px';
    boxStyle.boxShadow = `0 6px 18px ${hexA(th.accent, 0.35)}`;
    if (userStroke) boxStyle.border = `2px solid ${strokeCss}`;
  } else if (depth === 1) {
    boxStyle.background = fillCss;
    boxStyle.color = th.text;
    boxStyle.fontWeight = 600;
    boxStyle.fontSize = 15;
    boxStyle.padding = '0 15px';
    boxStyle.border = `2px solid ${strokeCss}`;
    boxStyle.boxShadow = '0 3px 10px rgba(0,0,0,.06)';
  } else {
    boxStyle.background = fillCss;
    boxStyle.color = th.text;
    boxStyle.fontWeight = 500;
    boxStyle.fontSize = 14;
    boxStyle.padding = '0 13px';
    boxStyle.border = '1.5px solid ' + strokeCss;
    boxStyle.boxShadow = '0 2px 6px rgba(0,0,0,.04)';
  }

  if (selected) boxStyle.boxShadow = `0 0 0 2px ${th.panel}, 0 0 0 4px ${hexA(th.accent, 0.55)}, 0 6px 18px rgba(0,0,0,.12)`;
  // drop-target highlight while another node is being dragged over this one — port of
  // `Component#renderCanvas`'s `_attachHi` ring (MindFlow.dc.html:1158-1159).
  if (attach) boxStyle.boxShadow = `0 0 0 3px ${th.accent}, 0 0 0 7px ${hexA(th.accent, 0.25)}, 0 6px 18px rgba(0,0,0,.16)`;
  // Above every other node box (default z ~auto) and the drag ghost (z 40) so the
  // active shape's opaque background hides any neighbour beneath it while it grows.
  if (raised) boxStyle.zIndex = 200;

  const shape = n.shape || 'round';
  let shapeBg: ReactNode = null;
  if (shape === 'rect') boxStyle.borderRadius = 3;
  else if (shape === 'pill') boxStyle.borderRadius = 999;
  else if (shape === 'ellipse') boxStyle.borderRadius = '50%';
  else if (shape === 'underline') {
    boxStyle.background = 'transparent';
    boxStyle.border = 'none';
    boxStyle.borderRadius = 0;
    boxStyle.borderBottom = `3px solid ${hexA(userStroke || (depth === 0 ? th.accent : col), strokeA)}`;
    boxStyle.boxShadow = selected ? `0 3px 0 -1px ${hexA(th.accent, 0.9)}` : 'none';
    if (depth === 0) boxStyle.color = th.text;
  } else if (shape === 'hexagon' || shape === 'diamond' || shape === 'parallelogram') {
    boxStyle.background = 'transparent';
    boxStyle.border = 'none';
    boxStyle.borderRadius = 0;
    boxStyle.boxShadow = 'none';
    if (shape === 'parallelogram') boxStyle.padding = '0 22px';
    const polyFill = fillCss;
    const bw2 = depth >= 2 ? 1.5 : 2;
    boxStyle.color = depth === 0 ? th.accentInk : th.text;
    const W = g.w;
    const H = g.h;
    const pts =
      shape === 'hexagon'
        ? `${0.14 * W},0 ${0.86 * W},0 ${W},${0.5 * H} ${0.86 * W},${H} ${0.14 * W},${H} 0,${0.5 * H}`
        : shape === 'diamond'
          ? `${0.5 * W},0 ${W},${0.5 * H} ${0.5 * W},${H} 0,${0.5 * H}`
          : `${0.16 * W},0 ${W},0 ${0.84 * W},${H} 0,${H}`;
    shapeBg = (
      <svg
        width={W}
        height={H}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'visible',
          zIndex: 0,
          pointerEvents: 'none',
          filter: selected ? 'drop-shadow(0 3px 8px rgba(0,0,0,.28))' : 'drop-shadow(0 2px 6px rgba(0,0,0,.18))',
        }}
      >
        {selected && <polygon points={pts} fill="none" stroke={hexA(th.accent, 0.55)} strokeWidth={bw2 + 6} strokeLinejoin="round" />}
        {selected && <polygon points={pts} fill="none" stroke={th.panel} strokeWidth={bw2 + 2} strokeLinejoin="round" />}
        {remotePeer && <polygon points={pts} fill="none" stroke={hexA(remotePeer.user.color, 0.9)} strokeWidth={bw2 + 4} strokeLinejoin="round" />}
        <polygon points={pts} fill={polyFill} stroke={strokeCss} strokeWidth={bw2} strokeLinejoin="miter" />
      </svg>
    );
  }

  // presence: a remote peer's selection ring, layered onto whatever local
  // selected/attach boxShadow (if any) is already set above — polygon shapes
  // (hexagon/diamond/parallelogram) got their own ring drawn into `shapeBg`'s
  // SVG instead (no CSS box to shadow), so they're excluded here.
  if (remotePeer && shape !== 'hexagon' && shape !== 'diamond' && shape !== 'parallelogram') {
    const rc = hexA(remotePeer.user.color, 0.9);
    boxStyle.boxShadow = boxStyle.boxShadow && boxStyle.boxShadow !== 'none' ? `${boxStyle.boxShadow}, 0 0 0 3px ${rc}` : `0 0 0 3px ${rc}`;
  }
  // 검색 일치 링 — 모든 일치 대상에 노란 링(현재 항목은 검색 바가 실제 선택까지
  // 얹어 accent 링과 겹친다). 색은 선택(accent)·원격(피어색)과 구별되는 앰버.
  if (controller.searchMarks?.nodes.has(id)) {
    const sc = hexA('#e0b23c', 0.9);
    boxStyle.boxShadow = boxStyle.boxShadow && boxStyle.boxShadow !== 'none' ? `${boxStyle.boxShadow}, 0 0 0 3px ${sc}` : `0 0 0 3px ${sc}`;
  }

  if (n.textColor) boxStyle.color = n.textColor;
  // 링크 글자색 — 도형의 **글자색**을 보고 그 위에서 읽히는 파랑을 고른다
  // (`richSpans.linkInk`). 변수로 내려 주면 커밋된 렌더(`RichSpan`)와 편집 박스가
  // 쓰는 HTML 문자열(`runsToHtml`)이 같은 값을 물려받는다 — 둘 다 `.mf-link`.
  (boxStyle as Record<string, unknown>)['--mf-link'] = linkInk(boxStyle.color as string | undefined);
  if (g.fpx) boxStyle.fontSize = g.fpx;
  if (g.fw) boxStyle.fontWeight = g.fw;

  // 노드 이미지: 썸네일(위) + 내용(아래)의 세로 스택 — metrics.computeMetrics가
  // imgH+8만큼 박스를 미리 키워 두므로 여기선 배치만 바꾼다.
  const hasImg = !!(n.img && n.imgW && n.imgH);
  if (hasImg) boxStyle.flexDirection = 'column';

  const align = nodeTextAlign(n) as CSSProperties['textAlign'];
  const clipShape = shape === 'hexagon' || shape === 'diamond' || shape === 'parallelogram' || shape === 'ellipse' || shape === 'pill';
  const bodyWidth = clipShape ? Math.min(g.tw || g.w, g.w) : '100%';

  const listLines = editing ? null : listLinesOf(n);
  const textInner = editing ? (
    <NodeEditBox id={id} n={n} boxStyle={boxStyle} align={align} controller={controller} />
  ) : listLines ? (
    <ListTextBlock lines={listLines} align={align} />
  ) : n.rich && n.rich.length ? (
    <span style={{ lineHeight: 1.35, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box', textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {n.rich.map((r, ri) => (
        <RichSpan key={ri} seg={r}>
          {r.t}
        </RichSpan>
      ))}
    </span>
  ) : (
    <span style={{ lineHeight: 1.35, flex: '1 1 auto', width: '100%', minWidth: 0, boxSizing: 'border-box', textAlign: align, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.text}</span>
  );

  const hasKids = n.children.length > 0;
  const outSign = mode === 'down' ? 0 : g.x >= rootX ? 1 : -1;
  const toggleStyle: CSSProperties = {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: n.collapsed ? col : th.panel,
    color: n.collapsed ? '#fff' : col,
    border: `2px solid ${col}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    zIndex: 3,
    cursor: 'pointer',
  };
  if (mode === 'down') {
    toggleStyle.left = g.w / 2 - 10;
    toggleStyle.top = g.h - 4;
  } else if (outSign > 0) {
    toggleStyle.right = -11;
    toggleStyle.top = g.h / 2 - 10;
  } else {
    toggleStyle.left = -11;
    toggleStyle.top = g.h / 2 - 10;
  }

  const noteSign = mode === 'down' ? 1 : g.x >= rootX ? 1 : -1;
  const hasNote = !!n.note && n.note.trim().length > 0;
  const noteStyle: CSSProperties = {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#fff',
    color: th.accent,
    border: `1.5px solid ${th.accent}`,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    lineHeight: 1,
    zIndex: 4,
    boxShadow: '0 1px 4px rgba(0,0,0,.18)',
    top: -8,
  };
  if (noteSign > 0) noteStyle.right = -7;
  else noteStyle.left = -7;

  return (
    <div
      style={boxStyle}
      data-node-id={id}
      data-depth={depth}
      onPointerDown={(e) => controller.beginNodeDrag(e, id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        controller.startEditNode(id);
      }}
    >
      {shapeBg}
      {hasImg && (
        <AttachedImg
          img={n.img}
          urls={controller.imageUrls}
          style={{ position: 'relative', zIndex: 1, width: n.imgW, height: n.imgH, objectFit: 'cover', borderRadius: 8, marginBottom: 8, pointerEvents: 'none', userSelect: 'none' }}
        />
      )}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
          width: bodyWidth,
          maxWidth: '100%',
          gap: n.emoji ? 7 : 0,
          pointerEvents: editing ? 'auto' : 'none',
        }}
      >
        {n.emoji && !editing && <span style={{ fontSize: depth === 0 ? 22 : 17, lineHeight: 1 }}>{n.emoji}</span>}
        {textInner}
      </div>
      {hasKids && (
        <div
          style={toggleStyle}
          onPointerDown={(e) => {
            if (isPanButton(e)) return; // 우클릭·휠클릭 = 화면 이동
            e.stopPropagation();
            controller.toggleCollapse(id);
          }}
        >
          {n.collapsed ? String(descendants(nodes, id).length) : '−'}
        </div>
      )}
      {hasNote && (
        <div title={n.note} style={noteStyle} aria-hidden="true">
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke={th.accent} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </div>
      )}
      {/* Drop-target hint badge while another node is dragged over this one —
          tells the user how it will attach (자식/형제). Port of the
          `attach-badge` in `Component#renderCanvas` (MindFlow.dc.html:1246-1248). */}
      {attach && controller.attachTarget && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: -34,
            transform: 'translateX(-50%)',
            background: th.accent,
            color: th.accentInk,
            borderRadius: 7,
            padding: '4px 10px',
            fontSize: 11.5,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,.25)',
            pointerEvents: 'none',
            zIndex: 100,
            fontFamily: 'Pretendard, sans-serif',
          }}
        >
          {controller.attachTarget.zone === 'child' ? '자식으로 연결' : '형제로 연결'}
        </div>
      )}
      {remotePeer && !editing && <RemotePeerTag color={remotePeer.user.color} name={remotePeer.user.name} style={{ left: 0, top: -22 }} />}
      {/* resize handle only for a true single selection (port of `this.state.selectedId`,
          MindFlow.dc.html:1274 — not shown for a marquee multi-selection) */}
      {controller.selection?.kind === 'node' && controller.selection.id === id && !editing && (
        // 우하단 모서리 하나. 한때 오른쪽·아래 변에 축 고정 핸들도 뒀는데, 그건
        // "가로로 끌었는데 세로가 튄다"를 우회하려던 장치였다. 원인(텍스트 최소
        // 높이 계단 + 분수 cw의 과팽창 되돌림)을 모서리 쪽에서 고친 뒤로는 남길
        // 이유가 없어져 걷어냈다 — 핸들 셋이 겹쳐 빗맞히기 쉬운 쪽이 더 문제였다.
        <ResizeHandle
          title="크기 조절 (더블클릭: 원래 크기)"
          accent={th.accent}
          panel={th.panel}
          right={-6}
          bottom={-6}
          zIndex={81}
          onPointerDown={(e) => controller.beginNodeResize(e, id)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            controller.resetNodeSize(id);
          }}
        />
      )}
    </div>
  );
}

/**
 * 리스트 자동 이어쓰기(`NodeEditBox`의 Shift+Enter) — 캐럿이 있는 줄이 리스트
 * 줄이면 브라우저 기본 줄바꿈을 막고 char-model로 직접 처리한다:
 * `\n` + 다음 마커(글머리=같은 마커, 번호=+1)를 삽입하거나, 마커만 남은 빈
 * 줄이면 마커를 지워 리스트를 끝낸다. `applyPartial`과 같은 재료(linearize/
 * domToRuns/runsToHtml/setLinearSelection)로 innerHTML을 재구성해 rich 스타일을
 * 보존한다(execCommand는 jsdom에 없고 deprecated — 처음부터 쓰지 않는다).
 *
 * @returns 처리했으면 true(호출부는 return), 리스트 줄이 아니면 false(기본 줄바꿈).
 */
/** 접힌 선택 없이 캐럿이 리스트 마커 안에 있는지 보고, Backspace가 대신 수행할
 * 리스트 연산을 돌려준다(아니면 `null` → 브라우저 기본 삭제). 판정 규칙 자체는
 * 코어 `listBackspaceOp`가 단일 소스다. */
export function listBackspaceOpAt(el: HTMLDivElement): ReturnType<typeof listBackspaceOp> {
  const ws = window.getSelection();
  if (!ws || !ws.rangeCount) return null;
  const rng = ws.getRangeAt(0);
  if (!rng.collapsed) return null; // 선택 삭제는 평범한 삭제다
  const lin = linearize(el, [{ container: rng.startContainer, offset: rng.startOffset }]);
  return listBackspaceOp(domToRuns(el, true).text, lin.pos[0] ?? 0);
}

export function maybeContinueList(e: { preventDefault: () => void }, el: HTMLDivElement | null, render: (v: { text: string; rich: RichRun[] | null }, caret: number) => void): boolean {
  if (!el) return false;
  const ws = window.getSelection();
  if (!ws || !ws.rangeCount) return false;
  const rng = ws.getRangeAt(0);
  const lin = linearize(el, [
    { container: rng.startContainer, offset: rng.startOffset },
    { container: rng.endContainer, offset: rng.endOffset },
  ]);
  // 값과 오프셋을 같은 좌표계로 — placeholder `<br>` 한 칸 차이가 캐럿을 **앞 줄**로
  // 읽게 만들어, 리스트를 끝낸 빈 줄에서 다시 마커가 생기던 제보의 원인이었다.
  const parsed = liveEditValue(el);
  const a = parsed.clamp(Math.min(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
  const b = parsed.clamp(Math.max(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
  const text = parsed.text;
  const lineStart = text.lastIndexOf('\n', a - 1) + 1;
  const lineEndIdx = text.indexOf('\n', a);
  const line = text.slice(lineStart, lineEndIdx === -1 ? text.length : lineEndIdx);
  const cont = continueListMarker(line);
  if (!cont) return false;
  e.preventDefault();
  const chars = runsToChars(parsed);
  let caret: number;
  if ('end' in cont) {
    // 마커만 남은 빈 줄 → 접두를 `replaceWith`로 교체(들여쓴 줄은 한 단계
    // 내어쓰기, 최상위는 제거로 리스트 종료). 줄바꿈은 넣지 않는다.
    const p = parseListPrefix(line);
    const rawLen = p ? p.raw.length : 0;
    chars.splice(lineStart, rawLen, ...Array.from(cont.replaceWith).map((ch) => ({ ch, b: false, c: null })));
    caret = lineStart + cont.replaceWith.length;
  } else {
    chars.splice(a, b - a);
    const insert = `\n${cont.next}`;
    chars.splice(a, 0, ...Array.from(insert).map((ch) => ({ ch, b: false, c: null })));
    caret = a + insert.length;
  }
  // 이어쓰기/내어쓰기로 어긋난 이웃 번호를 정리한다 — 하위 목록의 빈 `b.`를
  // 내어쓰면 상위 `2.` 다음이므로 `3.`이어야 하고(제보), 목록 **중간**에 항목을
  // 끼우면 뒤 항목들이 한 칸씩 밀려야 한다. `continueListMarker`는 한 줄만 보므로
  // 전체 번호는 여기서 맞춘다(Tab의 `applyListOp`는 자체적으로 한다).
  const renum = renumberEdits(chars.map((c) => c.ch).join(''));
  [...renum]
    .sort((x, y) => y.at - x.at)
    .forEach((ed) => chars.splice(ed.at, ed.remove, ...Array.from(ed.insert).map((ch) => ({ ch, b: false, c: null }))));
  caret = shiftOffset(caret, renum);
  const runs = charsToRuns(chars).filter((r) => r.t);
  render({ text: chars.map((c) => c.ch).join(''), rich: isStyledRuns(runs) ? runs : null }, caret);
  return true;
}

/** Shift+Enter 줄바꿈 — 브라우저 기본에 맡기지 않고 char-model로 직접 넣는다.
 *
 * 기본 동작에 맡기면 두 가지가 어긋난다(제보): ① contentEditable에서 글 끝에 넣은
 * `<br>` **하나는 화면에 나타나지 않아** 두 번 눌러야 줄이 바뀌고 ② 우리 측정
 * (`updateNodeEditSize`)이 그 자리에서 돌지 않아 도형이 다음 글자를 칠 때에야 커진다.
 * 리스트 이어쓰기(`maybeContinueList`)와 같은 경로로 통일하면 둘 다 해결된다 —
 * `render`가 곧바로 다시 그리고 크기까지 갱신하기 때문이다. */
export function insertLineBreak(el: HTMLDivElement | null, render: (v: { text: string; rich: RichRun[] | null }, caret: number) => void): boolean {
  if (!el) return false;
  const ws = window.getSelection();
  if (!ws || !ws.rangeCount) return false;
  const rng = ws.getRangeAt(0);
  const lin = linearize(el, [
    { container: rng.startContainer, offset: rng.startOffset },
    { container: rng.endContainer, offset: rng.endOffset },
  ]);
  const v = liveEditValue(el);
  const a = v.clamp(Math.min(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
  const b = v.clamp(Math.max(lin.pos[0] ?? 0, lin.pos[1] ?? 0));
  // 이미 끝에 있던 빈 줄을 이 삽입이 먹어 버리지 않게 `liveEditValue`로 읽는다.
  const chars = runsToChars(v);
  chars.splice(a, b - a);
  chars.splice(a, 0, { ch: '\n', b: false, c: null });
  const runs = charsToRuns(chars).filter((r) => r.t);
  render({ text: chars.map((c) => c.ch).join(''), rich: isStyledRuns(runs) ? runs : null }, a + 1);
  return true;
}

interface NodeEditBoxProps {
  id: string;
  n: Node;
  boxStyle: CSSProperties;
  align: CSSProperties['textAlign'];
  controller: EditorController;
}

/** In-place node text editor — a real `contentEditable` div, port of the original's rich
 * text box (MindFlow.dc.html:1200-1224): seeds its innerHTML from the node's existing
 * `rich` runs on mount (`runsToHtml`), focuses + selects all its content, and supports
 * partial bold/color styling on a text *selection* within it (`TextToolbar.tsx`,
 * `controller.applyPartial`) — the floating toolbar stays visible for the WHOLE edit
 * session (opened in the mount effect below). Enter (non-IME, non-shift) commits via
 * `commitNodeRichText`; Shift+Enter inserts a line break (the browser's own
 * `contentEditable` default, left un-intercepted); Escape cancels. Ctrl/Cmd+B·I are
 * intercepted and routed to `applyPartial` (see `onKeyDown` below — the browser's own
 * bold toggle turns the WRONG way inside already-bold node boxes). */
function NodeEditBox({ id, n, boxStyle, align, controller }: NodeEditBoxProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  /**
   * 소프트 키보드에는 Shift가 사실상 없다 — 폰에서 Enter가 편집을 끝내 버리면
   * **줄바꿈을 넣을 방법 자체가 없어진다**(제보). 터치 기기에서는 Enter를 줄바꿈으로
   * 두고, 편집은 바깥을 탭하면 끝난다(모바일의 일반적인 관례). 데스크톱은 그대로:
   * Enter=확정, Shift+Enter=줄바꿈.
   */
  // 판정은 **두 신호의 합**이다: 기기가 터치인가(미디어 질의) 또는 지금 실제로
  // 소프트 키보드가 떠 있는가(visualViewport). 후자를 더한 이유는 앞의 하나가
  // "데스크톱"이라고 답하는 환경이 실제로 있기 때문이다(크롬 안드로이드의 데스크톱
  // 사이트 모드, 마우스를 붙인 태블릿, 일부 인앱 브라우저) — 그 화면에서도 Enter가
  // 편집을 끝내면 줄바꿈을 넣을 방법이 없다(제보).
  // `||`로 한 줄에 쓰면 앞이 true일 때 뒤의 훅이 **호출되지 않아** 훅 순서가 깨진다.
  const touchDevice = useIsTouchDevice();
  const keyboardOpen = useSoftKeyboardOpen();
  const softKeyboard = touchDevice || keyboardOpen;
  /** IME 조합 중 — 이때 캐럿을 옮기면 조합이 깨진다(스냅·재구성 모두 보류). */
  const composingRef = useRef(false);
  /** 조합 중에 들어온 Shift+Enter — 기본 줄바꿈은 막았고(행을 쪼갠다), 조합이
   * 끝나는 compositionend에서 우리 경로로 잇는다(제보: 캐럿 깜빡임). */
  const pendingBreakRef = useRef(false);

  /** 편집 값을 리스트 구조까지 반영해 다시 그리고 캐럿을 복원한다. 줄 구성
   * 서명은 엘리먼트에 새겨진다(`renderListEdit`) — 컨트롤러(툴바·단축키)가 다시
   * 그린 경우에도 다음 입력의 재구성 판정이 어긋나지 않는다. */
  const render = (el: HTMLDivElement, v: { text: string; rich: RichRun[] | null }, caret: number): void => {
    renderListEdit(el, v, align, caret, caret);
    controller.updateNodeEditSize(id, el);
  };

  /** 줄바꿈 — 리스트 줄이면 마커 이어쓰기, 아니면 평범한 `\n`. 언제나 이 경로
   * 하나로만 들어간다(브라우저 기본 줄바꿈은 [마커|내용] 행을 쪼갠다). */
  const doBreak = (el: HTMLDivElement): void => {
    if (!maybeContinueList({ preventDefault: () => {} }, el, (v, caret) => render(el, v, caret))) {
      insertLineBreak(el, (v, caret) => render(el, v, caret));
    }
  };

  /** 다음 페인트 **직전**(rAF)에 캐럿 스냅 — 방향키·클릭의 기본 동작은 핸들러
   * 뒤에 실행되므로, 비동기 selectionchange 스냅만으로는 마커 위에 선 캐럿이
   * **한 프레임 화면에 그려진다**(제보: →로 다음 리스트 줄에 내려가면 마커 앞에
   * 잠깐 머물렀다 튐). rAF 콜백은 같은 프레임의 페인트 전에 돌아 잘못된 위치가
   * 화면에 나가지 않는다. */
  const scheduleSnap = (): void => {
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      if (!composingRef.current && ref.current) snapCaretOffListMarker(ref.current);
    });
  };

  /** 입력 후 줄 구조가 바뀌었으면(마커 생성/삭제) 편집 DOM을 리스트 모양으로
   * 재구성 — 제보: 편집 중에는 `- 항목` 원문이 보이고 확정해야 리스트가 됐다. */
  const syncListStructure = (el: HTMLDivElement): void => {
    const v = domToRuns(el, true);
    // 줄 구성이 그대로여도, 사용자가 **마커 스팬 안에** 글자를 넣었으면 다시 그린다
    // — 그 스팬은 `white-space: pre`라 글자가 줄바꿈되지 않아 도형을 벗어난다(제보).
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


  /** 최신 `doBreak`을 담아 둔다 — 아래 네이티브 리스너는 마운트 때 한 번만 붙는데,
   * `doBreak`은 렌더마다 새로 만들어지므로 그때 잡은 것을 쓰면 낡는다. */
  const doBreakRef = useRef(doBreak);
  doBreakRef.current = doBreak;

  /**
   * 줄바꿈이 **브라우저 기본 동작으로** 들어오는 마지막 구멍을 막는 안전망.
   *
   * 이걸 React의 `onBeforeInput`으로 달아 뒀던 게 문제였다(제보) — React의
   * `onBeforeInput`은 네이티브 `beforeinput`이 아니라 `textInput`/`keypress`에서
   * **합성한 폴리필**이라 `inputType`이 없고, `insertParagraph`에는 아예 뜨지도
   * 않는다. 실측: 안드로이드 IME처럼 keydown이 `keyCode 229`로 와서 우리 Enter
   * 분기를 비껴가면, 네이티브 `beforeinput insertParagraph`가 **막히지 않은 채**
   * 실행돼 [마커|내용] flex 행을 쪼갠다(그 뒤의 리스트 조작이 어긋나는 원인).
   * 그래서 네이티브 이벤트에 직접 건다.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: Event): void => {
      const it = (e as InputEvent).inputType;
      if (it !== 'insertLineBreak' && it !== 'insertParagraph') return;
      e.preventDefault();
      if (composingRef.current) pendingBreakRef.current = true;
      else doBreakRef.current(el);
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 시작부터 리스트 모양으로 — 편집 진입 순간 글머리가 원문(`- `)으로 되돌아
    // 보이지 않게(마커 글자 수가 같아 캐럿/선택 오프셋은 그대로다).
    renderListEdit(el, n, align, 0, 0);
    controller.setRichEditorEl(el);
    // Seed the live box size from the initial content so an already-long node
    // opens at its correct size (and subsequent typing keeps it in sync).
    controller.updateNodeEditSize(id, el);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // 서식 툴바는 편집 세션 동안 **상시 노출**(사용자 결정) — 예전엔 드래그
    // 선택이 있을 때만 떠서, 선택을 풀면 사라져 "서식 기능이 없는 것처럼"
    // 보였다. 노드 박스 위에 고정으로 열고, 닫히는 경우는 편집 종료(커밋/취소가
    // textCtx를 지움)와 다른 메뉴 열림(openCtxAt)뿐이다. 선택 없이 버튼을
    // 누르면 전체 텍스트에 적용된다(applyPartial 참고).
    const box = el.closest('[data-node-id]') as HTMLElement | null;
    const vpEl = el.closest('.mf-ed-vp');
    if (box && vpEl && typeof box.getBoundingClientRect === 'function' && typeof vpEl.getBoundingClientRect === 'function') {
      const br = box.getBoundingClientRect();
      const vr = vpEl.getBoundingClientRect();
      controller.openTextCtx(br.left + br.width / 2 - vr.left, br.top - vr.top);
    } else {
      controller.openTextCtx(0, 60); // rect를 못 읽는 환경(jsdom) — 위치만 폴백
    }
    // 캐럿이 리스트 마커 구역에 앉지 못하게 — 클릭·방향키·Home 등 모든 경로가
    // selectionchange로 모인다(제보: user-select:none 이후 마커 **앞**에 캐럿이
    // 서서 친 글자가 마커 앞에 쌓임).
    const onSelChange = (): void => {
      if (composingRef.current || !ref.current) return;
      snapCaretOffListMarker(ref.current);
      // 툴바 버튼은 편집 박스 **밖**을 누르는 동작이라 그 순간의 선택을 믿을 수
      // 없다 — 편집 중 여기서 계속 기록해 둔 캐럿이 그때의 기준점이 된다.
      controller.noteEditCaret(ref.current);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      document.removeEventListener('selectionchange', onSelChange);
      controller.setRichEditorEl(null);
    };
    // Mount-once (empty deps): this box only ever exists for the DURATION of one edit
    // session — `NodeBox` renders it exclusively while `editing` is true, so "on mount"
    // and "on entering edit mode" are the same moment here, unlike the original's single
    // persistent DOM node (reused across renders, hence its own `data-init`-keyed guard
    // to avoid re-seeding the innerHTML mid-edit, MindFlow.dc.html:1204-1210).
  }, []);

  return (
    <div
      ref={ref}
      className="mf-edit mf-richedit"
      contentEditable
      suppressContentEditableWarning
      // 소프트 키보드의 액션 키를 **줄바꿈 키**로 못박는다. 이 힌트가 없으면 IME가
      // 스스로 고르는데, "완료/이동"류를 고르면 그 키가 키보드를 내려 버리고 →
      // 편집 박스가 blur → 우리 blur 커밋이 편집을 끝낸다(제보: 폰에서 엔터를
      // 누르면 편집이 종료됨). 물리 키보드에는 아무 영향이 없다.
      enterKeyHint="enter"
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
      // 편집 중에도 Ctrl/⌘+클릭으로 링크를 연다(요청). 편집 박스 안의 링크는
      // `runsToHtml`이 심은 `data-href` span이라 여기서 한 번에 처리한다 —
      // 기본 동작(캐럿 이동)은 막는다.
      onClick={(e) => {
        if (!isLinkOpenModifier(e)) return;
        const href = (e.target as HTMLElement | null)?.closest?.('[data-href]')?.getAttribute('data-href');
        if (!href) return;
        e.preventDefault();
        e.stopPropagation();
        openLink(href);
      }}
      // 편집 중의 더블클릭(단어 선택)은 여기서 멈춘다. 안 그러면 노드 박스의
      // `onDoubleClick`까지 올라가 `startEditNode`가 다시 불리고, 그 안의
      // `setTextCtx(null)`이 **방금 뜬 서식 툴바를 바로 닫아** 버렸다(제보:
      // 더블클릭으로 선택하면 팝업이 안 뜬다). 순서가 mouseup(툴바 열림) →
      // dblclick(닫힘)이라 열렸다 사라지는 것처럼 보이지도 않았다.
      onDoubleClick={(e) => e.stopPropagation()}
      // 리스트 마커는 `user-select: none`이라 기본 복사에서 빠진다 — 마커가 곧
      // 데이터이므로(붙여넣으면 리스트가 사라짐) 값 좌표계에서 잘라 원문을 싣는다.
      onCopy={(e) => {
        const el = ref.current;
        if (!el || !el.querySelector('[data-list-marker]')) return; // 리스트 없으면 기본 복사 그대로
        const t = selectedRawText(el);
        if (t == null) return;
        e.preventDefault();
        e.clipboardData.setData('text/plain', t);
      }}
      onInput={(e) => {
        const el = ref.current;
        if (!el) return;
        // IME 조합 중에는 DOM을 재구성하지 않는다(조합이 깨진다) — 조합이 끝난
        // 뒤 compositionend에서 다시 확인한다.
        if (!(e.nativeEvent as InputEvent).isComposing) syncListStructure(el);
        controller.updateNodeEditSize(id, el);
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        const el = ref.current;
        if (!el) return;
        // 조합 중에 눌린 Shift+Enter — IME가 글자를 확정한 지금 줄바꿈을 잇는다
        // (doBreak가 재구성·크기 갱신까지 하므로 sync는 불필요).
        if (pendingBreakRef.current) {
          pendingBreakRef.current = false;
          doBreak(el);
          return;
        }
        syncListStructure(el);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const composing = e.nativeEvent.isComposing || e.keyCode === 229;
        // 조합 중 Enter/Shift+Enter — 기본 줄바꿈을 막는다. 줄바꿈 의도(Shift)는
        // compositionend에서 잇고, 맨 Enter는 IME 확정만(관례 — 한 번 더 눌러 커밋).
        if (composing && e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey || softKeyboard) pendingBreakRef.current = true;
          return;
        }
        // 입력 전에 캐럿이 마커 구역이면 내용 시작으로 — selectionchange 스냅의
        // 이중화(클릭 직후 빠른 타이핑 등 이벤트 순서 편차 대비). ArrowLeft가
        // 내용 시작에 있으면 마커를 통째로 건너 앞 줄 끝으로(안 그러면 스냅에
        // 되튕겨 캐럿이 그 줄에 갇힌다). 방향키의 **기본 동작**은 이 핸들러 뒤에
        // 실행되므로 rAF 스냅도 예약해 마커에 떨어진 캐럿이 페인트되기 전에 교정.
        if (!composing && ref.current) {
          snapCaretOffListMarker(ref.current);
          scheduleSnap();
          const plainKey = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
          if (e.key === 'ArrowLeft' && plainKey && listArrowLeft(ref.current)) {
            e.preventDefault();
            return;
          }
          // ↑/↓는 리스트 행([마커|내용] flex)을 크롬 기본 이동이 건너지 못한다 —
          // 우리가 직접 옮긴다(제보: ↑를 눌러도 캐럿이 위로 안 올라감).
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plainKey && listArrowVertical(ref.current, e.key === 'ArrowUp' ? -1 : 1)) {
            e.preventDefault();
            return;
          }
        }
        // Ctrl/Cmd+B·I는 브라우저 기본(execCommand bold/italic) 대신 우리
        // `applyPartial`로 라우팅한다. 기본 동작에 맡기면 루트(700)·1단계(600)
        // 노드처럼 박스 자체가 굵은 곳에서 브라우저가 "이미 굵다"고 판단해
        // 토글을 **끄는** 쪽으로 동작 — `font-weight: normal`(400) 스팬을 심어
        // 기본보다 얇아 보이고, 커밋 시 `domToRuns`가 400을 b:false(무서식)로
        // 읽어 되돌아가는 "눌러도 얇아졌다 복원되는" 버그가 됐다(제보).
        // `applyPartial`은 툴바 버튼과 동일 경로(800 고정, 선택 없으면 전체 적용).
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !composing) {
          const k = e.key.toLowerCase();
          if (k === 'b' || k === 'i') {
            e.preventDefault();
            controller.applyPartial(k);
            return;
          }
          if (k === 'u') {
            // 밑줄은 서식 모델에 없다 — 기본 동작을 그냥 두면 편집 중엔 밑줄이
            // 보이다가 커밋 때 소리 없이 사라진다(domToRuns가 무시). 차라리 무시.
            e.preventDefault();
            return;
          }
        }
        // Tab = 들여쓰기 / Shift+Tab = 내어쓰기 (리스트 줄에만 반응). 리스트가
        // 아니어도 기본 동작은 막는다 — Tab으로 포커스가 나가면 blur 커밋이
        // 걸려 편집이 갑자기 끝나 버린다.
        // Backspace가 마커 **안**에 있으면 마커를 한 덩어리로 다룬다 — 한 글자씩
        // 지우게 두면 `2. `가 `2.`가 되면서 그 줄이 리스트에서 빠지고, 남은 `2.`가
        // 평문 정렬(가운데)을 따라 옆으로 튀어 "Tab이 걸린 것처럼" 보였다(제보).
        // 들여쓴 줄은 한 단계 내어쓰고, 최상위 줄은 마커를 없앤다(표준 관례).
        if (e.key === 'Backspace' && !composing) {
          const el = ref.current;
          const act = el ? listBackspaceOpAt(el) : null;
          if (act) {
            e.preventDefault();
            if (act.kind === 'op') controller.applyListOp(act.op);
            else controller.applyListEdits(act.edits);
            controller.updateNodeEditSize(id, ref.current);
            return;
          }
        }
        if (e.key === 'Tab') {
          // 조합 중에도 기본 동작은 막는다 — Tab 포커스 이탈은 blur 커밋으로
          // 편집을 갑자기 끝낸다. 들여쓰기 연산 자체는 조합이 끝난 뒤에만.
          e.preventDefault();
          if (composing) return;
          controller.applyListOp({ type: 'indent', dir: e.shiftKey ? -1 : 1 });
          controller.updateNodeEditSize(id, ref.current);
          return;
        }
        if (e.key === 'Enter' && !composing && !e.shiftKey && softKeyboard) {
          // 터치 기기: 소프트 키보드의 줄바꿈 키는 줄바꿈이다(편집 유지).
          e.preventDefault();
          if (ref.current) doBreak(ref.current);
        } else if (e.key === 'Enter' && !composing && !e.shiftKey) {
          e.preventDefault();
          controller.commitNodeRichText(id, ref.current);
        } else if (e.key === 'Enter' && !composing && e.shiftKey) {
          // 리스트 자동 이어쓰기: 리스트 줄에서 Shift+Enter(줄바꿈)를 치면 다음
          // 줄에 마커를 이어 넣고, 마커만 남은 빈 줄이면 마커를 지워 리스트를
          // 끝낸다(표준 에디터 관례). 리스트 줄이 아니면 평범한 `\n` — 어느 쪽도
          // 브라우저 기본에 맡기지 않는다(`doBreak`).
          e.preventDefault();
          if (ref.current) doBreak(ref.current);
        } else if (e.key === 'Escape' && !composing) {
          e.preventDefault();
          controller.cancelNodeEdit();
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
      // 링크 주소 입력창이 열려 있는 동안엔 커밋하지 않는다 — 입력창으로 포커스가
      // 넘어가는 순간 편집이 끝나 버리면 링크를 걸 수가 없다.
      onBlur={() => {
        if (!controller.isBlurCommitPaused()) controller.commitNodeRichText(id, ref.current);
      }}
      style={{
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontWeight: boxStyle.fontWeight,
        textAlign: align,
        flex: '1 1 auto',
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        boxSizing: 'border-box',
        outline: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.35,
        pointerEvents: 'auto',
        cursor: 'text',
        padding: 0,
      }}
    />
  );
}
