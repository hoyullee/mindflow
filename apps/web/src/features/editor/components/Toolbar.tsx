import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { EditorController } from '../useEditorState';
import { PresenceAvatars } from './PresenceAvatars';
import { StyleMenu } from './StyleMenu';
import { ExportMenu } from './ExportMenu';
import { AnchoredMenu } from './AnchoredMenu';
import { EditMenu, InsertMenu, ViewMenu, HelpMenu, MoreMenu, ShareGlyph } from './ToolbarMenus';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { BrandMark } from '../../../components/BrandMark';

interface ToolbarProps {
  controller: EditorController;
}

type MenuKey = 'edit' | 'insert' | 'view' | 'style' | 'export' | 'help' | 'more';

/**
 * Top menu bar (GNB) — a port of `.mf-topbar` (MindFlow.dc.html:36-96)
 * reorganized from a flat row of ~10 buttons into grouped dropdown menus:
 * 편집(실행취소/다시실행) · 삽입(도형/메모/선/영역) · 보기(맵/아웃라인) · 스타일 ·
 * 내보내기. Fewer top-level controls keeps the bar compact (no horizontal scroll
 * on mobile). Only one menu opens at a time; an outside click or an item pick
 * closes it. Keyboard shortcuts (Ctrl+Z, etc.) still work via the global handler
 * in `useEditorState`, independent of these menus.
 */
