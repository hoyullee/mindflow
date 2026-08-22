import type { ReactNode } from 'react';
import type { EditorController } from '../useEditorState';
import type { Theme } from '../theme';
import { MenuRow } from '../../../components/Menu';

/**
 * Dropdown menu bodies for the editor's top menu bar (GNB) — 편집 / 삽입 / 보기.
 * (스타일 and 내보내기 keep their own bodies in `StyleMenu`/`ExportMenu`.) Each
 * is a plain list of `MenuItem` rows; **면·위치·키보드 이동은 `Menu`**(Radix
 * DropdownMenu)가 맡는다 — 예전에는 `MenuShell`이 면을 그리고 `AnchoredMenu`가
 * 위치를 손으로 계산했다.
 */

/** Bordered dropdown container — shared chrome for the list menus. */
/** 메뉴 내용 묶음 — **면·그늘·스크롤은 이제 `Menu`(Radix Content)가 들고 있다**.
 * 여기서는 항목을 담기만 하므로 껍데기가 비어 있다(패널이 둘로 겹치면 그늘이
 * 두 번 깔린다). 툴바 밖에서 이 컴포넌트를 쓰는 곳이 남아 있어 형태는 유지한다. */
export function MenuShell({ children }: { theme?: Theme; children: ReactNode; minWidth?: number }) {
  return <>{children}</>;
}

/** A single menu row: leading icon, label, optional trailing check (for a
 * currently-active choice) or shortcut hint. Disabled rows are greyed + inert. */
export function MenuItem({
  theme: th,
  icon,
  label,
  hint,
  active,
  disabled,
  isMobile,
  onClick,
}: {
  theme: Theme;
  icon?: ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  isMobile?: boolean;
  onClick: () => void;
}) {
  // 시각은 그대로, 몸통은 `MenuRow`(Radix `DropdownMenu.Item`)에 넘긴다 — 그래야
  // ↑/↓·Home/End·글자 타이핑이 통하고 고르면 메뉴가 스스로 닫힌다.
  return <MenuRow theme={th} icon={icon} label={label} hint={hint} active={active} disabled={disabled} isMobile={isMobile} onSelect={onClick} />;
}

export function EditMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.uiTheme;
  return (
    <MenuShell theme={th}>
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<UndoIcon />}
        label="실행 취소"
        hint="Ctrl+Z"
        disabled={!controller.canUndo}
        onClick={() => {
          controller.undo();
          onDone();
        }}
      />
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<RedoIcon />}
        label="다시 실행"
        hint="Ctrl+Shift+Z"
        disabled={!controller.canRedo}
        onClick={() => {
          controller.redo();
          onDone();
        }}
      />
      <MenuDivider theme={th} />
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<HistoryIcon />}
        label="버전 기록"
        onClick={() => {
          controller.setHistoryOpen(true);
          onDone();
        }}
      />
    </MenuShell>
  );
}

export function InsertMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.uiTheme;
  // 화이트보드의 어휘: 메모·이미지 + **연결선·영역**(요청). 스티커끼리 잇는 화살표와
  // 스티커를 담는 구획은 화이트보드의 기본 도구다 — 모델·렌더·마그넷 앵커
  // (`LineAnchor{kind:'float'}`)가 이미 있어서 M2에서 감췄던 진입점만 되돌려 놓으면 된다.
  // **주제(트리 노드)만은 계속 내주지 않는다** — 보드에는 레이아웃할 트리가 없다.
  // (보드에서 이 메뉴 자체는 GNB에 뜨지 않는다 — Toolbar가 감추고 하단 도구 막대와
  //  배경 우클릭이 삽입을 맡는다. 목록은 그 게이트가 바뀌어도 어휘가 어긋나지
  //  않도록 board 분기를 유지한다.)
  const items: { icon: ReactNode; label: string; run: () => void }[] = controller.isBoard
    ? [
        { icon: <MemoIcon />, label: '메모 추가', run: () => controller.addFloatAt() },
        { icon: <ImageIcon />, label: '이미지 추가', run: () => controller.promptAddImage() },
        { icon: <LineIcon />, label: '연결선 추가', run: () => controller.addLineAt() },
        { icon: <ZoneIcon />, label: '영역 추가', run: () => controller.addZoneAt() },
      ]
    : [
        { icon: <ShapeIcon />, label: '주제 추가', run: () => controller.addFreeNodeAt() },
        { icon: <MemoIcon />, label: '메모 추가', run: () => controller.addFloatAt() },
        { icon: <ImageIcon />, label: '이미지 추가', run: () => controller.promptAddImage() },
        { icon: <LineIcon />, label: '선 추가', run: () => controller.addLineAt() },
        { icon: <ZoneIcon />, label: '영역 추가', run: () => controller.addZoneAt() },
        // 스레드 — 화이트보드는 하단 도구 막대가 이 일을 맡지만 맵에는 막대가 없다
        // (요청). 다른 삽입과 달리 문서에 바로 넣지 않는다: 화면 가운데에 첫 글
        // 말풍선이 뜨고, 한 마디를 남겨야 핀이 들어간다.
        ...(controller.canComment ? [{ icon: <CommentIcon />, label: '스레드 추가', run: () => controller.startCommentDraft() }] : []),
      ];
  return (
    <MenuShell theme={th}>
      {items.map((it) => (
        <MenuItem
          key={it.label}
          theme={th}
          isMobile={isMobile}
          icon={it.icon}
          label={it.label}
          onClick={() => {
            it.run();
            onDone();
          }}
        />
      ))}
    </MenuShell>
  );
}

