import { useEffect, useRef } from 'react';
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { formatFullDateTime, formatLastEdited } from '../timeFormat';
import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { useCardActivation } from './useCardActivation';
import { dotGridStyle } from '../chrome';
import { useVisibleOnce } from '../useVisibleOnce';
import type { NoteSketch } from '@mindflow/mindmap-core';
import { Avatar } from '../../editor/components/commentPinShape';

interface Props {
  card: CardViewData;
  controller: HomeController;
  draggableEnabled: boolean;
  /** Recent-section variant: ~1/4 the footprint (half the thumbnail + tighter
   * text) and no ☰ menu button, so a recent entry reads as a quick-access
   * shortcut and is clearly distinct from a full card in the main list. */
  compact?: boolean;
}

/**
 * 문서 **종류** 색 — 이제 카드 테두리가 아니라 **배지의 점**에만 쓴다.
 *
 * 예전에는 카드 테두리 전체를 이 색으로 칠했는데(요청), 홈 리디자인의 카드는 모두
 * 같은 옅은 경계선을 쓰고 종류는 **배지(점 + 이름)**가 말한다 — 색 테두리를 그대로
 * 두면 그리드가 초록·파랑·보라로 얼룩져 디자인 원본과 인상이 달라진다. 종류를
 * 알리는 신호는 여전히 세 겹이다: 배지 이름 · 배지 점 색 · 화이트보드/칸반의 흰 종이 바탕.
 * (색은 `home/theme.ts`의 `docMap`/`docBoard`/`docKanban` — 테마를 따르지 않는다.)
 */
function docKindColor(card: CardViewData): string {
  // 열 수 없는 카드(Drive 데모의 비지원 파일)는 종류를 말할 게 없다.
  if (card.openable === false) return 'var(--mf-faint)';
  if (card.isNote) return 'var(--mf-doc-note)';
  if (card.isKanban) return 'var(--mf-doc-kanban)';
  if (card.isBoard) return 'var(--mf-doc-board)';
  return 'var(--mf-doc-map)';
}

/**
 * 공책 카드 — 디자인 원본은 보드 카드와 **골격부터 다르다**.
 *
 * 보드 카드는 [썸네일 + 아래 제목 줄]인데, 공책에는 축소할 그림이 없다(글이라서다).
 * 그래서 디자인은 공책을 **한 장의 종이**로 그린다: 겹친 종이 그늘 · 모눈 바탕 ·
 * 오른쪽 책갈피 · 큰 제목 · 페이지 목록 · 표지 스케치. 214px 고정 높이 한 덩어리라
 * 썸네일/본문 경계선도 없다.
 *
 * 표지 색 하나(`ink`)가 제목·책갈피·스케치를 함께 정한다(코어 `noteCoverColor`의
 * 우선순위: 사용자 지정 > 태그 기본 > 흑연).
 *
 * 디자인의 스프링 링(`noteRings`)은 **원본에서도 꺼진 기본값**이라(headOp 0) 그리지
 * 않는다 — 켜진 모습이 없는 것을 옮기면 우리만 다른 그림이 된다.
 */