export function Toolbar({ controller }: ToolbarProps) {
  const th = controller.uiTheme; // GNB는 시스템 크롬 — 문서 테마와 무관하게 고정
  const isMobile = useIsMobile();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);

  const editRef = useRef<HTMLDivElement>(null);
  const insertRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const refs: Record<MenuKey, RefObject<HTMLDivElement>> = { edit: editRef, insert: insertRef, view: viewRef, style: styleRef, export: exportRef, help: helpRef, more: moreRef };

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent): void => {
      const wrap = refs[openMenu].current;
      if (wrap && !wrap.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [openMenu]);

  const close = (): void => setOpenMenu(null);
  const toggle = (k: MenuKey): void => setOpenMenu((cur) => (cur === k ? null : k));

  return (
    <div
      className="mf-ed-topbar"
      style={{
        height: 56,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 12px',
        background: th.panel,
        borderBottom: `1px solid ${th.border}`,
        zIndex: 20,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {/* 브랜드 로고 = 홈으로(사용자 요청). 독칩의 홈 버튼과 **같은 `goHome`**을
          쓴다 — 저장을 먼저 태우고 이동하는 동작이 갈라지지 않게. */}
      <button
        type="button"
        className="mf-ed-btn"
        onClick={controller.goHome}
        title="홈으로"
        // 독칩에도 "홈으로" 버튼이 있어 이름이 겹친다 — 스크린리더에서 구분되게
        // 브랜드를 붙인다(툴팁은 짧게 유지).
        aria-label="Geurio 홈으로"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '3px 8px 3px 4px',
          marginLeft: -4,
          flexShrink: 0,
          border: 'none',
          borderRadius: 10,
          background: 'none',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        <div style={{ width: 26, height: 26, borderRadius: 8, background: th.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: th.accentInk, fontWeight: 800, fontSize: 15 }}>
          <BrandMark size={16} color={th.accentInk} />
        </div>
        {/* Wordmark hidden on mobile to leave room for the menu items */}
        {!isMobile && <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.01em' }}>Geurio</div>}
      </button>

      <Divider theme={th} />

      {/* 보기 전용(#22): 편집·삽입·스타일은 전부 문서 변이라 감춘다. 대신 지금
          이 맵을 왜 못 고치는지 한눈에 보이도록 배지를 단다. */}
      {controller.readOnly && (
        <span
          title="보기 전용으로 초대된 맵이에요. 편집하려면 소유자에게 '편집 가능' 권한을 요청하세요."
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: isMobile ? 32 : 28,
            padding: '0 11px',
            borderRadius: 999,
            background: th.panel2,
            border: `1px solid ${th.border}`,
            color: th.subtext,
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          <EyeGlyph />
          보기 전용
        </span>
      )}
      {!controller.readOnly && (
        <>
          <MenuBarButton label="편집" wrapRef={editRef} open={openMenu === 'edit'} onToggle={() => toggle('edit')} th={th} isMobile={isMobile} width={230} align="left">
            <EditMenu controller={controller} onDone={close} isMobile={isMobile} />
          </MenuBarButton>
          {/* 화이트보드는 삽입할 것이 메모·이미지 둘뿐이고 그 둘이 하단 도구
              막대에 나와 있다 — 같은 동작의 진입점을 둘로 두지 않는다(요청:
              "GNB 메뉴에 들어가 있으니 불편하다"). 배경 우클릭 메뉴는 그대로
              (그건 "누른 자리에 만든다"는 다른 동작이다). */}
          {/* 칸반은 삽입할 것이 열·카드뿐이고 그 둘이 화면의 ＋ 버튼에 있다. */}
          {!controller.isBoard && !controller.isKanban && (
            <MenuBarButton label="삽입" wrapRef={insertRef} open={openMenu === 'insert'} onToggle={() => toggle('insert')} th={th} isMobile={isMobile} width={200} align="left">
              <InsertMenu controller={controller} onDone={close} isMobile={isMobile} />
            </MenuBarButton>
          )}
        </>
      )}
      {/* 보기 is a top-level trigger on desktop; on mobile it folds into the ☰ menu
          on the right (with 내보내기) so the narrow bar doesn't scroll. */}
      {!isMobile && (
        <MenuBarButton label="보기" wrapRef={viewRef} open={openMenu === 'view'} onToggle={() => toggle('view')} th={th} isMobile={isMobile} width={190} align="left">
          <ViewMenu controller={controller} onDone={close} isMobile={isMobile} />
        </MenuBarButton>
      )}
      {/* 도움말 — 디자인 원본의 헤더가 편집·보기·도움말 셋이다(요청). 단축키
          도움말은 여기로 모으고 보기 메뉴에서는 뺐다(진입점은 화면당 하나). */}
      {!isMobile && (
        <MenuBarButton label="도움말" wrapRef={helpRef} open={openMenu === 'help'} onToggle={() => toggle('help')} th={th} isMobile={isMobile} width={200} align="left">
          <HelpMenu controller={controller} onDone={close} isMobile={isMobile} />
        </MenuBarButton>
      )}
      {/* 칸반에는 캔버스가 없어 테마·레이아웃·연결선 스타일이 뜻을 갖지 않는다. */}
      {!controller.readOnly && !controller.isKanban && (
      <MenuBarButton
        label="스타일"
        wrapRef={styleRef}
        open={openMenu === 'style'}
        onToggle={() => toggle('style')}
        th={th}
        isMobile={isMobile}
        width={250}
        align="left"
        leading={
          <span
            aria-hidden="true"
            style={{
              width: 14,
              height: 14,
              borderRadius: 5,
              background: 'conic-gradient(from 210deg,#f0663f,#e0b23c,#3fae9e,#3f8fd0,#8a6bd1,#f0663f)',
              boxShadow: `inset 0 0 0 1.5px ${th.panel}`,
              flexShrink: 0,
            }}
          />
        }
      >
        <StyleMenu controller={controller} />
      </MenuBarButton>
      )}

      <div style={{ flex: '1 1 auto' }} />

      {/* 접속자 — 디자인 원본은 얼굴을 **상단 바 오른쪽 묶음 앞**에 겹쳐 세운다.
          예전의 떠 있는 알약("N명 접속 중")보다 캔버스를 덜 가리고, 얼굴 수가
          곧 사람 수다. 끊김·보안 경고는 여전히 `PresenceBar`가 맡는다. */}
      <PresenceAvatars controller={controller} isMobile={isMobile} />

      {/* 맵 안 검색 — 바로 열리는 버튼(Ctrl/⌘+F와 동일). 모바일에서도 남긴다:
          긴 맵에서 찾기는 터치 사용자가 더 아쉬운 기능이고 아이콘 하나 폭이다.
          칸반은 캔버스 텍스트를 훑는 검색이라 아직 대상이 없다(1단계 범위 밖). */}
      {!controller.isKanban && (
      <button
        type="button"
        className="mf-ed-btn"
        onClick={() => controller.setSearchOpen(!controller.searchOpen)}
        title="맵에서 검색 (Ctrl+F)"
        aria-label="맵에서 검색"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: isMobile ? 44 : 34,
          height: isMobile ? 44 : 34,
          marginRight: 2,
          border: 'none',
          borderRadius: 9,
          background: controller.searchOpen ? th.panel2 : 'none',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 15 15" aria-hidden="true">
          <circle cx="6.4" cy="6.4" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <line x1="10" y1="10" x2="13.6" y2="13.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      )}

      {/* 공유 — 메뉴가 아니라 바로 열리는 버튼이다(초대는 한 단계로 끝나는 동작이라
          플라이아웃을 한 겹 더 씌울 이유가 없다). 모바일에서는 ☰(MoreMenu) 항목으로
          접었다(요청) — 좁은 바에서 아이콘만 남은 버튼이라 뜻이 약했고, 자리를
          비운 만큼 남은 버튼들의 44px 터치 타겟이 여유로워진다. */}
      {!isMobile && (
        <button
          type="button"
          className="mf-ed-btn"
          onClick={controller.openShare}
          title="공유"
          aria-label="공유"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 34,
            padding: '0 13px',
            marginRight: 8,
            border: `1px solid ${th.border}`,
            // 알약 — 디자인 원본의 헤더 버튼 모양(요청). 내보내기(강조 알약)와
            // 짝을 이뤄 "보조 / 주 동작"이 한눈에 갈린다.
            borderRadius: 999,
            background: th.panel,
            color: th.text,
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <ShareGlyph />
          공유
        </button>
      )}
      {isMobile ? (
        /* Mobile: one ☰ button on the right holds 보기 + 내보내기 (see `MoreMenu`),
           so the bar fits without a horizontal scroll. */
        <MenuBarButton label="" ariaLabel="더보기" wrapRef={moreRef} open={openMenu === 'more'} onToggle={() => toggle('more')} th={th} isMobile={isMobile} width={210} align="right" leading={<HamburgerIcon />} noCaret>
          <MoreMenu controller={controller} onDone={close} isMobile={isMobile} />
        </MenuBarButton>
      ) : (
        /* 내보내기는 **보기 전용에서 감춘다**(요청). 편집·삽입·스타일과 같은 처리 —
           이 앱의 보기 전용은 "할 수 없는 것은 보이지 않는다"로 일관돼 있다.
           다만 이건 **보안 경계가 아니다**: 화면을 볼 수 있는 사람은 캡처할 수
           있다. 정책·마찰 장치로 이해할 것. */
        !controller.readOnly && (
          <MenuBarButton label="내보내기" wrapRef={exportRef} open={openMenu === 'export'} onToggle={() => toggle('export')} th={th} isMobile={isMobile} width={200} align="right" leading={<ExportGlyph />} primary>
            <ExportMenu controller={controller} onDone={close} />
          </MenuBarButton>
        )
      )}
    </div>
  );
}

/** One top-level menu-bar entry: a text trigger (optional leading glyph) + a
 * ▾ caret, with its dropdown portaled via `AnchoredMenu` when open. */
function MenuBarButton({
  label,
  ariaLabel,
  leading,
  wrapRef,
  open,
  onToggle,
  th,
  isMobile,
  width,
  align,
  noCaret,
  primary,
  children,
}: {
  label: string;
  ariaLabel?: string;
  leading?: ReactNode;
  wrapRef: RefObject<HTMLDivElement>;
  open: boolean;
  onToggle: () => void;
  th: EditorController['theme'];
  isMobile: boolean;
  width: number;
  align: 'left' | 'right';
  noCaret?: boolean;
  /** 강조 알약(내보내기) — 디자인 원본의 primary 버튼. */
  primary?: boolean;
  children: ReactNode;
}) {
  // 메뉴 트리거는 **테두리 없는 텍스트**다(디자인 원본) — 열렸을 때만 옅은 배경이
  // 깔린다. 예전엔 열림 표시로 강조색 테두리를 둘렀는데, 항목이 여럿이면 바가
  // 상자로 가득 차 보였다.
  const triggerStyle: CSSProperties = primary
    ? {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: isMobile ? 44 : 34,
        padding: '0 14px',
        border: `1px solid ${th.accent}`,
        borderRadius: 999,
        background: th.accent,
        color: th.accentInk,
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        boxShadow: `0 8px 18px -10px ${th.accent}`,
      }
    : {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: isMobile ? 44 : 34,
        padding: label ? '0 11px' : '0 9px',
        border: '1px solid transparent',
        borderRadius: 9,
        background: open ? th.panel2 : 'transparent',
        color: open ? th.text : th.subtext,
        fontSize: 13.5,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      };
  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" className="mf-ed-btn" onClick={onToggle} aria-expanded={open} aria-haspopup="menu" aria-label={ariaLabel} style={triggerStyle}>
        {leading}
        {label}
        {!noCaret && <Caret open={open} color={primary ? th.accentInk : th.subtext} />}
      </button>
      {open && (
        <AnchoredMenu anchorRef={wrapRef} width={width} align={align}>
          {children}
        </AnchoredMenu>
      )}
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1={3} y1={6} x2={21} y2={6} />
      <line x1={3} y1={12} x2={21} y2={12} />
      <line x1={3} y1={18} x2={21} y2={18} />
    </svg>
  );
}

function Caret({ open, color }: { open: boolean; color: string }) {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease', flexShrink: 0 }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** 보기 전용 배지의 눈 글리프. */
function EyeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** 공유 글리프 — 사람 + 더하기(초대). */
function ExportGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1={12} y1={15} x2={12} y2={3} />
    </svg>
  );
}

function Divider({ theme: th }: { theme: EditorController['theme'] }) {
  return <div style={{ width: 1, height: 24, background: th.border, flexShrink: 0 }} />;
}