export function ViewMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.uiTheme;
  // 칸반의 **보기 모드**는 보드·리스트·타임라인 셋뿐이다(요청) — 맵/아웃라인·격자는
  // 캔버스의 것이고, 단축키 도움말은 GNB의 도움말 메뉴로.
  //
  // 보드 전체 댓글은 그 아래 구분선 뒤에 따로 둔다: 보드 머리의 아이콘 자리를
  // 필터에 내주면서(요청) 데스크톱에는 첫 댓글을 남길 길이 사라졌다. 모바일 ☰도
  // 예전부터 [보기 3종] + [댓글] 구성이라 두 화면이 같은 꼴이 된다.
  if (controller.isKanban) {
    return (
      <MenuShell theme={th}>
        {(['board', 'list', 'timeline'] as const).map((v) => (
          <MenuItem
            key={v}
            theme={th}
            isMobile={isMobile}
            icon={v === 'board' ? <BoardViewIcon /> : v === 'list' ? <OutlineIcon /> : <TimelineIcon />}
            label={v === 'board' ? '보드' : v === 'list' ? '리스트' : '타임라인'}
            active={controller.kanbanView === v}
            onClick={() => {
              controller.setKanbanView(v);
              onDone();
            }}
          />
        ))}
        {controller.canComment && (
          <>
            <MenuDivider theme={th} />
            <MenuItem
              theme={th}
              isMobile={isMobile}
              icon={<CommentIcon />}
              label="보드 전체 댓글"
              active={controller.commentsOpen}
              onClick={() => {
                if (controller.commentsOpen) controller.closeComments();
                else controller.openComments();
                onDone();
              }}
            />
          </>
        )}
      </MenuShell>
    );
  }
  return (
    <MenuShell theme={th}>
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<MapIcon />}
        label="맵"
        active={controller.view === 'map'}
        onClick={() => {
          controller.setView('map');
          onDone();
        }}
      />
      {/* 아웃라인 = 트리의 목차 — 화이트보드에는 트리가 없어 빈 화면뿐이다. */}
      {!controller.isBoard && (
        <MenuItem
          theme={th}
          isMobile={isMobile}
          icon={<OutlineIcon />}
          label="아웃라인"
          active={controller.view === 'outline'}
          onClick={() => {
            controller.setView('outline');
            onDone();
          }}
        />
      )}
      {/* 캔버스 문서에는 '댓글' 항목이 없다(요청 ⑧) — 댓글은 **댓글 핀**에만 붙으므로
          대상 없이 여는 목록이 성립하지 않는다. 남기는 길은 화이트보드 도구 막대의
          댓글 도구와 배경 우클릭의 '댓글 추가'이고, 읽는 길은 그 핀을 누르는 것이다. */}
      {/* 맞춤 도우미(요청) — 메모·이미지·영역을 끌면 **이웃의 기준선**(안내선)에
          먼저, 없으면 격자에 붙는다. 토글 하나가 둘을 함께 켜고 끈다(사용자에겐
          "손이 자석처럼 붙는다"는 한 가지 감각이다). 드래그 중 Alt는 그 순간만 끔. */}
      {!controller.readOnly && (
        <MenuItem
          theme={th}
          isMobile={isMobile}
          icon={<GridIcon />}
          label="안내선·격자에 맞추기"
          active={controller.snapGrid}
          onClick={() => {
            controller.setSnapGrid(!controller.snapGrid);
            onDone();
          }}
        />
      )}
    </MenuShell>
  );
}

