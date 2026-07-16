import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';

interface Props {
  card: CardViewData;
  controller: HomeController;
  draggableEnabled: boolean;
}

/** Home.dc.html:251-303 `<sc-for list="{{ allCards }}">` — a single map/Drive-file card. */
export function MapCard({ card, controller, draggableEnabled }: Props) {
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
    borderRadius: 14,
    background: grey ? '#fbf8f5' : '#fff',
    overflow: 'hidden',
    cursor: grey ? 'default' : 'pointer',
    transition: 'border-color .14s, box-shadow .14s, opacity .14s',
    display: 'block',
    position: 'relative',
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
          opacity: card.isFav ? 1 : 0,
          transition: 'opacity .15s, transform .1s',
        }}
      >
        {card.isFav ? '★' : '☆'}
      </div>

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
          opacity: card.menuOpen ? 1 : 0,
          transition: 'opacity .15s',
        }}
      >
        ☰
      </div>

      <div onClick={stopPrevent} style={{ position: 'absolute', top: 44, right: 10, zIndex: 20, width: 150, background: '#fff', border: '1px solid #ecdfd5', borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,.16)', padding: '5px 0', display: card.menuOpen ? 'block' : 'none' }}>
        <div style={{ display: card.exportOpen || card.moveOpen ? 'none' : 'block' }}>
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
              controller.exportMapPNG(card.title);
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
              controller.exportMapOutline(card.title, card.docId);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
          >
            <span style={{ display: 'flex', color: '#7c6d60' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </span>{' '}
            텍스트 개요 (.md)
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
            MindFlow 파일 (.json)
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
      </div>

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
          height: 150,
          background: grey ? '#f4f0eb' : `linear-gradient(135deg,#fdfbfa,${card.isDrive ? 'rgba(52,168,83,.07)' : 'rgba(0,0,0,.02)'})`,
          borderBottom: '1px solid #f0e6dd',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 30,
          filter: grey ? 'grayscale(1) opacity(.55)' : 'none',
        }}
      >
        {card.sketch}
      </div>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.title}</div>
        <div style={{ fontSize: 12, color: '#9c8b7e' }}>최근 항목:{card.when}</div>
      </div>
    </a>
  );
}
