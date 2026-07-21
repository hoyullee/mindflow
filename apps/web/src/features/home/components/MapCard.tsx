import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';

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

  const onOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (card.openable !== false) controller.selectCard(card.title);
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
    controller.openWithLoader(card.href, card.title);
  };

  const onDragStart = (e: DragEvent<HTMLAnchorElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', card.title);
    } catch {
      /* some browsers restrict dataTransfer outside real drag */
    }
    controller.setDraggingMap(card.title);
  };
  const onDragEnd = () => controller.clearDrag();

  const grey = card.openable === false;
  const cardStyle: CSSProperties = {
    border: card.selected ? '2px solid #f0663f' : '1px solid #ecdfd5',
    borderRadius: compact ? 10 : 14,
    background: grey ? '#fbf8f5' : '#fff',
    // The card no longer clips (was `overflow: hidden`) — otherwise the open ☰
    // menu is cut off inside the card. The thumbnail keeps its own top-corner
    // clip below, and an open menu raises the card above its grid neighbours.
    cursor: grey ? 'default' : 'pointer',
    transition: 'border-color .14s, box-shadow .14s, opacity .14s',
    display: 'block',
    position: 'relative',
    zIndex: card.menuOpen ? 30 : undefined,
    opacity: card.dragging ? 0.45 : 1,
    boxShadow: card.selected ? '0 0 0 3px rgba(240,102,63,.18)' : 'none',
    margin: card.selected ? -1 : 0,
    color: grey ? '#b6a596' : '#33281f',
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
          background: card.isFav ? '#fff' : 'rgba(255,255,255,.9)',
          border: `1px solid ${card.isFav ? '#f0c24a' : '#ecdfd5'}`,
          display: card.openable === false ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          lineHeight: 1,
          color: card.isFav ? '#e0a53c' : '#b6a596',
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
      <div
        className="menu-btn"
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          controller.toggleMenu(card.title);
        }}
        title="메뉴"
        aria-label="메뉴"
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 4,
          width: 28,
          height: 28,
          borderRadius: 8,
          background: 'rgba(255,255,255,.92)',
          border: '1px solid #ecdfd5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          lineHeight: 1,
          color: '#7c6d60',
          cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(0,0,0,.12)',
          // Revealed on hover (see home.css), but also when the menu is open or
          // the card is selected, so on touch (no hover) a selected map exposes
          // its ☰ menu button.
          opacity: card.menuOpen || card.selected ? 1 : 0,
          transition: 'opacity .15s',
        }}
      >
        ☰
      </div>
      )}

      {!compact && (
      <div onClick={stopPrevent} style={{ position: 'absolute', top: 44, right: 10, zIndex: 20, width: 150, background: '#fff', border: '1px solid #ecdfd5', borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,.16)', padding: '5px 0', display: card.menuOpen ? 'block' : 'none' }}>
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
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
            >
              <span style={{ color: '#e0a53c' }}>★</span> {card.isFav ? '즐겨찾기 해제' : '즐겨찾기'}
            </div>
          )}
          {card.showFavRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.setExportFor(card.title);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
            >
              <span style={{ display: 'flex', color: '#7c6d60' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </span>{' '}
              내보내기 <span style={{ marginLeft: 'auto', color: '#b6a596' }}>›</span>
            </div>
          )}
          {card.showMoveRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.setMoveFor(card.title);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
            >
              <span>📁</span> 폴더로 이동 <span style={{ marginLeft: 'auto', color: '#b6a596' }}>›</span>
            </div>
          )}
          {card.showSpaceMoveRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.setMoveSpaceFor(card.title);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
            >
              <span style={{ display: 'flex', color: '#7c6d60' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <path d="M17.5 14v7M14 17.5h7" />
                </svg>
              </span>{' '}
              스페이스로 이동 <span style={{ marginLeft: 'auto', color: '#b6a596' }}>›</span>
            </div>
          )}
          {card.showUnfolderRow && (
            <div
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.moveMapToFolder(card.title, null);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
            >
              <span style={{ display: 'flex', color: '#7c6d60' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <path d="M12 17v-6" />
                  <path d="M9 13.5 12 11l3 2.5" />
                </svg>
              </span>{' '}
              폴더에서 꺼내기
            </div>
          )}
          {card.showDivider && <div style={{ height: 1, background: '#f0e6dd', margin: '2px 0' }} />}
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.askDelete(card.title, card.docId);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#d64545' }}
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
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 12.5, cursor: 'pointer', color: '#9c8b7e' }}
          >
            ‹ 뒤로
          </div>
          <div style={{ height: 1, background: '#f0e6dd', margin: '2px 0' }} />
          <div
            className="menu-row"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.exportMapPNG(card.title, card.docId);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
          >
            <span style={{ display: 'flex', color: '#7c6d60' }}>
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
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
          >
            <span style={{ display: 'flex', color: '#7c6d60' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>{' '}
            JSON 파일 (.json)
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
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 12.5, cursor: 'pointer', color: '#9c8b7e' }}
          >
            ‹ 뒤로
          </div>
          <div style={{ height: 1, background: '#f0e6dd', margin: '2px 0' }} />
          {card.moveTargets.map((ft) => (
            <div
              key={ft.id}
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.moveMapToFolder(card.title, ft.id);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 12.5, cursor: 'pointer', color: '#9c8b7e' }}
          >
            ‹ 뒤로
          </div>
          <div style={{ height: 1, background: '#f0e6dd', margin: '2px 0' }} />
          {card.spaceMoveTargets.map((sp) => (
            <div
              key={sp.id}
              className="menu-row"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                controller.moveMapToSpace(card.title, sp.id);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              <span style={{ display: 'flex', color: '#7c6d60', flexShrink: 0 }}>
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
            background: card.openable ? 'rgba(52,168,83,.12)' : '#eeeae5',
            color: card.openable ? '#1e7a3a' : '#b6a596',
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
          background: grey ? '#f4f0eb' : `linear-gradient(135deg,#fdfbfa,${card.isDrive ? 'rgba(52,168,83,.07)' : 'rgba(0,0,0,.02)'})`,
          borderBottom: '1px solid #f0e6dd',
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
      <div style={{ padding: compact ? '8px 10px' : '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, marginBottom: compact ? 0 : 4 }}>
          {/* Cross-space "최근 항목" strip: a small dot in the owning space's color.
              Color alone is inaccessible information, so the dot carries the space
              name for screen readers (+ a hover tooltip), and a faint inset ring
              keeps low-luminance palette colors (amber/teal ≲3:1 on white) visible. */}
          {card.spaceColor &&
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
          <div style={{ fontSize: compact ? 12 : 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{card.title}</div>
        </div>
        {!compact && <div style={{ fontSize: 12, color: '#9c8b7e' }}>최근 항목:{card.when}</div>}
      </div>
    </a>
  );
}