/** 도움말 메뉴 — 단축키 도움말(요청: GNB에 편집·보기와 나란히). */
export function HelpMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.uiTheme;
  return (
    <MenuShell theme={th}>
      <MenuItem
        theme={th}
        isMobile={isMobile}
        icon={<HelpIcon />}
        label="단축키 도움말"
        hint="?"
        onClick={() => {
          controller.setHelpOpen(true);
          onDone();
        }}
      />
    </MenuShell>
  );
}

/** 칸반 보드 보기 아이콘 — 세로 열 셋. */
function BoardViewIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4" width="5.5" height="16" rx="1.4" />
      <rect x="9.25" y="4" width="5.5" height="16" rx="1.4" />
      <rect x="16" y="4" width="5.5" height="16" rx="1.4" />
    </svg>
  );
}

/** 타임라인 보기 아이콘 — 서로 다른 길이의 막대 셋. */
function TimelineIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h11M4 12h7M4 17h14" />
    </svg>
  );
}

/** Small uppercase section label inside a dropdown (used by `MoreMenu`). */
export function MenuSectionLabel({ theme: th, children }: { theme: Theme; children: ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: th.subtext, padding: '6px 10px 3px' }}>{children}</div>;
}
export function MenuDivider({ theme: th }: { theme: Theme }) {
  return <div style={{ height: 1, background: th.border, margin: '5px 6px' }} />;
}

/**
 * Combined overflow menu for the mobile toolbar's ☰ button — folds the 보기 and
 * 내보내기 menus into ONE dropdown (with section headers) so those two triggers
 * don't need their own room on the narrow bar (which otherwise scrolled). Desktop
 * keeps 보기/내보내기 as separate top-level triggers.
 */
export function MoreMenu({ controller, onDone, isMobile }: { controller: EditorController; onDone: () => void; isMobile?: boolean }) {
  const th = controller.uiTheme;
  return (
    <MenuShell theme={th}>
      {/* 공유 — 데스크톱은 GNB의 독립 버튼이지만 모바일은 이 메뉴가 진입점이다(요청).
          맨 위에 두는 이유: 이 메뉴에서 유일하게 "다른 사람"과 얽히는 항목이라
          보기/내보내기 묶음과 성격이 다르다. */}
      <MenuItem theme={th} isMobile={isMobile} icon={<ShareGlyph />} label="공유" onClick={() => { controller.openShare(); onDone(); }} />
      <MenuDivider theme={th} />
      <MenuSectionLabel theme={th}>보기</MenuSectionLabel>
      {/* 칸반의 보기는 보드·리스트·타임라인 셋뿐이다(데스크톱 보기 메뉴와 같은 규칙). */}
      {controller.isKanban ? (
        (['board', 'list', 'timeline'] as const).map((v) => (
          <MenuItem
            key={v}
            theme={th}
            isMobile={isMobile}
            icon={v === 'board' ? <BoardViewIcon /> : v === 'list' ? <OutlineIcon /> : <TimelineIcon />}
            label={v === 'board' ? '보드' : v === 'list' ? '리스트' : '타임라인'}
            active={controller.kanbanView === v}
            onClick={() => {
              controller.setKanbanView(v);
              onDone();
            }}
          />
        ))
      ) : (
        <>
          <MenuItem theme={th} isMobile={isMobile} icon={<MapIcon />} label="맵" active={controller.view === 'map'} onClick={() => { controller.setView('map'); onDone(); }} />
          {!controller.isBoard && (
            <MenuItem theme={th} isMobile={isMobile} icon={<OutlineIcon />} label="아웃라인" active={controller.view === 'outline'} onClick={() => { controller.setView('outline'); onDone(); }} />
          )}
          {!controller.readOnly && (
            <MenuItem theme={th} isMobile={isMobile} icon={<GridIcon />} label="안내선·격자에 맞추기" active={controller.snapGrid} onClick={() => { controller.setSnapGrid(!controller.snapGrid); onDone(); }} />
          )}
        </>
      )}
      {/* 칸반의 '보드 전체 댓글'만 남는다 — 캔버스 문서의 댓글은 핀에 붙는다(요청 ⑧). */}
      {controller.canComment && controller.isKanban && (
        <MenuItem theme={th} isMobile={isMobile} icon={<CommentIcon />} label="보드 전체 댓글" active={controller.commentsOpen} onClick={() => { if (controller.commentsOpen) controller.closeComments(); else controller.openComments(); onDone(); }} />
      )}
      {/* 내보내기는 보기 전용에서 감춘다(요청) — 데스크톱 툴바와 같은 규칙. */}
      {!controller.readOnly && (
        <>
          <MenuDivider theme={th} />
          <MenuSectionLabel theme={th}>내보내기</MenuSectionLabel>
          {/* 칸반에는 그릴 캔버스가 없다 — PNG 자리를 Markdown(열·카드 목록)에 내준다. */}
          {controller.isKanban ? (
            <MenuItem theme={th} isMobile={isMobile} icon={<OutlineIcon />} label="Markdown 개요 (.md)" onClick={() => { controller.exportMarkdown(); onDone(); }} />
          ) : (
            <MenuItem theme={th} isMobile={isMobile} icon={<PngIcon />} label="PNG 이미지" onClick={() => { controller.exportPNG(); onDone(); }} />
          )}
          <MenuItem theme={th} isMobile={isMobile} icon={<JsonIcon />} label="JSON 파일 (.json)" onClick={() => { controller.exportJSON(); onDone(); }} />
        </>
      )}
      <MenuDivider theme={th} />
      {/* 버전 기록의 복원은 문서 변이다 — 보기 전용(#22)에는 감춘다(기록 자체도
          이 기기에서 저장한 판이 없어 비어 있다). */}
      {!controller.readOnly && <MenuItem theme={th} isMobile={isMobile} icon={<HistoryIcon />} label="버전 기록" onClick={() => { controller.setHistoryOpen(true); onDone(); }} />}
      <MenuItem theme={th} isMobile={isMobile} icon={<HelpIcon />} label="단축키 도움말" onClick={() => { controller.setHelpOpen(true); onDone(); }} />
      <MenuItem theme={th} isMobile={isMobile} icon={<FeedbackIcon />} label="피드백 보내기" onClick={() => { controller.setFeedbackOpen(true); onDone(); }} />
    </MenuShell>
  );
}

