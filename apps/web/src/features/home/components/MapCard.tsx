import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import { formatFullDateTime, formatLastEdited } from '../timeFormat';
import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';
import { useCardActivation } from './useCardActivation';

interface Props {
  card: CardViewData;
  controller: HomeController;
  draggableEnabled: boolean;
  /** Recent-section variant: ~1/4 the footprint (half the thumbnail + tighter
   * text) and no ☰ menu button, so a recent entry reads as a quick-access
   * shortcut and is clearly distinct from a full card in the main list. */
  compact?: boolean;
}

/** Home.dc.html:251-303 `<sc-for list="{{ allCards }}">` — a single map/Drive-file card. */
export function MapCard({ card, controller, draggableEnabled, compact = false }: Props) {
  const stopPrevent = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // 한 번 = 선택 / 두 번 = 열기. 규칙과 그 함정들은 `useCardActivation`에.
  const activation = useCardActivation();

  const onOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (card.openable === false) return;
    const target = e.target as HTMLElement;
    if (target.closest && target.closest('.menu-btn,.menu-row,.fav-btn')) return;
    // 한 번에 바로 열리면 카드의 ☰ 메뉴(즐겨찾기·이동·내보내기·삭제)에 닿기 전에
    // 에디터로 넘어가 버려서, 카드에 딸린 동작을 쓸 방법이 사실상 없었다(제보).
    if (activation.click() === 'activate') {
      controller.openWithLoader(card.href, card.title, card.docId);
      return;
    }
    controller.selectCard(card.key); // 선택 → ☰/☆가 이 카드의 것으로 드러난다
  };
  const onDblOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    const target = e.target as HTMLElement;
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

  const onDragStart = (e: DragEvent<HTMLAnchorElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', card.key);
    } catch {
      /* some browsers restrict dataTransfer outside real drag */
    }
    controller.setDraggingMap(card.key);
  };
  const onDragEnd = () => controller.clearDrag();

  const grey = card.openable === false;
  const cardStyle: CSSProperties = {
    border: card.selected ? '2px solid var(--mf-accent)' : '1px solid var(--mf-border)',
    borderRadius: compact ? 10 : 14,
    background: grey ? 'var(--mf-panel-grey)' : 'var(--mf-panel)',
    // The card no longer clips (was `overflow: hidden`) — otherwise the open ☰
    // menu is cut off inside the card. The thumbnail keeps its own top-corner
    // clip below, and an open menu raises the card above its grid neighbours.
    cursor: grey ? 'default' : 'pointer',
    transition: 'border-color .14s, box-shadow .14s, opacity .14s',
    display: 'block',
    position: 'relative',
    zIndex: card.menuOpen ? 30 : undefined,
    opacity: card.dragging ? 0.45 : 1,
    boxShadow: card.selected ? '0 0 0 3px rgba(var(--mf-accent-rgb),.18)' : 'none',
    margin: card.selected ? -1 : 0,
    color: grey ? 'var(--mf-faint)' : 'var(--mf-text)',
    // 더블탭이 브라우저의 '두 번 눌러 확대' 제스처로 새지 않게 한다(스크롤·핀치는 유지).
    touchAction: 'manipulation',
  };

  return (
    <a
      href={card.href}
      onClick={onOpen}
      onDoubleClick={onDblOpen}
      draggable={draggableEnabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="map-card"
      data-title={card.title}
      style={cardStyle}
    >
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
          top: 10,
          left: 10,
          zIndex: 3,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: card.isFav ? 'var(--mf-panel)' : 'var(--mf-panel-veil)',
          border: `1px solid ${card.isFav ? 'var(--mf-star)' : 'var(--mf-border)'}`,
          display: card.openable === false ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          lineHeight: 1,
          color: card.isFav ? 'var(--mf-star)' : 'var(--mf-faint)',
          cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(0,0,0,.12)',
          // Revealed on hover (see home.css), but also whenever the card is
          // favorited or selected — so on touch (no hover) selecting a card
          // exposes its controls.
          opacity: card.isFav || card.selected ? 1 : 0,
          transition: 'opacity .15s, transform .1s',
        }}
      >
        {card.isFav ? '★' : '☆'}
      </div>


      {!compact && (
      <div onClick={stopPrevent} style={{ position: 'absolute', bottom: 44, right: 10, zIndex: 20, width: 150, background: 'var(--mf-panel)', border: '1px solid var(--mf-border)', borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,.16)', padding: '5px 0', display: card.menuOpen ? 'block' : 'none' }}>
        <div style={{ display: card.exportOpen || card.moveOpen || card.spaceMoveOpen ? 'none' : 'block' }}>
          {card.showFavRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.toggleFav(card.title, card.docId);
                controller.closeMenu();
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
            >
              <span style={{ color: 'var(--mf-star)' }}>★</span> {card.isFav ? '즐겨찾기 해제' : '즐겨찾기'}
            </div>
          )}
          {card.showFavRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.setExportFor(card.key);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
            >
              <span style={{ display: 'flex', color: 'var(--mf-subtext)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </span>{' '}
              내보내기 <span style={{ marginLeft: 'auto', color: 'var(--mf-faint)' }}>›</span>
            </div>
          )}
          {card.showMoveRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.setMoveFor(card.key);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
            >
              <span>📁</span> 폴더로 이동 <span style={{ marginLeft: 'auto', color: 'var(--mf-faint)' }}>›</span>
            </div>
          )}
          {card.showSpaceMoveRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.setMoveSpaceFor(card.key);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
            >
              <span style={{ display: 'flex', color: 'var(--mf-subtext)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <path d="M17.5 14v7M14 17.5h7" />
                </svg>
              </span>{' '}
              스페이스로 이동 <span style={{ marginLeft: 'auto', color: 'var(--mf-faint)' }}>›</span>
            </div>
          )}
          {card.showUnfolderRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.moveMapToFolder(card.key, null);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
            >
              <span style={{ display: 'flex', color: 'var(--mf-subtext)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <path d="M12 17v-6" />
                  <path d="M9 13.5 12 11l3 2.5" />
                </svg>
              </span>{' '}
              폴더에서 꺼내기
            </div>
          )}
          {card.showDivider && <div style={{ height: 1, background: 'var(--mf-border-soft)', margin: '2px 0' }} />}
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.askDelete(card.title, card.docId);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-danger)' }}
          >
            <span style={{ display: 'flex' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </span>{' '}
            삭제하기
          </div>
        </div>

        <div style={{ display: card.exportOpen ? 'block' : 'none' }}>
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.setExportFor(null);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 12.5, cursor: 'pointer', color: 'var(--mf-muted)' }}
          >
            ‹ 뒤로
          </div>
          <div style={{ height: 1, background: 'var(--mf-border-soft)', margin: '2px 0' }} />
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.exportMapPNG(card.title, card.docId);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
          >
            <span style={{ display: 'flex', color: 'var(--mf-subtext)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </span>{' '}
            PNG 이미지
          </div>
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.exportMap(card.title, card.docId);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
          >
            <span style={{ display: 'flex', color: 'var(--mf-subtext)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>{' '}
            JSON 파일 (.json)
          </div>
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.exportMapMarkdown(card.title, card.docId);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
          >
            <span style={{ display: 'flex', color: 'var(--mf-subtext)' }}>
              {/* 개요(불릿) 아이콘 — 목록 형태임을 보여 준다 */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="9" y1="6" x2="20" y2="6" />
                <line x1="11" y1="12" x2="20" y2="12" />
                <line x1="13" y1="18" x2="20" y2="18" />
                <circle cx="5" cy="6" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="7" cy="12" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none" />
              </svg>
            </span>{' '}
            Markdown 개요 (.md)
          </div>
        </div>

        <div style={{ display: card.moveOpen ? 'block' : 'none' }}>
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.setMoveFor(null);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 12.5, cursor: 'pointer', color: 'var(--mf-muted)' }}
          >
            ‹ 뒤로
          </div>
          <div style={{ height: 1, background: 'var(--mf-border-soft)', margin: '2px 0' }} />
          {card.moveTargets.map((ft) => (
            <div
              key={ft.id}
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.moveMapToFolder(card.key, ft.id);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              📁 {ft.name}
            </div>
          ))}
        </div>

        <div style={{ display: card.spaceMoveOpen ? 'block' : 'none' }}>
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.setMoveSpaceFor(null);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 12.5, cursor: 'pointer', color: 'var(--mf-muted)' }}
          >
            ‹ 뒤로
          </div>
          <div style={{ height: 1, background: 'var(--mf-border-soft)', margin: '2px 0' }} />
          {card.spaceMoveTargets.map((sp) => (
            <div
              key={sp.id}
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.moveMapToSpace(card.key, sp.id);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              <span style={{ display: 'flex', color: 'var(--mf-subtext)', flexShrink: 0 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </span>{' '}
              {sp.name}
            </div>
          ))}
        </div>
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

      <div
        className="map-thumb"
        style={{
          height: compact ? 72 : 150,
          background: grey ? 'var(--mf-panel2)' : `linear-gradient(135deg,var(--mf-panel),${card.isDrive ? 'rgba(52,168,83,.07)' : 'rgba(0,0,0,.02)'})`,
          borderBottom: '1px solid var(--mf-border-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: compact ? 22 : 30,
          filter: grey ? 'grayscale(1) opacity(.55)' : 'none',
          borderRadius: compact ? '10px 10px 0 0' : '14px 14px 0 0',
          overflow: 'hidden',
        }}
      >
        {card.sketch}
      </div>
      {/* 하단 정보 영역: [제목+수정일] 좌측 열 + ☰ 메뉴 버튼(영역 전체의
          세로 중앙) — 버튼을 제목 행 안에 두면 수정일 줄 때문에 시각적으로
          위로 치우쳐 보인다. */}
      <div style={{ padding: compact ? '8px 10px' : '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
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
          <div style={{ fontSize: compact ? 12 : 14, lineHeight: compact ? '15px' : undefined, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{card.title}</div>
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
        {/* 마지막 수정 시각 — 상대(7일 이내)/절대 혼합 표기, 전체 일시는 툴팁.
            시각 정보가 없는 카드(Drive 데모 등)는 줄 자체를 생략한다.
            공동 편집(0009) 이후: 마지막으로 **저장한 사람이 내가 아닐 때만** 이름을
            덧붙인다(0015). 혼자 쓰는 사람의 카드마다 자기 이름이 반복되면 정보가
            아니라 잡음이라, 이름은 알려 줄 게 있을 때만 나타난다. */}
        {!compact && formatLastEdited(card.updatedAt) && (
          <div
            title={card.editorName ? `${formatFullDateTime(card.updatedAt)} · ${card.editorName}님이 마지막으로 저장` : formatFullDateTime(card.updatedAt)}
            style={{ fontSize: 12, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            수정일 · {formatLastEdited(card.updatedAt)}
            {card.editorName ? ` · ${card.editorName}` : ''}
          </div>
        )}
        </div>
        {!compact && (
          <div
            className="menu-btn"
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.toggleMenu(card.key);
            }}
            title="메뉴"
            aria-label="메뉴"
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: 9,
              background: 'transparent',
              border: '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              lineHeight: 1,
              color: 'var(--mf-subtext)',
              cursor: 'pointer',
              // Revealed on hover (see home.css), but also when the menu is open
              // or the card is selected, so on touch (no hover) a selected map
              // exposes its ☰ menu button.
              opacity: card.menuOpen || card.selected ? 1 : 0,
              transition: 'opacity .15s',
            }}
          >
            ☰
          </div>
        )}
      </div>
    </a>
  );
}
