import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import type { Float, RichRun } from '@mindflow/mindmap-core';
import { ListTextBlock, domMarkerSignature, listSigOf, listSignature, markerSignature, nodeContentLines, plainContentLines, renderListEdit } from '../listLines';
import { hexA } from '../theme';
import { floatPadLeft } from '../metrics';
import type { Theme } from '../theme';
import type { EditorController } from '../useEditorState';
import { peersSelecting } from '../presenceSelection';
import { ReactionRow } from './ReactionRow';
import { useIsTouchDevice } from '../../../hooks/useMediaQuery';
import { useSoftKeyboardOpen } from '../../../hooks/useKeyboardInset';
import { RemotePeerTag } from './RemotePeerTag';
import { ResizeHandle } from './ResizeHandle';
import { domToRuns, linearize, listArrowLeft, listArrowVertical, selectedRawText, snapCaretOffListMarker } from '../richtextDom';
import { isLinkOpenModifier, linkInk, openLink } from '../richSpans';
import { insertLineBreak, listBackspaceOpAt, maybeContinueList } from './NodeLayer';
import { AttachedImg } from './AttachedImg';

/**
 * IME 확정과 함께 처리한 줄바꿈이 **한 번 더** 도착하는 것을 막는 창(ms).
 *
 * 한글로 쓰다 Shift+Enter를 누르면 마지막 글자가 조합 중이라, 우리는 keydown에서
 * 기본 동작을 막고 의도만 기억했다가 `compositionend`에서 줄을 바꾼다. 그런데
 * 브라우저·IME 조합에 따라 **같은 물리적 Enter**가 조합이 끝난 뒤 평범한 keydown
 * (또는 `beforeinput: insertLineBreak`)으로 한 번 더 온다 — 그러면 한 번 눌렀는데
 * 두 줄이 내려간다(제보). 사람이 두 번 누르는 간격(보통 100ms 이상)보다 짧게
 * 잡아, 연속 줄바꿈은 그대로 동작하고 메아리만 걸러진다.
 */