// ---- icons (shared by the menu bar triggers + rows) ----
export function HistoryIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <polyline points="3 3 3 8 8 8" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}
/** 공유 글리프 — 사람 + 더하기(초대). GNB 버튼(데스크톱)과 ☰ 메뉴(모바일)가 공용. */
export function ShareGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}
export function FeedbackIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
/**
 * 댓글 — 말풍선 **안에 줄**. 피드백(빈 말풍선)과 나란히 놓이므로 일부러 다르게
 * 그린다: 같은 도형이면 같은 동작으로 읽힌다.
 */
/** 댓글 말풍선의 도형 — 아이콘·핀·마우스 커서가 **같은 문자열**을 쓴다(요청 ②·③).
 * 커서는 CSS 값이라 컴포넌트를 쓸 수 없어 path만 따로 내보낸다. */
export const COMMENT_GLYPH = {
  bubble: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  line1: 'M7.5 8.5h9',
  line2: 'M7.5 12h5.5',
};

export function CommentIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={COMMENT_GLYPH.bubble} />
      <path d={COMMENT_GLYPH.line1} />
      <path d={COMMENT_GLYPH.line2} />
    </svg>
  );
}
export function HelpIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={10} />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1={12} y1={17} x2={12.01} y2={17} />
    </svg>
  );
}

export function PngIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={3} width={18} height={18} rx={2} />
      <circle cx={8.5} cy={8.5} r={1.5} />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
export function JsonIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
export function UndoIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}
export function RedoIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  );
}
export function MapIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <circle cx={4} cy={5} r={2} />
      <circle cx={20} cy={5} r={2} />
      <circle cx={4} cy={19} r={2} />
      <circle cx={20} cy={19} r={2} />
      <path d="M10 10 5.5 6.5M14 10l4.5-3.5M10 14l-4.5 3.5M14 14l4.5 3.5" />
    </svg>
  );
}
export function OutlineIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1={8} y1={6} x2={21} y2={6} />
      <line x1={10} y1={12} x2={21} y2={12} />
      <line x1={12} y1={18} x2={21} y2={18} />
      <line x1={3} y1={6} x2={3.01} y2={6} />
      <line x1={5} y1={12} x2={5.01} y2={12} />
      <line x1={7} y1={18} x2={7.01} y2={18} />
    </svg>
  );
}
export function ShapeIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={6} width={18} height={12} rx={3} />
    </svg>
  );
}
export function ImageIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function MemoIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v11l-5 5H4z" />
      <path d="M15 20v-5h5" />
    </svg>
  );
}
export function LineIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="3.5 3.5">
      <path d="M4 20C9 18 15 6 20 4" />
    </svg>
  );
}
export function ZoneIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3">
      <rect x={3} y={5} width={18} height={14} rx={3} />
    </svg>
  );
}
export function ExportIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1={12} y1={15} x2={12} y2={3} />
    </svg>
  );
}

/** 격자 아이콘 — 3×3 점. 맞춤(안내선·격자) 토글용. */
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {[3, 8, 13].map((y) => [3, 8, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.3} fill="currentColor" />))}
    </svg>
  );
}