function NoteCardBody({ card, controller, selectMode }: { card: CardViewData; controller: HomeController; selectMode: boolean }) {
  const note = card.note;
  const ink = note?.cover ?? 'var(--mf-doc-note)';
  const titles = note?.pageTitles ?? [];
  const when = formatLastEdited(card.updatedAt);
  return (
    <>
      {/* 모눈 바탕 — 14px 격자. 종이 질감을 만드는 첫 겹이다. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 12,
          backgroundImage:
            'linear-gradient(90deg, color-mix(in srgb, var(--mf-border) 62%, transparent) 1px, transparent 1px),' +
            'linear-gradient(180deg, color-mix(in srgb, var(--mf-border) 62%, transparent) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
          backgroundPosition: '6px 6px',
          pointerEvents: 'none',
        }}
      />
      {/* 윗면의 빛 — 위쪽 38%에만 옅게. 종이가 평면이 아니라 **덮여 있는** 것처럼 보인다. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 12,
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--mf-card) 65%, transparent), transparent 38%)',
          pointerEvents: 'none',
        }}
      />
      {/* 책갈피 — 오른쪽 모서리에 표지 색으로 꽂힌 띠. 그리드에서 "공책"을 가장 빨리 말한다. */}
      <span
        aria-hidden="true"
        data-note-bookmark
        style={{
          position: 'absolute',
          top: 44,
          right: -1,
          width: 7,
          height: 40,
          borderRadius: '4px 0 0 4px',
          background: ink,
          boxShadow: '-1px 1px 2px rgba(46,42,38,.16)',
        }}
      />

      <div
        data-note-cover
        style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '18px 22px 14px 20px' }}
      >
        {/* 첫 줄 — 태그 · 수정 시각 · (검색 중이면) 위치 · ★. */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            role="button"
            tabIndex={-1}
            data-note-tag
            title="태그 바꾸기"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // 태그를 바꾸는 자리는 이미 카드 메뉴에 있다 — 칩은 그 메뉴를 칩 아래로 연다.
              const r = e.currentTarget.getBoundingClientRect();
              controller.openCtxMenu(r.left, r.bottom + 6, { kind: 'map', key: card.key });
            }}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 20,
              padding: '0 7px 0 6px',
              marginLeft: -6,
              borderRadius: 7,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '.02em',
              color: note?.tag ? 'var(--mf-text)' : 'var(--mf-faint)',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {note?.tag ? (
              <>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: note.tagColor, display: 'block', flexShrink: 0 }} />
                {note.tag}
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span style={{ fontWeight: 600 }}>태그</span>
              </>
            )}
          </span>
          {when && (
            <span title={formatFullDateTime(card.updatedAt)} style={{ fontFamily: 'var(--mf-mono, ui-monospace, monospace)', fontSize: 10, color: 'var(--mf-subtext)', whiteSpace: 'nowrap' }}>
              {when}
            </span>
          )}
          {/* 검색 중이면 **이 문서에서 걸린 줄 수**(`본문 2`) — 위의 `내용에서 찾은 것`과
              같은 셈이라, 카드만 보고도 왜 결과에 있는지 알 수 있다(디자인). */}
          {card.hits && (
            <span data-card-hits style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: '0 7px', borderRadius: 6, background: 'var(--mf-mark)', color: 'var(--mf-text)', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
              {card.hits.kind} {card.hits.count}
            </span>
          )}
          {/* 검색 결과 카드의 위치 — 검색은 폴더 경계를 넘으므로 어느 폴더인지 알려 준다. */}
          {card.pathLabel && (
            <span data-card-path title={card.pathLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--mf-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 2, background: card.spaceColor ?? 'var(--mf-faint)', display: 'block', flexShrink: 0 }} />
              {card.pathLabel}
            </span>
          )}
          <span style={{ flex: 1, minWidth: 0 }} />
          {/* ★과 ☰ — 디자인은 별을 카드 위에 떠 있는 칩이 아니라 **첫 줄의 끝**에 둔다.
              그래서 공책 카드는 겉에 얹히는 ☆ 버튼(`fav-btn`)을 쓰지 않는다.
              ☰도 여기로 왔다(질문: "아바타를 넣으면 3점 메뉴는 어디로?") — 맨 아랫줄은
              디자인에서 **읽는 줄**(페이지 수 · 공유 · 사람)이라 조작을 끼우면 그 읽기가
              끊긴다. 둘 다 hover에서 함께 나타나므로 한 벌의 조작 묶음으로 읽힌다. */}
          {!selectMode && (
            <button
              type="button"
              className="fav-btn"
              title="즐겨찾기"
              aria-label={card.isFav ? '즐겨찾기 해제' : '즐겨찾기'}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.toggleFav(card.title, card.docId);
              }}
              style={{
                width: 24,
                height: 24,
                flex: '0 0 auto',
                borderRadius: 8,
                border: 0,
                background: 'transparent',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                color: card.isFav ? 'var(--mf-star)' : 'var(--mf-faint)',
                opacity: card.isFav || card.selected ? 1 : 0,
                transition: 'opacity .16s ease, background .16s ease',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill={card.isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 3.6 2.5 5.2 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
              </svg>
            </button>
          )}
          {!selectMode && (
            <div
              className="menu-btn"
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                controller.openCtxMenu(r.right - 184, r.bottom + 6, { kind: 'map', key: card.key });
              }}
              title="메뉴"
              aria-label="메뉴"
              style={{
                width: 24,
                height: 24,
                flex: '0 0 auto',
                borderRadius: 8,
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mf-subtext)',
                cursor: 'pointer',
                opacity: card.menuOpen || card.selected ? 1 : 0,
                transform: card.menuOpen || card.selected ? 'translateY(0)' : 'translateY(2px)',
                transition: 'opacity .18s ease, transform .18s ease, background .15s ease',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </div>
          )}
        </div>

        {/* 공책 이름 — 표지 색으로 크게. 카드에서 가장 먼저 읽히는 것이 이 줄이다. */}
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 0 0' }}>
          <span
            data-note-title
            title={card.title}
            style={{
              display: 'block',
              width: '100%',
              padding: '0 0 2px',
              fontSize: 19,
              fontWeight: 800,
              letterSpacing: '-.04em',
              color: ink,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.title}
          </span>
        </div>

        {/* 페이지 목록(앞 세 장) + 표지 스케치 — 본문 첫 줄이 아니라 **목차**를 보여 준다.
            공책은 여러 장이 한 권이라, "무엇이 들어 있나"에 답하는 것이 목차다. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-start', gap: 12, paddingTop: 6, minWidth: 0, overflow: 'hidden' }}>
          <span data-note-pages style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {titles.map((t, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, height: 19 }}>
                <span aria-hidden="true" style={{ width: 4, height: 4, flex: '0 0 auto', borderRadius: 999, background: 'var(--mf-text)', opacity: 0.7, display: 'block' }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
              </span>
            ))}
            {!!note?.moreCount && (
              <span style={{ paddingLeft: 11, fontSize: 10.5, color: 'var(--mf-subtext)', lineHeight: '19px' }}>+{note.moreCount} 페이지 더</span>
            )}
          </span>
          <NoteSketchArt sketch={note?.sketch ?? 'grid'} ink={ink} />
        </div>

        {/* 맨 아랫줄 — 페이지 수 · 공유 표식 · ☰. 디자인의 아바타 자리를 ☰이 쓴다
            (우리 카드의 메뉴는 어느 종류에서나 같은 자리에 있어야 한다). */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>
            <span style={{ fontFamily: 'var(--mf-mono, ui-monospace, monospace)' }}>{note?.pageCount ?? 0}</span> 페이지
          </span>
          <span style={{ flex: 1, minWidth: 0 }} />
          {card.sharedLabel && (
            <span data-shared-badge role="img" title={card.sharedLabel} aria-label={`공유 중 — ${card.sharedLabel}`} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--mf-muted)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="9" cy="8" r="3" />
                <path d="M3 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 19a5 5 0 0 0-4-4.9" />
              </svg>
            </span>
          )}
          {/* 마지막으로 고친 사람의 얼굴(요청·디자인 원본) — 이름이 없으면 **내가**
              마지막으로 저장했다는 뜻이다(`document_editors`는 호출자 본인을 돌려주지
              않는다). 그래서 이름/사진이 없을 때 내 프로필로 떨어지는 것이 옳다.
              사진 주소가 죽으면 Avatar가 이름 첫 글자로 되돌아간다. */}
          <span
            role="img"
            title={card.editorName ? `${card.editorName}님이 마지막으로 수정` : '내가 마지막으로 수정'}
            aria-label={card.editorName ? `${card.editorName}님이 마지막으로 수정` : '내가 마지막으로 수정'}
            style={{ flexShrink: 0, display: 'inline-flex', borderRadius: 999, boxShadow: '0 0 0 1.5px var(--mf-card), 0 1px 3px rgba(46,42,38,.18)' }}
          >
            <Avatar
              name={card.editorName || controller.state.userName || '나'}
              size={22}
              src={card.editorName ? (card.editorAvatar ?? null) : controller.state.userAvatar}
            />
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * 표지 스케치 96×58 — 디자인 원본의 다섯 벌을 그대로. 전부 표지 색(`ink`) 한 색으로
 * 그린다. 태그별 기본값이 있어 같은 태그의 공책들이 한 눈에 묶여 보인다.
 */
function NoteSketchArt({ sketch, ink }: { sketch: NoteSketch; ink: string }) {
  if (sketch === 'none') return null;
  // 스케치 안의 면을 채우는 옅은 색 — 디자인의 `shade(ink, .86, 'w')`.
  const fill = `color-mix(in srgb, ${ink} 14%, var(--mf-card))`;
  const pill: CSSProperties = {
    position: 'absolute',
    padding: '2px 6px',
    border: `1.3px solid ${ink}`,
    borderRadius: 999,
    background: 'var(--mf-card)',
    fontSize: 7.5,
    fontWeight: 800,
    color: ink,
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  };
  const bar = (op: number, mr: number): CSSProperties => ({ flex: 1, height: 2, borderRadius: 999, background: ink, opacity: op, display: 'block', marginRight: mr });
  return (
    <span aria-hidden="true" data-note-sketch={sketch} style={{ flex: '0 0 auto', width: 96, height: 58, position: 'relative', display: 'block', opacity: 0.92 }}>
      {sketch === 'grid' && (
        <span style={{ position: 'absolute', inset: '4px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 3, transform: 'rotate(-2deg)' }}>
          {[0, 1, 2, 3].map((k) => (
            <span key={k} style={{ border: `1.3px solid ${ink}`, borderRadius: 3, background: fill, display: 'block' }} />
          ))}
        </span>
      )}
      {sketch === 'list' && (
        <span style={{ position: 'absolute', inset: 6, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, border: `1.3px solid ${ink}`, borderRadius: 2, display: 'block' }} />
            <span style={bar(0.55, 0)} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, border: `1.3px solid ${ink}`, borderRadius: 2, background: ink, display: 'block' }} />
            <span style={bar(0.35, 14)} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, border: `1.3px solid ${ink}`, borderRadius: 2, display: 'block' }} />
            <span style={bar(0.55, 26)} />
          </span>
          <span style={{ alignSelf: 'flex-end', marginTop: 2, padding: '1px 6px', border: `1.3px solid ${ink}`, borderRadius: 999, fontSize: 7.5, fontWeight: 800, color: ink, letterSpacing: '.02em', lineHeight: 1.3, whiteSpace: 'nowrap' }}>§1 · §2</span>
        </span>
      )}
      {sketch === 'clip' && (
        <>
          <span style={{ position: 'absolute', left: 4, top: 8, width: 60, height: 46, border: `1.3px solid ${ink}`, borderRadius: 5, background: fill, display: 'block', transform: 'rotate(-3deg)', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 9, borderBottom: `1.3px solid ${ink}`, display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px' }}>
              <span style={{ width: 3, height: 3, borderRadius: 999, background: ink, display: 'block' }} />
              <span style={{ width: 3, height: 3, borderRadius: 999, background: ink, display: 'block' }} />
            </span>
            <span style={{ position: 'absolute', left: 6, top: 15, width: 26, height: 16, borderRadius: 2, background: ink, opacity: 0.35, display: 'block' }} />
            <span style={{ position: 'absolute', left: 36, top: 15, width: 18, height: 3, borderRadius: 999, background: ink, opacity: 0.5, display: 'block' }} />
            <span style={{ position: 'absolute', left: 36, top: 22, width: 14, height: 3, borderRadius: 999, background: ink, opacity: 0.35, display: 'block' }} />
          </span>
          <span style={{ ...pill, right: 2, top: 2, transform: 'rotate(4deg)' }}>Insight</span>
          <span style={{ ...pill, right: 0, bottom: 4, transform: 'rotate(-3deg)' }}>Compare</span>
        </>
      )}
      {sketch === 'bulb' && (
        <>
          <span style={{ position: 'absolute', left: 18, top: 2, width: 44, height: 54, display: 'block', transform: 'rotate(-4deg)' }}>
            <svg width="44" height="54" viewBox="0 0 24 30" fill="none" stroke={ink} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 19.5A7 7 0 1 1 15.5 19.5c-.9.8-1.3 1.8-1.3 3.2H9.8c0-1.4-.4-2.4-1.3-3.2Z" fill={fill} />
              <path d="M9.8 25h4.4M10.6 27.5h2.8" />
              <path d="M12 12v4M10 14h4" />
            </svg>
          </span>
          <span style={{ position: 'absolute', right: 0, top: 10, width: 5, height: 5, borderRadius: 999, background: ink, opacity: 0.45, display: 'block' }} />
          <span style={{ position: 'absolute', right: 8, top: 2, width: 3, height: 3, borderRadius: 999, background: ink, opacity: 0.7, display: 'block' }} />
          <span style={{ ...pill, right: 2, bottom: 6, transform: 'rotate(3deg)' }}>Idea</span>
        </>
      )}
      {sketch === 'chart' && (
        <>
          <span style={{ position: 'absolute', inset: '6px 10px 4px 8px', borderLeft: `1.3px solid ${ink}`, borderBottom: `1.3px solid ${ink}`, display: 'flex', alignItems: 'flex-end', gap: 5, padding: '0 4px 0 6px', transform: 'rotate(-2deg)' }}>
            {[[38, 0.35], [62, 0.55], [48, 0.4], [84, 1]].map(([h, op], k) => (
              <span key={k} style={{ flex: 1, height: `${h}%`, borderRadius: '2px 2px 0 0', background: ink, opacity: op, display: 'block' }} />
            ))}
          </span>
          <span style={{ ...pill, right: -2, top: 0, transform: 'rotate(4deg)' }}>+24%</span>
        </>
      )}
    </span>
  );
}

/**
 * 최근 항목 트레이의 공책 — 214px 카드가 들어갈 자리가 아니다(트레이 카드는 그리드
 * 카드의 1/4 크기다). 그래서 여기서는 **책등 + 첫 장 제목 + 페이지 수**로 줄인다:
 * 그리드 카드의 요약본이되 "공책"임은 책등과 표지 색이 여전히 말한다.
 */
function NoteCompactCover({ card, grey }: { card: CardViewData; grey: boolean }) {
  const note = card.note;
  const ink = note?.cover ?? 'var(--mf-doc-note)';
  return (
    <div
      data-note-cover
      style={{
        position: 'relative',
        height: 74,
        background: grey ? 'var(--mf-panel2)' : `color-mix(in srgb, ${ink} 12%, var(--mf-card))`,
        borderBottom: '1px solid var(--mf-border-soft)',
        borderRadius: '14px 14px 0 0',
        overflow: 'hidden',
        display: 'flex',
        filter: grey ? 'grayscale(1) opacity(.55)' : 'none',
      }}
    >
      <span aria-hidden="true" style={{ width: 5, flex: '0 0 auto', background: ink, opacity: 0.9 }} />
      <span style={{ position: 'relative', flex: 1, minWidth: 0, padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '-.02em', color: `color-mix(in srgb, ${ink} 72%, var(--mf-text))`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {note?.pageTitles[0] ?? '제목 없는 페이지'}
        </span>
        <span style={{ marginTop: 'auto', fontSize: 10.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap' }}>{note?.pageCount ?? 0}페이지</span>
      </span>
    </div>
  );
}

/** 모바일 선택 모드 진입 — 누르고 있어야 하는 시간(iOS·안드로이드의 길게 누르기와 같은 길이). */
const LONG_PRESS_MS = 500;
/** 누르는 동안 허용하는 흔들림(px, 직선 거리) — 이보다 크면 스크롤 의도로 본다. */
const LONG_PRESS_SLOP = 10;

/** Home.dc.html:251-303 `<sc-for list="{{ allCards }}">` — a single map/Drive-file card. */
export function MapCard({ card, controller, draggableEnabled, compact = false }: Props) {
  // 한 번 = 선택 / 두 번 = 열기. 규칙과 그 함정들은 `useCardActivation`에.
  const activation = useCardActivation();
  // 첨부 이미지 URL은 이 카드가 **화면에 닿을 때** 발급받는다 — 스페이스 안의 모든
  // 카드가 한꺼번에 사진을 내려받지 않게(전송량). URL이 오기 전에는 미리보기가
  // 자리표시자를 그리고, 표시 크기는 문서에 있어 도착해도 레이아웃이 밀리지 않는다.
  const rootRef = useRef<HTMLAnchorElement | null>(null);
  const docId = card.docId;
  const noteVisible = controller.notePreviewVisible;
  useVisibleOnce(rootRef, () => { if (docId) noteVisible(docId); });
  // 선택 모드는 **모바일 레이아웃에서만** 켠다 — 선택 바가 모바일 툴바 자리를 쓰기
  // 때문이다(터치 화면이 달린 데스크톱에서 길게 눌러 들어가면 나갈 길이 없다).
  const isMobile = useIsMobile();
  const selectMode = controller.state.selectMode;

  // ---- 모바일 선택 모드: 길게 누르기(요청) ----
  // 시간을 **직접 잰다**(칸반 카드 드래그의 `beginPointerDrag`와 같은 골격):
  // 브라우저의 길게 누르기(=`contextmenu`)는 기기·브라우저마다 발화 여부가 갈리고,
  // iOS는 `-webkit-touch-callout: none`을 걸면 아예 오지 않기도 한다. 둘 중 **먼저
  // 오는 쪽**이 모드를 켜고, 나머지는 이미 켜져 있으므로 아무 일도 하지 않는다.
  const holdTimer = useRef<number | undefined>(undefined);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  /** 이번 제스처가 터치였는가 — `contextmenu`가 우클릭인지 길게 누르기인지 가른다. */
  const wasTouch = useRef(false);
  /** 길게 누르기로 모드에 들어간 직후 따라오는 클릭 한 번을 삼킨다. */
  const swallowClick = useRef(false);

  const cancelHold = () => {
    if (holdTimer.current !== undefined) window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    holdStart.current = null;
  };
  useEffect(() => cancelHold, []);

  /** 길게 누르기가 실제로 성립했을 때 — 두 경로(타이머·contextmenu)가 함께 쓴다. */
  const beginSelectMode = () => {
    cancelHold();
    swallowClick.current = true;
    if (controller.state.selectMode) return;
    // 메뉴가 손가락 **아래에서** 뜨는 것과 같은 이유로 시각만으로는 알아채기 늦다.
    navigator.vibrate?.(12);
    controller.enterSelectMode(card.key);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    wasTouch.current = e.pointerType === 'touch';
    // 새 제스처의 시작 — 앞선 제스처가 남긴 억제 플래그를 여기서 푼다(클릭이 끝내
    // 오지 않은 경우에도 다음 탭이 먹히도록).
    swallowClick.current = false;
    cancelHold();
    if (!wasTouch.current || !isMobile || compact || selectMode) return;
    const t = e.target as HTMLElement;
    if (t.closest && t.closest('.menu-btn,.fav-btn')) return;
    holdStart.current = { x: e.clientX, y: e.clientY };
    holdTimer.current = window.setTimeout(beginSelectMode, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    const s = holdStart.current;
    if (!s) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP) cancelHold();
  };

  const onOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const inControls = (e.target as HTMLElement).closest?.('.menu-btn,.menu-row,.fav-btn');
    // 길게 누르기로 방금 모드에 들어왔다 — 손을 떼며 따라오는 이 클릭은 토글이 아니다.
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    // 선택 모드에서는 탭이 곧 체크 토글이다(더블탭 열기는 아래에서 꺼진다).
    if (selectMode && !compact) {
      if (!inControls) controller.toggleCardSelected(card.key);
      return;
    }
    if (card.openable === false) return;
    if (inControls) return;
    // 한 번에 바로 열리면 카드의 ☰ 메뉴(즐겨찾기·이동·내보내기·삭제)에 닿기 전에
    // 에디터로 넘어가 버려서, 카드에 딸린 동작을 쓸 방법이 사실상 없었다(제보).
    // 수정 키를 쥔 클릭은 **선택을 고치는 동작**이지 여는 동작이 아니다 —
    // 여기서 활성화 판정을 태우면 Ctrl+클릭 두 번이 맵을 열어 버린다.
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    if (additive || range) {
      controller.selectCard(card.key, { additive, range });
      return;
    }
    if (activation.click() === 'activate') {
      controller.openWithLoader(card.href, card.title, card.docId);
      return;
    }
    controller.selectCard(card.key); // 선택 → ☰/☆가 이 카드의 것으로 드러난다
  };
  const onDblOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    const target = e.target as HTMLElement;
    // 선택 모드 안에서는 두 번 탭해도 열리지 않는다 — 그 시간대의 탭은 토글이다.
    if (selectMode && !compact) {
      e.preventDefault();
      return;
    }
    if (target.closest && target.closest('.menu-btn,.menu-row,.fav-btn')) {
      e.preventDefault();
      return;
    }
    if (card.openable === false) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (!activation.acceptDoubleClick()) return;
    controller.openWithLoader(card.href, card.title, card.docId);
  };

  // 우클릭 = ☰과 같은 메뉴, 커서 자리에(요청). 카드 안에서 처리하고 전파를 끊어
  // 배경 메뉴가 뒤이어 열리지 않게 한다.
  const onContextMenu = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // 최근 트레이 카드는 원래 메뉴가 없는 **바로가기**다(☰도 없다). 그래도 전파는
    // 끊는다 — 카드를 눌렀는데 빈 자리 메뉴("새로 만들기…")가 뜨면 더 이상하다.
    if (compact) return;
    // 터치의 `contextmenu`는 곧 **길게 누르기**다 — 그 뜻은 이제 선택 모드 진입이고,
    // 카드 메뉴는 ☰이 맡는다(터치에서는 ☰이 항상 보인다: home.css `@media (hover: none)`).
    if (wasTouch.current && isMobile) {
      beginSelectMode();
      return;
    }
    // 선택 **밖**에서 우클릭하면 그 카드 하나로 교체, **안**이면 선택을 유지한다
    // (OS 표준 — 여러 장을 골라 놓고 그중 하나를 우클릭하는 것이 일괄 동작의 길).
    if (!controller.state.selectedCards.includes(card.key)) controller.selectCard(card.key);
    controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'map', key: card.key });
  };

  const onDragStart = (e: DragEvent<HTMLAnchorElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', card.key);
    } catch {
      /* some browsers restrict dataTransfer outside real drag */
    }
    controller.setDraggingMap(card.key);
  };
  /** 선택 전체를 끌고 있는가 — 카드에 개수 배지를 띄운다. */
  const dragCount = card.dragging ? controller.dragKeys(card.key).length : 0;

  // `data-card-key`: 다중 선택의 범위(Shift)·전체 선택(Ctrl+A)이 **화면에 그려진
  // 순서**를 이 표식으로 읽는다. 최근 항목 트레이 카드(compact)는 원래 메뉴 없는
  // 바로가기라 표식을 달지 않는다 — 다중 선택에도 끼지 않는다(#345와 같은 결).
  const onDragEnd = () => controller.clearDrag();

  const grey = card.openable === false;
  /** 그리드의 공책 카드 — 디자인 원본이 **한 장의 종이**로 그리는 그 카드
   *  (`NoteCardBody`). 최근 항목 트레이(compact)는 크기가 1/4이라 요약본을 쓴다. */
  const notePaper = card.isNote && !compact;
  const cardStyle: CSSProperties = {
    // 문서 **종류**를 테두리 색으로 알린다(요청) — 마인드맵 초록 · 화이트보드 파랑 ·
    // 칸반 보라. 처음엔 화이트보드만 갈랐고 이름 영역에 가라앉은 면을 깔았는데 그
    // 색이 홈 배경과 비슷해 카드가 배경에 묻혀 보였다(제보) — 면 대신 선으로 옮겼고,
    // 이제 셋이 각자의 색을 쓴다. 선택 표시(강조색 2px + 글로우)와는 굵기·글로우로
    // 갈리므로 "선택된 것"과 헷갈리지 않는다.
    // 선택 표시는 **outline 링**(디자인 원본: 2px 강조색, 카드에서 2px 띄운다) —
    // 레이아웃에 영향이 없어 예전의 "테두리 2px + 음수 마진" 곡예가 필요 없다.
    border: '1px solid var(--mf-border)',
    outline: card.selected ? '2px solid var(--mf-accent)' : '2px solid transparent',
    outlineOffset: 2,
    borderRadius: compact ? 15 : 18,
    background: grey ? 'var(--mf-panel-grey)' : 'var(--mf-card)',
    // The card no longer clips (was `overflow: hidden`) — otherwise the open ☰
    // menu is cut off inside the card. The thumbnail keeps its own top-corner
    // clip below, and an open menu raises the card above its grid neighbours.
    cursor: grey ? 'default' : 'pointer',
    // ⚠️ transition은 인라인으로 두지 않는다 — home.css의 `.map-card` 규칙(transform
    // 포함)을 인라인이 덮어써서, hover의 떠오름이 전이 없이 A→B로 툭 바뀌었다(제보).
    display: 'block',
    position: 'relative',
    zIndex: card.menuOpen ? 30 : undefined,
    opacity: card.dragging ? 0.45 : 1,
    // 카드는 면 위에 **떠 있다**(디자인 원본) — 평소에도 옅은 그늘이 있고 마우스를
    // 얹으면 3px 떠오르며 그늘이 멀어진다(home.css의 `.map-card:hover`).
    // 고른 카드는 강조색 글로우가 그늘 위에 겹친다.
    boxShadow: compact ? 'var(--mf-card-shadow-sm)' : 'var(--mf-card-shadow)',
    color: grey ? 'var(--mf-faint)' : 'var(--mf-text)',
    // 더블탭이 브라우저의 '두 번 눌러 확대' 제스처로 새지 않게 한다(스크롤·핀치는 유지).
    touchAction: 'manipulation',
    // iOS는 길게 누르면 링크 미리보기/공유 시트를 띄운다 — 그 자리를 선택 모드가
    // 쓰므로 막는다(카드의 `user-select: none`은 home.css에 이미 있다, #418).
    WebkitTouchCallout: 'none',
    // 화면 밖 카드는 브라우저가 렌더링(스타일·레이아웃·페인트)을 건너뛴다 —
    // 썸네일 SVG가 카드마다 수백 노드라, 150맵 그리드의 마운트/재마운트 비용이
    // 뷰포트 분량으로 떨어진다(가상화의 저렴한 중간 단계: DOM·테스트·드래그·
    // 접근성·Ctrl+F 전부 무변경, 실측은 CLAUDE.md 항목 참고). intrinsic-size의
    // `auto`는 한 번 그려진 카드의 실제 크기를 기억하므로 추정값은 첫 페인트
    // 전 스크롤바 자리에만 쓰인다.
    contentVisibility: 'auto',
    containIntrinsicSize: compact ? 'auto 130px' : 'auto 220px',
  };
  if (notePaper) {
    // 공책은 [썸네일 + 제목 줄]이 아니라 **214px 고정 높이 한 덩어리**다(디자인 원본).
    // 테두리 한 줄 대신 겹친 종이 그늘이 카드 경계를 그리므로(home.css의 `.mf-note-card`)
    // border와 인라인 boxShadow를 모두 뺀다 — 인라인이 남으면 CSS의 겹친 그늘을 덮는다.
    cardStyle.height = 214;
    cardStyle.marginTop = 8;
    cardStyle.borderRadius = 12;
    cardStyle.border = 'none';
    cardStyle.display = 'flex';
    cardStyle.flexDirection = 'column';
    delete cardStyle.boxShadow;
    cardStyle.containIntrinsicSize = 'auto 222px';
  }

  return (
    <a
      ref={rootRef}
      href={card.href}
      onClick={onOpen}
      onDoubleClick={onDblOpen}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      draggable={draggableEnabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={notePaper ? 'map-card mf-note-card' : 'map-card'}
      data-title={card.title}
      data-card-key={compact ? undefined : card.key}
      style={cardStyle}
    >
      {/* 여러 장을 끌고 있다는 표시 — 끌리는 카드마다 개수를 달면 시끄러우므로
          **잡은 카드에만** 붙인다(브라우저의 드래그 이미지는 우리가 못 그린다). */}
      {dragCount > 1 && (
        <div
          data-drag-count
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            minWidth: 22,
            height: 22,
            padding: '0 6px',
            borderRadius: 999,
            background: 'var(--mf-accent)',
            color: 'var(--mf-accent-ink)',
            fontSize: 11.5,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,.18)',
            zIndex: 31,
          }}
        >
          {dragCount}
        </div>
      )}
      {/* 선택 모드의 체크 표시 — ★ 자리를 그대로 쓰고 그동안 ★은 감춘다(한 자리에
          두 표식이 겹치지 않게). 카드 전체가 이미 터치 타깃이라 이 동그라미는
          누르는 버튼이 아니라 **상태 표시**다(탭은 카드 어디서나 토글). */}
      {selectMode && !compact && (
        <div
          data-select-check
          aria-hidden="true"
          style={{
            position: 'absolute',
            // 공책 카드에는 ★이 카드 위에 떠 있지 않고 **첫 줄의 끝**에 있다 —
            // 체크도 그 자리(오른쪽 위)로 간다. 왼쪽 위에 두면 태그 칩을 덮는다.
            top: notePaper ? 14 : 10,
            ...(notePaper ? { right: 16 } : { left: 10 }),
            zIndex: 4,
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: card.selected ? 'var(--mf-accent)' : 'var(--mf-panel-veil)',
            border: `1.5px solid ${card.selected ? 'var(--mf-accent)' : 'var(--mf-border)'}`,
            color: 'var(--mf-accent-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,.12)',
          }}
        >
          {card.selected && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      )}

      {notePaper ? (
        <NoteCardBody card={card} controller={controller} selectMode={selectMode} />
      ) : (
        <>
      <div
        className="fav-btn"
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (card.openable !== false) controller.toggleFav(card.title, card.docId);
        }}
        title="즐겨찾기"
        aria-label={card.isFav ? '즐겨찾기 해제' : '즐겨찾기'}
        style={{
          position: 'absolute',
          top: compact ? 7 : 10,
          left: compact ? 7 : 10,
          zIndex: 3,
          width: compact ? 24 : 28,
          height: compact ? 24 : 28,
          // 원이 아니라 **둥근 사각**이다(디자인 원본) — 미리보기 위에 얹히는 칩들
          // (종류 배지·☰)과 같은 꼴이라 한 벌로 읽힌다.
          borderRadius: compact ? 8 : 9,
          background: card.isFav ? 'var(--mf-panel)' : 'var(--mf-panel-veil)',
          border: `1px solid ${card.isFav ? 'var(--mf-star)' : 'var(--mf-border)'}`,
          display: card.openable === false || (selectMode && !compact) ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: compact ? 13 : 15,
          lineHeight: 1,
          color: card.isFav ? 'var(--mf-star)' : 'var(--mf-faint)',
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          // Revealed on hover (see home.css), but also whenever the card is
          // favorited or selected — so on touch (no hover) selecting a card
          // exposes its controls.
          opacity: card.isFav || card.selected ? 1 : 0,
          transition: 'opacity .15s, transform .1s',
        }}
      >
        {card.isFav ? '★' : '☆'}
      </div>


      {/* 종류 배지 — 디자인 원본은 **모든 카드**에 종류를 적는다(마인드맵도).
          점 색은 카드 테두리와 같은 종류색이라 배지·테두리·바탕이 세 겹으로 같은
          것을 가리킨다. Drive 배지(`card.badge`)가 있는 카드는 그 자리를 양보한다. */}
      {!card.badge && card.openable !== false && (
        <div
          data-board-badge
          title={card.isNote ? '공책' : card.isKanban ? '칸반 보드' : card.isBoard ? '화이트보드' : '마인드맵'}
          style={{
            position: 'absolute',
            top: compact ? 7 : 10,
            right: compact ? 7 : 10,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: compact ? 4 : 5,
            height: compact ? 20 : 24,
            padding: compact ? '0 7px' : '0 9px',
            borderRadius: 999,
            background: 'var(--mf-panel-veil)',
            border: '1px solid var(--mf-border)',
            color: 'var(--mf-subtext)',
            fontSize: compact ? 9.5 : 10.5,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(6px)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: compact ? 5 : 6,
              height: compact ? 5 : 6,
              borderRadius: 2,
              background: docKindColor(card),
              display: 'block',
              flexShrink: 0,
            }}
          />
          {card.isNote ? '공책' : card.isKanban ? (compact ? '칸반' : '칸반 보드') : card.isBoard ? (compact ? '보드' : '화이트보드') : '마인드맵'}
        </div>
      )}

      {card.badge && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 46,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 999,
            background: card.openable ? 'rgba(52,168,83,.12)' : 'var(--mf-panel2)',
            color: card.openable ? 'var(--mf-success-ink)' : 'var(--mf-faint)',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {card.badge}
        </div>
      )}

      {card.isNote ? (
        <NoteCompactCover card={card} grey={grey} />
      ) : (
      <div
        className="map-thumb"
        style={{
          // 디자인 원본의 미리보기 높이(최근 74 / 그리드 150).
          height: compact ? 74 : 150,
          position: 'relative',
          // 바탕은 **그 문서의 캔버스 배경**이고 그 위에 같은 도트 격자가 깔린다 —
          // 미리보기가 진짜 "캔버스의 축소판"으로 읽힌다(제보: 에디터 배경색이
          // 반영되지 않는다). 본문을 아직 못 받아 무엇을 그릴지 모르면 지금까지의
          // 기본 바탕(wash)을 그대로 쓴다. 칸반은 캔버스가 아니라 크롬이라
          // `previewSurface`가 에디터 보드 바닥을 돌려준다.
          background: grey ? 'var(--mf-panel2)' : card.surface?.bg ?? 'var(--mf-wash)',
          borderBottom: '1px solid var(--mf-border-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: compact ? 22 : 30,
          filter: grey ? 'grayscale(1) opacity(.55)' : 'none',
          // 안쪽 반지름 = 겉면(15/18) − 테두리(1) — 미리보기가 모서리에서 삐져나오지 않게.
          borderRadius: compact ? '14px 14px 0 0' : '17px 17px 0 0',
          overflow: 'hidden',
        }}
      >
        {/* 도트 격자 — 내용(썸네일) **뒤**에 깔린다. 색은 그 문서 테마의 도트 색
            (에디터 캔버스와 같은 값). 회색 카드(열 수 없는 파일)에는 그리지 않고,
            칸반도 격자가 없다(`surface.dot === null`). */}
        {!grey && card.surface?.dot !== null && <span aria-hidden="true" data-dot-grid style={dotGridStyle(compact ? 13 : 18, card.surface?.dot ?? undefined)} />}
        {/* 실제 문서를 그린 썸네일 — 디자인 원본은 목업이라 추상 도형을 그렸지만,
            우리는 에디터와 같은 렌더러로 실제 내용을 그린다(`mapPreview`). 틀(wash·
            점 격자·배지)만 디자인을 따르고 내용은 진짜다. */}
        <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>{card.sketch}</span>
      </div>
      )}
      {/* 하단 정보 영역: [제목+수정일] 좌측 열 + ☰ 메뉴 버튼(영역 전체의
          세로 중앙) — 버튼을 제목 행 안에 두면 수정일 줄 때문에 시각적으로
          위로 치우쳐 보인다. */}
      <div style={{ padding: compact ? '9px 11px 11px' : '13px 14px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, marginBottom: compact ? 0 : 4 }}>
          {/* Cross-space "최근 항목" strip: a small dot in the owning space's color.
              compact(최근 항목)에서는 이 점을 제목 줄이 아니라 아래 경로 줄로 옮겼다 —
              색과 스페이스명이 붙어 있어야 의미가 통하고, 128px 카드에서 제목이 쓸 수
              있는 폭도 그만큼 넓어진다. (그리드 카드에는 `spaceColor`가 설정되지 않아
              실제로는 렌더되지 않지만, 향후 설정될 경우를 위해 분기는 남겨 둔다.) */}
          {!compact && card.spaceColor &&
            (card.spaceName ? (
              <span
                role="img"
                aria-label={`${card.spaceName} 스페이스`}
                title={card.spaceName}
                style={{ width: 8, height: 8, borderRadius: 3, background: card.spaceColor, flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.18)' }}
              />
            ) : (
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 3, background: card.spaceColor, flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.18)' }} />
            ))}
          {/* compact(최근 항목 트레이): lineHeight를 px로 고정 — 'normal'은 폰트
              메트릭을 따라가서 웹폰트 스왑 순간 카드/트레이 높이가 몇 px 출렁이고
              아래 툴바까지 밀렸다(새로고침 깜빡임). */}
          <div style={{ fontSize: compact ? 12 : 14, lineHeight: compact ? '15px' : undefined, fontWeight: 700, letterSpacing: compact ? '-.01em' : '-.015em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{card.title}</div>
          {/* "공유 중" 표식 — 제목 옆 사람 아이콘(Google Drive 관례). 에디터 공유
              버튼·카드 메뉴와 같은 글리프(같은 뜻은 같은 표식)이되, 여기는 상태
              표시라 더하기(+) 없이 사람 둘만 그린다. 자세한 내용은 툴팁으로. */}
          {card.sharedLabel && (
            <span
              data-shared-badge
              role="img"
              title={card.sharedLabel}
              aria-label={`공유 중 — ${card.sharedLabel}`}
              style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--mf-muted)' }}
            >
              <svg width={compact ? 11 : 13} height={compact ? 11 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
          )}
        </div>
        {/* 최근 항목 전용 위치 줄 — "● 폴더"(폴더가 없으면 "● 스페이스"). 최근
            트레이는 스페이스를 가로지르는 목록이라 제목만으로는 어느 위치의 맵인지
            알 수 없다.
            · 라벨은 가장 구체적인 한 조각만(`buildCardPath`) — 스페이스는 앞의 색
              점이 나타낸다. 좁은 폭을 변별력 있는 폴더명에 양보해 말줄임을 줄인다.
            · 높이(14) + marginTop(2)를 px로 고정: 폰트 스왑에 카드/트레이 높이가
              출렁이지 않게 하고, RecentStripSkeleton과 footprint를 정확히 맞춘다.
            · 위치를 알 수 없으면(빈 pathLabel) 줄 높이만 유지하고 아무것도 그리지
              않는다 — 한 행에 섞여도 카드 아랫변이 어긋나지 않는다.
            · a11y: 라벨에서 스페이스명이 빠지고 색 점은 시각 정보뿐이라, 줄 전체를
              `role="img"` + 전체 경로 `aria-label`로 묶어 스크린리더가 스페이스까지
              읽게 한다(코드베이스의 색 점과 같은 패턴). 마우스에는 같은 값을 title
              툴팁으로 준다 — 말줄임된 경우의 전체 경로 확인용. */}
        {compact && (
          <div
            {...(card.pathFull ? { title: card.pathFull, role: 'img', 'aria-label': `위치: ${card.pathFull}` } : {})}
            style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, height: 14, minWidth: 0 }}
          >
            {card.pathLabel && card.spaceColor && (
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2.5, background: card.spaceColor, flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.18)' }} />
            )}
            <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{card.pathLabel}</span>
          </div>
        )}
        {/* 검색 결과 카드의 위치 줄 — 검색은 폴더 경계를 넘으므로(viewModel) 어느
            폴더의 맵인지 알려 줘야 한다. 평소 그리드 카드는 `pathLabel`이 비어 있어
            이 줄 자체가 없다(레이아웃 무변화), 검색 중에는 결과 카드가 모두 같은
            조건이라 한 행 안에서 높이가 어긋나지 않는다. */}
        {!compact && (card.pathLabel || card.hits) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, minWidth: 0 }}>
            {card.pathLabel && (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--mf-faint)', flexShrink: 0 }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                {/* 위치는 **이 span 하나**다 — 옆의 `본문 N` 배지까지 감싸면 "어느
                    폴더인가"를 읽는 자리에 다른 글자가 섞인다. */}
                <span data-card-path title={card.pathLabel} style={{ fontSize: 11.5, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{card.pathLabel}</span>
              </>
            )}
            {card.hits && (
              <span data-card-hits style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: '0 7px', borderRadius: 6, background: 'var(--mf-mark)', color: 'var(--mf-text)', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
                {card.hits.kind} {card.hits.count}
              </span>
            )}
          </div>
        )}
        {/* 마지막 수정 시각 — 상대(7일 이내)/절대 혼합 표기, 전체 일시는 툴팁.
            시각 정보가 없는 카드(Drive 데모 등)는 줄 자체를 생략한다.
            공동 편집(0009) 이후: 마지막으로 **저장한 사람이 내가 아닐 때만** 이름을
            덧붙인다(0015). 혼자 쓰는 사람의 카드마다 자기 이름이 반복되면 정보가
            아니라 잡음이라, 이름은 알려 줄 게 있을 때만 나타난다. */}
        {!compact && formatLastEdited(card.updatedAt) && (
          <div
            title={card.editorName ? `${formatFullDateTime(card.updatedAt)} · ${card.editorName}님이 마지막으로 저장` : formatFullDateTime(card.updatedAt)}
            style={{ fontSize: 11.5, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            수정일 · {formatLastEdited(card.updatedAt)}
            {card.editorName ? ` · ${card.editorName}` : ''}
          </div>
        )}
        </div>
        {/* 선택 모드에서는 카드의 ☰을 감춘다 — 여러 장을 골라 둔 채 한 장의 메뉴를
            여는 것은 뜻이 어긋난다. 그때의 메뉴는 선택 바의 ⋯이다. */}
        {!compact && !selectMode && (
          <div
            className="menu-btn"
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // ☰과 우클릭은 같은 메뉴다 — 버튼 아래(왼쪽 정렬)에 띄운다.
              const r = e.currentTarget.getBoundingClientRect();
              controller.openCtxMenu(r.right - 184, r.bottom + 6, { kind: 'map', key: card.key });
            }}
            title="메뉴"
            aria-label="메뉴"
            style={{
              flexShrink: 0,
              // 심플하게 **점 셋만**(요청) — 면·테두리를 두르면 카드 안에서 버튼이
              // 하나 더 있는 것처럼 무거워 보인다. hover에서 글자색만 짙어진다.
              width: 28,
              height: 28,
              borderRadius: 9,
              background: 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--mf-subtext)',
              cursor: 'pointer',
              // Revealed on hover (see home.css), but also when the menu is open
              // or the card is selected, so on touch (no hover) a selected map
              // exposes its ⋯ menu button.
              opacity: card.menuOpen || card.selected ? 1 : 0,
              transform: card.menuOpen || card.selected ? 'translateY(0)' : 'translateY(2px)',
              transition: 'opacity .18s ease, transform .18s ease, background .15s ease',
            }}
          >
            {/* 가로 점 셋 — 디자인 원본. ☰(세 줄)은 "메뉴 열기"보다 "목록"으로 읽힌다. */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </div>
        )}
      </div>
        </>
      )}
    </a>
  );
}