const IME_BREAK_ECHO_MS = 80;

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
        const fFpx = f.tsize === 's' ? 11.5 : f.tsize === 'l' ? 15.5 : 13;
        // presence: a remote peer's selection ring (see `NodeLayer`'s identical pattern).
        const remotePeer = peersSelecting(controller.presence.peers, 'floats', f.id)[0];
        // 디자인 원본의 메모: 위쪽에 얇은 흰 하이라이트(종이가 살짝 들린 느낌) +
        // 아래로 길게 깔리는 그늘. 선택 링은 이 앱의 관례대로 **강조색**이다
        // (원본은 파란 아웃라인이지만, 도형·선·영역이 전부 강조색이라 메모만
        // 파랗게 두면 "선택"이 두 가지 색으로 갈린다).
        const cardShadow = 'inset 0 1px 0 rgba(255,255,255,.7), 0 22px 40px -26px rgba(46,42,38,.6)';
        let boxShadow = selected ? `0 0 0 2px ${th.panel}, 0 0 0 4px ${hexA(th.accent, 0.55)}, ${cardShadow}` : cardShadow;
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
          border: `1px solid ${f.bg ? hexA('#2e2a26', 0.1) : th.appBg === '#191512' ? '#5a4a2f' : '#f0e3a0'}`,
          borderRadius: 14,
          padding: `9px 11px 9px ${floatPadLeft()}px`,
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
        // 이미지 플로트: 메모 카드가 아니라 이미지 자체가 박스를 채운다 —
        // 패딩/메모 배경/텍스트 편집 전부 미적용 (Float.img 참고).
        const isImage = !!f.img;
        // 맵에서 이미지는 영역(채움 8·경계 9)보다 **아래**(요청) — 배경 사진처럼
        // 깔린다. 단, 고른 동안은 위로 떠야 리사이즈 핸들이 영역 히트 판에
        // 가리지 않는다(선택 = 지금 만지는 것). 첫 클릭은 영역 판이 받아
        // `beginZoneDrag`가 이미지에게 넘긴다(획 back-off와 같은 결).
        if (isImage && !controller.isBoard) boxStyle.zIndex = selected || editing ? 20 : 5;
        if (isImage) {
          boxStyle.padding = 0;
          boxStyle.background = th.panel;
          boxStyle.minHeight = undefined;
          boxStyle.height = f.h || Math.round(f.w * 0.75);
          // `overflow: hidden`을 **박스에 걸지 않는다.** 둥근 모서리로 이미지를
          // 자르려던 것인데, 그러면 박스 밖에 놓인 자식까지 잘린다 — 크기 조절
          // 핸들(right/bottom −6)이 잘려 **이미지 안에 박힌 것처럼** 보였고
          // (제보 스크린샷) 원격 피어 이름표(top −22)도 같이 잘렸다.
          // 자르기는 이미지를 감싸는 안쪽 래퍼가 맡는다(아래 `mf-float-img-clip`).
        }
        // 링크 글자색 — 노드와 같은 규칙(글자색 밝기 기반, `richSpans.linkInk`).
        (boxStyle as Record<string, unknown>)['--mf-link'] = linkInk((boxStyle.color as string) || null);
        // rich(부분 서식)가 있으면 노드와 같은 줄 단위 rich 렌더(리스트 포함),
        // 평문 리스트는 기존 경로, 그 외 평문은 기존 단일 div — 무회귀 우선.
        const richLines = !editing && f.rich && f.rich.length ? nodeContentLines({ text: f.text, rich: f.rich }) : null;
        const floatLines = !richLines && !editing && f.text ? plainContentLines(f.text) : null;
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
            {/* 접기/펼치기 토글은 제거됐다(요청) — 메모는 항상 펼쳐진 상태이고,
                토글 자리였던 좌측 패딩(32)도 우측과 대칭(11)으로 좁혔다. */}
            {remotePeer && !editing && <RemotePeerTag color={remotePeer.user.color} name={remotePeer.user.name} style={{ left: 0, top: -22 }} />}
            {isImage ? (
              <>
                <div data-float-img-clip style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit' }}>
                  <AttachedImg
                    img={f.img}
                    urls={controller.imageUrls}
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }}
                  />
                </div>
                {/* 이미지 제목(Float.caption, 화이트보드 요청) — 이미지 **아래 바깥**에
                    한 줄. 박스 밖(top:100%)이라 히트 박스·리사이즈 핸들·겹침 계산이
                    변하지 않고, 그림 캡션 관례대로 가운데 정렬. 편집은 속성 패널. */}
                {!!(f.caption || '').trim() && (
                  <div data-float-caption style={{ position: 'absolute', top: '100%', left: -20, right: -20, marginTop: 5, textAlign: 'center', fontSize: 12, fontWeight: 600, color: th.subtext, pointerEvents: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
                    {f.caption}
                  </div>
                )}
              </>
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
                }}
              >
                {f.text || '메모 입력…'}
              </div>
            )}
            {/* resize handle only for a true single selection (port of `this.state.selFloat`,
                MindFlow.dc.html:1486 — hidden during a marquee multi-selection) */}
            {controller.selection?.kind === 'float' && controller.selection.id === f.id && !editing && (
              <ResizeHandle title="크기 조절" accent={th.accent} panel={th.panel} right={-6} bottom={-6} zIndex={6} onPointerDown={(e) => controller.beginFloatResize(e, f.id)} />
            )}
            {/* 스티커 반응·점 투표(화이트보드) — 카드 아래 바깥 칩 줄. 맵에는 두지
                않는다: 회고에서 스티커에 표를 던지는 도구라 보드의 어휘다. */}
            {controller.isBoard && !editing && (
              <ReactionRow controller={controller} target={f.id} active={controller.selection?.kind === 'float' && controller.selection.id === f.id} />
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
  // 판정은 **두 신호의 합**이다: 기기가 터치인가(미디어 질의) 또는 지금 실제로
  // 소프트 키보드가 떠 있는가(visualViewport). 후자를 더한 이유는 앞의 하나가
  // "데스크톱"이라고 답하는 환경이 실제로 있기 때문이다(크롬 안드로이드의 데스크톱
  // 사이트 모드, 마우스를 붙인 태블릿, 일부 인앱 브라우저) — 그 화면에서도 Enter가
  // 편집을 끝내면 줄바꿈을 넣을 방법이 없다(제보).
  // `||`로 한 줄에 쓰면 앞이 true일 때 뒤의 훅이 **호출되지 않아** 훅 순서가 깨진다.
  const touchDevice = useIsTouchDevice();
  const keyboardOpen = useSoftKeyboardOpen();
  const softKeyboard = touchDevice || keyboardOpen;

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


  /** 최신 `doBreak`을 담아 둔다(노드와 동일 — 아래 리스너는 마운트 때 한 번만 붙는다). */
  /** IME 확정과 함께 줄을 바꾼 시각 — 같은 물리적 Enter의 메아리를 거른다
   * (위 {@link IME_BREAK_ECHO_MS} 참고). */
  const imeBreakAtRef = useRef(0);
  /** 줄바꿈 요청 — IME 메아리면 무시한다. keydown·beforeinput처럼 **브라우저가
   * 주는** 줄바꿈 신호는 전부 이 문을 지난다(compositionend는 원본이라 직접 호출). */
  const requestBreak = (el: HTMLDivElement): void => {
    if (Date.now() - imeBreakAtRef.current < IME_BREAK_ECHO_MS) return;
    doBreak(el);
  };

  const doBreakRef = useRef(requestBreak);
  doBreakRef.current = requestBreak;

  /**
   * 기본 줄바꿈 차단 안전망 — **네이티브** `beforeinput`에 건다(노드와 동일).
   *
   * React의 `onBeforeInput`은 네이티브 이벤트가 아니라 `textInput`/`keypress`에서
   * 합성한 폴리필이라 `inputType`이 없고 `insertParagraph`에는 뜨지도 않는다 —
   * 실측으로 안 막히는 것을 확인했다(안드로이드 IME의 `keyCode 229` Enter가 그대로
   * 실행돼 [마커|내용] 행을 쪼갠다).
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
    // Mount-once: 이 박스는 한 편집 세션 동안만 존재한다(NodeEditBox와 동일).
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
          // 이 줄바꿈이 원본이다 — 같은 Enter가 곧 keydown/beforeinput으로 한 번 더
          // 오더라도(제보: 한글로 쓰다 Shift+Enter를 누르면 두 줄) 걸러지도록 시각을 남긴다.
          imeBreakAtRef.current = Date.now();
          doBreak(el);
          return;
        }
        syncListStructure(el);
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
          if (ref.current) requestBreak(ref.current);
        } else if (e.key === 'Enter' && !composing && !e.shiftKey) {
          e.preventDefault();
          controller.commitFloatRichText(f.id, ref.current);
        } else if (e.key === 'Enter' && !composing && e.shiftKey) {
          e.preventDefault();
          if (ref.current) requestBreak(ref.current);
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
