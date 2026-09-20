// 공책 에디터 — 캔버스가 아니라 **페이지의 글**.
//
// 화면은 둘로 갈린다(디자인 원본):
//   왼쪽  페이지 목록 — 이 공책의 페이지들. 제목 + 첫 줄 + 태그.
//   가운데 페이지 본문 — 제목 한 줄 + 블록들. 위에 서식 툴바가 붙는다.
//
// 팬·줌·미니맵·그리기·레이아웃이 없다(에디터가 `isNote`로 그 UI를 통째로 걷어낸다).
// 대신 다루는 것이 순서와 글이고, 규칙은 전부 코어 `note.ts`에 있다.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import type { Doc, NoteBlock, NoteBlockKind, NoteCalloutTone, NoteExportScope, NotePage, RichRun, TableFillTarget } from '@mindflow/mindmap-core';
import {
  NOTE_HIGHLIGHTS,
  NOTE_TAG_COLORS,
  NOTE_TAGS,
  noteBlockShape,
  noteMarkdown,
  notePlainText,
  parseDoc,
  noteCoverColor,
  noteHighlightColor,
  noteTagColor,
  pageExcerpt,
  pageText,
  listMarkers,
  roundSizes,
  runsText,
  textRuns,
  blockText,
  fillAt,
} from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { useDocStore } from '../../../adapters/BackendContext';
import type { Theme } from '../theme';
import { applyNoteFormat, noteActiveMarks, noteEditBoxInSelection } from '../noteRichDom';
import { buildSelection, caretAt, clearPaint as clearSelectionPaint, paint as paintSelection, paintRanges, selectionText, supportsHighlight, type LineSel } from '../noteTextSelect';
import { NoteLine } from './NoteLine';
import { runsToHtml } from '../richtextDom';
import { downloadFile } from '../download';
import { exportDocx } from '../docx';
import { openNotePrint } from '../notePrint';
import { PresenceAvatars } from './PresenceAvatars';
import { Avatar } from './commentPinShape';
import { formatLastEdited } from '../../home/timeFormat';
import { useIsTouchDevice } from '../../../hooks/useMediaQuery';

interface Props {
  controller: EditorController;
}

/** 블록 종류 메뉴 — 이름과 아이콘(디자인의 `BLOCKS`). 2판에서 붙는 종류는 없다. */
/**
 * `/` 커맨드가 고를 수 있는 **모든** 블록. 툴바의 `본문 ⌄` 메뉴는 이 가운데
 * **줄의 종류**(`inMenu`)만 보여 준다 — 표·이미지·구분선·문서 링크는 "이 줄을 무엇으로
 * 바꿀까"가 아니라 "여기에 무엇을 넣을까"라서 툴바 아이콘과 `/`가 맡는다.
 *
 * 목록 셋(글머리·번호·체크리스트)은 **메뉴에 있다**(제보). 한 번 뺐었는데, 그러면
 * 목록 줄에 커서를 뒀을 때 단추에는 `글머리 목록`이라 적히는데 열어 보면 그 항목이
 * 없다 — 라벨과 메뉴가 어긋난다. 목록은 문단과 서로 오갈 수 있는 **줄의 종류**가 맞다.
 */
const BLOCK_TYPES: { kind: NoteBlockKind; name: string; hint: string; desc: string; group: string; inMenu?: boolean; sepBefore?: boolean; icon: JSX.Element }[] = [
  { kind: 'p', name: '본문', hint: '⌘⌥0', desc: '일반 글', group: '기본', inMenu: true, icon: <path d="M4 7h16M4 12h16M4 17h10" /> },
  { kind: 'h1', name: '제목 1', hint: '⌘⌥1', desc: '가장 큰 제목', group: '기본', inMenu: true, icon: (<><path d="M4 5v14M12 5v14M4 12h8" /><path d="M17 9.5 19.5 8V19" /></>) },
  { kind: 'h2', name: '제목 2', hint: '⌘⌥2', desc: '섹션 제목', group: '기본', inMenu: true, icon: (<><path d="M4 5v14M11 5v14M4 12h7" /><path d="M15.5 10a2 2 0 1 1 3.4 1.4L15.5 16H20" /></>) },
  { kind: 'h3', name: '제목 3', hint: '⌘⌥3', desc: '작은 제목', group: '기본', inMenu: true, icon: (<><path d="M4 5v14M11 5v14M4 12h7" /><path d="M15.5 9.5h4.5l-2.5 3a2.2 2.2 0 1 1-2 3.6" /></>) },
  { kind: 'ul', name: '글머리 기호', hint: '', desc: '점으로 나열', group: '목록',   icon: (<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></>) },
  { kind: 'ol', name: '번호 매기기', hint: '', desc: '순서가 있는 나열', group: '목록',  icon: <path d="M10 6h10M10 12h10M10 18h10M4 5.5h1.5V9M4 9h3" /> },
  { kind: 'ck', name: '체크리스트', hint: '', desc: '할 일 · 결정 사항', group: '목록',  icon: (<><rect x="3" y="4" width="7" height="7" rx="1.6" /><path d="m4.6 7.4 1.6 1.6L9 6.2" /><path d="M13 7.5h8M13 17.5h8" /></>) },
  { kind: 'q', name: '인용', hint: '⌘⇧.', desc: '다른 글이나 말을 인용', group: '강조', inMenu: true, sepBefore: true, icon: <path d="M7 7h4v5c0 2-1 3.5-3 4.5M14 7h4v5c0 2-1 3.5-3 4.5" /> },
  { kind: 'callout', name: '콜아웃', hint: '', desc: '주의 · 결정 · 질문', group: '강조', inMenu: true, icon: (<><rect x="3.5" y="5" width="17" height="14" rx="3" /><path d="M12 9v3.5M12 15.5h.01" /></>) },
  { kind: 'toggle', name: '접기', hint: '', desc: '긴 내용을 접어 두기', group: '강조', inMenu: true, icon: (<><path d="m8 6 6 6-6 6" /><path d="M4 21h16" opacity=".35" /></>) },
  { kind: 'code', name: '코드 블록', hint: '⌘⌥C', desc: '고정폭 글꼴', group: '강조', inMenu: true, icon: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" /> },
  { kind: 'table', name: '표', hint: '', desc: '행과 열', group: '넣기', icon: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17M9.5 10v9M15 10v9" /></>) },
  { kind: 'img', name: '이미지', hint: '', desc: '파일을 올려 본문에', group: '넣기', icon: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17 4.5-4.5L14 17l3-3 3 3" /></>) },
  // 아이콘이 칸반 세 기둥이었는데, 이 블록은 **어떤 종류의 문서로든** 가는 링크다
  // (요청: "칸반 보드 모양이라 이상해"). 문서 한 장 + 사슬 — 종류를 말하지 않으면서
  // "다른 문서로 간다"만 말한다. 인라인 링크(주소)와는 **문서 모양**으로 갈린다.
  { kind: 'link', name: '문서 링크', hint: '', desc: '맵 · 보드 · 칸반 · 공책으로', group: '넣기', icon: (<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /><path d="M14 3v5h5" /><path d="M10.5 14.5a2.2 2.2 0 0 0 3.2.2l1.3-1.3a2.2 2.2 0 0 0-3.1-3.1l-.6.6" /><path d="M13.5 12.5a2.2 2.2 0 0 0-3.2-.2L9 13.6a2.2 2.2 0 0 0 3.1 3.1l.6-.6" /></>) },
  { kind: 'hr', name: '구분선', hint: '', desc: '섹션 나누기', group: '넣기', icon: (<><path d="M4 12h16" /><path d="M8 6h8M8 18h8" opacity=".35" /></>) },
];

/**
 * 잘라내기 — **맵·보드 에디터의 그 가위**다(제보: 다른 에디터와 다르다).
 *
 * 한 앱에서 같은 동작이 두 모양으로 그려지면 "같은 일인가"를 매번 다시 확인하게
 * 된다. 그쪽(`ContextMenu.tsx`의 `CutIcon`)은 손잡이 둘을 **아래에** 두고 날을
 * 위로 벌린 세로 가위다 — 이 파일도 같은 path를 쓴다. 바꿀 일이 생기면 둘을 함께.
 */
const CUT_ICON = (
  <>
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M8.1 15.9 19 3" />
    <path d="M15.9 15.9 5 3" />
  </>
);

/** 콜아웃 어조 셋 — 디자인의 `CALLOUTS`(이름, 바탕, 잉크). */
const TONES: { tone: NoteCalloutTone; name: string; bg: string; ink: string }[] = [
  { tone: 'warn', name: '주의', bg: 'var(--mf-accent-soft)', ink: 'var(--mf-accent-deep)' },
  { tone: 'decide', name: '결정', bg: 'var(--mf-success-soft)', ink: 'var(--mf-success)' },
  { tone: 'ask', name: '질문', bg: 'var(--mf-info-soft)', ink: 'var(--mf-info)' },
];

/** 인라인 서식 — 코어 `applyPartialStyle`의 종류와 1:1. */
const MARKS: { kind: 'b' | 'i' | 's' | 'u' | 'k'; label: string; name: string; css: CSSProperties }[] = [
  { kind: 'b', label: 'B', name: '굵게', css: { fontWeight: 800 } },
  { kind: 'i', label: 'I', name: '기울임', css: { fontStyle: 'italic' } },
  { kind: 's', label: 'S', name: '취소선', css: { textDecoration: 'line-through' } },
  { kind: 'u', label: 'U', name: '밑줄', css: { textDecoration: 'underline' } },
  { kind: 'k', label: '<>', name: '인라인 코드', css: { fontFamily: 'ui-monospace, monospace', fontSize: 11 } },
];

/**
 * 공책의 색 — **디자인 원본의 종이 팔레트를 값 그대로** 깐다.
 *
 * 공책은 캔버스가 아니라 **종이**다. 디자인 원본이 그 종이를 따뜻한 크림 한 벌로
 * 정해 두었고(바탕 `#FBF7F1` · 상단 `#F6F0E8` · 본문 `#FDFBF8` · 면 `#FFFDFB`),
 * 그 관계가 곧 이 화면의 인상이다. 그래서 여기서는 테마에서 **만들어 내지 않고**
 * 디자인 값을 그대로 쓴다(요청: "디자인 html과 완벽하게 동일하게").
 *
 * 테마를 아주 버리지는 않는다 — **강조색만** 문서 테마를 따른다(코랄이면 디자인과
 * 같은 주황이고, 오션이면 같은 종이에 파란 강조다). 그리고 **다크 테마에서는**
 * 종이 대신 테마에서 만든 값으로 통째로 바꾼다: 밝은 종이를 어두운 화면에 그대로
 * 두면 읽을 수 없다.
 *
 * 이 값들은 홈에서 쓰는 이름(`--mf-*`)을 **이 트리에서만** 덮는다 — 공책 UI가 홈에서
 * 옮겨 온 코드라 색을 그 이름으로 적기 때문이고, 덮지 않으면 한 화면에 팔레트가
 * 둘이 된다(본문은 문서 테마, 목록은 홈 테마).
 */
export function noteTokens(t: Theme): CSSProperties {
  const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  // 다크는 종이가 성립하지 않는다 — 테마에서 만든다(밝기 관계는 그대로: 목록이 어둡고
  // 본문이 밝다). 판정은 이름이 아니라 **배경의 밝기**로 한다(테마가 늘어나도 맞는다).
  if (luma(t.appBg) < 0.5) {
    return {
      '--mf-panel': t.appBg,
      '--mf-card': t.panel,
      '--mf-panel2': t.panel2,
      '--mf-border': t.border,
      '--mf-border-soft': mix(t.border, 60, t.panel),
      '--mf-border-hover': mix(t.accent, 26, t.border),
      '--mf-hairline': t.border,
      '--mf-text': t.text,
      '--mf-subtext': t.subtext,
      '--mf-muted': mix(t.subtext, 82, t.panel),
      '--mf-faint': mix(t.subtext, 66, t.panel),
      '--mf-faint2': mix(t.subtext, 48, t.panel),
      '--mf-accent': t.accent,
      '--mf-accent-ink': t.accentInk,
      '--mf-accent-soft': mix(t.accent, 18, t.panel),
      '--mf-accent-mute': mix(t.accent, 36, t.panel),
      '--mf-accent-deep': mix(t.accent, 70, t.text),
      '--mf-note-bar': t.appBg,
      '--mf-note-bar-dot': mix(t.border, 70, 'transparent'),
      '--mf-note-body': t.panel,
      '--mf-note-hover': t.panel2,
      '--mf-tag-on': mix(t.accent, 10, t.panel),
      // 표 — 손잡이 알약과 선택(면·링·글자). 값은 스펙의 밝은 테마 색과 같은 관계를
      // 테마에서 다시 만든다(색을 박으면 다크에서 종이 위에 베이지 띠가 뜬다).
      '--mf-th': mix(t.border, 80, t.panel),
      '--mf-tsel-bg': mix(t.accent, 20, t.panel),
      '--mf-tsel-ring': mix(t.accent, 76, t.panel),
      '--mf-tsel-text': mix(t.accent, 40, t.panel),
      '--mf-note-ck': t.border,
      '--mf-note-code-bg': t.panel2,
      '--mf-note-code-fg': t.text,
      '--mf-note-ok': '#5eaa5e',
      '--mf-note-ok-ink': '#8fb66f',
      ...TONE_TOKENS,
    } as CSSProperties;
  }
  return {
    '--mf-panel': '#fbf7f1', // 페이지 목록·바탕
    '--mf-card': '#fffdfb', // 면(툴바·팝업·카드·고른 행)
    '--mf-panel2': '#f4ede4', // 가라앉은 면(세그먼트 트랙)
    '--mf-border': '#efe4da',
    '--mf-border-soft': '#f3eae1', // 실선보다 옅은 경계(툴바 아래·통계 줄 위)
    '--mf-border-hover': '#eed8c8', // 고른 행의 테두리
    '--mf-hairline': '#efe4da',
    '--mf-text': '#3a352f',
    '--mf-subtext': '#8a8078',
    '--mf-muted': '#a29b90',
    '--mf-faint': '#b7aca1',
    '--mf-faint2': '#c3b8ac',
    // 강조색만 문서 테마를 따른다 — 코랄이면 디자인의 주황(#E85E33)과 같은 자리다.
    '--mf-accent': t.accent,
    '--mf-accent-ink': '#fffdfb',
    '--mf-accent-soft': mix(t.accent, 12, '#fffdfb'),
    '--mf-accent-mute': mix(t.accent, 34, '#fffdfb'),
    '--mf-accent-deep': mix(t.accent, 82, '#3a352f'),
    '--mf-note-bar': '#f6f0e8', // 상단 바 — 본문보다 한 톤 짙다
    '--mf-note-bar-dot': 'rgba(199,186,172,.28)', // 그 위의 도트 무늬(14px)
    '--mf-note-body': '#fdfbf8', // 본문 바탕 — 면보다 아주 살짝 어둡다
    '--mf-note-hover': '#f7f0e8', // 메뉴·단추에 마우스를 얹었을 때(요청 값)
    '--mf-tag-on': '#fbf3ee', // 태그 메뉴에서 **고른** 태그의 면(요청 값)
    '--mf-th': '#eadfd3', // 표 손잡이 알약(스펙 값)
    '--mf-tsel-bg': '#fbede6', // 고른 칸의 면(스펙 값)
    '--mf-tsel-ring': '#e8845c', // 고른 구역의 바깥 링(스펙 값)
    '--mf-tsel-text': '#fbdfcc', // 표 안에서 글자를 끌어 고른 자리(스펙 값)
    '--mf-note-ck': '#dcd1c6', // 체크 상자의 빈 테두리
    '--mf-note-code-bg': '#332e29',
    '--mf-note-code-fg': '#e7dacb',
    '--mf-note-ok': '#5eaa5e', // 저장됨 점
    '--mf-note-ok-ink': '#7a8b62', // 저장됨 글자
    ...TONE_TOKENS,
  } as CSSProperties;
}

/**
 * 어조·위험색은 **테마를 따르지 않는다** — 결정은 초록, 질문은 파랑, 삭제는 빨강이라는
 * 뜻이 색에 실려 있어 테마마다 달라지면 그 뜻이 흐려진다(맵 에디터와 같은 규칙).
 */
const TONE_TOKENS = {
  '--mf-success': '#4e8c67',
  '--mf-success-soft': '#ebf5ee',
  '--mf-info': '#3f8fd0',
  '--mf-info-soft': '#eaf2fb',
  '--mf-danger': '#c0563a',
} as const;

/** 상대 밝기(0~1) — 종이 팔레트를 쓸지 테마에서 만들지 가르는 기준. */
function luma(hex: string): number {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v.slice(0, 6), 16);
  if (Number.isNaN(n)) return 1;
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** 넣기 — 디자인 원본의 `TOOL_ICONS`. 아이콘은 그 파일의 path를 그대로 옮겼다. */
const INSERTS: { kind: NoteBlockKind; name: string; icon: JSX.Element }[] = [
  { kind: 'ul', name: '글머리 기호', icon: (<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" /></>) },
  { kind: 'ol', name: '번호 매기기', icon: (<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5.5h1.5V9M4 9h3M4 13.5c0-1 2-1.2 2-.2 0 .6-.6.9-2 2.2h2.4M4.2 17.5h1.6c1.2 0 1.2 1.5 0 1.5h-1.6" /></>) },
  { kind: 'ck', name: '체크리스트', icon: (<><rect x="3" y="4" width="7" height="7" rx="1.6" /><path d="m4.6 7.4 1.6 1.6L9 6.2" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><path d="M13 7.5h8M13 17.5h8" /></>) },
  { kind: 'table', name: '표', icon: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17M9.5 10v9M15 10v9" /></>) },
  { kind: 'img', name: '이미지', icon: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17 4.5-4.5L14 17l3-3 3 3" /></>) },
  { kind: 'hr', name: '구분선', icon: (<><path d="M4 12h16" /><path d="M8 6h8M8 18h8" opacity=".35" /></>) },
  { kind: 'link', name: '문서 링크', icon: (<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" /><path d="M14 3v5h5" /><path d="M10.5 14.5a2.2 2.2 0 0 0 3.2.2l1.3-1.3a2.2 2.2 0 0 0-3.1-3.1l-.6.6" /><path d="M13.5 12.5a2.2 2.2 0 0 0-3.2-.2L9 13.6a2.2 2.2 0 0 0 3.1 3.1l.6-.6" /></>) },
];

/** 가로 정렬 셋 — 디자인의 `alignTools` 앞 세 개. */
const ALIGNS: { align: 'left' | 'center' | 'right'; name: string; icon: JSX.Element }[] = [
  { align: 'left', name: '왼쪽 정렬', icon: <path d="M4 6h16M4 12h10M4 18h14" /> },
  { align: 'center', name: '가운데 정렬', icon: <path d="M4 6h16M7 12h10M5 18h14" /> },
  { align: 'right', name: '오른쪽 정렬', icon: <path d="M4 6h16M10 12h10M6 18h14" /> },
];

/** 들여쓰기 둘 — 같은 목록의 뒤 두 개. */
const INDENTS: { delta: number; name: string; icon: JSX.Element }[] = [
  { delta: -1, name: '내어쓰기', icon: (<><path d="M11 6h9M11 12h9M11 18h9" /><path d="m7 9-3 3 3 3" /></>) },
  { delta: 1, name: '들여쓰기', icon: (<><path d="M11 6h9M11 12h9M11 18h9" /><path d="m4 9 3 3-3 3" /></>) },
];

/** 글자색 — 스와치. 맵의 색 팔레트와 같은 값을 쓴다(한 앱에서 색이 두 벌이 되지 않게). */
const INKS: [string, string][] = [
  ['', '기본'],
  ['#d92626', '빨강'],
  ['#d98026', '주황'],
  ['#2f7d57', '초록'],
  ['#3e66b8', '파랑'],
  ['#8e5a80', '자두'],
];

export function NoteEditor({ controller }: Props) {
  const page = controller.notePage;
  const readOnly = controller.readOnly;
  /**
   * 서식 버튼을 누르면 포커스가 버튼으로 옮겨 가 선택이 풀린다. 그래서 **누르기
   * 전에**(mousedown) 지금 선택이 들어 있던 박스를 기억해 둔다.
   */
  const boxRef = useRef<HTMLElement | null>(null);
  const rememberBox = () => {
    const el = noteEditBoxInSelection();
    if (el) boxRef.current = el;
  };
  /** 포커스가 온 줄도 기억한다 — 선택이 접혀 있거나 툴바를 먼저 눌러도 대상을 잃지 않게. */
  const focusBox = (el: HTMLElement) => {
    boxRef.current = el;
  };
  /** 방금 만든 블록·항목 — 캐럿을 그리로 보낸다. */
  const [freshId, setFreshId] = useState<string | null>(null);
  /**
   * `/` 커맨드 — **빈 블록에서 `/`를 치면** 종류 목록이 뜬다(디자인).
   *
   * 글자 사이에서는 뜨지 않는다: 코드나 주소를 적다 `/`를 칠 때마다 메뉴가 끼어들면
   * 방해다. "빈 줄에서 시작한다"는 조건 하나로 그 오탐이 사라진다.
   */
  /**
   * `/` 목록 — 어느 블록에 걸리는지(`slashFor`)와 **어디서 열렸는지**(`slashAt`)를 함께
   * 든다. 예전에는 목록 맨 끝에 `absolute`로 붙어 있어, 툴바의 `/`로 열든 글 중간에서
   * 열든 **본문 맨 아래**에 떴다(제보). 이제 연 자리를 기준으로 뜬다.
   */
  const [slashFor, setSlashFor] = useState<string | null>(null);
  const [slashAt, setSlashAt] = useState<SlashAnchor | null>(null);
  /**
   * `/`가 놓인 **글자 자리** — 목록이 그 뒤에 이어 친 글자로 좁혀진다(요청·노션).
   * 툴바 단추로 열었으면 `null`이고, 그때는 예전처럼 목록이 그대로 다 보인다.
   */
  const [slashAtChar, setSlashAtChar] = useState<number | null>(null);
  const openSlashAt = (lineKey: string, from?: Element | number | null) => {
    const at = typeof from === 'number' ? from : null;
    const el = typeof from === 'number' || !from ? document.querySelector(`[data-note-line="${lineKey}"]`) : from;
    setSlashAt(measureSlash(el));
    setSlashFor(lineKey);
    setSlashAtChar(at);
  };
  /**
   * 본문을 굴려도 목록이 **따라간다**(제보: 스크롤하면 닫힌다) — 기준 줄을 다시 재
   * 자리만 고친다. 목록 쪽은 스크롤로 닫지 않도록 꺼 뒀다(`closeOnScroll: false`).
   */
  useEffect(() => {
    if (slashFor === null) return;
    const follow = () => {
      const el = document.querySelector(`[data-note-line="${slashFor}"]`);
      if (el) setSlashAt(measureSlash(el));
    };
    document.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [slashFor]);
  const closeSlash = useCallback(() => {
    setSlashFor(null);
    setSlashAtChar(null);
  }, []);
  /**
   * 집중 모드 — **페이지 목록을 왼쪽으로 밀어 넣는다**(요청).
   *
   * 디자인 원본은 본문 단을 700→640으로 좁혔는데, 그러면 글줄이 짧아질 뿐 화면은
   * 그대로 복잡하다. 목록이 사라지는 쪽이 "지금 이 장만 본다"에 곧바로 답한다.
   * 접힌 목록은 DOM에 남되 `inert`로 키보드 초점에서 빠진다(홈의 최근 항목과 같은 결).
   */
  const [focus, setFocus] = useState(false);
  /**
   * 본문 우클릭 메뉴(요청·디자인) — 어느 블록에서 열렸는지와 **그 편집 박스**를 함께
   * 든다. 박스를 기억하는 이유는 서식 항목이 그 박스의 선택에 걸리기 때문이다.
   */
  const [ctxAt, setCtxAt] = useState<BlockMenuAt | null>(null);
  /**
   * **블록을 가로지른 드래그 선택**(제보: 드래그로 글을 고를 수 없다 → 이어서: 블록이
   * 아니라 **글자**로 골라 달라).
   *
   * 왜 브라우저에 맡길 수 없나: 블록마다 편집 박스가 따로다(`contentEditable`이 블록
   * 단위다 — 비제어 박스라는 결정의 뿌리다). 브라우저의 선택은 **한 편집 호스트 안에
   * 갇혀** 있어서, 문단에서 끌어 아래 제목으로 넘어가면 그 경계에서 멈춘다(실측:
   * anchor·focus가 둘 다 첫 블록에 남는다). 한 블록 안에서는 지금도 잘 된다.
   *
   * 그래서 경계를 넘는 순간부터 우리가 **글자 구간**을 만들고 `CSS.highlights`로
   * 칠한다(`noteTextSelect`) — DOM을 건드리지 않으므로 비제어 박스와 부딪히지 않고,
   * 첫 줄은 중간부터·마지막 줄은 중간까지 칠해져 메모장·업노트의 그 선택으로 보인다.
   */
  const [textSel, setTextSel] = useState<LineSel[] | null>(null);
  /** 드래그가 시작된 자리 — 편집 박스와 그 안의 캐럿 지점. */
  const dragFrom = useRef<{ el: HTMLElement; node: Node; offset: number } | null>(null);
  const colRef = useRef<HTMLDivElement | null>(null);

  // Escape로 닫는다 — 팝업이 열려 있는 동안 본문 타이핑은 그대로 이어진다.
  useEffect(() => {
    if (!slashFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSlash();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [slashFor, closeSlash]);

  /**
   * 드래그의 끝 — **문서에** 건다. 본문 밖에서 손을 떼는 일이 흔하고(스크롤바·
   * 사이드바), 그때 기준 블록이 남아 있으면 다음 마우스 이동만으로 선택이 생긴다.
   */
  useEffect(() => {
    const done = () => {
      dragFrom.current = null;
    };
    document.addEventListener('pointerup', done);
    document.addEventListener('pointercancel', done);
    return () => {
      document.removeEventListener('pointerup', done);
      document.removeEventListener('pointercancel', done);
    };
  }, []);

  /**
   * `/` 뒤에 이어 친 글자 — **본문의 그 줄에서** 읽는다(입력칸이 따로 없다).
   *
   * 세션이 깨지는 조건도 여기서 본다: 그 자리의 글자가 더는 `/`가 아니거나(지웠다)
   * 줄이 사라졌으면 닫는다. 띄어쓰기는 그대로 둔다 — `/할 일`처럼 이름에 공백이 든
   * 항목이 있고, 맞는 것이 없으면 아래에서 어차피 닫힌다.
   */
  const slashQuery = useMemo(() => {
    if (slashFor === null || slashAtChar === null || !page) return '';
    const text = noteLineText(page, slashFor);
    return text[slashAtChar] === '/' ? text.slice(slashAtChar + 1) : '';
  }, [slashFor, slashAtChar, page]);
  /**
   * 세션이 살아 있는지 — **`/`를 본 뒤에만** 판단한다.
   *
   * 여는 순간에는 모델이 아직 그 글자를 모른다(키를 누른 직후에 열고, 글자는 그
   * 뒤에 들어와 커밋된다). 그때 바로 검사하면 열자마자 닫힌다(실측으로 그랬다).
   */
  const slashSeen = useRef(false);
  useEffect(() => {
    if (slashFor === null || slashAtChar === null) slashSeen.current = false;
  }, [slashFor, slashAtChar]);
  useEffect(() => {
    if (slashFor === null || slashAtChar === null || !page) return;
    const text = noteLineText(page, slashFor);
    if (text[slashAtChar] === '/') slashSeen.current = true;
    else if (slashSeen.current) {
      closeSlash(); // `/`를 지웠다
      return;
    } else return; // 아직 글자가 들어오기 전
    /**
     * **글을 쓰는 중으로 넘어갔을 때** 접는다(스펙 §4) — 연속 공백이나 줄바꿈이
     * 들어오면 그건 더 이상 블록 이름이 아니다. 어느 쪽이든 **친 글자는 그대로
     * 둔다**(스펙 §8: 지우는 것은 항목을 고른 경우뿐이다).
     */
    if (/\s\s|\n/.test(slashQuery)) {
      closeSlash();
      return;
    }
    /**
     * **공백이 있고 공백을 뺀 길이가 7 이상**이면 접는다(요청).
     *
     * 스펙의 값은 5였는데 그대로는 우리 목록을 쓸 수 없었다 — `글머리 목록`(6)
     * `번호 목록`·`코드 블록`·`문서 링크`(각 5)처럼 **이름에 공백이 든 블록**이
     * 다섯이라 이름을 끝까지 치는 순간 닫혔다. 7이면 가장 긴 이름(6)을 넘어서므로
     * 조건 하나로 깔끔하다(예전에 덧대 두었던 "맞는 것이 없을 때"는 걷었다).
     */
    const bare = slashQuery.replace(/\s/g, '');
    if (/\s/.test(slashQuery) && bare.length >= 7) closeSlash();
  }, [slashFor, slashAtChar, slashQuery, page, closeSlash]);

  /** 고른 줄들의 블록 id — 칠하기가 안 되는 브라우저에서 면으로 물러설 때 쓴다. */
  const selectedIds = useMemo(() => (textSel ?? []).map((l) => blockIdOf(l.key)), [textSel]);

  /**
   * 칠하기는 DOM 작업이라 그리고 난 뒤에 — 선택이 바뀔 때마다 다시 칠한다.
   *
   * **한 줄 안의 선택도 여기서 칠한다**(제보: 한 줄과 여러 줄의 배경 크기가 다르다).
   * 브라우저의 `::selection`은 **줄 높이**를 통째로 덮고 `::highlight()`는 **글자
   * 상자**만 덮는다(실측: 같은 문단에서 27px 대 17px). 그래서 같은 동작이 한 줄에서는
   * 도톰하게, 여러 줄에서는 얄팍하게 보였다. 본문 줄의 `::selection`을 투명하게 두고
   * (CSS) 브라우저가 만든 구간도 같은 하이라이트로 다시 그려 한 벌로 맞춘다.
   *
   * 표의 칸과 제목 입력칸은 손대지 않는다 — 거기서는 브라우저 칠이 그대로다.
   */
  useEffect(() => {
    if (textSel && textSel.length) {
      paintSelection(textSel);
      return () => clearSelectionPaint();
    }
    const lineOf = (node: Node | null): HTMLElement | null => {
      const el = node?.nodeType === 1 ? (node as HTMLElement) : (node?.parentElement ?? null);
      return (el?.closest?.('[data-note-line]') as HTMLElement | null) ?? null;
    };
    const follow = (): void => {
      const col = colRef.current;
      const s = window.getSelection();
      if (!col || !s || s.isCollapsed || s.rangeCount === 0) {
        clearSelectionPaint();
        return;
      }
      const range = s.getRangeAt(0);
      const a = lineOf(range.startContainer);
      // 한 줄 안에서, 본문 단 안에서, 표 밖일 때만 — 나머지는 브라우저에 맡긴다.
      if (!a || a !== lineOf(range.endContainer) || !col.contains(a) || a.closest('.mf-note-table')) {
        clearSelectionPaint();
        return;
      }
      paintRanges([range.cloneRange()]);
    };
    follow();
    document.addEventListener('selectionchange', follow);
    return () => {
      document.removeEventListener('selectionchange', follow);
      clearSelectionPaint();
    };
  }, [textSel]);

  /**
   * 글자 선택 위의 키보드 — 복사·잘라내기·지우기·Esc.
   *
   * `copy`/`cut` 이벤트에 얹지 않는 이유: 브라우저의 선택은 비워 둔 상태라(칠하기로
   * 대신 보여 준다) 그 이벤트가 오지 않는다. 키를 직접 읽고 클립보드에 쓴다 —
   * 막혀 있으면 조용히 넘어간다(지우기는 그대로 동작한다).
   *
   * 지우기는 **글자 단위**다: 첫 줄의 앞부분과 마지막 줄의 뒷부분을 이어 붙이고
   * 그 사이 블록들을 뺀다(노션·메모장과 같은 결과).
   */
  useEffect(() => {
    const sel = textSel;
    if (!sel || !sel.length || !page) return;
    const remove = () => {
      const first = sel[0]!;
      const last = sel[sel.length - 1]!;
      /**
       * **줄의 단위는 블록만이 아니다**(제보: 목록 여러 줄을 끌어 지우면 첫 줄의
       * 글자만 지워진다). 예전에는 여기서 "가운데 **블록**들을 지운다"만 했는데,
       * 목록의 여러 줄은 한 블록 안의 **항목**이라 지울 블록이 하나도 없었다.
       * 이제 컨트롤러가 항목까지 보고 한 커밋으로 들어낸다.
       */
      const done = controller.deleteNoteTextRange({ key: first.key, at: first.from }, { key: last.key, at: last.to });
      if (!done) {
        setTextSel(null);
        return;
      }
      // 비제어 박스라 DOM도 함께 고쳐 준다(모델만 바꾸면 화면에 옛 글자가 남는다).
      const el = document.querySelector<HTMLElement>(`[data-note-line="${done.key}"]`) ?? first.el;
      el.innerHTML = runsToHtml({ text: runsText(done.runs), rich: done.runs });
      caretToLine(done.key, done.at);
      setTextSel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTextSel(null);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const text = () => selectionText(sel);
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        void navigator.clipboard.writeText(text()).catch(() => undefined);
      } else if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        void navigator.clipboard.writeText(text()).catch(() => undefined);
        if (!readOnly) remove();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && !readOnly) {
        e.preventDefault();
        remove();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [textSel, page, controller, readOnly]);

  /**
   * **⌘F = 이 공책 안에서 찾기**(요청: 공책에서도 단축키를 다 쓰게).
   *
   * 전역 핸들러(`useEditorState`)의 ⌘F는 **맵 검색 바**를 연다 — 공책 화면에는 그
   * 바가 없으므로 아무 일도 일어나지 않았다. 공책의 같은 자리는 페이지 목록 위의
   * 찾기 칸이라 거기로 초점을 보낸다. 전역보다 **먼저** 잡아야 하므로(window보다
   * document가 앞이다) 여기서 전파를 끊는다.
   *
   * 집중 모드에서는 목록이 `inert`라 초점이 가지 않는다 — 먼저 펴 준다.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'f' && e.code !== 'KeyF') return;
      e.preventDefault();
      e.stopPropagation();
      setFocus(false);
      const go = () => {
        const box = document.querySelector<HTMLInputElement>('[data-note-search]');
        box?.focus();
        box?.select?.();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
      else go();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /** 본문 단을 창 너비에 맞출지 — 공책 한 권의 읽기 설정(`cover.wide`). */
  const wide = controller.doc.cover?.wide === true;

  if (!page) return null;

  return (
    <div
      data-note-editor
      // 우리가 선택을 칠할 수 있는 브라우저인가 — CSS가 이 표식을 보고 본문 줄의
      // 브라우저 칠을 끈다(모르는 브라우저에서 끄면 선택이 아예 보이지 않는다).
      data-note-hl={supportsHighlight() ? '1' : undefined}
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', background: 'var(--mf-note-body)', overflow: 'hidden' }}
    >
      <PageList controller={controller} collapsed={focus} />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!readOnly && (
          <FormatToolbar
            controller={controller}
            boxRef={boxRef}
            rememberBox={rememberBox}
            onInserted={setFreshId}
            openSlash={(id, from) => openSlashAt(id, from)}
            focus={focus}
            setFocus={setFocus}
            wide={wide}
          />
        )}
        <div className="lnb-scroll" data-note-page style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '26px 0 56px', background: 'var(--mf-note-body)' }}>
          {/* 본문 단 — 디자인 원본의 700px. 블록 사이는 **9px**이다(요청: 너무 넓다) —
              19px이던 값의 절반. 제목만 위쪽에 숨을 더 둬서(아래 `headGap`) 문단은
              촘촘하고 구획은 여전히 갈린다. */}
          <div
            ref={colRef}
            onPointerDown={(e) => {
              // 새 드래그의 시작 — 이전 선택을 접고 **캐럿 자리**를 기억한다.
              setTextSel(null);
              const line = (e.target as HTMLElement | null)?.closest?.('[data-note-line]') as HTMLElement | null;
              // 좌표→캐럿이 없는 환경에서는 **줄 머리**로 본다(그 줄 전체가 걸린다).
              const at = caretAt(e.clientX, e.clientY) ?? (line ? { node: line, offset: 0 } : null);
              dragFrom.current = line && at ? { el: line, node: at.node, offset: at.offset } : null;
            }}
            onPointerMove={(e) => {
              // 드래그 중일 때만 — 누름은 `dragFrom`이 말하고, 뗌은 **문서에 건**
              // `pointerup`이 지운다(위 effect). `e.buttons`를 보지 않는 이유:
              // 그 값이 실려 오지 않는 환경이 있어 조건으로 쓰면 조용히 죽는다.
              const from = dragFrom.current;
              const col = colRef.current;
              if (!from || !col) return;
              // 커서 아래의 줄은 좌표로 찾는다 — 편집 박스가 드래그를 잡고 있어
              // `e.target`은 시작 줄에 머문다.
              let under: HTMLElement | null = null;
              try {
                under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
              } catch {
                under = null; // 좌표 조회가 없는 환경(jsdom) — 아래 폴백으로 간다
              }
              const line = (under ?? (e.target as HTMLElement | null))?.closest?.('[data-note-line]') as HTMLElement | null;
              if (!line || line === from.el) return;
              const at = caretAt(e.clientX, e.clientY) ?? { node: line, offset: (line.textContent ?? '').length };
              const next = buildSelection(col, from, { el: line, node: at.node, offset: at.offset });
              if (!next) return;
              // 경계를 넘었다 — 여기서부터는 우리가 칠한다. 브라우저가 반쯤 그려 둔
              // 선택은 지우고 **캐럿도 뺀다**: 칠해 둔 채 캐럿이 남으면 글쇠가 그
              // 줄 안으로 들어가 "고른 것"과 "고치는 것"이 갈린다.
              window.getSelection()?.removeAllRanges();
              const live = document.activeElement as HTMLElement | null;
              if (live?.hasAttribute('data-note-line')) live.blur();
              setTextSel(next);
            }}
            onContextMenu={(e) => {
              if (readOnly) return;
              const el = e.target as HTMLElement | null;
              const host = el?.closest?.('[data-note-block]') as HTMLElement | null;
              const id = host?.getAttribute('data-note-block');
              if (!id) return; // 머리(제목·태그)나 빈 자리에서는 브라우저 메뉴 그대로
              e.preventDefault();
              const box = (el?.closest?.('[data-note-line]') as HTMLElement | null) ?? null;
              if (box) focusBox(box);
              setCtxAt({ blockId: id, box, x: e.clientX, y: e.clientY });
            }}
            // 폭은 **공책 한 권의 읽기 설정**이다(요청·`cover.wide`) — 가운데 정렬
            // (700px)이 기본이고, `창 너비에 맞춤`이면 단이 화면을 가득 쓴다.
            style={{ ...(wide ? {} : { maxWidth: 700 }), margin: '0 auto', padding: '0 30px', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}
          >
            <PageHead controller={controller} page={page} />
            {/* 머리와 본문 사이의 선(요청) — 위는 이 장이 무엇인지(제목·태그·사람),
                아래는 그 내용이다. 블록 간격(19px)만으로는 그 경계가 서지 않는다. */}
            {/* 간격은 **18px**이다(요청) — 단의 기본 틈이 9px이라 9를 더해 맞춘다. */}
            <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', marginTop: 9 }} />
            {page.blocks.map((block, i) => (
              // 선택 면은 **감싸는 칸**이 그린다 — 블록마다 뿌리가 달라서(표·이미지·
              // 콜아웃…) 각 뿌리에 면을 얹으면 같은 코드를 여덟 번 쓰게 된다. 이 칸은
              // 여백이 없어 평소 레이아웃에는 아무 영향이 없다.
              <div
                key={block.id}
                data-note-blockwrap={block.id}
                data-selected={selectedIds.includes(block.id) ? '1' : undefined}
                style={{
                  minWidth: 0,
                  borderRadius: 7,
                  // 제목 위에 숨을 더 둔다 — 간격을 9px로 좁히면서 구획이 뭉치지 않게.
                  marginTop: i > 0 && (block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3') ? 9 : 0,
                  // 면은 **칠하기를 모르는 브라우저**에서만 — 아는 브라우저에서는 글자에
                  // 직접 칠하므로(`CSS.highlights`) 면까지 깔면 두 겹이 된다.
                  ...(!supportsHighlight() && selectedIds.includes(block.id)
                    ? { background: 'var(--mf-accent-soft)', boxShadow: '0 0 0 3px var(--mf-accent-soft)' }
                    : {}),
                }}
              >
                <BlockView
                  controller={controller}
                  block={block}
                  index={i}
                  freshId={freshId}
                  setFreshId={setFreshId}
                  rememberBox={rememberBox}
                  focusBox={focusBox}
                  openSlash={(id, at) => openSlashAt(id, at)}
                />
              </div>
            ))}
            {ctxAt && !readOnly && <BlockMenu controller={controller} at={ctxAt} onClose={() => setCtxAt(null)} />}
            {slashFor && !readOnly && (
              <SlashMenu
                anchor={slashAt}
                query={slashQuery}
                inline={slashAtChar !== null}
                onClose={closeSlash}
                onPick={(kind) => {
                  // 본문에 친 `/질의`는 **지우고** 종류를 바꾼다(노션과 같은 결과).
                  if (slashAtChar !== null) dropSlashText(page, slashFor, slashAtChar, slashQuery, controller);
                  const id = blockIdOf(slashFor);
                  controller.retypeNoteBlock(id, kind);
                  closeSlash();
                  setFreshId(id);
                }}
              />
            )}

            {/* 본문 끝의 빈 줄 — 디자인은 여기에 **무엇을 할 수 있는지**를 적는다.
                예전에는 아무것도 없는 120px 빈 버튼이라, 이어 쓸 수 있다는 것을
                알아채려면 우연히 눌러 보는 수밖에 없었다. */}
            {!readOnly && (
              <button
                type="button"
                data-note-append
                onClick={() => setFreshId(controller.addNoteBlock('p'))}
                className="btn"
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0, border: 'none', background: 'transparent', cursor: 'text', textAlign: 'left' }}
              >
                <span aria-hidden="true" style={{ width: 26, height: 26, flex: '0 0 auto', borderRadius: 8, border: '1px dashed var(--mf-border)', color: 'var(--mf-faint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--mf-faint)' }}>여기에 입력하거나 / 를 눌러 블록을 넣으세요</span>
              </button>
            )}

          </div>
        </div>
        {/* 글의 부피는 **본문 밖의 고정 띠**다(요청) — 예전에는 본문 맨 끝에 붙어
            있어 끝까지 굴려야 보였고, 글을 쓰는 동안 계속 아래로 밀려났다. 이제
            페이지 바닥에 붙어 늘 같은 자리에서 같은 값을 말한다. */}
        <PageStats page={page} wide={wide} />
      </div>
    </div>
  );
}

/**
 * 팝업 하나를 **화면 좌표로** 띄우고, 바깥을 누르면 닫는다.
 *
 * 왜 `position: fixed`인가: 공책 화면은 [상단 바 · 목록 · 본문]이 각각 `overflow:hidden`인
 * 상자다. 그 안에서 `absolute`로 띄운 팝업은 상자 밖으로 나가는 순간 **잘린다** —
 * 경로의 공책 전환 팝업이 본문에 가려 보이지 않던 것이 그 때문이었다(제보). 화면
 * 좌표로 띄우면 어느 상자 안에서 열든 온전히 보인다.
 *
 * 닫히는 조건을 한곳에 모은 이유도 같다: 팝업마다 따로 달다 보니 어떤 것은 바깥을
 * 눌러도 열려 있었다(제보 — "모든 툴팁에 동일하게"). 여기서는 **바깥 누르기 · Esc ·
 * 스크롤 · 창 크기 변경**이 모두 닫는다. 스크롤과 크기 변경까지 닫는 이유는 기준점이
 * 움직였는데 팝업만 제자리에 남으면 엉뚱한 것에 붙어 보이기 때문이다.
 */
function useAnchored(open: boolean, close: () => void, opts: { closeOnScroll?: boolean } = {}): { ref: RefObject<HTMLElement | null>; rect: DOMRect | null } {
  const ref = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (open && ref.current) setRect(ref.current.getBoundingClientRect());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = () => close();
    // 캡처 단계 — 팝업 안의 클릭은 그쪽에서 `stopPropagation`으로 막는다.
    // 스크롤에서 닫을지는 고를 수 있다(기본은 닫는다 — 기준점이 움직였는데 팝업만
    // 제자리에 남으면 엉뚱한 것에 붙어 보인다). `/` 목록은 **본문을 스크롤하며 고르는**
    // 자리라 닫지 않고 따라간다(제보: 스크롤하면 닫힌다).
    const scrollCloses = opts.closeOnScroll !== false;
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onDown);
    if (scrollCloses) document.addEventListener('scroll', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onDown);
      if (scrollCloses) document.removeEventListener('scroll', onDown, true);
    };
  }, [open, close, opts.closeOnScroll]);
  return { ref, rect };
}

/**
 * 기준 사각형 아래에 뜰 자리 — 화면 밖으로 나가지 않게 당긴다.
 *
 * `align: 'right'`는 기준의 **오른쪽 끝에 맞춘다**(내보내기처럼 화면 오른쪽에 있는 단추).
 * 아래에 자리가 모자라면 위로 뒤집는다 — 화면 아래쪽에서 연 팝업이 잘리지 않게.
 */
function anchoredStyle(rect: DOMRect | null, width: number, opts: { align?: 'left' | 'right'; gap?: number; maxHeight?: number } = {}): CSSProperties {
  if (!rect) return { position: 'fixed', top: -9999, left: -9999 };
  const gap = opts.gap ?? 6;
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const max = opts.maxHeight ?? 360;
  const below = vh - rect.bottom - gap - 12;
  const flip = below < Math.min(max, 220) && rect.top > below;
  const left = opts.align === 'right' ? rect.right - width : rect.left;
  return {
    position: 'fixed',
    left: Math.max(12, Math.min(left, vw - width - 12)),
    ...(flip ? { bottom: vh - rect.top + gap } : { top: rect.bottom + gap }),
    width,
    maxHeight: Math.max(160, flip ? rect.top - gap - 12 : below),
    overflowY: 'auto',
  };
}

/**
 * `/` 목록의 **앵커** — 스펙 §2의 네 값.
 *
 * `DOMRect`를 그대로 들고 다니지 않는 이유: 앵커와 패널을 각각 `fixed`로 놓으면 화면
 * 밖으로 나가지 않게 당기는 계산(clamp)이 **따로 돌아** 둘이 서로 떨어진다(스펙 §3).
 * 그래서 자리는 여기서 한 번만 정하고, 패널은 앵커의 `absolute` 자식으로 붙인다.
 */
interface SlashAnchor {
  /** 앵커의 화면 X — 블록 왼쪽, 뷰포트 안으로 당긴다. */
  gx: number;
  /** 앵커의 화면 Y — 블록의 아랫선. */
  gy: number;
  /** 패널을 위로 띄울지 — 아래 여백이 모자랄 때만. */
  up: boolean;
  /** 목록 영역의 `max-height`. */
  listH: number;
}

const SLASH_W = 306;

function clampN(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * `/`를 친 줄을 기준으로 목록이 뜰 자리(스펙 §3).
 *
 * 스크롤 컨테이너는 **계산으로** 찾는다(클래스 이름으로 찾지 않는다 — 에디터 구조가
 * 바뀌면 조용히 틀린 자리에 뜬다): 부모를 거슬러 올라가며 `scrollHeight`가
 * `clientHeight`보다 크고 `overflow-y`가 `auto|scroll`인 첫 조상이 그것이다.
 */
function measureSlash(el: Element | null): SlashAnchor | null {
  if (!el || typeof window === 'undefined') return null;
  const rect = el.getBoundingClientRect();
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  let sc: HTMLElement | null = el.parentElement;
  while (sc) {
    const oy = getComputedStyle(sc).overflowY;
    if (sc.scrollHeight > sc.clientHeight + 4 && (oy === 'auto' || oy === 'scroll')) break;
    sc = sc.parentElement;
  }
  const vpTop = sc ? sc.getBoundingClientRect().top : 0;
  const vpBottom = sc ? sc.getBoundingClientRect().bottom : ih;
  const gx = clampN(rect.left, 8, Math.max(8, iw - (SLASH_W + 8)));
  const gy = clampN(rect.bottom - 1, vpTop + 4, Math.max(vpTop + 4, Math.min(vpBottom, ih) - 30));
  // 머리·푸터 크롬 78px을 뺀 **목록이 쓸 수 있는** 높이.
  const roomBelow = Math.min(vpBottom, ih) - gy - 78;
  const roomAbove = gy - Math.max(vpTop, 0) - 78;
  const up = roomBelow < 110 && roomAbove > roomBelow;
  return { gx, gy, up, listH: clampN(up ? roomAbove : roomBelow, 90, 288) };
}

/** 전환 팝업이 보여 주는 한 권. */
interface NotebookRow {
  docId: string;
  title: string;
  cover: string;
  pages: number;
  updatedAt: string;
  /** 지난번에 보던 페이지 제목 — `이어서: …`. 없으면 빈 문자열. */
  resume: string;
}

/**
 * 이 스페이스의 **공책들** — 전환 팝업이 열릴 때 한 번만 읽는다.
 *
 * 본문은 `loadPreview`로 받는다(썸네일 전용 경로: Supabase는 이미지 데이터를 뗀 RPC +
 * `(version, updatedAt)` 키 로컬 캐시, 로컬 모드는 그대로). 홈이 카드를 그릴 때 쓰는
 * 바로 그 길이라 같은 판이면 네트워크가 나가지 않는다 — 팝업을 다시 열어도 공짜다.
 *
 * 열기 전에는 **아무것도 하지 않는다**: 공책을 옮겨 다니지 않는 사람에게 문서 수만큼의
 * 조회를 시킬 이유가 없다.
 */
function useNotebooks(controller: EditorController, open: boolean): { rows: NotebookRow[]; loading: boolean } {
  const docStore = useDocStore();
  const [rows, setRows] = useState<NotebookRow[]>([]);
  const [loading, setLoading] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (!open || done.current) return;
    done.current = true;
    setLoading(true);
    let alive = true;
    void (async () => {
      try {
        const metas = await docStore.list();
        const byId = new Map(metas.map((m) => [m.id, m]));
        // **지금 스페이스 안의 공책만**(요청) — A 스페이스에서 열었으면 A의 목록이다.
        // 다른 스페이스의 공책으로 건너뛰면 경로(`스페이스 › 공책 › 페이지`)가 통째로
        // 바뀌어, 옮긴 것이 페이지인지 스페이스인지 알 수 없다. 스페이스를 모르는
        // 문서(워크스페이스 밖)라면 거르지 않는다 — 거를 기준이 없다.
        const here = controller.noteSpaceName;
        const ids = controller.linkTargets
          .filter((t) => !here || t.spaceName === here)
          .map((t) => t.docId)
          .concat(controller.docId);
        const bodies = await Promise.allSettled(ids.map((id) => docStore.loadPreview(id, byId.get(id))));
        if (!alive) return;
        const out: NotebookRow[] = [];
        bodies.forEach((r, i) => {
          if (r.status !== 'fulfilled' || !r.value) return;
          const id = ids[i]!;
          let parsed: Doc | null = null;
          try {
            parsed = parseDoc(JSON.parse(r.value) as Record<string, unknown>);
          } catch {
            parsed = null;
          }
          if (!parsed || parsed.kind !== 'note') return;
          const pages = parsed.pages ?? [];
          const meta = byId.get(id);
          out.push({
            docId: id,
            title: meta?.title || controller.linkTargets.find((t) => t.docId === id)?.title || '제목 없는 공책',
            cover: noteCoverColor(parsed.cover),
            pages: pages.length,
            updatedAt: meta?.updatedAt ?? '',
            resume: pages[0]?.title?.trim() ?? '',
          });
        });
        // 최근에 고친 것부터 — 옮겨 갈 공책은 대개 방금까지 보던 것 옆에 있다.
        out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        setRows(out);
      } catch {
        /* 목록을 못 받아도 지금 공책은 그대로 쓴다 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, docStore, controller.linkTargets, controller.docId, controller.noteSpaceName]);
  return { rows, loading };
}

/**
 * 공책 전환 — 경로의 공책 이름을 누르면 열린다(요청·디자인 2번 이미지).
 *
 * 공책은 "여러 권"으로 쓰는 물건이라 권을 옮기는 일이 잦은데, 그때마다 홈으로 나갔다
 * 들어와야 했다. 목록은 **책등 타일**로 그려 표지 색이 그대로 단서가 된다.
 */
function NotebookSwitch({ controller }: { controller: EditorController }) {
  const [open, setOpen] = useState(false);
  const { rows, loading } = useNotebooks(controller, open);
  const { ref, rect } = useAnchored(open, () => setOpen(false));
  const cover = noteCoverColor(controller.doc.cover);
  return (
    <>
      {/* 경로의 공책 칸 — 표지 타일 · 이름 · `⇅ 이동` 배지(요청·이미지 2·3).
          배지가 있어야 "여기를 누르면 옮길 수 있다"가 보인다. 열려 있으면 `닫기`로
          바뀌어 같은 자리가 토글임을 말한다. */}
      <button
        type="button"
        ref={ref as RefObject<HTMLButtonElement>}
        className="mf-note-tb"
        data-note-book-switch
        title="다른 공책으로 이동"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          flex: '0 1 auto',
          minWidth: 0,
          maxWidth: '100%',
          height: 30,
          padding: '0 7px 0 7px',
          border: `1px solid ${open ? 'var(--mf-border-hover)' : 'var(--mf-border)'}`,
          borderRadius: 999,
          background: 'var(--mf-card)',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--mf-text)',
          cursor: 'pointer',
        }}
      >
        <BookTile cover={cover} size="sm" />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{controller.docTitle || '제목 없는 공책'}</span>
        <span
          aria-hidden="true"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flex: '0 0 auto', height: 18, padding: '0 6px', borderRadius: 999, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-deep)', fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3" />
          </svg>
          {open ? '닫기' : '이동'}
        </span>
      </button>
      {open && (
        <div
          data-note-book-menu
          onPointerDown={(e) => e.stopPropagation()}
          style={{ ...POP, ...anchoredStyle(rect, 292, { gap: 8, maxHeight: 420 }), padding: 8, borderRadius: 15, display: 'flex', flexDirection: 'column' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 8px 8px' }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', color: 'var(--mf-faint)' }}>공책 이동</span>
            {controller.noteSpaceName && <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: 'var(--mf-faint2)' }}>{controller.noteSpaceName}</span>}
            <span style={{ flex: 1, minWidth: 0 }} />
            <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: 'var(--mf-faint2)', whiteSpace: 'nowrap' }}>{rows.length}권</span>
          </span>
          {loading && <span style={{ padding: '10px 9px', fontSize: 12, color: 'var(--mf-faint)' }}>공책을 찾는 중…</span>}
          {!loading && rows.length === 0 && <span style={{ padding: '10px 9px', fontSize: 12, color: 'var(--mf-faint)' }}>이 스페이스에 다른 공책이 없어요</span>}
          {rows.map((r) => {
            const here = r.docId === controller.docId;
            return (
              <a
                key={r.docId}
                data-note-book-item={r.docId}
                href={here ? undefined : `/editor?map=${encodeURIComponent(r.docId)}`}
                className="mf-note-item"
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box', padding: '8px 9px', borderRadius: 11, background: here ? 'var(--mf-accent-soft)' : 'transparent', textDecoration: 'none', color: 'inherit', cursor: here ? 'default' : 'pointer', minWidth: 0 }}
              >
                <BookTile cover={r.cover} size="md" />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, fontWeight: here ? 800 : 700, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.pages} 페이지
                    {r.updatedAt ? ` · ${formatLastEdited(r.updatedAt)} 수정` : ''}
                    {!here && r.resume ? ` · 이어서: ${r.resume}` : ''}
                  </span>
                </span>
                {here ? (
                  <span style={{ flex: '0 0 auto', height: 18, padding: '0 7px', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-accent-deep)', fontSize: 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>보는 중</span>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                )}
              </a>
            );
          })}
          <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', margin: '6px 4px' }} />
          <button type="button" className="btn mf-note-item" onClick={controller.goBack} style={{ ...MENU_ITEM, gap: 9, color: 'var(--mf-subtext)', fontWeight: 700 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            스페이스에서 모든 공책 보기
          </button>
        </div>
      )}
    </>
  );
}

/** 공책 한 권의 **책등 타일** — 표지 색 그대로, 오른쪽 모서리만 둥글다(꽂힌 책 모양). */
function BookTile({ cover, size }: { cover: string; size: 'sm' | 'md' }) {
  const w = size === 'sm' ? 15 : 26;
  const h = size === 'sm' ? 19 : 32;
  return (
    <span
      aria-hidden="true"
      style={{
        width: w,
        height: h,
        flex: '0 0 auto',
        borderRadius: size === 'sm' ? '2px 4px 4px 2px' : '3px 6px 6px 3px',
        background: `color-mix(in srgb, ${cover} 26%, var(--mf-card))`,
        borderLeft: `${size === 'sm' ? 2 : 3}px solid ${cover}`,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: size === 'sm' ? 3 : 4,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ width: size === 'sm' ? 7 : 12, height: 2, borderRadius: 999, background: 'var(--mf-card)', opacity: 0.85, display: 'block' }} />
    </span>
  );
}

/**
 * 상단 바 — 디자인 원본의 공책 머리를 값 그대로.
 *
 * [알약: 뒤로 · 공책 이름 + 저장 상태 · 저장] · [경로] · [알약: 공유 + 얼굴들 | 댓글 · 기록]
 *
 * 바탕은 본문보다 한 톤 짙은 `#F6F0E8`에 **14px 도트 무늬**가 깔린다(`radial-gradient`)
 * — 이 무늬가 상단을 "책상 면"으로 만들어 그 위의 흰 알약을 떠 보이게 한다(제보:
 * "배경 패턴"). 문서 칩은 이 알약이 대신한다 — 지름·모서리·그림자가 전부 다르고,
 * 캔버스용 칩을 억지로 맞추는 것보다 여기서 그리는 편이 정확하다.
 */
export function NoteTopBar({ controller }: { controller: EditorController }) {
  const page = controller.notePage;
  const space = controller.noteSpaceName;
  const readOnly = controller.readOnly;
  const saving = controller.saveState;
  const saveLabel = readOnly ? '보기 전용' : saving === 'saved' ? '저장됨' : saving === 'saving' ? '저장 중…' : saving === 'unsaved' ? '저장 전' : '변경됨';
  const cover = noteCoverColor(controller.doc.cover);
  const tabs: { name: string; on: boolean; onPick: () => void }[] = [
    { name: '댓글', on: controller.commentsOpen, onPick: () => (controller.commentsOpen ? controller.closeComments() : controller.openComments()) },
    { name: '기록', on: controller.historyOpen, onPick: () => controller.setHistoryOpen(!controller.historyOpen) },
  ];
  return (
    <div
      data-note-topbar
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'stretch',
        height: 58,
        // **알약도 카드도 아니다**(요청·시안): 한 줄이 통째로 화면 폭을 쓰고, 그 안이
        // **선으로만** 갈린다 — 왼쪽 칸의 오른쪽 선은 아래 목록의 경계선과 **같은
        // 선상**이고, 바 아래의 가로선은 그 목록의 윗변이 된다. 그래서 바탕도 아래
        // 툴바와 같은 면(`--mf-card`)을 쓴다 — 바와 툴바가 한 장으로 이어진다.
        background: 'var(--mf-card)',
        borderBottom: '1px solid var(--mf-border-soft)',
        minWidth: 0,
      }}
    >
      {/* 문서 칸 — [뒤로 · 표지 띠 + 이름/쪽수·상태 · 저장]. **아래 페이지 목록과 같은
          폭**(292)이라 오른쪽 선이 그 목록의 경계선으로 그대로 이어진다(시안). 집중
          모드로 목록이 접혀도 이 칸은 남는다 — 이름과 저장은 목록이 아니라 **문서**의
          것이고, 폭이 흔들리면 경로까지 함께 출렁인다. */}
      <span
        data-doc-chip
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          height: '100%',
          padding: '0 10px 0 8px',
          flex: '0 0 292px',
          boxSizing: 'border-box',
          minWidth: 0,
          // 면은 **아래 목록과 같은 종이**(#FBF7F1 = `--mf-panel`, 요청) — 한 칸이
          // 위아래로 이어져 보이고, 오른쪽의 경로·툴바와도 선 하나로 갈린다.
          background: 'var(--mf-panel)',
          borderRight: '1px solid var(--mf-border-soft)',
        }}
      >
        <button
          type="button"
          className="mf-note-tb"
          onClick={controller.goBack}
          title="홈으로"
          aria-label="홈으로"
          style={{ width: 30, height: 30, flex: '0 0 auto', borderRadius: 9, border: 0, background: 'transparent', color: 'var(--mf-subtext)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
        </button>
        {/* 표지 색 띠 — 시안이 이름 앞에 세워 둔 3px 막대. 어느 공책을 보고 있는지가
            이름을 읽기 전에 색으로 먼저 온다(목록의 고른 줄과 같은 표식). */}
        <span aria-hidden="true" style={{ width: 3, height: 24, flex: '0 0 auto', borderRadius: 999, background: cover, display: 'block' }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <input
            data-note-book-title
            defaultValue={controller.docTitle}
            readOnly={readOnly}
            maxLength={40}
            placeholder="공책 이름"
            title="눌러서 공책 이름 수정"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => controller.commitTitle(e.currentTarget.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 0,
              border: 0,
              borderBottom: '1.5px dashed transparent',
              background: 'transparent',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: '-.02em',
              color: 'var(--mf-text)',
              outline: 'none',
            }}
          />
          {/* `6쪽 · 저장됨` — 시안의 아래 줄. 쪽수가 먼저인 이유는 그것이 이 공책의
              크기이고, 저장 상태는 대개 `저장됨`으로 잠잠하기 때문이다. 잠잠하지 않을
              때만(저장 전·저장 중) 글자에 색이 든다. */}
          <span data-note-save-state style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap', minWidth: 0 }}>
            {/* **충돌은 저장 상태보다 먼저 말해야 한다**(제보) — 공책에는 이 자리가
                유일한 알림 자리다(캔버스의 `DocChip` 배너가 여기엔 없어서, 다른 기기가
                먼저 저장해도 화면은 그냥 `저장됨`이라고만 적혀 있었다). 공책은 실시간
                공동 편집을 붙이지 않은 문서라 두 기기가 자동으로 합쳐지지 않으므로,
                덮인 판이 `기록`에 남아 있다는 것까지 함께 알린다(저장 경로가 충돌
                직전에 서버 판을 거기 넣어 둔다). 눌러서 닫는다. */}
            {controller.saveConflict ? (
              <button
                type="button"
                data-note-save-conflict
                onClick={controller.dismissSaveConflict}
                title="다른 기기에서 먼저 저장했습니다. 그 판은 `기록`에 남겨 뒀어요. (눌러서 닫기)"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, padding: 0, border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 800, color: 'var(--mf-danger)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                ⚠ 다른 기기에서 먼저 저장됨 — 그 판은 `기록`에
              </button>
            ) : (
              <>
                <span>{controller.notePages.length}쪽</span>
                <span aria-hidden="true">·</span>
                <span style={{ color: saving === 'saved' || readOnly ? 'var(--mf-faint)' : 'var(--mf-accent-deep)', fontWeight: saving === 'saved' || readOnly ? 600 : 800 }}>{saveLabel}</span>
              </>
            )}
          </span>
        </span>
        {!readOnly && (
          <button
            type="button"
            data-note-save
            className="mf-note-tb"
            onClick={controller.saveNow}
            title="저장"
            aria-label="저장"
            style={{ width: 30, height: 30, flex: '0 0 auto', borderRadius: 9, border: '1px solid var(--mf-border-soft)', background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
              <path d="M8 4v5h7V4M8 21v-6h8v6" />
            </svg>
          </button>
        )}
      </span>

      {/* 경로 — `스페이스 › ● 공책 › 페이지`. */}
      <nav aria-label="위치" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 10px', boxSizing: 'border-box', overflow: 'hidden' }}>
        {space && (
          <>
            <button type="button" className="mf-note-crumb" onClick={controller.goBack} style={{ flex: '0 0 auto', height: 26, padding: '0 9px', border: 0, borderRadius: 8, color: 'var(--mf-muted)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {space}
            </button>
            <Caret />
          </>
        )}
        <NotebookSwitch controller={controller} />
        <Caret />
        <span style={{ flex: '0 1 auto', minWidth: 0, height: 26, padding: '0 9px', display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {page?.title?.trim() || '제목 없는 페이지'}
        </span>
      </nav>

      {/* 오른쪽 — **공유는 맨몸으로**(얼굴들과 한 덩이), 댓글·기록만 카드 안에(시안).
          예전에는 셋이 한 알약 안에 있어 "지금 이 문서를 누가 보나"(공유·얼굴)와
          "무엇을 펼까"(댓글·기록)가 한 묶음으로 읽혔다. */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 0 0', minWidth: 0 }}>
        <button
          type="button"
          className="mf-note-crumb"
          data-note-share
          onClick={controller.openShare}
          title="공유"
          // 얼굴이 단추 **안**에 서므로 이름을 못박는다 — 그러지 않으면 접근성
          // 이름이 `공유 나` 처럼 얼굴의 첫 글자를 물고 들어온다.
          aria-label="공유"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 9, border: 0, color: 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3" />
            <path d="M3 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 19a5 5 0 0 0-4-4.9" />
          </svg>
          공유
          {/* 함께 보고 있는 얼굴들 — 겹쳐 놓는다(시안). **혼자여도 내 얼굴은 선다**
              (요청): "누가 보고 있나"의 답에 나를 빼면 빈자리가 "아무도 없다"로
              읽히고, 남이 들어온 순간에만 무언가 나타나 자리가 출렁인다.
              GNB가 쓰는 그 컴포넌트를 그대로 쓴다(같은 뜻은 같은 그림). */}
          <PresenceAvatars controller={controller} isMobile withSelf />
        </button>
        <span data-note-panels style={{ display: 'inline-flex', alignItems: 'center', height: 38, padding: '0 4px', borderRadius: 12, background: 'var(--mf-card)', border: '1px solid var(--mf-border-soft)' }}>
          {tabs.map((t, i) => (
            <Fragment key={t.name}>
              {i > 0 && <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', display: 'block', flex: '0 0 auto' }} />}
              <button
                type="button"
                className="mf-note-crumb"
                data-note-tab={t.name}
                aria-pressed={t.on}
                onClick={t.onPick}
                title={t.name}
                style={{
                  height: 30,
                  padding: '0 13px',
                  borderRadius: 9,
                  border: 0,
                  color: t.on ? 'var(--mf-accent-deep)' : 'var(--mf-subtext)',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: t.on ? 800 : 600,
                  cursor: 'pointer',
                }}
              >
                {t.name}
              </button>
            </Fragment>
          ))}
        </span>
      </div>
    </div>
  );
}

/** 경로의 `›` — 한 벌로 써서 간격이 어긋나지 않게. */
function Caret() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/* ── 페이지 목록 ───────────────────────────────────────────────────────────── */

/** 목록 정렬 둘 — 디자인 원본의 `noteSorts`. */
type PageSort = 'edited' | 'title';

function PageList({ controller, collapsed }: { controller: EditorController; collapsed: boolean }) {
  const pages = controller.notePages;
  const curId = controller.notePage?.id ?? null;
  const cover = noteCoverColor(controller.doc.cover);
  /**
   * 이 공책 안에서 **페이지 이름과 본문을 함께** 찾는다(요청 12번).
   *
   * 홈 검색이 문서를 찾아 주는 자리라면 여기는 **한 권 안에서** 찾는 자리다 —
   * 회의록처럼 같은 틀이 수십 장 쌓이면 제목만으로는 못 고른다. 걸린 줄을
   * 그 자리에 보여 줘 "이 장이 맞나"를 목록에서 판단할 수 있게 한다.
   */
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<PageSort>('edited');
  const [tag, setTag] = useState<string>('전체');
  const query = q.trim().toLowerCase();
  const searching = query.length > 0;

  /** 이 공책에 실제로 쓰인 태그들 — 쓰지 않은 태그로 거르는 칩은 뜻이 없다. */
  const tags = useMemo(() => {
    const seen: string[] = [];
    for (const pg of pages) {
      const t = pg.tag?.trim();
      if (t && !seen.includes(t)) seen.push(t);
    }
    return seen;
  }, [pages]);

  const shown = useMemo(() => {
    // 검색 중에는 **태그·정렬을 적용하지 않는다** — 찾는 사람은 "어디 있나"를 묻는
    // 것이지 "어떤 순서로 보고 싶다"를 말하는 게 아니다(디자인도 그때 두 줄을 감춘다).
    if (searching) {
      return pages.map((pg) => ({ pg, hit: pageHit(pg, query) })).filter((x) => x.hit !== null);
    }
    const rows = pages.filter((pg) => tag === '전체' || (pg.tag ?? '') === tag).map((pg) => ({ pg, hit: null as string | null }));
    if (sort === 'title') {
      // 제목순은 **화면에 보이는 이름**을 기준으로 — 빈 제목은 뒤로 민다.
      return [...rows].sort((a, b) => (a.pg.title.trim() || '￿').localeCompare(b.pg.title.trim() || '￿', 'ko'));
    }
    // 수정순 — 시각을 모르는 페이지(옛 문서)는 문서 안 순서를 그대로 지킨다.
    return [...rows].sort((a, b) => (b.pg.updatedAt ?? '').localeCompare(a.pg.updatedAt ?? ''));
  }, [pages, query, searching, sort, tag]);

  return (
    <aside
      data-note-pages
      data-collapsed={collapsed ? '1' : undefined}
      aria-hidden={collapsed || undefined}
      {...(collapsed ? { inert: '' } : {})}
      style={{
        // 집중 모드에서 **왼쪽으로 스르륵 들어간다**(요청) — 폭을 0으로 줄이면서
        // 동시에 밀어 내야 안쪽 글이 찌그러지지 않고 미끄러져 나간다.
        width: collapsed ? 0 : 292,
        minWidth: 0,
        flex: '0 0 auto',
        borderRight: collapsed ? 'none' : '1px solid var(--mf-border-soft)',
        background: 'var(--mf-panel)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        // **펼쳐져 있을 때는 `transform`을 걸지 않는다.** 값이 `translateX(0)`이어도
        // 변형이 있으면 그 요소가 `position: fixed` 자손의 **컨테이닝 블록**이 되고,
        // 그러면 `overflow: hidden`이 화면 좌표로 띄운 팝업까지 잘라 낸다 — 페이지
        // 우클릭 메뉴의 단축키 칸이 목록 너비에서 싹둑 잘려 있었다(프로브에서 잡았다).
        // 접힐 때만 걸면 미끄러지는 animation은 그대로고(없음→변형도 보간된다) 잘림은
        // 사라진다. 접히는 동안에는 메뉴가 열려 있지 않다.
        ...(collapsed ? { transform: 'translateX(-24px)' } : {}),
        opacity: collapsed ? 0 : 1,
        transition: 'width .26s cubic-bezier(.2,.9,.3,1), transform .26s cubic-bezier(.2,.9,.3,1), opacity .18s ease',
      }}
    >
      <div style={{ width: 292, minWidth: 292, display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* 머리 — 검색 + 새 페이지가 **한 줄**이다(디자인). 예전에는 검색이 가운데,
          새 페이지가 목록 맨 아래에 따로 있어 둘이 한 벌로 읽히지 않았다. */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 9px', borderRadius: 10, border: '1px solid var(--mf-border)', background: 'var(--mf-card)' }}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.2" strokeLinecap="round" style={{ flex: '0 0 auto' }}>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.5-4.5" />
            </svg>
            <input
              data-note-search
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('');
              }}
              placeholder="제목과 본문에서 찾기"
              aria-label="제목과 본문에서 찾기"
              style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 12, outline: 'none' }}
            />
            {searching && (
              <button
                type="button"
                data-note-search-clear
                className="mf-note-tb"
                onClick={() => setQ('')}
                title="지우기"
                aria-label="검색어 지우기"
                style={{ width: 18, height: 18, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </span>
        </div>

        {searching ? (
          <div data-note-search-count style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 0', fontSize: 11, color: 'var(--mf-subtext)', minWidth: 0 }}>
            <span style={{ fontWeight: 700, color: 'var(--mf-accent)' }}>{shown.length}</span>
            <span>장에서 찾음</span>
            <span style={{ flex: 1, minWidth: 0 }} />
            <span style={{ fontSize: 9.5, color: 'var(--mf-faint)' }}>Esc 목록으로</span>
          </div>
        ) : (
          <>
            {/* 정렬 — 회의록처럼 쌓이는 공책은 **최근 것**이 먼저이고, 템플릿 모음처럼
                이름으로 찾는 공책은 제목순이 맞다. 둘 다 흔해서 고르게 둔다. */}
            <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 10, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)' }}>
              {([['edited', '수정순'], ['title', '제목순']] as const).map(([key, name]) => (
                <button
                  key={key}
                  type="button"
                  className="mf-note-row"
                  data-note-sort={key}
                  aria-pressed={sort === key}
                  onClick={() => setSort(key)}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    height: 25,
                    border: 0,
                    borderRadius: 8,
                    color: sort === key ? 'var(--mf-text)' : 'var(--mf-subtext)',
                    fontFamily: 'inherit',
                    fontSize: 11.5,
                    fontWeight: sort === key ? 800 : 600,
                    cursor: 'pointer',
                    boxShadow: sort === key ? '0 1px 2px rgba(46,42,38,.16)' : 'none',
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            {/* 태그 거르개 — 이 공책에 쓰인 태그가 둘 이상일 때만 뜻이 있다. */}
            {tags.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {['전체', ...tags].map((name) => {
                  const on = tag === name;
                  const dot = name === '전체' ? null : noteTagColor(name, controller.doc.tagColors);
                  return (
                    <button
                      key={name}
                      type="button"
                      className="mf-note-chip"
                      data-note-tag-filter={name}
                      aria-pressed={on}
                      onClick={() => setTag(name)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        height: 24,
                        padding: '0 9px',
                        borderRadius: 999,
                        border: `1px solid ${on ? 'var(--mf-border-hover)' : 'var(--mf-border)'}`,
                        color: on ? 'var(--mf-text)' : 'var(--mf-subtext)',
                        fontFamily: 'inherit',
                        fontSize: 11,
                        fontWeight: on ? 800 : 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {dot && <span aria-hidden="true" style={{ width: 6, height: 6, flex: '0 0 auto', borderRadius: 999, background: dot, display: 'block' }} />}
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* 거르개와 `새 페이지` 사이의 선(요청) — 위는 "무엇을 볼까"를 고르는 줄이고,
          아래는 "무엇을 더할까 · 무엇이 있나"다. 선이 이 자리에 있어야 새 페이지가
          목록의 머리로 읽힌다(예전에는 새 페이지 **아래**에 있어 그 단추가 거르개
          쪽에 붙어 보였다). */}
      {!controller.readOnly && !searching && <span aria-hidden="true" style={{ height: 1, flex: '0 0 auto', background: 'var(--mf-border-soft)', display: 'block', margin: '0 14px 10px' }} />}

      {/* 새 페이지 — 검색칸 옆의 주황 `+`에서 **목록 바로 위의 점선 띠**로(요청·시안).
          한 칸짜리 단추는 "무엇을 만드는지"를 아이콘 하나로만 말했고, 거르개 줄과 붙어
          있어 검색의 일부처럼 보였다. 지금은 목록의 첫 줄처럼 서서 그 아래 페이지들과
          같은 폭을 쓴다(점선이라 "아직 없는 것"으로 읽힌다). */}
      {!controller.readOnly && !searching && (
        <button
          type="button"
          data-note-new-page
          className="mf-note-item"
          onClick={() => controller.addNotePage()}
          title="새 페이지"
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            height: 38,
            margin: '0 14px 10px',
            // 점선이 너무 옅어 띠가 있는지조차 보이지 않았다(제보) — 한 단계 진한
            // 선(`--mf-border-hover`)으로 올린다.
            border: '1.5px dashed var(--mf-border-hover)',
            borderRadius: 11,
            color: 'var(--mf-subtext)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          새 페이지
        </button>
      )}

      <div className="lnb-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {shown.map(({ pg, hit }) => (
          <PageRow key={pg.id} controller={controller} page={pg} index={pages.indexOf(pg)} active={pg.id === curId} hit={hit} cover={cover} />
        ))}

        {shown.length === 0 && (
          <div data-note-search-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '26px 12px', textAlign: 'center' }}>
            <span style={{ fontSize: 12.5, color: 'var(--mf-faint)', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              {searching ? '이 공책의 제목과 본문을 모두 찾아봤어요' : '검색과 태그에 맞는 페이지가 없어요'}
            </span>
            {!searching && !controller.readOnly && (
              <button
                type="button"
                className="mf-note-tb"
                onClick={() => controller.addNotePage()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', border: '1.5px dashed var(--mf-border-hover)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                새 페이지 만들기
              </button>
            )}
          </div>
        )}
      </div>
      </div>
    </aside>
  );
}

/**
 * 커서 자리에 뜨는 메뉴 — 화면 밖으로 나가지 않게 당긴다.
 *
 * `anchoredStyle`은 **기준 사각형**(단추) 아래에 붙이는 자리고, 우클릭 메뉴는 기준이
 * 점(마우스)이라 셈이 다르다. 오른쪽·아래에 자리가 모자라면 그만큼 끌어올린다.
 */
function cursorStyle(at: { x: number; y: number }, width: number, height: number): CSSProperties {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  return {
    position: 'fixed',
    left: Math.max(8, Math.min(at.x + 2, vw - width - 8)),
    top: Math.max(8, Math.min(at.y + 2, vh - height - 8)),
    width,
  };
}

/** 페이지 우클릭 메뉴의 너비 — 날개(`다른 공책으로 이동`)가 이 값만큼 옆으로 붙는다. */
const PAGE_MENU_W = 212;

function PageRow({ controller, page, index, active, hit, cover }: { controller: EditorController; page: NotePage; index: number; active: boolean; hit?: string | null; cover: string }) {
  // 검색 중이면 **걸린 줄**을 보여 준다 — 첫 줄은 왜 걸렸는지를 말해 주지 못한다.
  const excerpt = hit ?? pageExcerpt(page, 90);
  const tag = page.tag ?? null;
  const who = page.updatedBy?.trim();
  /**
   * 페이지 조작은 **이 줄의 우클릭**에 있다(디자인의 `openPageCtx`).
   *
   * 본문 머리의 메타 줄에 복제·삭제 단추를 얹어 뒀었는데, 그 줄은 태그·사람·시각을
   * 읽는 자리라 조작이 끼면 읽기가 끊긴다(요청으로 뺐다). 지울 페이지를 **고르는**
   * 자리가 목록이므로 메뉴도 여기 있는 것이 맞다.
   *
   * 메뉴가 말하는 단축키(F2·⌘D·⌫)는 **실제로 동작한다** — 줄에 포커스가 있을 때
   * 같은 일을 한다. 적어 놓고 안 되는 단축키는 메뉴를 거짓말로 만든다.
   */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const pages = controller.notePages;
  const last = pages.length <= 1;
  const closeMenu = useCallback(() => {
    setMenu(null);
    setMoving(false);
  }, []);
  useAnchored(!!menu, closeMenu);
  const rename = () => {
    setRenaming(true);
    closeMenu();
  };
  const reorder = (delta: number) => {
    controller.moveNotePage(page.id, index + delta);
    closeMenu();
  };
  return (
    <div
      className="mf-note-row"
      data-note-page-row={page.id}
      data-active={active ? '1' : undefined}
      onClick={() => controller.setNotePageId(page.id)}
      onContextMenu={(e) => {
        if (controller.readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        controller.setNotePageId(page.id);
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          controller.setNotePageId(page.id);
          return;
        }
        if (controller.readOnly || renaming) return;
        if (e.key === 'F2') {
          e.preventDefault();
          setRenaming(true);
        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          controller.duplicateNotePage(page.id);
        } else if ((e.key === 'Backspace' || e.key === 'Delete') && !last) {
          e.preventDefault();
          controller.removeNotePage(page.id);
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 9,
        padding: '10px 11px',
        border: `1px solid ${active ? 'var(--mf-border-hover)' : 'transparent'}`,
        borderRadius: 12,
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      {/* 고른 줄의 왼쪽 띠 — 표지 색. 배경 톤만으로 가르면 테마에 따라 거의 안 보인다. */}
      <span aria-hidden="true" style={{ width: 3, flex: '0 0 auto', borderRadius: 999, background: active ? cover : 'transparent', display: 'block' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ flex: '0 0 auto', fontFamily: 'ui-monospace, monospace', fontSize: 10, fontWeight: 700, color: 'var(--mf-faint)', whiteSpace: 'nowrap' }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          {/* 이름 바꾸기는 **그 자리에서** 한다 — 별도 대화상자를 띄우면 어느 페이지를
              고쳤는지 목록에서 눈을 떼야 한다. Enter로 확정, Esc로 되돌린다. */}
          {renaming ? (
            <input
              data-note-page-rename={page.id}
              autoFocus
              defaultValue={page.title}
              placeholder="페이지 이름"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                controller.setNotePageTitle(page.id, e.currentTarget.value.trim());
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  controller.setNotePageTitle(page.id, e.currentTarget.value.trim());
                  setRenaming(false);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenaming(false);
                }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                height: 24,
                padding: '0 7px',
                border: '1px solid var(--mf-border-hover)',
                borderRadius: 8,
                background: 'var(--mf-panel)',
                color: 'var(--mf-text)',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: '-.015em',
                outline: 'none',
              }}
            />
          ) : (
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                fontWeight: active ? 800 : 700,
                letterSpacing: '-.015em',
                color: 'var(--mf-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {page.title.trim() || '제목 없는 페이지'}
            </span>
          )}
          {page.updatedAt && !renaming && (
            <span style={{ flex: '0 0 auto', fontSize: 10, color: 'var(--mf-faint)', whiteSpace: 'nowrap' }}>{formatLastEdited(page.updatedAt)}</span>
          )}
        </div>
        {excerpt && (
          <div
            data-note-page-hit={hit ? '1' : undefined}
            style={{ fontSize: 11.5, color: 'var(--mf-subtext)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'keep-all' }}
          >
            {excerpt}
          </div>
        )}
        {/* 태그 줄 — 태그가 없어도 **자리를 비우지 않는다**(요청): 빈 자리는 "아직 안
            정했다"인지 "이 줄이 원래 없다"인지 말해 주지 않고, 행마다 높이도 달라진다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span data-note-page-tag style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto' }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: tag ? noteTagColor(tag, controller.doc.tagColors) : 'var(--mf-faint2)', display: 'block' }} />
              <span style={{ fontSize: 10.5, fontWeight: tag ? 700 : 600, color: tag ? noteTagColor(tag, controller.doc.tagColors) : 'var(--mf-faint)' }}>{tag || '태그 없음'}</span>
            </span>
            {who && (
              <span style={{ minWidth: 0, fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who} 님이 씀</span>
            )}
        </div>
      </div>
      {menu && (
        <div
          data-note-page-menu
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ ...POP, ...cursorStyle(menu, PAGE_MENU_W, 246), display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          {/* 어느 페이지의 메뉴인지 — 목록에서 우클릭은 **줄을 겨냥한** 동작이라
              이름이 없으면 옆줄을 지웠는지 알 수 없다(디자인 1번 이미지의 머리). */}
          <span style={{ ...POP_HEAD, textTransform: 'none', letterSpacing: '-.01em', fontSize: 11, color: 'var(--mf-subtext)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {page.title.trim() || '제목 없는 페이지'}
          </span>
          <button type="button" data-note-page-rename-open className="btn mf-note-item" onClick={rename} style={MENU_ITEM}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            이름 바꾸기
            <span style={{ flex: 1 }} />
            <span style={POP_KEY}>F2</span>
          </button>
          <button
            type="button"
            data-note-page-dup
            className="btn mf-note-item"
            onClick={() => {
              controller.duplicateNotePage(page.id);
              closeMenu();
            }}
            style={MENU_ITEM}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V6a1 1 0 0 1 1-1h9" />
            </svg>
            복제
            <span style={{ flex: 1 }} />
            <span style={POP_KEY}>⌘D</span>
          </button>
          <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', margin: '4px 4px' }} />
          {/* 순서 바꾸기 — 끌어 옮기기는 좁은 목록에서 정확히 놓기가 어렵다.
              한 칸씩 움직이는 항목이 대신한다(끝에 닿으면 꺼진다). */}
          <button
            type="button"
            data-note-page-up
            className="btn mf-note-item"
            disabled={index === 0}
            onClick={() => reorder(-1)}
            style={{ ...MENU_ITEM, color: index === 0 ? 'var(--mf-faint)' : 'var(--mf-text)', cursor: index === 0 ? 'default' : 'pointer' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto', opacity: index === 0 ? 0.6 : 1 }}>
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
            위로
            <span style={{ flex: 1 }} />
            <span style={POP_KEY}>↑</span>
          </button>
          <button
            type="button"
            data-note-page-down
            className="btn mf-note-item"
            disabled={index >= pages.length - 1}
            onClick={() => reorder(1)}
            style={{ ...MENU_ITEM, color: index >= pages.length - 1 ? 'var(--mf-faint)' : 'var(--mf-text)', cursor: index >= pages.length - 1 ? 'default' : 'pointer' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto', opacity: index >= pages.length - 1 ? 0.6 : 1 }}>
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
            아래로
            <span style={{ flex: 1 }} />
            <span style={POP_KEY}>↓</span>
          </button>
          <button
            type="button"
            data-note-page-move
            aria-expanded={moving}
            className="btn mf-note-item"
            disabled={last}
            title={last ? '공책에는 페이지가 한 장 이상 있어야 해요' : undefined}
            onClick={() => setMoving((v) => !v)}
            style={{ ...MENU_ITEM, color: last ? 'var(--mf-faint)' : 'var(--mf-text)', cursor: last ? 'default' : 'pointer', background: moving ? 'var(--mf-accent-soft)' : 'transparent' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto', opacity: last ? 0.6 : 1 }}>
              <path d="M4 19V6a2 2 0 0 1 2-2h5l2 3h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
            </svg>
            다른 공책으로 이동
            <span style={{ flex: 1 }} />
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
          <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', margin: '4px 4px' }} />
          {/* 마지막 한 장은 지울 수 없다(코어 `removePage`) — 누를 수는 있는데 아무
              일도 안 나는 항목은 고장으로 읽히므로 끄고 이유를 툴팁으로 붙인다. */}
          <button
            type="button"
            data-note-page-del
            className="btn mf-note-item"
            disabled={last}
            title={last ? '공책에는 페이지가 한 장 이상 있어야 해요' : undefined}
            onClick={() => {
              controller.removeNotePage(page.id);
              closeMenu();
            }}
            style={{ ...MENU_ITEM, color: last ? 'var(--mf-faint)' : 'var(--mf-danger)', cursor: last ? 'default' : 'pointer' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
              <path d="M4 7h16M10 11v6M14 11v6" />
              <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
            </svg>
            삭제
            <span style={{ flex: 1 }} />
            <span style={POP_KEY}>⌫</span>
          </button>
        </div>
      )}
      {/* 날개는 메뉴의 **형제**다 — 자식으로 두면 메뉴의 등장 애니메이션이 남긴
          `transform`이 컨테이닝 블록이 되어 `fixed` 좌표가 메뉴 왼쪽 위에서 다시
          세어진다(본문 우클릭 메뉴에서 실측했다 — 화면 밖으로 밀려났다). */}
      {menu && moving && !last && (
        <MovePageMenu controller={controller} pageId={page.id} anchor={cursorStyle(menu, PAGE_MENU_W, 246)} onDone={closeMenu} />
      )}
    </div>
  );
}

/**
 * `다른 공책으로 이동 ›`의 날개 — 이 스페이스의 다른 공책들.
 *
 * 열렸을 때만 붙는 컴포넌트다(목록 조회가 그때 한 번 나간다 — `useNotebooks`).
 * 옮기기는 **받는 쪽에 먼저 쓰고** 성공했을 때만 여기서 뺀다(`moveNotePageTo`);
 * 그 공책을 다른 탭에서 고치는 중이면 잠금에 걸려 실패하는데, 그때 조용히 닫히면
 * 옮겨진 줄 알게 되므로 자리에 남아 이유를 말한다.
 */
function MovePageMenu({ controller, pageId, anchor, onDone }: { controller: EditorController; pageId: string; anchor: CSSProperties; onDone: () => void }) {
  const { rows, loading } = useNotebooks(controller, true);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const others = rows.filter((r) => r.docId !== controller.docId);
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const width = 252;
  // **부모 메뉴가 실제로 놓인 자리**를 기준으로 붙인다 — 커서 좌표를 다시 쓰면 화면
  // 밖으로 나가지 않으려 위로 당겨진 부모와 어긋나 한참 아래에 뜬다(프로브에서 봤다).
  const left = typeof anchor.left === 'number' ? anchor.left : 8;
  const top = typeof anchor.top === 'number' ? anchor.top : 8;
  // 오른쪽에 자리가 없으면 부모 메뉴의 **왼쪽**으로 넘긴다.
  const rightFits = left + PAGE_MENU_W + width + 16 < vw;
  return (
    <div
      data-note-page-move-menu
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        ...POP,
        position: 'fixed',
        left: rightFits ? left + PAGE_MENU_W + 6 : Math.max(8, left - width - 6),
        top,
        width,
        maxHeight: Math.max(160, Math.min(300, vh - top - 12)),
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <span style={POP_HEAD}>공책 고르기</span>
      {loading && <span style={{ padding: '8px 9px', fontSize: 12, color: 'var(--mf-faint)' }}>공책을 찾는 중…</span>}
      {!loading && others.length === 0 && <span style={{ padding: '8px 9px', fontSize: 12, color: 'var(--mf-faint)' }}>이 스페이스에 다른 공책이 없어요</span>}
      {others.map((r) => (
        <button
          key={r.docId}
          type="button"
          data-note-page-move-to={r.docId}
          className="btn mf-note-item"
          disabled={busy !== null}
          onClick={() => {
            setBusy(r.docId);
            setFailed(false);
            void controller.moveNotePageTo(pageId, r.docId).then((ok) => {
              setBusy(null);
              if (ok) onDone();
              else setFailed(true);
            });
          }}
          style={{ ...MENU_ITEM, height: 40, gap: 9 }}
        >
          <BookTile cover={r.cover} size="sm" />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
            <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{r.pages} 페이지</span>
          </span>
          {busy === r.docId && <span style={{ flex: '0 0 auto', fontSize: 10.5, color: 'var(--mf-faint)' }}>옮기는 중…</span>}
        </button>
      ))}
      {failed && (
        <span data-note-page-move-failed style={{ padding: '6px 9px', fontSize: 11, lineHeight: 1.5, color: 'var(--mf-danger)', wordBreak: 'keep-all' }}>
          옮기지 못했어요 — 그 공책을 다른 곳에서 고치는 중일 수 있어요. 잠시 뒤 다시 시도해 주세요.
        </span>
      )}
    </div>
  );
}

/**
 * 이 페이지가 질의에 걸리는가 — 걸렸으면 **보여 줄 한 줄**, 아니면 `null`.
 *
 * 제목에서 걸리면 빈 문자열을 돌려준다(행이 제목을 이미 보여 주므로 같은 말을
 * 두 번 쓰지 않는다 — 호출부는 `!== null`로 판단한다).
 */
function pageHit(page: NotePage, query: string): string | null {
  if (page.title.toLowerCase().includes(query)) return '';
  for (const b of page.blocks) {
    const line = blockText(b)
      .split('\n')
      .find((l) => l.toLowerCase().includes(query));
    if (line) return line.length > 70 ? `${line.slice(0, 69)}…` : line;
  }
  return null;
}

/* ── 페이지 머리(제목·태그·페이지 조작) ───────────────────────────────────── */

/**
 * 글의 부피 — `176자 · 56단어 · 읽기 1분`(디자인 원본의 본문 맨 아래 줄).
 *
 * 회의록·정책처럼 **읽을 사람이 있는 글**에서 "이거 길어요?"에 답해 주는 줄이다.
 * 읽기 시간은 한국어 분당 500자(일반적인 추정치)로, 1분 미만도 `1분`으로 적는다.
 */
function PageStats({ page, wide }: { page: NotePage; wide: boolean }) {
  const text = pageText(page);
  const chars = [...text.replace(/\s+/g, '')].length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return (
    <div
      data-note-stats
      style={{
        // **자리를 따로 잡는다**(요청) — 본문과 함께 구르지 않고 페이지 바닥에 붙는다.
        flex: '0 0 auto',
        background: 'var(--mf-note-body)',
        padding: '0 30px 9px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ ...(wide ? {} : { maxWidth: 700 }), margin: '0 auto' }}>
        {/* 화면을 가로지르는 **경계선이 아니라 본문의 구분선**이다(제보) — 머리 아래의
            그 선과 같은 색·같은 가로 길이라 한 문서의 선 둘이 세로로 맞아떨어진다.
            글이 아니라 장식이므로 고를 수도 지울 수도 없다(`aria-hidden`인 빈 span). */}
        <span aria-hidden="true" data-note-stats-rule style={{ display: 'block', height: 1, background: 'var(--mf-border-soft)', marginBottom: 9 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10.5, color: 'var(--mf-faint)', flexWrap: 'wrap' }}>
          <span>{chars}자</span>
          <span aria-hidden="true">·</span>
          {/* `읽기 n분`은 뺐다(요청) — 디자인에는 있지만 한 장짜리 공책 페이지에서
              500자/분 추정이 말해 주는 것이 거의 없다(대개 `1분`으로 고정된다). 길이는
              자·단어 두 값이 이미 말한다. */}
          <span>{words}단어</span>
          <span style={{ flex: 1, minWidth: 0 }} />
          {page.updatedAt && <span>{formatLastEdited(page.updatedAt)} 수정</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * 페이지 태그 고르개 — 칩(점 · 이름 · 캐럿)과 팝업(디자인 3번 이미지).
 *
 * **태그 만들기**가 여기 있다: 기본 여섯(`NOTE_TAGS`)으로는 팀마다 다른 분류를 담지
 * 못한다. 태그 자체는 저장할 곳이 따로 없다 — 그냥 페이지에 적히는 글자다. 그래서
 * 목록은 [기본 여섯 + **이 공책에서 실제로 쓰인 태그**]로 만든다: 1장에서 만든 태그가
 * 2장에서도 그대로 보인다.
 *
 * **점 색은 만들 때 고른다**(요청) — 고르지 않으면 이름 해시로 정해진다(`noteTagColor`).
 * 고른 값만 문서의 `tagColors`에 적히므로, 그 공책을 여는 모든 사람이 같은 색을 본다
 * (해시는 기기마다 같지만 "우리 팀의 회의록은 파랑"이라는 약속은 담지 못한다).
 */
function TagPick({
  controller,
  page,
  readOnly,
  open,
  setOpen,
}: {
  controller: EditorController;
  page: NotePage;
  readOnly: boolean;
  open: boolean;
  setOpen: (fn: (v: boolean) => boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  /** 새 태그에 고른 점 색 — `null`이면 이름에서 정해진다(고르지 않았다). */
  const [hue, setHue] = useState<string | null>(null);
  const tag = page.tag ?? null;
  const inks = controller.doc.tagColors;
  const { ref, rect } = useAnchored(open, () => setOpen(() => false));
  /** 고를 수 있는 태그 — 기본 여섯 뒤에 이 공책이 실제로 쓰고 있는 것들. */
  const options = useMemo(() => {
    const out = [...NOTE_TAGS];
    for (const pg of controller.notePages) {
      const t = pg.tag?.trim();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }, [controller.notePages]);

  const commit = () => {
    const name = draft.trim();
    if (name) {
      // 색을 **먼저** 적는다 — 태그가 먼저 붙으면 한 프레임 동안 기본색으로 그려진다.
      if (hue) controller.setNoteTagColor(name, hue);
      controller.setNotePageTag(page.id, name);
    }
    setDraft('');
    setHue(null);
    setAdding(false);
    setOpen(() => false);
  };
  const cancel = () => {
    setDraft('');
    setHue(null);
    setAdding(false);
  };
  /** 지금 새 태그가 그려질 색 — 고른 값이 있으면 그것, 없으면 이름에서. */
  const newInk = hue ?? noteTagColor(draft.trim() || '새', inks);

  return (
    <>
      <button
        type="button"
        ref={ref as RefObject<HTMLButtonElement>}
        data-note-tag-pick
        disabled={readOnly}
        title="태그 바꾸기"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className="btn"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 24,
          padding: '0 8px 0 10px',
          borderRadius: 999,
          // 칩은 **종이 면 + 테두리**다(요청·시안) — 태그 색을 면에 풀면 태그마다
          // 칩의 무게가 달라 보이고, 옆의 사람·시각 줄보다 튄다. 색은 점 하나가 맡고
          // 글자는 본문 잉크를 쓴다.
          border: `1px solid ${open ? 'var(--mf-border-hover)' : 'var(--mf-border)'}`,
          background: 'var(--mf-panel)',
          color: tag ? 'var(--mf-text)' : 'var(--mf-muted)',
          fontFamily: 'inherit',
          fontSize: 11,
          fontWeight: 700,
          cursor: readOnly ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden="true" style={{ width: 6, height: 6, flex: '0 0 auto', borderRadius: 999, background: tag ? noteTagColor(tag, inks) : 'var(--mf-faint)', display: 'block' }} />
        {tag || '태그 없음'}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && !readOnly && (
        <div data-note-tag-menu onPointerDown={(e) => e.stopPropagation()} style={{ ...POP, ...anchoredStyle(rect, 252), display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={POP_HEAD}>태그</span>
          {options.map((t) => {
            const on = tag === t;
            return (
              <button
                key={t}
                type="button"
                data-note-tag-opt={t}
                className="btn mf-note-item"
                onClick={() => {
                  controller.setNotePageTag(page.id, on ? null : t);
                  setOpen(() => false);
                }}
                style={{ ...MENU_ITEM, height: 30, gap: 8, fontWeight: on ? 800 : 600, ...(on ? { background: 'var(--mf-tag-on)' } : {}) }}
              >
                <span aria-hidden="true" style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: 999, background: noteTagColor(t, inks), display: 'block' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                {on && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mf-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 13 4.5 4.5L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
          {/* `태그 없음` — **목록의 마지막 줄**이다(요청). 태그를 고르는 자리에서 "안
              고르겠다"도 하나의 선택이라 같은 묶음에 있어야 하고, `태그 만들기` 아래에
              있으면 만들기의 부속처럼 읽힌다. */}
          {tag && (
            <button
              type="button"
              data-note-tag-clear
              className="btn mf-note-item"
              onClick={() => {
                controller.setNotePageTag(page.id, null);
                setOpen(() => false);
              }}
              style={{ ...MENU_ITEM, height: 30, gap: 8, color: 'var(--mf-muted)' }}
            >
              <span aria-hidden="true" style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: 999, background: 'var(--mf-faint2)', display: 'block' }} />
              태그 없음
            </button>
          )}
          <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', margin: '4px 2px' }} />
          {adding ? (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 5px 0 9px', borderRadius: 9, border: '1.5px solid var(--mf-accent)', background: 'var(--mf-card)' }}>
                <span data-note-tag-newdot aria-hidden="true" style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: 999, background: newInk, display: 'block' }} />
                <input
                  data-note-tag-new
                  autoFocus
                  value={draft}
                  maxLength={16}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') cancel();
                  }}
                  placeholder="새 태그 이름"
                  aria-label="새 태그 이름"
                  style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 12.5, outline: 'none' }}
                />
                <button
                  type="button"
                  data-note-tag-commit
                  onClick={commit}
                  title="추가"
                  aria-label="태그 추가"
                  style={{ width: 22, height: 22, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 13 4.5 4.5L19 7" />
                  </svg>
                </button>
              </span>
              {/* 색 고르개(요청·디자인) — 고르지 않으면 이름에서 정해지는 그 색이다.
                  팔레트가 해시의 팔레트와 **같은 여덟**이라, 고른 색과 저절로 정해진
                  색이 한 계열로 보인다. */}
              {/* 여덟이 **한 줄에** 서야 한 벌로 읽힌다 — 그래서 팝업 폭이 252다(디자인). */}
              <div data-note-tag-hues style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 6px 2px' }}>
                {NOTE_TAG_COLORS.map(([c, name]) => {
                  const on = hue === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      data-note-tag-hue={c}
                      title={name}
                      aria-label={`${name} 색`}
                      aria-pressed={on}
                      onClick={() => setHue((v) => (v === c ? null : c))}
                      style={{
                        width: 22,
                        height: 22,
                        flex: '0 0 auto',
                        padding: 0,
                        borderRadius: 999,
                        // 고른 색은 **테두리 링**으로 표시한다 — 점을 키우면 줄이 들썩인다.
                        border: `2px solid ${on ? c : 'transparent'}`,
                        background: 'transparent',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 999, background: c, display: 'block' }} />
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <button type="button" data-note-tag-add className="btn mf-note-item" onClick={() => setAdding(true)} style={{ ...MENU_ITEM, height: 30, gap: 8, color: 'var(--mf-accent)', fontWeight: 700 }}>
              <span aria-hidden="true" style={{ width: 16, height: 16, flex: '0 0 auto', borderRadius: 999, border: '1.5px dashed var(--mf-accent-mute)', color: 'var(--mf-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              태그 만들기
            </button>
          )}
        </div>
      )}
    </>
  );
}

function PageHead({ controller, page }: { controller: EditorController; page: NotePage }) {
  const [tagOpen, setTagOpen] = useState(false);
  const readOnly = controller.readOnly;
  const who = page.updatedBy?.trim() || controller.myName || '나';
  const mine = !page.updatedBy?.trim();
  const linked = page.linkedDocId ? controller.linkTargets.find((t) => t.docId === page.linkedDocId) : undefined;
  return (
    <div className="mf-note-head" data-note-page-head style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <input
        data-note-title
        value={page.title}
        readOnly={readOnly}
        placeholder="제목 없는 페이지"
        onChange={(e) => controller.setNotePageTitle(page.id, e.target.value)}
        title="눌러서 제목 수정"
        style={{
          border: 'none',
          // 눌러서 고칠 수 있다는 것을 **밑줄이 나타났다 사라지며** 알린다(디자인 원본).
          borderBottom: '1.5px dashed transparent',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: 27,
          fontWeight: 800,
          letterSpacing: '-.04em',
          lineHeight: 1.3,
          color: 'var(--mf-text)',
          outline: 'none',
          padding: '2px 0 5px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, position: 'relative', minWidth: 0 }}>
        {/* 페이지 태그 — 공책 표지의 태그와 **별개**다(페이지마다 다를 수 있다). */}
        <TagPick controller={controller} page={page} readOnly={readOnly} open={tagOpen} setOpen={setTagOpen} />
        {/* 누가 · 언제 — 디자인 원본은 태그 바로 옆에 이 둘을 둔다. 얼굴이 있으면
            "남이 고쳤다"가 이름을 읽기 전에 보인다. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto', minWidth: 0 }}>
          <Avatar name={who} size={20} src={mine ? controller.myAvatar : null} />
          <span style={{ fontSize: 11.5, color: 'var(--mf-subtext)', whiteSpace: 'nowrap' }}>{mine ? '나' : who}</span>
        </span>
        {page.updatedAt && <span style={{ fontSize: 11, color: 'var(--mf-faint)', flex: '0 0 auto', whiteSpace: 'nowrap' }}>{formatLastEdited(page.updatedAt)} 수정</span>}
        {/* 연결 문서 — 이 페이지가 어느 보드의 회의록인지. 눌러서 그리로 간다. */}
        {linked && (
          <a
            data-note-linked-doc
            href={linked.href}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', flex: '0 0 auto', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3.5" y="4" width="4.6" height="16" rx="1.3" />
              <rect x="9.7" y="4" width="4.6" height="10" rx="1.3" />
              <rect x="15.9" y="4" width="4.6" height="13" rx="1.3" />
            </svg>
            {linked.title}
          </a>
        )}
      </div>
    </div>
  );
}

/* ── 서식 툴바 ─────────────────────────────────────────────────────────────── */

function FormatToolbar({
  controller,
  boxRef,
  rememberBox,
  onInserted,
  openSlash,
  focus,
  setFocus,
  wide,
}: {
  controller: EditorController;
  boxRef: { current: HTMLElement | null };
  rememberBox: () => void;
  /** 새로 만든 블록·항목으로 캐럿을 보낸다(루트의 `freshId`). */
  onInserted: (id: string | null) => void;
  /** `/` 단추 — 지금 줄에서 블록 목록을 연다. `from`을 주면 그 요소를 기준으로 뜬다. */
  openSlash: (blockId: string, from?: Element | null) => void;
  focus: boolean;
  setFocus: (fn: (v: boolean) => boolean) => void;
  /** 본문 단이 창 너비를 쓰는가(`cover.wide`) — 폭 단추의 켜짐 상태. */
  wide: boolean;
}) {
  const [open, setOpen] = useState<'hl' | 'ink' | null>(null);
  /**
   * 지금 캐럿에 걸린 서식 — 굵게·기울임·취소선·밑줄·코드 단추가 이걸 보고 켜진다(요청).
   *
   * 선택이 바뀔 때마다 다시 읽어야 하므로 `selectionchange`를 듣는다. 값이 같으면
   * 상태를 갱신하지 않는다 — 글자를 칠 때마다 이벤트가 오는데 매번 리렌더하면
   * 편집 박스가 흔들린다.
   */
  const [marks, setMarks] = useState({ b: false, i: false, s: false, u: false, k: false });
  useEffect(() => {
    const read = () => {
      const el = noteEditBoxInSelection() ?? boxRef.current;
      const next = el ? noteActiveMarks(el) : { b: false, i: false, s: false, u: false, k: false };
      setMarks((cur) => (cur.b === next.b && cur.i === next.i && cur.s === next.s && cur.u === next.u && cur.k === next.k ? cur : next));
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [boxRef]);

  /**
   * 지금 **다루는 블록** — 캐럿이 들어 있던 줄. 아직 아무 데도 두지 않았으면
   * 마지막 블록으로 본다(툴바를 먼저 누르는 사람이 아무 일도 못 하게 두지 않는다).
   */
  const curBlockId = (): string | null => {
    const key = boxRef.current?.getAttribute('data-note-line') || '';
    const id = blockIdOf(key);
    if (id) return id;
    const blocks = controller.notePage?.blocks ?? [];
    return blocks.length ? blocks[blocks.length - 1]!.id : null;
  };

  /**
   * 넣기 — **줄 종류를 바꿀 수 있으면 바꾸고, 아니면 아래에 새로 만든다.**
   *
   * 빈 문단에서 「글머리 목록」을 누르면 그 줄이 목록이 되는 것이 기대이고(새 줄이
   * 하나 더 생기면 빈 문단이 남는다), 글이 들어 있는 줄에서는 새로 만드는 것이 맞다.
   * 표·이미지·구분선·문서 링크는 글을 담지 않으므로 언제나 새로 만든다.
   */
  const insert = (kind: NoteBlockKind) => {
    const id = curBlockId();
    const blocks = controller.notePage?.blocks ?? [];
    const cur = blocks.find((b) => b.id === id);
    const textLike = noteBlockShape(kind) === 'items';
    if (cur && textLike && noteBlockShape(cur.kind) === 'runs' && runsText(cur.runs) === '') {
      controller.retypeNoteBlock(cur.id, kind);
      onInserted(cur.id);
      return;
    }
    onInserted(controller.addNoteBlock(kind, id ?? undefined));
  };

  /**
   * 서식을 걸고 **그 결과를 문서에 커밋한다**.
   *
   * 박스가 어느 블록·항목·칸의 것인지는 `data-note-line`에 실어 둔 키로 안다 —
   * 툴바가 블록 구조를 다시 알아내지 않아도 되고, 목록 항목·표 칸도 같은 길을 쓴다.
   */
  const apply = (kind: 'b' | 'i' | 's' | 'u' | 'k' | 'c' | 'hl' | 'link' | 'clear', val?: string | null) => {
    const el = boxRef.current;
    if (!el) return;
    const runs = applyNoteFormat(el, kind, val);
    if (!runs) return;
    commitLine(controller, el.getAttribute('data-note-line') || '', runs);
    setOpen(null);
  };

  /**
   * 링크 — 고른 글에 주소를 건다. 주소는 `prompt`로 받는다(디자인의 `insertUrl`과 같은
   * 자리). 취소하거나 빈 값이면 아무 일도 하지 않고, **선택을 기억해 둔 박스**에 건다.
   */
  const insertLink = () => {
    const el = boxRef.current;
    if (!el) return;
    const url = typeof window === 'undefined' ? null : window.prompt('링크 주소');
    if (!url || !url.trim()) return;
    apply('link', url.trim());
  };

  const stop = (e: ReactMouseEvent) => {
    // **선택을 잃지 않는다**: mousedown의 기본 동작이 포커스를 옮겨 캐럿이 풀린다.
    rememberBox();
    e.preventDefault();
  };

  return (
    <div
      data-note-toolbar
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
        padding: '9px 20px',
        borderBottom: '1px solid var(--mf-border-soft)',
        background: 'var(--mf-card)',
      }}
    >
      <BlockTypeMenu controller={controller} rememberBox={rememberBox} boxRef={boxRef} />
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {MARKS.map((m) => (
        <button
          key={m.kind}
          type="button"
          data-note-mark={m.kind}
          title={m.name}
          aria-label={m.name}
          className="btn mf-note-tb"
          aria-pressed={marks[m.kind]}
          onMouseDown={stop}
          onClick={() => apply(m.kind)}
          style={{
            ...TOOL_BTN,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontWeight: 700,
            // 걸려 있으면 켜진 면 — 지금 글자가 어떤 서식인지 툴바가 말해 준다(요청).
            background: marks[m.kind] ? 'var(--mf-accent-soft)' : 'transparent',
            color: marks[m.kind] ? 'var(--mf-accent-deep)' : 'var(--mf-subtext)',
            ...m.css,
          }}
        >
          {m.label}
        </button>
      ))}
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {/* 형광펜 */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          data-note-hl
          className="btn mf-note-tb"
          title="형광펜"
          onMouseDown={stop}
          onClick={() => setOpen((v) => (v === 'hl' ? null : 'hl'))}
          style={{ ...TOOL_BTN, flexDirection: 'column', gap: 2, background: open === 'hl' ? 'var(--mf-accent-soft)' : 'transparent' }}
        >
          {/* 형광펜 글리프 — 색은 아래 막대가 말한다(디자인). */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m14.5 4.5 5 5-8 8H6.5v-5z" />
            <path d="M4 21h16" />
          </svg>
          <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 999, background: noteHighlightColor('yellow') ?? '#FBEFC0', display: 'block' }} />
        </button>
        {open === 'hl' && (
          <div style={SWATCH_POP}>
            {NOTE_HIGHLIGHTS.map(([key, name]) => (
              <button key={key} type="button" title={name} aria-label={name} className="btn" onMouseDown={stop} onClick={() => apply('hl', key)} style={{ ...SWATCH, background: noteHighlightColor(key) ?? 'transparent' }} />
            ))}
            <button type="button" title="형광펜 지우기" aria-label="형광펜 지우기" className="btn" onMouseDown={stop} onClick={() => apply('hl', '')} style={{ ...SWATCH, background: 'transparent', fontSize: 11 }}>
              ✕
            </button>
          </div>
        )}
      </div>
      {/* 글자색 */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          data-note-ink
          className="btn mf-note-tb"
          title="글자색"
          onMouseDown={stop}
          onClick={() => setOpen((v) => (v === 'ink' ? null : 'ink'))}
          style={{ ...TOOL_BTN, flexDirection: 'column', gap: 2, background: open === 'ink' ? 'var(--mf-accent-soft)' : 'transparent' }}
        >
          <span aria-hidden="true" style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>A</span>
          <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 999, background: 'var(--mf-text)', display: 'block' }} />
        </button>
        {open === 'ink' && (
          <div style={SWATCH_POP}>
            {INKS.map(([ink, name]) => (
              <button
                key={name}
                type="button"
                title={name}
                aria-label={name}
                className="btn"
                onMouseDown={stop}
                onClick={() => apply('c', ink || null)}
                style={{ ...SWATCH, background: ink || 'var(--mf-panel2)', color: 'var(--mf-text)', fontSize: 11 }}
              >
                {ink ? '' : 'A'}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* 링크 — 인라인 묶음의 마지막(디자인). 고른 글에 주소를 건다. */}
      <button type="button" data-note-link-btn className="btn mf-note-tb" title="링크" aria-label="링크" onMouseDown={stop} onClick={insertLink} style={TOOL_BTN}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
      </button>
      <button type="button" data-note-clear className="btn mf-note-tb" title="서식 지우기" aria-label="서식 지우기" onMouseDown={stop} onClick={() => apply('clear')} style={TOOL_BTN}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 7h10M12 7v10M8 20h8" />
          <path d="m4 4 16 16" />
        </svg>
      </button>
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {/* 넣기 — 디자인 원본의 `TOOL_ICONS`. 모델에는 처음부터 있던 블록들인데 넣는
          길이 `/` 커맨드 하나뿐이었다(그래서 있는 줄도 몰랐다). */}
      {INSERTS.map((t) => (
        <button key={t.kind} type="button" data-note-insert={t.kind} title={t.name} aria-label={t.name} className="btn mf-note-tb" onMouseDown={stop} onClick={() => insert(t.kind)} style={TOOL_BTN}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {t.icon}
          </svg>
        </button>
      ))}
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {/* 정렬·들여쓰기 — `NoteBlock.align`·`indent`는 모델에 있었는데 버튼이 없어
          화면에 나타난 적이 없다. 지금 줄에 걸린다(선택 범위가 아니라 블록 단위다). */}
      {ALIGNS.map((t) => {
        const on = (controller.notePage?.blocks.find((b) => b.id === curBlockId())?.align ?? 'left') === t.align;
        return (
          <button
            key={t.align}
            type="button"
            data-note-align={t.align}
            aria-pressed={on}
            title={t.name}
            aria-label={t.name}
            className="btn mf-note-tb"
            onMouseDown={stop}
            onClick={() => {
              const id = curBlockId();
              if (id) controller.setNoteBlockAlign(id, t.align);
            }}
            style={{ ...TOOL_BTN, background: on ? 'var(--mf-accent-soft)' : 'transparent', color: on ? 'var(--mf-accent)' : 'var(--mf-subtext)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              {t.icon}
            </svg>
          </button>
        );
      })}
      {INDENTS.map((t) => (
        <button
          key={t.name}
          type="button"
          data-note-indent={t.delta > 0 ? 'in' : 'out'}
          title={t.name}
          aria-label={t.name}
          className="btn mf-note-tb"
          onMouseDown={stop}
          onClick={() => {
            const id = curBlockId();
            if (id) controller.setNoteBlockIndent(id, t.delta);
          }}
          style={TOOL_BTN}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {t.icon}
          </svg>
        </button>
      ))}
      <span style={{ flex: 1 }} />
      {/* `/` — 빈 줄에서 `/`를 치는 것과 같은 자리를 **버튼으로도** 연다. 그 규칙을
          아는 사람만 쓸 수 있는 기능이 되지 않게(디자인 원본도 이 단추를 둔다).
          디자인은 글리프가 아니라 **키캡**처럼 생긴 작은 면이다. */}
      <button
        type="button"
        data-note-slash-btn
        title="블록 넣기 (/)"
        aria-label="블록 넣기"
        className="btn mf-note-tb"
        onMouseDown={stop}
        onClick={(e) => {
          const id = curBlockId();
          // 기준은 **이 단추**다(요청) — 눌러서 연 목록이 화면 저 아래에 뜨면 어디서
          // 나온 것인지 알 수 없다.
          if (id) openSlash(id, e.currentTarget);
        }}
        style={TOOL_BTN}
      >
        {/* 키캡 — **정사각**이다(제보: 면이 너무 좁다). 좌우 여백만 주면 `/` 한 글자
            폭에 맞춰 납작해져 옆의 30×30 단추들과 다른 리듬으로 보인다. */}
        <span aria-hidden="true" style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'var(--mf-panel2)', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, fontWeight: 700, color: 'var(--mf-subtext)', lineHeight: 1 }}>/</span>
      </button>
      <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--mf-hairline)', margin: '0 4px' }} />
      {/* **본문 폭**(요청) — `가운데 정렬`(700px)과 `창 너비에 맞춤` 둘을 오간다.
          표가 넓거나 화면이 큰 사람에게는 700px 단이 답답하고, 글만 읽는 사람에게는
          화면 폭 한 줄이 너무 길다 — 둘 다 옳아서 고를 수 있게 둔다. 값은 **공책
          한 권**에 적힌다(`cover.wide`): 한 권 안에서 장마다 폭이 달라지면 페이지를
          넘길 때마다 글이 출렁인다. */}
      <button
        type="button"
        data-note-width
        aria-pressed={wide}
        title={wide ? '본문 폭 — 창 너비에 맞춤 (눌러서 가운데 정렬)' : '본문 폭 — 가운데 정렬 (눌러서 창 너비에 맞춤)'}
        aria-label={wide ? '본문 폭 가운데 정렬로' : '본문 폭 창 너비에 맞춤'}
        className="btn mf-note-tb"
        onMouseDown={stop}
        onClick={() => controller.setNoteCover({ wide: !wide })}
        style={{ ...TOOL_BTN, background: wide ? 'var(--mf-accent-soft)' : 'transparent', color: wide ? 'var(--mf-accent)' : 'var(--mf-subtext)' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {wide ? (
            // 창 너비에 맞춤 — 바깥 테두리를 가득 채운 단.
            <>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M6 10h12M6 14h9" />
            </>
          ) : (
            // 가운데 정렬 — 양옆에 여백을 둔 단.
            <>
              <rect x="3" y="5" width="18" height="14" rx="2" opacity=".35" />
              <path d="M8 10h8M8 14h6" />
              <path d="M7 5v14M17 5v14" opacity=".5" />
            </>
          )}
        </svg>
      </button>
      {/* 집중 — 본문 단을 좁히고 여백을 키운다(디자인의 `toggleFocus`: 700→640px). */}
      <button
        type="button"
        data-note-focus
        aria-pressed={focus}
        title={focus ? '집중 모드 끄기' : '집중 모드'}
        aria-label={focus ? '집중 모드 끄기' : '집중 모드'}
        className="btn mf-note-tb"
        onMouseDown={stop}
        onClick={() => setFocus((v) => !v)}
        style={{ ...TOOL_BTN, background: focus ? 'var(--mf-accent-soft)' : 'transparent', color: focus ? 'var(--mf-accent)' : 'var(--mf-subtext)' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
        </svg>
      </button>
      <ExportMenu controller={controller} stop={stop} />
      <button
        type="button"
        data-note-keys
        title="단축키"
        aria-label="단축키"
        className="btn mf-note-tb"
        onMouseDown={stop}
        onClick={() => controller.setHelpOpen(true)}
        style={{ ...TOOL_BTN, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13, fontWeight: 700 }}
      >
        ?
      </button>
      {/* 표지 색은 **툴바에서 뺐다**(요청) — 원본 디자인에도 없고, 표지는 글을 쓰는
          동안 건드릴 것이 아니라 공책을 고르는 자리(홈의 우클릭 메뉴)의 일이다. */}
    </div>
  );
}

/** 블록 종류 바꾸기 — 캐럿이 있는 블록에 걸린다. */
function BlockTypeMenu({ controller, rememberBox, boxRef }: { controller: EditorController; rememberBox: () => void; boxRef: { current: HTMLElement | null } }) {
  const [open, setOpen] = useState(false);
  const cur = controller.notePage?.blocks.find((b) => b.id === blockIdOf(boxRef.current?.getAttribute('data-note-line') || ''));
  const curType = BLOCK_TYPES.find((t) => t.kind === (cur?.kind ?? 'p')) ?? BLOCK_TYPES[0]!;
  const { ref, rect } = useAnchored(open, () => setOpen(false));
  return (
    <>
      {/* 디자인은 이 하나만 **테두리 있는 알약**이다 — 지금 줄이 무엇인지 늘 말해 주는
          자리라 다른 단추들과 달리 면을 가진다. 왼쪽 아이콘이 그 종류를 그림으로 겹쳐 말한다. */}
      <button
        type="button"
        ref={ref as RefObject<HTMLButtonElement>}
        data-note-blocktype
        className="btn"
        title="블록 종류"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          rememberBox();
          e.preventDefault();
        }}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          // **폭을 고정한다**(제보) — 이름이 `본문`에서 `코드 블록`으로 바뀔 때마다
          // 단추가 늘어 오른쪽 단추들이 통째로 밀렸다. 가장 긴 이름(`글머리 목록`)이
          // 들어가는 폭으로 못박고 넘치면 말줄임한다.
          width: 118,
          flex: '0 0 auto',
          boxSizing: 'border-box',
          height: 30,
          padding: '0 8px 0 10px',
          border: '1px solid var(--mf-border)',
          borderRadius: 9,
          background: open ? 'var(--mf-panel2)' : 'transparent',
          color: 'var(--mf-text)',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {curType.icon}
        </svg>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{curType.name}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          data-note-blocktype-menu
          onPointerDown={(e) => e.stopPropagation()}
          style={{ ...POP, ...anchoredStyle(rect, 224, { maxHeight: 340 }), display: 'flex', flexDirection: 'column', gap: 1 }}
          className="lnb-scroll"
        >
          {BLOCK_TYPES.filter((t) => t.inMenu).map((t) => (
            <Fragment key={t.kind}>
            {t.sepBefore && <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', margin: '4px 2px' }} />}
            <button
              type="button"
              data-note-blocktype-item={t.kind}
              className="btn mf-note-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const key = boxRef.current?.getAttribute('data-note-line') || '';
                const id = blockIdOf(key);
                if (id) {
                  controller.retypeNoteBlock(id, t.kind);
                  // 종류를 바꾸면 그 자리의 줄이 다시 그려진다 — **쓰던 자리로 캐럿을
                  // 돌려준다**(제보: 목록을 풀면 포커스가 풀린다). 목록으로 바뀌면
                  // 편집 박스는 블록이 아니라 **첫 항목**이 갖는다.
                  caretToLine(id);
                  requestAnimationFrame(() => {
                    const first = document.querySelector<HTMLElement>(`[data-note-block="${id}"] [data-note-line]`);
                    if (first && first.getAttribute('data-note-line') !== id) caretToLine(first.getAttribute('data-note-line') || id);
                  });
                }
                setOpen(false);
              }}
              style={{ ...MENU_ITEM, fontWeight: cur?.kind === t.kind ? 800 : 600, ...(cur?.kind === t.kind ? { background: 'var(--mf-accent-soft)' } : {}) }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-subtext)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
                {t.icon}
              </svg>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              {/* 오른쪽 끝의 **키 힌트** — 고정폭이라 여러 줄이 세로로 맞는다(디자인). */}
              <span style={POP_KEY}>{t.hint}</span>
            </button>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}

/* ── 블록 ─────────────────────────────────────────────────────────────────── */

interface BlockProps {
  controller: EditorController;
  block: NoteBlock;
  index: number;
  freshId: string | null;
  setFreshId: (id: string | null) => void;
  rememberBox: () => void;
  focusBox: (el: HTMLElement) => void;
  /** `/`를 쳤다 — **그 줄의 키**와 글자 자리(글자는 본문에 남는다). 목록 항목·표
   * 칸에서도 열린다(그 줄의 글로 좁혀져야 하므로 블록 id로는 모자란다). */
  openSlash: (lineKey: string, at?: number) => void;
}

/**
 * 내보내기 — 확장자 배지가 붙은 네 형식 + **범위 세그먼트**(디자인 5번 이미지).
 *
 * 범위가 있는 이유: 공책은 여러 장이 한 권이라 "이 회의록 한 장만" 보낼 때와 "이
 * 공책을 통째로" 넘길 때가 둘 다 흔하다. 기본은 **이 페이지** — 지금 보고 있는 것이
 * 대개 보내려는 것이다.
 *
 * 형식마다 길이 다르다:
 *   MD·TXT  글자 그대로 내려받는다(코어 `noteMarkdown`/`notePlainText`).
 *   DOCX    XML 몇 장을 담은 zip을 직접 만든다(`docx.ts` — 압축 없이 담아도 유효하다).
 *   PDF     **브라우저 인쇄**를 연다(`notePrint.ts`). 직접 만들려면 한글 글꼴을 파일에
 *           심어야 하는데, 인쇄를 거치면 글자 그대로·쪽 나눔까지 브라우저가 해 준다.
 */
function ExportMenu({ controller, stop }: { controller: EditorController; stop: (e: ReactMouseEvent) => void }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<NoteExportScope>('page');
  const [notice, setNotice] = useState('');
  const { ref, rect } = useAnchored(open, () => setOpen(false));

  const title = controller.docTitle || '공책';
  const page = controller.notePage;
  const base = scope === 'book' ? title : page?.title?.trim() || title;
  const items: { ext: string; name: string; tone: string; onPick: () => void }[] = [
    { ext: 'MD', name: 'Markdown', tone: '#4e8c67', onPick: () => downloadFile(`${base}.md`, noteMarkdown(controller.doc, title, scope, page?.id ?? null), 'text/markdown') },
    {
      ext: 'PDF',
      name: 'PDF 문서',
      tone: '#c0563a',
      onPick: () => {
        if (!openNotePrint(controller.doc, title, scope, page?.id ?? null)) setNotice('팝업이 막혀 있어요 — 이 사이트의 팝업을 허용해 주세요');
      },
    },
    { ext: 'DOCX', name: 'Word 문서', tone: '#3e66b8', onPick: () => exportDocx(controller.doc, title, scope, page?.id ?? null, base) },
    { ext: 'TXT', name: '일반 텍스트', tone: '#8a8078', onPick: () => downloadFile(`${base}.txt`, notePlainText(controller.doc, title, scope, page?.id ?? null), 'text/plain') },
  ];

  return (
    <>
      <button
        type="button"
        ref={ref as RefObject<HTMLButtonElement>}
        data-note-export
        title="내보내기"
        aria-label="내보내기"
        className="btn mf-note-tb"
        onMouseDown={stop}
        onClick={() => setOpen((v) => !v)}
        style={{ ...TOOL_BTN, background: open ? 'var(--mf-accent-soft)' : 'transparent' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M8 11l4 4 4-4" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      </button>
      {open && (
        <div data-note-export-menu onPointerDown={(e) => e.stopPropagation()} style={{ ...POP, ...anchoredStyle(rect, 236, { align: 'right' }), display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={POP_HEAD}>내보내기 · {scope === 'book' ? '공책 전체' : '이 페이지'}</span>
          {items.map((x) => (
            <button
              key={x.ext}
              type="button"
              data-note-export-item={x.ext}
              className="btn mf-note-item"
              onMouseDown={stop}
              onClick={() => {
                x.onPick();
                setOpen(false);
              }}
              style={MENU_ITEM}
            >
              <span aria-hidden="true" style={{ width: 26, height: 20, flex: '0 0 auto', borderRadius: 6, background: `color-mix(in srgb, ${x.tone} 16%, var(--mf-card))`, color: x.tone, fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {x.ext}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
            </button>
          ))}
          <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', margin: '4px 2px' }} />
          {/* 범위 — 세그먼트 둘. 고른 쪽이 종이면으로 떠오른다(목록의 정렬과 같은 모양). */}
          <span style={{ display: 'flex', gap: 3, padding: 3, margin: '0 2px 2px', borderRadius: 9, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)' }}>
            {([['page', '이 페이지'], ['book', '공책 전체']] as const).map(([key, name]) => (
              <button
                key={key}
                type="button"
                data-note-export-scope={key}
                aria-pressed={scope === key}
                onMouseDown={stop}
                onClick={() => setScope(key)}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  height: 24,
                  border: 0,
                  borderRadius: 7,
                  background: scope === key ? 'var(--mf-card)' : 'transparent',
                  color: scope === key ? 'var(--mf-text)' : 'var(--mf-subtext)',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  fontWeight: scope === key ? 800 : 600,
                  cursor: 'pointer',
                  boxShadow: scope === key ? '0 1px 2px rgba(46,42,38,.16)' : 'none',
                }}
              >
                {name}
              </button>
            ))}
          </span>
          {notice && <span style={{ padding: '2px 9px 6px', fontSize: 10.5, color: 'var(--mf-danger)', lineHeight: 1.5, wordBreak: 'keep-all' }}>{notice}</span>}
        </div>
      )}
    </>
  );
}

function BlockView({ controller, block, index, freshId, setFreshId, rememberBox, focusBox, openSlash }: BlockProps) {
  const readOnly = controller.readOnly;
  const shape = noteBlockShape(block.kind);
  /**
   * 이 페이지의 강조색 — 디자인은 `accent = allTags()[태그]`다. 즉 **페이지 태그 색**이
   * 체크 표시와 제목 바를 칠한다(회의록이면 자두색, 회고면 주황). 공책 표지 색이
   * 아니다 — 한 공책 안에서도 장마다 성격이 다를 수 있고, 목록의 태그 점과 본문의
   * 강조가 같은 색이라야 "이 장은 회의록"이 두 곳에서 같은 말을 한다.
   */
  const accent = pageAccent(controller);
  /** 이 페이지에 글이 한 자도 없는가 — 첫 줄 안내를 띄울지 가른다. */
  const pageIsEmpty = (controller.notePage?.blocks ?? []).every((b) => blockText(b).trim() === '');

  /** 엔터 — 같은 종류의 새 블록을 아래에 만든다(제목 뒤에는 문단이 자연스럽다). */
  const enterBlock = (at: number): boolean => {
    if (readOnly) return false;
    /**
     * **캐럿 뒤의 글이 따라 내려간다**(요청) — 문장 한가운데서 Enter를 치면 거기서
     * 갈린다. 끝에서 쳤으면 가를 것이 없으므로 예전처럼 빈 줄 하나를 더한다
     * (새 블록을 만드는 길이 그대로라 제목 뒤의 Enter 같은 규칙도 그대로다).
     */
    const len = runsText(block.runs).length;
    if (at < len) {
      const made = controller.splitNoteBlock(block.id, at);
      if (made) {
        /**
         * **DOM도 함께 자른다** — 편집 박스는 비제어라(마운트할 때 한 번만 그린다)
         * 모델만 가르면 화면에는 원래 글이 그대로 남고, 캐럿이 새 줄로 옮겨 가며
         * 포커스를 잃는 순간 그 옛 글이 통째로 **되덮는다**(실측으로 그랬다).
         */
        const el = document.querySelector<HTMLElement>(`[data-note-line="${block.id}"]`);
        if (el) el.innerHTML = runsToHtml({ text: runsText(made.head), rich: made.head });
        setFreshId(made.id);
        return true;
      }
    }
    const next = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3' ? 'p' : block.kind;
    setFreshId(controller.addNoteBlock(next === 'hr' || next === 'table' ? 'p' : next, block.id));
    return true;
  };

  /** 맨 앞 백스페이스 — 빈 블록이면 지우고, 글이 있으면 문단으로 되돌린다. */
  /**
   * 이 블록을 지운 **다음**, 캐럿을 바로 앞 줄의 **끝**으로 보낸다(제보: 한 줄을
   * 지워도 커서가 올라가지 않는다).
   *
   * 왜 `freshId`로 안 되나: 그 길은 **새로 마운트되는** 줄에만 듣는다
   * (`NoteLine`의 `autoFocus`는 마운트할 때 한 번이다). 앞 줄은 이미 떠 있으므로
   * 우리가 직접 옮겨야 한다. 지우면 DOM이 다시 그려지므로 다음 프레임에 찾는다.
   */
  const caretToPrevLine = (): void => {
    const go = () => {
      const wrap = document.querySelector<HTMLElement>(`[data-note-blockwrap="${block.id}"]`);
      // 지워졌으면 그 자리에 **다음** 블록이 와 있다 — 앞 블록은 언제나 이전 형제다.
      const prev = (wrap?.previousElementSibling ?? document.querySelectorAll('[data-note-blockwrap]')[index - 1]) as HTMLElement | null;
      if (!prev) return;
      // 표처럼 **고쳐 쓸 수 없는 줄**만 가진 블록은 건너뛴다(캐럿이 갈 자리가 없다).
      const lines = [...prev.querySelectorAll<HTMLElement>('[data-note-line][contenteditable="true"]')];
      const el = lines[lines.length - 1];
      if (!el) return;
      el.focus({ preventScroll: true });
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false); // 끝 — 이어 쓰려던 자리다
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        /* 캐럿을 못 놓아도 포커스는 갔다 */
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    else setTimeout(go, 0);
  };

  const backBlock = (): boolean => {
    if (readOnly) return false;
    const empty = runsText(block.runs) === '';
    if (empty && index > 0) {
      controller.removeNoteBlock(block.id);
      caretToPrevLine();
      return true;
    }
    if (block.kind !== 'p') {
      controller.retypeNoteBlock(block.id, 'p');
      // 종류만 바뀌고 글은 그대로다 — **그 줄에 캐럿을 남긴다**(제보: 포커스가 풀린다).
      caretToLine(block.id, 0);
      return true;
    }
    /**
     * **글이 있는 줄의 맨 앞 Backspace = 앞 줄에 잇기**(제보: 윗줄로 올라가지 않는다).
     *
     * 예전에는 여기서 손을 뗐고(브라우저가 할 일도 없다 — 앞에 글자가 없다) 그래서
     * 아무 일도 일어나지 않았다. 이제 앞 줄 끝에 이어 붙이고 캐럿을 이은 자리에 둔다.
     */
    if (index > 0) {
      const joined = controller.mergeNoteBlockBack(block.id);
      if (joined) {
        // 비제어 박스라 **앞 줄의 DOM도** 우리가 다시 그린다(Enter로 가를 때와 같은
        // 이유: 포커스를 잃는 순간 옛 글이 되덮는다).
        const el = document.querySelector<HTMLElement>(`[data-note-line="${joined.key}"]`);
        if (el) el.innerHTML = runsToHtml({ text: runsText(joined.runs), rich: joined.runs });
        caretToLine(joined.key, joined.at);
        return true;
      }
      // 앞이 구분선이면 그것을 **고른다** — 한 번 더 누르면 지워진다.
      const wrap = document.querySelector<HTMLElement>(`[data-note-blockwrap="${block.id}"]`);
      const hr = wrap?.previousElementSibling?.querySelector<HTMLElement>('[data-note-hr]');
      if (hr) {
        hr.focus();
        return true;
      }
    }
    return false;
  };

  if (shape === 'empty') {
    /**
     * **구분선도 고를 수 있다**(제보: 넣고 나면 지울 방법이 없다).
     *
     * 글이 없는 블록이라 캐럿이 갈 자리가 없고, 그래서 선택(글자 범위)에도 걸리지
     * 않고 백스페이스도 닿지 않았다. 우클릭 메뉴는 있었지만 **선 한 줄(1px)**이라
     * 겨냥하는 것 자체가 어려웠다.
     *
     * 그래서 선을 **초점을 받을 수 있는 칸**으로 감싼다 — 누르면(또는 위·아래
     * 방향키로 넘어오면) 테두리가 켜지고, 그 상태에서 Backspace·Delete로 지운다.
     * 위아래 여백(8px)은 겨냥할 면이기도 하다.
     */
    const onHrKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (moveNoteCaret(e.key === 'ArrowUp' ? -1 : 1)) e.preventDefault();
        return;
      }
      if (readOnly) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        controller.removeNoteBlock(block.id);
        caretToPrevLine();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        setFreshId(controller.addNoteBlock('p', block.id));
      }
    };
    return (
      <div data-note-block={block.id} data-note-kind={block.kind} style={blockFlow(block)}>
        <div
          data-note-hr={block.id}
          className="mf-note-hr"
          role="button"
          aria-label="구분선 — 지우려면 선택한 뒤 Backspace"
          tabIndex={0}
          onKeyDown={onHrKey}
          style={{ padding: '8px 0', borderRadius: 6, outline: 'none', cursor: 'pointer' }}
        >
          <hr style={{ border: 'none', borderTop: '1px solid var(--mf-border)', margin: 0 }} />
        </div>
      </div>
    );
  }

  if (shape === 'img') {
    return <ImageBlock controller={controller} block={block} />;
  }

  if (shape === 'link') {
    return <LinkBlock controller={controller} block={block} />;
  }

  if (block.kind === 'callout') {
    const tone = TONES.find((t) => t.tone === (block.tone ?? 'warn')) ?? TONES[0]!;
    return (
      <div
        data-note-block={block.id}
        data-note-kind="callout"
        onMouseUp={rememberBox}
        style={{ ...blockFlow(block), display: 'flex', gap: 10, alignItems: 'flex-start', padding: '13px 15px', borderRadius: 13, background: tone.bg, borderLeft: `3px solid ${tone.ink}` }}
      >
        {/* 어조는 **왼쪽 칩을 눌러** 돈다 — 세 가지뿐이라 메뉴보다 한 번 누르는 쪽이 빠르다. */}
        <button
          type="button"
          data-note-tone={block.tone ?? 'warn'}
          disabled={readOnly}
          title="주의 · 결정 · 질문"
          onClick={() => {
            const i = TONES.findIndex((t) => t.tone === (block.tone ?? 'warn'));
            controller.setNoteCalloutTone(block.id, TONES[(i + 1) % TONES.length]!.tone);
          }}
          className="btn"
          style={{
            flex: '0 0 auto',
            height: 20,
            marginTop: 2,
            padding: '0 8px',
            borderRadius: 999,
            border: 'none',
            background: 'transparent',
            color: tone.ink,
            fontFamily: 'inherit',
            fontSize: 11,
            fontWeight: 800,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          {tone.name}
        </button>
        <NoteLine
          onFocusLine={focusBox}
          lineKey={block.id}
          runs={block.runs}
          readOnly={readOnly}
          placeholder="알려 둘 것"
          autoFocus={freshId === block.id}
          onChange={(runs) => controller.setNoteBlockRuns(block.id, runs)}
          onEnter={enterBlock}
          onBackspaceAtStart={backBlock}
          style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.75, color: 'var(--mf-text)' }}
        />
      </div>
    );
  }

  if (block.kind === 'toggle') {
    const open = block.open ?? true;
    return (
      <div data-note-block={block.id} data-note-kind="toggle" onMouseUp={rememberBox} style={blockFlow(block)}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <button
            type="button"
            data-note-toggle={open ? 'open' : 'closed'}
            aria-expanded={open}
            aria-label={open ? '접기' : '펼치기'}
            onClick={() => controller.toggleNoteOpen(block.id)}
            className="btn"
            style={{ flex: '0 0 auto', width: 18, height: 24, border: 'none', background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .14s ease' }}>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
          <NoteLine
            onFocusLine={focusBox}
            lineKey={block.id}
            runs={block.runs}
            readOnly={readOnly}
            placeholder="접어 둘 제목"
            autoFocus={freshId === block.id}
            onChange={(runs) => controller.setNoteBlockRuns(block.id, runs)}
            onEnter={enterBlock}
            onBackspaceAtStart={backBlock}
            style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 700, lineHeight: 1.8, color: 'var(--mf-text)' }}
          />
        </div>
        {/* 접힌 토글의 **안쪽 내용은 다음 블록들**이 아니라 이 한 줄이다(이번 판).
            구조를 중첩으로 들면 모델이 트리가 되고, 그러면 순서·이동·삭제가 전부
            달라진다 — 접는 쓰임의 대부분은 "긴 설명을 감춰 두기"라 한 줄로 충분하다. */}
        {open && (
          <div style={{ paddingLeft: 24, paddingTop: 2 }}>
            <NoteLine
              onFocusLine={focusBox}
              lineKey={`${block.id}:body`}
              runs={block.items?.[0]?.runs}
              readOnly={readOnly}
              placeholder="펼쳤을 때 보일 내용"
              onArrowOut={moveNoteCaret}
              onChange={(runs) => {
                const itemId = block.items?.[0]?.id;
                if (itemId) controller.setNoteItemRuns(block.id, itemId, runs);
                else controller.addNoteItem(block.id);
              }}
              style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--mf-subtext)' }}
            onSlash={(at) => {
                if (readOnly) return;
                openSlash(`${block.id}:body`, at);
              }}
              />
          </div>
        )}
      </div>
    );
  }

  if (shape === 'items') {
    /**
     * 표식은 **코어가 센다**(`listMarkers`) — 항목마다 단계가 다를 수 있어(Tab)
     * 번호가 단계별로 따로 매겨지기 때문이다(`1. a. i.` · `• ◦ ▪`).
     */
    const items = block.items ?? [];
    const marks = block.kind === 'ck' ? [] : listMarkers(block.kind === 'ol' ? 'ol' : 'ul', items, block.start ?? 1);
    return (
      <div data-note-block={block.id} data-note-kind={block.kind} style={{ ...blockFlow(block), display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, j) => (
          <div key={item.id} data-note-item-depth={item.indent ? String(item.indent) : undefined} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingLeft: (item.indent ?? 0) * 22 }}>
            {block.kind === 'ck' ? (
              <button
                type="button"
                data-note-check={item.id}
                role="checkbox"
                aria-checked={!!item.done}
                aria-label="완료 표시"
                disabled={readOnly}
                onClick={() => controller.toggleNoteCheck(block.id, item.id)}
                className="btn"
                style={{
                  // 디자인: 18×18 · 반지름 6 · 빈 테두리는 `#DCD1C6` · 켜지면 **페이지 태그 색**.
                  width: 18,
                  height: 18,
                  marginTop: 4,
                  flex: '0 0 auto',
                  borderRadius: 6,
                  border: `1.5px solid ${item.done ? accent : 'var(--mf-note-ck)'}`,
                  background: item.done ? accent : 'transparent',
                  color: 'var(--mf-card)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: readOnly ? 'default' : 'pointer',
                  padding: 0,
                }}
              >
                {item.done && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                )}
              </button>
            ) : (
              <span aria-hidden="true" data-note-bullet={marks[j] ?? ''} style={{ flex: '0 0 auto', width: 18, marginTop: 3, textAlign: 'right', fontSize: 13, color: 'var(--mf-faint)', fontFamily: block.kind === 'ol' ? 'ui-monospace, monospace' : undefined }}>
                {marks[j] ?? '•'}
              </span>
            )}
            <NoteLine
              onFocusLine={focusBox}
              lineKey={`${block.id}:${item.id}`}
              runs={item.runs}
              readOnly={readOnly}
              placeholder={j === 0 ? '항목' : ''}
              autoFocus={freshId === item.id}
              onArrowOut={moveNoteCaret}
              onChange={(runs) => controller.setNoteItemRuns(block.id, item.id, runs)}
              onSlash={(at) => {
                if (readOnly) return;
                openSlash(`${block.id}:${item.id}`, at);
              }}
              onEnter={() => {
                if (readOnly) return false;
                // 빈 항목에서 엔터 = 목록을 **끝낸다**(문단으로 빠져나온다) —
                // 문서 편집기의 몸에 익은 동작이고, 없으면 빈 항목이 쌓인다.
                if (runsText(item.runs) === '' && (block.items ?? []).length > 1) {
                  controller.removeNoteItem(block.id, item.id);
                  setFreshId(controller.addNoteBlock('p', block.id));
                  return true;
                }
                setFreshId(controller.addNoteItem(block.id, item.id));
                return true;
              }}
              onTab={(back) => {
                if (readOnly) return false;
                // 캐럿은 그대로 둔다 — 이 줄은 다시 마운트되지 않고 **왼쪽 여백만** 바뀐다.
                return controller.setNoteItemIndent(block.id, item.id, back ? -1 : 1);
              }}
              onBackspaceAtStart={() => {
                if (readOnly) return false;
                // 들여쓴 항목의 맨 앞 Backspace는 **먼저 내어쓴다**(글이 있어도) —
                // 문서 편집기의 몸에 익은 순서다(지우기 전에 한 단계 나온다).
                if ((item.indent ?? 0) > 0) return controller.setNoteItemIndent(block.id, item.id, -1);
                /**
                 * **앞 줄에 잇는다** — 앞 항목이 있으면 그 항목에, 첫 항목이면 앞
                 * 블록의 마지막 줄에(그때 목록의 나머지 항목은 그대로 남는다).
                 * 빈 항목도 같은 길을 지난다(이어 붙일 글이 없을 뿐이다).
                 */
                const joined = controller.mergeNoteBlockBack(block.id, item.id);
                if (joined) {
                  const el = document.querySelector<HTMLElement>(`[data-note-line="${joined.key}"]`);
                  if (el) el.innerHTML = runsToHtml({ text: runsText(joined.runs), rich: joined.runs });
                  caretToLine(joined.key, joined.at);
                  return true;
                }
                // 이을 앞 줄이 없다(페이지의 첫 블록) — 빈 항목만 정리한다.
                if (runsText(item.runs) !== '') return false;
                if ((block.items ?? []).length > 1) {
                  const prev = (block.items ?? [])[j - 1];
                  controller.removeNoteItem(block.id, item.id);
                  caretToLine(prev ? `${block.id}:${prev.id}` : block.id);
                  return true;
                }
                controller.retypeNoteBlock(block.id, 'p');
                // 목록이 문단으로 돌아간 자리 — 그 문단에 캐럿을 남긴다(제보).
                caretToLine(block.id);
                return true;
              }}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                lineHeight: 1.7,
                // 끝낸 항목은 **흐려지고 줄이 그어진다**(요청). 색만 바꾸면 "옅은 글"과
                // "끝난 글"이 같아 보여서, 목록을 훑을 때 무엇이 남았는지 한눈에 안 들어온다.
                color: block.kind === 'ck' && item.done ? 'var(--mf-muted)' : 'var(--mf-text)',
                textDecoration: block.kind === 'ck' && item.done ? 'line-through' : undefined,
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (shape === 'table') {
    return <TableBlock controller={controller} block={block} focusBox={focusBox} openSlash={openSlash} />;
  }

  // 글 한 덩이(문단·제목·인용·코드) — 종류가 겉모습만 정한다.
  const style = runStyleOf(block.kind);
  const heading = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3';
  const line = (
    <NoteLine
      onFocusLine={focusBox}
      lineKey={block.id}
      runs={block.runs}
      readOnly={readOnly}
      // 안내는 **이 페이지가 통째로 비었을 때만** 뜬다(제보). 예전에는 `index === 0`만
      // 봐서, 아래에 글이 가득한데 첫 줄만 지워도 긴 안내가 튀어나오고 캐럿이 그
      // 글자 끝으로 밀려 보였다.
      placeholder={index === 0 && pageIsEmpty ? '여기에 글을 쓰세요 — / 로 블록 넣기' : ''}
      autoFocus={freshId === block.id}
      onChange={(runs) => {
        /**
         * **마크다운 단축**(요청) — `- ` 는 글머리 기호, `3. ` 은 3번부터 번호 매기기.
         *
         * 문단이 **그 글자뿐일 때만** 건다: 글 중간의 `- `나 `1. `까지 잡으면 목록이
         * 아니라 그냥 글을 쓰던 사람이 매번 되돌려야 한다. 되돌리기는 한 번이면 된다
         * (종류 바꾸기와 글 비우기를 컨트롤러가 한 커밋으로 묶는다).
         */
        const md = block.kind === 'p' && !readOnly ? listShortcutOf(runsText(runs)) : null;
        if (md) {
          // 캐럿은 **항목**으로 보낸다(제보: 목록으로 바뀌면 커서가 풀린다) — 목록의
          // 편집 박스는 블록이 아니라 항목이 갖는다.
          setFreshId(controller.noteListShortcut(block.id, md.kind, md.start));
          return;
        }
        controller.setNoteBlockRuns(block.id, runs);
      }}
      onEnter={enterBlock}
      onBackspaceAtStart={backBlock}
      onArrowOut={moveNoteCaret}
      onSlash={(at) => {
        if (readOnly) return;
        openSlash(block.id, at);
      }}
      style={heading ? { ...style, flex: 1, minWidth: 0 } : style}
    />
  );
  return (
    <div
      data-note-block={block.id}
      data-note-kind={block.kind}
      onMouseUp={rememberBox}
      style={{
        ...blockFlow(block),
        ...(heading ? { display: 'flex', alignItems: 'center', gap: 9 } : {}),
        ...(block.kind === 'q' ? { padding: '14px 16px', borderRadius: 13, background: 'var(--mf-panel2)', borderLeft: '3px solid var(--mf-accent-mute)' } : {}),
        ...(block.kind === 'code' ? { background: 'var(--mf-panel2)', border: '1px solid var(--mf-border-soft)', borderRadius: 13, padding: '13px 15px' } : {}),
      }}
    >
      {/* 제목의 왼쪽 강조 바 — 디자인 원본. 굵기만으로 가른 제목은 긴 글에서 본문과
          섞여 보인다(스크롤하며 훑을 때 눈이 걸릴 자리가 없다). */}
      {heading && <span aria-hidden="true" style={{ width: 3, height: block.kind === 'h1' ? 21 : 17, flex: '0 0 auto', borderRadius: 999, background: accent, display: 'block' }} />}
      {line}
    </div>
  );
}

/**
 * 표에서 지금 고른 것 — 칸 하나 · 끌어서 잡은 네모 구간 · 행 · 열 · 표 전체.
 *
 * `range`가 `r`·`c`를 따로 드는 이유: 구간에도 **기준 칸**이 있어야 메뉴가
 * "이 행", "이 열"을 말할 수 있고, 키보드로 늘릴 때 어느 쪽이 고정단인지 안다.
 */
type TableSel =
  | { mode: 'cell'; r: number; c: number }
  | { mode: 'range'; r0: number; c0: number; r1: number; c1: number; r: number; c: number }
  | { mode: 'row'; r: number }
  | { mode: 'col'; c: number }
  | { mode: 'all' };

/** 채울 수 있는 색 — 표를 읽기 쉽게 하는 **옅은 면**들이다(글자가 그대로 읽혀야 한다). */
const CELL_FILLS: readonly (readonly [string, string])[] = [
  ['#FBEEE4', '살구'],
  ['#F6F1E7', '모래'],
  ['#EDF4EC', '풀빛'],
  ['#EAF0F9', '하늘'],
  ['#F7EDF3', '자두'],
  ['#F1F1F0', '안개'],
];

/** 보일까 말까 — 인라인으로 적어 CSS의 hover 규칙보다 **이 판단**이 이기게 한다. */
function showIf(on: boolean | undefined): CSSProperties {
  return on ? { opacity: 1, pointerEvents: 'auto' } : { opacity: 0, pointerEvents: 'none' };
}

/** 고른 자리를 **채울 자리**로 — 칩과 메뉴가 같은 값을 쓴다(스냅샷으로 넘긴다). */
function fillTargetOf(sel: TableSel): TableFillTarget {
  if (sel.mode === 'cell') return { kind: 'cell', r: sel.r, c: sel.c };
  if (sel.mode === 'range') return { kind: 'range', r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1 };
  if (sel.mode === 'row') return { kind: 'row', r: sel.r };
  if (sel.mode === 'col') return { kind: 'col', c: sel.c };
  return { kind: 'all' };
}

/** 이 칸이 고른 것에 드는가. */
function selHas(sel: TableSel | null, r: number, c: number): boolean {
  if (!sel) return false;
  if (sel.mode === 'all') return true;
  if (sel.mode === 'row') return sel.r === r;
  if (sel.mode === 'col') return sel.c === c;
  if (sel.mode === 'cell') return sel.r === r && sel.c === c;
  return r >= Math.min(sel.r0, sel.r1) && r <= Math.max(sel.r0, sel.r1) && c >= Math.min(sel.c0, sel.c1) && c <= Math.max(sel.c0, sel.c1);
}

/** 고른 것의 **기준 칸** — 메뉴가 "이 행 · 이 열"을 말할 때 쓴다. */
function selAnchor(sel: TableSel): { r: number; c: number } {
  if (sel.mode === 'all') return { r: 0, c: 0 };
  if (sel.mode === 'row') return { r: sel.r, c: 0 };
  if (sel.mode === 'col') return { r: 0, c: sel.c };
  return { r: sel.r, c: sel.c };
}

/** 칩에 적는 두 조각 — 무엇을 골랐나(이름)와 얼마나(개수). */
function selLabel(sel: TableSel, rows: number, cols: number): { name: string; count: string } {
  if (sel.mode === 'cell') return { name: '칸 선택', count: '1칸' };
  if (sel.mode === 'range') {
    const h = Math.abs(sel.r1 - sel.r0) + 1;
    const w = Math.abs(sel.c1 - sel.c0) + 1;
    return { name: '범위 선택', count: `${h}×${w}` };
  }
  if (sel.mode === 'row') return { name: '행 선택', count: `${cols}칸` };
  if (sel.mode === 'col') return { name: '열 선택', count: `${rows}칸` };
  return { name: '표 전체', count: `${rows}×${cols}` };
}

/** 표가 재어 둔 치수 — 레일의 손잡이를 실제 행·열에 1:1로 맞춘다. */
interface TableGeom {
  rows: { t: number; h: number }[];
  cols: { l: number; w: number }[];
}

/**
 * 표 블록 — 칸·구간·행·열·표 전체를 고르고, 넣고 빼고 옮기고 **색을 붓는다**(스펙 문서).
 *
 * **레일은 표 바깥에 선다.** 위(열)·왼쪽(행)·좌상단(전체)의 세 자리이고, 손잡이는
 * 얇은 알약이지만 누르는 자리는 그보다 넓다(시각 요소보다 히트 영역이 크다). 표에
 * 마우스가 없으면 레일 전체가 사라진다 — 종이에 그린 표라는 인상을 늘 붙어 있는
 * 회색 띠가 깨뜨린다. 메뉴가 열려 있는 동안에는 마우스가 떠나도 남는다(무엇을
 * 겨냥한 메뉴인지 보이지 않으면 고를 수 없다).
 *
 * **레일을 절대 좌표로 그리는 이유**: 열 너비는 글에 따라 달라지고 행 높이는 줄바꿈에
 * 따라 달라져, 손잡이를 따로 그리면 어긋난다. 표를 한 번 재서(`ResizeObserver`) 그
 * 값으로 손잡이를 세운다 — 재지 못하는 환경(jsdom·숨은 표)에서는 균등 배분으로 물러선다.
 *
 * **레일은 손잡이 하나 단위로 반응한다**(요청) — A열 손잡이에 마우스를 얹으면 A열
 * 손잡이만 물들고, **그 왼쪽에만** ＋가 뜬다(행은 위쪽). 레일 전체가 함께 반응하면
 * "지금 어느 열을 겨냥했나"를 손잡이가 말해 주지 못하고, ＋가 줄줄이 떠 고르는 자리가
 * 더하는 자리로 읽힌다. 그래서 색과 ＋ 둘 다 **얹은 손잡이 하나**(`hot`)가 정한다.
 *
 * 표의 **오른쪽 끝·아래쪽 끝**에는 점선 띠가 하나씩 있어 "마지막에 하나 더"가 메뉴를
 * 거치지 않는다. 이 둘은 손잡이가 아니라 **표**에 마우스를 얹으면 나타난다.
 *
 * **한 번 누르면 고르기, 두 번 누르면 편집**(제보). 공책의 다른 블록은 상시 편집이지만
 * 표는 "무엇을 고쳤나"보다 "어느 칸이냐"를 먼저 묻는 자리라, 한 번의 누름이 곧 선택이고
 * 글은 두 번 눌러 연다(스프레드시트의 관례). 그래서 칸 위의 커서도 `cell`이다.
 */
function TableBlock({ controller, block, focusBox, openSlash }: { controller: EditorController; block: NoteBlock; focusBox: (el: HTMLElement) => void; openSlash: BlockProps['openSlash'] }) {
  const readOnly = controller.readOnly;
  const rows = block.rows ?? [];
  const width = rows[0]?.length ?? 0;
  const [sel, setSel] = useState<TableSel | null>(null);
  const [menu, setMenu] = useState<{ sel: TableSel; at: { x: number; y: number } } | null>(null);
  /**
   * **마우스를 얹은 손잡이 하나**(제보) — 레일 전체가 아니다.
   *
   * 레일 단위로 물들였더니 열 하나에 마우스를 얹어도 모든 열이 강조색이 되어 "지금
   * 어느 열을 겨냥했나"를 손잡이가 말해 주지 못했다. ＋의 노출과 색은 **이 값 하나**가
   * 정한다(레일 전체의 hover는 좌상단 코너를 숨기는 데만 쓰였고, 그 코너를 걷으면서
   * 함께 사라졌다).
   */
  const [hot, setHot] = useState<{ axis: 'row' | 'col'; i: number } | null>(null);
  /**
   * **마우스가 얹힌 칸**(요청) — 그 칸의 열·행 손잡이만 보인다.
   *
   * 예전에는 표에 마우스를 얹으면 레일이 통째로 나타나, 열이 여섯이면 손잡이 여섯과
   * 행 손잡이 여럿이 한꺼번에 떠서 "지금 어느 줄을 겨냥했나"가 보이지 않았다.
   * `A1`에 얹었으면 `A`열과 `1`행의 손잡이 둘만 선다.
   */
  const [hoverAt, setHoverAt] = useState<{ r: number; c: number } | null>(null);
  /**
   * **레일 띠 위에 마우스가 있다**(요청 7) — 그 축의 손잡이를 모두 보인다.
   *
   * 칸 위에 있을 때만 보이게 두면 손잡이로 마우스를 옮기는 **그 길에서** 사라져
   * 누를 수가 없다(제보 2 — 행 레일이 그랬다). 레일에 닿는 순간부터는 레일이
   * 기준이 되어, 띠를 따라 옮겨 다니며 원하는 줄을 고를 수 있다.
   */
  const [railZone, setRailZone] = useState<'row' | 'col' | null>(null);
  const [geom, setGeom] = useState<TableGeom | null>(null);
  /** 문서에 건 리스너가 읽는 최신 치수·칸 찾개 — 효과가 렌더마다 다시 붙지 않게. */
  const geomRef = useRef<TableGeom | null>(null);
  geomRef.current = geom;
  /**
   * **글을 고치는 중인 칸**(제보) — 두 번 눌러야 열린다.
   *
   * 이 칸만 `contentEditable`이고 나머지는 읽기 전용이다. 한 번의 누름을 선택으로
   * 쓰기로 했으니 그러지 않으면 누를 때마다 캐럿이 들어가 선택이 흐려진다.
   */
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);
  /** 편집을 연 뒤 캐럿을 놓을 자리 — 상태가 바뀐 **다음** 렌더에서만 놓을 수 있다. */
  const wantCaret = useRef<{ r: number; c: number; x?: number; y?: number; seed?: string } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** 넘침을 받는 바깥 판 — 가로 막대가 여기에 선다(표 테두리 **밖**, 그 아래). */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * 표 상자의 **가로 스크롤 위치** — 열 레일이 이 값만큼 따라 움직인다(제보).
   *
   * 레일은 상자 **밖**(그리드 `1 / 2`)에 있으면서 손잡이를 **표 기준 좌표**로 놓는다.
   * 열을 크게 늘려 표가 상자보다 넓어지면 상자만 스크롤되고 레일은 제자리에 남아,
   * 어긋난 양이 정확히 `scrollLeft`가 된다. ref가 아니라 state여야 다시 그려진다.
   */
  const [scrollX, setScrollX] = useState(0);
  /** 고른 시각 — 바깥 클릭으로 즉시 풀리는 것을 막는 가드(스펙 400ms). */
  const pickedAt = useRef(0);
  const touch = useIsTouchDevice();
  /**
   * **키를 받는 숨은 상자**(제보) — 칸을 고른 채 글자를 치면 그 칸에 들어간다.
   *
   * 왜 `div`가 아니라 `input`인가: `[data-note-table-box]`는 `tabIndex=-1`인 평범한
   * div라 **IME의 목적지가 될 수 없다**. 한글의 첫 `keydown`은 `key: 'Process'`로 와서
   * 글자 판정에 걸리지 않고, 그 안에서 포커스를 옮기면 이어질 조합이 취소돼 첫 자모가
   * 사라진다. 조합은 **여기서 끝까지 돌리고**, 끝난 글자를 칸에 옮겨 적는다.
   *
   * 터치 기기에서는 포커스를 주지 않는다 — 칸을 탭해 고르기만 해도 소프트 키보드가
   * 화면 절반을 덮는다.
   */
  const keysRef = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  const focusKeys = useCallback(() => {
    if (touch) return;
    const el = keysRef.current;
    if (!el) return;
    el.value = '';
    el.focus({ preventScroll: true });
  }, [touch]);
  /**
   * 고른 것에 **키를 받을 자리**를 준다.
   *
   * 칸 하나를 고른 경우에는 **그 칸 자신**이 받는다(아래 `armed` 효과) — 숨은
   * `<input>`을 거치면 한글이 한 박자 늦는다(제보). 행·열·표 전체는 옮겨 적을 칸이
   * 정해져 있지 않으므로 지금까지처럼 숨은 상자가 받는다.
   */
  const focusFor = useCallback(
    (next: TableSel | null) => {
      if (next?.mode === 'cell') return;
      focusKeys();
    },
    [focusKeys],
  );
  /** 끌어서 고르는 중 — 누른 칸이 기준이고, 다른 칸에 닿으면 구간이 된다. */
  const drag = useRef<{ r: number; c: number } | null>(null);
  /**
   * **크기를 끄는 중**(요청) — 경계선을 잡고 끌면 그 열·행만 커지고 줄어든다.
   *
   * 끄는 동안은 화면에만 반영하고(`live`), 손을 뗄 때 한 번 문서에 적는다 — 픽셀마다
   * 커밋하면 실행 취소가 한 칸씩 수십 개로 쌓인다(맵의 드래그와 같은 처방).
   */
  const sizing = useRef<{ axis: 'col' | 'row'; i: number; from: number; base: number[]; boxTop: number } | null>(null);
  const [live, setLive] = useState<{ axis: 'col' | 'row'; sizes: number[] } | null>(null);

  const pick = useCallback((next: TableSel | null) => {
    pickedAt.current = Date.now();
    setSel(next);
  }, []);

  /* 표를 재서 레일을 맞춘다 — 행 높이·열 너비가 글에 따라 달라지기 때문이다. */
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      if (!base.width) return; // 재지 못하는 환경(jsdom·숨은 표) — 균등 배분으로 물러선다
      const trs = Array.from(el.querySelectorAll('tr'));
      const next: TableGeom = {
        rows: trs.map((tr) => {
          const r = tr.getBoundingClientRect();
          return { t: r.top - base.top, h: r.height };
        }),
        cols: Array.from(trs[0]?.children ?? []).map((td) => {
          const r = (td as HTMLElement).getBoundingClientRect();
          return { l: r.left - base.left, w: r.width };
        }),
      };
      setGeom((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      // 열을 지워 표가 좁아지면 브라우저가 `scrollLeft`를 줄인다 — 그 값을 다시 읽지
      // 않으면 레일만 옛 오프셋에 남는다(같은 값이면 리렌더는 건너뛴다).
      setScrollX(scrollRef.current?.scrollLeft ?? 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // 표 하나만 보면 **줄이는 드래그가 안 잡힌다**: 합이 상자 너비 이하인 동안에는
    // colgroup만 다시 나뉘고 표의 border box는 그대로라 관찰자가 침묵한다(실측).
    // 첫 행의 칸들을 함께 보면 열 폭 변화가 곧바로 온다.
    Array.from(el.querySelector('tr')?.children ?? []).forEach((td) => ro.observe(td as HTMLElement));
    return () => ro.disconnect();
    // `setNoteTableSizes`는 `{ ...b, colW }`로 **`rows` 참조를 그대로 둔다** — 크기를
    // 커밋해도 `rows` 의존성이 변하지 않아 이펙트가 재실행되지 않았다(실측).
  }, [rows, width, block.colW, block.rowH]);

  /* 표 밖을 누르면 선택이 풀린다 — 단 방금 고른 것은 제 클릭으로 풀리지 않는다. */
  useEffect(() => {
    if (!sel && !edit) return;
    const onDoc = (e: MouseEvent) => {
      if (Date.now() - pickedAt.current < 400) return;
      if (rootRef.current?.contains(e.target as HTMLElement)) return;
      setSel(null);
      setEdit(null);
      };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [sel, edit]);

  /* 편집을 연 다음 렌더에서 캐럿을 놓는다 — 그 전에는 `contentEditable`이 아니다. */
  useEffect(() => {
    const want = wantCaret.current;
    if (!want) return;
    wantCaret.current = null;
    const el = cellLine(want.r, want.c);
    if (!el) return;
    if (want.seed !== undefined) {
      // 비제어 박스라 DOM에 직접 쓴다(`applyNoteFormat`과 같은 처방) — 그리고 그 값을
      // 곧바로 문서에 커밋한다. `input` 이벤트가 나지 않아 `NoteLine`이 모르기 때문이다.
      el.textContent = want.seed;
      controller.setNoteCell(block.id, want.r, want.c, textRuns(want.seed));
    }
    el.focus({ preventScroll: true });
    focusBox(el);
    try {
      const sp = want.seed === undefined && want.x != null && want.y != null ? caretAt(want.x, want.y) : null;
      const range = document.createRange();
      // 두 번 누른 **그 자리**에 캐럿을 둔다. 자리를 모르면 글 끝으로(이어 쓰려는 뜻).
      if (sp && el.contains(sp.node)) range.setStart(sp.node, sp.offset);
      else range.selectNodeContents(el);
      range.collapse(!!sp);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    } catch {
      /* 캐럿을 못 놓아도 포커스는 갔다 */
    }
  }, [edit]);

  /**
   * 그 칸의 글을 연다 — 두 번 누르기·Tab 이동·**고른 칸에 글자 치기**가 함께 쓴다.
   *
   * `seed`가 있으면 **기존 내용을 덮어쓴다**(스프레드시트의 관례 — 고른 칸에 글자를
   * 치는 것은 "이 값을 바꾸겠다"는 뜻이다. 이어 쓰려면 두 번 눌러 연다).
   */
  const openEdit = (r: number, c: number, at?: { x: number; y: number }, seed?: string) => {
    if (readOnly) return;
    wantCaret.current = { r, c, x: at?.x, y: at?.y, seed };
    setSel(null);
    setMenu(null);
    setEdit({ r, c });
  };

  /**
   * **고른 칸이 스스로 키를 받는다** — 한글이 첫 글자부터 들어가게(제보).
   *
   * 예전에는 숨은 `<input>`이 조합을 끝까지 돌리고 `compositionend`에서 그 결과를
   * 칸으로 옮겼다. 그런데 한글은 **다음 글자를 치는 순간**에야 앞 글자의 조합이
   * 끝나므로, 화면에는 두 번째 글자를 칠 때 첫 글자가 나타났고 그때 포커스가 옮겨
   * 가면서 이어지던 조합이 깨졌다(영어는 조합이 없어 첫 글자부터 멀쩡했다).
   *
   * 그래서 칸 하나를 고르면 **그 칸에 바로 포커스를 주고 글자를 통째로 고른다**.
   * 다음 글자는 브라우저가 "고른 글자를 갈아 끼우는" 평범한 입력으로 처리하므로
   * 조합이 한 번도 끊기지 않고, 스프레드시트의 "고른 칸에 치면 덮어쓴다"도 그대로다.
   * 터치 기기에서는 하지 않는다 — 탭만 해도 소프트 키보드가 화면 절반을 덮는다.
   */
  useEffect(() => {
    if (readOnly || touch || edit || sel?.mode !== 'cell') return;
    const el = cellLineRef.current(sel.r, sel.c);
    if (!el) return;
    el.focus({ preventScroll: true });
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    } catch {
      /* 글자를 못 골라도 포커스는 갔다 — 치면 이어 쓰기가 된다 */
    }
  }, [sel, edit, readOnly, touch]);

  /**
   * 끌기는 **문서에서** 이어지고 끝난다.
   *
   * 칸마다 `onMouseEnter`로만 넓히면 포인터가 표를 벗어나는 순간 구간이 멈췄다가
   * 돌아와야 다시 움직인다(제보). 표 밖에서도 좌표를 **가장 가까운 칸으로 눌러**
   * 계속 넓힌다 — 재어 둔 치수(`geom`)가 곧 칸의 경계다.
   */
  useEffect(() => {
    const near = (spans: { a: number; b: number }[], v: number): number => {
      for (let i = 0; i < spans.length; i++) if (v < spans[i]!.b || i === spans.length - 1) return v < spans[0]!.a ? 0 : i;
      return Math.max(0, spans.length - 1);
    };
    const move = (e: MouseEvent) => {
      const from = drag.current;
      const t = tableRef.current;
      const g = geomRef.current;
      if (!from || !t || !g || !g.rows.length || !g.cols.length) return;
      const base = t.getBoundingClientRect();
      const r = near(g.rows.map((x) => ({ a: x.t, b: x.t + x.h })), e.clientY - base.top);
      const c = near(g.cols.map((x) => ({ a: x.l, b: x.l + x.w })), e.clientX - base.left);
      if (r === from.r && c === from.c) return; // 아직 한 칸 안이다 — 구간이 아니다
      // 브라우저가 반쯤 그려 둔 글자 선택은 지운다(고른 것과 고치는 것이 갈린다).
      window.getSelection()?.removeAllRanges();
      pick({ mode: 'range', r0: from.r, c0: from.c, r1: r, c1: c, r: from.r, c: from.c });
    };
    const up = () => {
      drag.current = null;
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [pick]);

  const closeMenu = useCallback(() => setMenu(null), []);
  useAnchored(!!menu, closeMenu);

  /**
   * **표 안의 아무 데나 눌러도 메뉴가 닫힌다**(제보).
   *
   * `useAnchored`는 document에 **버블 단계** `pointerdown`을 거는데, 표 루트가
   * `stopPropagation`으로 그 전파를 끊는다(본문의 블록 간 드래그 선택을 깨우지 않기
   * 위해 반드시 있어야 하는 장치다 — React의 합성 `stopPropagation`은 네이티브까지
   * 함께 멈춘다). 그래서 표 **바깥**을 누르면 닫히고 표 **안**은 아무리 눌러도 열린
   * 채였다. 여기서는 **캡처 단계**로 걸어 그 차단선보다 먼저 듣는다.
   *
   * 메뉴 자신과 날개는 면제한다 — 날개는 메뉴의 **형제**로 뜨므로 메뉴 선택자만으로는
   * 모자라고, 빠뜨리면 색 칸을 누르는 순간 메뉴가 사라져 click이 닿지 않는다.
   */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[data-note-table-menu], [data-note-ctx-wing]')) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  const openMenu = (e: { clientX: number; clientY: number }, next: TableSel) => {
    pick(next);
    // 메뉴는 **열 때의 선택을 스냅샷으로** 든다 — 라이브 값을 읽으면 그 사이에 바깥
    // 클릭 핸들러가 선택을 지워 엉뚱한 한 칸에 적용된다(스펙이 겪었다고 적어 둔 버그).
    setMenu({ sel: next, at: { x: e.clientX, y: e.clientY } });
  };

  /**
   * 손잡이·코너 좌클릭은 **고르기뿐**이다(제보).
   *
   * 예전에는 같은 손잡이를 다시 누르면 메뉴가 떴는데, 고른 것을 다시 눌러 확인하는
   * 흔한 동작에서 메뉴가 튀어나왔다. 메뉴는 **우클릭**으로 옮겼다(`handleContext`).
   * 터치 기기에는 우클릭이 없으므로 그때만 두 번째 탭을 메뉴로 살려 둔다 — 레일은
   * `@media (hover: none)`에서 일부러 상시 노출되는 조작 수단이다.
   */
  const handleClick = (e: ReactMouseEvent, next: TableSel, same: boolean) => {
    if (same && touch) {
      openMenu(e, next);
      return;
    }
    pick(next);
    focusFor(next);
  };

  /** 레일·코너 우클릭 — 그 행·열·표의 메뉴를 연다(없으면 본문 블록 메뉴가 뜬다). */
  const handleContext = (e: ReactMouseEvent, next: TableSel) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e, next);
  };

  const fill = (target: TableFillTarget, color: string | null) => {
    controller.setNoteTableFill(block.id, target, color);
    // 칠하고 나면 선택을 놓는다(스펙 3-2) — 색을 보려면 면이 가리지 않아야 한다.
    setSel(null);
  };

  /* ── 키보드(스펙 6) ─────────────────────────────────────────────────────── */
  const cellLine = (r: number, c: number): HTMLElement | null =>
    rootRef.current?.querySelector<HTMLElement>(`[data-note-line="${block.id}:r${r}c${c}"]`) ?? null;
  const cellLineRef = useRef(cellLine);
  cellLineRef.current = cellLine;
  const focusCell = (r: number, c: number) => openEdit(r, c);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    // ⌘Z/⌘Y는 **전역이 받는다** — 공책에서는 `inEditable` 가드 앞에서 갈라지므로
    // (`useEditorState`의 공책 분기) 표의 숨은 `<input>`에서도 닿는다. 여기서 또
    // 받으면 한 번 눌러 두 번 되돌아간다.
    /**
     * **글을 고치는 중인가**는 이제 상태로 가른다(`edit`).
     *
     * 예전에는 "이벤트 대상이 편집 박스 안인가"로 봤는데, 고른 칸도
     * `contentEditable`이 되면서(한글 첫 글자를 받으려고) 그 판정이 늘 참이 됐다 —
     * 그러면 화살표·Esc·⌫가 선택이 아니라 캐럿에 걸린다.
     */
    const editing = edit !== null;
    const anchor = sel ? selAnchor(sel) : { r: 0, c: 0 };
    // Tab — 다음/이전 칸으로. 고른 칸에서도, 글을 고치는 중에도 돈다(표의 관례).
    // 자리는 셋에서 찾는다: 고치는 중인 칸 → 키가 난 칸 → 고른 칸.
    const atCell = /:r(\d+)c(\d+)$/.exec((e.target as HTMLElement).closest?.('[data-note-line]')?.getAttribute('data-note-line') ?? '');
    if (e.key === 'Tab' && (editing || atCell || sel)) {
      const r = editing ? edit.r : atCell ? Number(atCell[1]) : anchor.r;
      const c = editing ? edit.c : atCell ? Number(atCell[2]) : anchor.c;
      const flat = r * width + c + (e.shiftKey ? -1 : 1);
      if (flat < 0 || flat >= rows.length * width) return;
      e.preventDefault();
      focusCell(Math.floor(flat / width), flat % width);
      return;
    }
    // ⌥ + 화살표 — 그 자리에 행·열을 넣는다(스펙 4의 단축키).
    if (e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'ArrowUp') controller.addNoteTableRow(block.id, anchor.r);
      else if (e.key === 'ArrowDown') controller.addNoteTableRow(block.id, anchor.r + 1);
      else if (e.key === 'ArrowLeft') controller.addNoteTableCol(block.id, anchor.c);
      else controller.addNoteTableCol(block.id, anchor.c + 1);
      return;
    }
    if (editing) {
      // 글을 고치는 중의 Esc는 **편집만** 닫는다(선택은 애초에 없다).
      if (e.key === 'Escape') {
        e.preventDefault();
        setEdit(null);
        focusKeys();
      }
      return;
    }
    if (!sel) return;
    // 아래는 **표에 포커스가 있을 때**(글을 고치는 중이 아닐 때)만 — 그러지 않으면
    // 글 안에서 캐럿을 옮기는 화살표를 빼앗는다.
    if (e.key === 'Escape') {
      e.preventDefault();
      setSel(null);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      // **언제나 막는다** — 고른 칸은 이제 `contentEditable`이라(한글 첫 글자를 받으려고)
      // 막지 않으면 고르기만 해 둔 칸에서 글자가 하나 지워진다.
      e.preventDefault();
      if (sel.mode === 'row' && rows.length > 1) {
        controller.removeNoteTableRow(block.id, sel.r);
        setSel(null);
      } else if (sel.mode === 'col' && width > 1) {
        controller.removeNoteTableCol(block.id, sel.c);
        setSel(null);
      }
      return;
    }
    const step: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    const clampR = (r: number) => Math.max(0, Math.min(rows.length - 1, r));
    const clampC = (c: number) => Math.max(0, Math.min(width - 1, c));
    if (e.shiftKey) {
      // 늘리기 — 기준단은 그대로 두고 반대편만 움직인다.
      const base = sel.mode === 'range' ? sel : { r0: anchor.r, c0: anchor.c, r1: anchor.r, c1: anchor.c };
      pick({ mode: 'range', r0: base.r0, c0: base.c0, r1: clampR(base.r1 + d[0]), c1: clampC(base.c1 + d[1]), r: anchor.r, c: anchor.c });
    } else {
      pick({ mode: 'cell', r: clampR(anchor.r + d[0]), c: clampC(anchor.c + d[1]) });
    }
  };

  /* ── 레일 ───────────────────────────────────────────────────────────────── */
  const handleTone = (on: boolean, warm: boolean) => (on ? 'var(--mf-accent)' : warm ? 'var(--mf-accent-mute)' : 'var(--mf-th)');
  const plus = (label: string, onClick: () => void, style: CSSProperties) => (
    <button
      type="button"
      className="mf-note-tplus"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ position: 'absolute', width: 20, height: 20, border: 0, borderRadius: 999, background: 'transparent', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );

  /**
   * 그 손잡이를 지금 보일지 — 셋 중 하나면 보인다.
   * ① 마우스가 그 줄의 칸이나 손잡이 위에 있다 ② 그 줄이 골라져 있다(무엇을 골랐는지
   * 보이지 않으면 고를 수 없다) ③ 그 줄의 메뉴가 열려 있다.
   */
  const railOn = (axis: 'row' | 'col', i: number): boolean => {
    if (railZone === axis) return true;
    if (hot?.axis === axis && hot.i === i) return true;
    if (hoverAt && (axis === 'col' ? hoverAt.c : hoverAt.r) === i) return true;
    const live = menu?.sel ?? sel;
    if (live?.mode === 'all') return true;
    if (axis === 'col' && live?.mode === 'col') return live.c === i;
    if (axis === 'row' && live?.mode === 'row') return live.r === i;
    return false;
  };

  const colRail = !readOnly && width > 0 && (
    <div
      className="mf-note-trail"
      data-note-table-colrail
      // **클립 뷰포트**다 — `position`을 주지 않는 것이 중요하다(절대 배치의 원점은
      // 패딩 박스라, 여기가 positioned이면 손잡이가 패딩만큼 통째로 밀린다). 패딩과
      // 같은 크기의 음수 여백을 줘 ＋가 잘리지 않을 만큼만 클립 상자를 넓힌다.
      /**
       * 상자 **위쪽 바깥**에 뜬다(흐름 밖) — 표가 그만큼 더 넓게 선다(요청).
       *
       * 치수 계산: `left/right: 0`에 좌우 음수 여백 −12와 패딩 12를 함께 주어
       * **내용 상자가 정확히 표 상자의 폭**이 된다(안쪽 트랙의 `width: 100%`가 곧
       * 표의 폭이다). 세로는 `bottom: 100%`에 아래 여백 −4·패딩 8이라, 14px 트랙의
       * 아랫변이 상자 윗변에서 4px 위에 선다.
       *
       * 바깥이 `positioned`가 되었지만 손잡이의 원점은 **안쪽 트랙**(`relative`)이라
       * 좌표가 밀리지 않는다 — 그 둘을 가른 것이 스크롤 추종(#669)의 처방이었다.
       */
      onMouseEnter={() => setRailZone('col')}
      onMouseLeave={() => setRailZone(null)}
      style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', height: 14, overflow: 'hidden', padding: '8px 12px', margin: '-8px -12px -4px', boxSizing: 'content-box' }}
    >
      {/* 안쪽 트랙 — 손잡이의 절대 배치 원점이자 **스크롤을 따라가는 판**이다.
          변형은 스크롤이 있을 때만 건다: 값이 0이어도 변형이 있으면 그 요소가
          `position: fixed` 자손의 컨테이닝 블록이 되어 팝업이 잘린다(두 번 겪었다). */}
      <div style={{ position: 'relative', height: 14, width: '100%', display: geom ? 'block' : 'flex', alignItems: 'center', gap: 4, transform: scrollX ? `translateX(${-scrollX}px)` : undefined }}>
      {Array.from({ length: width }, (_, ci) => {
        const box = geom?.cols[ci];
        const on = sel?.mode === 'col' ? sel.c === ci : sel?.mode === 'all';
        // 칸 사이를 2px씩 비운다 — 붙여 두면 손잡이 셋이 띠 하나로 읽혀 "열마다
        // 하나"라는 것이 보이지 않는다(스펙의 레일 `column-gap: 4px`와 같은 자리).
        const place: CSSProperties = box ? { position: 'absolute', left: box.l + 2, width: Math.max(6, box.w - 4), top: 0, height: 14 } : { position: 'relative', flex: 1, minWidth: 0, height: 14 };
        return (
          <div
            key={ci}
            data-note-table-colslot={ci}
            style={{ ...place, ...showIf(railOn('col', ci)) }}
            // hover는 **감싸는 칸**이 잡는다 — 손잡이 단추에만 걸면 ＋로 마우스를
            // 옮기는 순간 `hot`이 풀려 ＋가 사라진다(＋는 단추 바깥에 그려진다).
            onMouseEnter={() => setHot({ axis: 'col', i: ci })}
            onMouseLeave={() => setHot(null)}
          >
            {/* ＋는 **얹은 손잡이의 왼쪽**에만 — 그 자리에 열을 끼워 넣는다(요청). */}
            {plus(ci === 0 ? '맨 앞에 열 넣기' : `${ci + 1}번째 열 왼쪽에 열 넣기`, () => controller.addNoteTableCol(block.id, ci), { left: -10, top: -3, ...showIf(hot?.axis === 'col' && hot.i === ci) })}
            <button
              type="button"
              className="mf-note-thandle"
              data-note-table-colhandle={ci}
              aria-label={`${ci + 1}번째 열 선택`}
              title="열 선택 · 우클릭하면 메뉴"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => handleClick(e, { mode: 'col', c: ci }, sel?.mode === 'col' && sel.c === ci)}
              onContextMenu={(e) => handleContext(e, { mode: 'col', c: ci })}
              style={{ width: '100%', height: '100%', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <span aria-hidden="true" style={{ display: 'block', width: '100%', height: 5, borderRadius: 999, background: handleTone(!!on, hot?.axis === 'col' && hot.i === ci) }} />
            </button>
          </div>
        );
      })}
      </div>
    </div>
  );

  const rowRail = !readOnly && (
    <div
      className="mf-note-trail"
      data-note-table-rowrail
      onMouseEnter={() => setRailZone('row')}
      onMouseLeave={() => setRailZone(null)}
      /**
       * 상자 **왼쪽 바깥**에 뜬다(흐름 밖).
       *
       * 틈(4px)을 **여백이 아니라 오른쪽 패딩**으로 준다(제보 2: 행 레일에 마우스를
       * 얹으면 사라져 누를 수가 없다). 여백으로 두면 그 4px이 어느 요소에도 속하지
       * 않아, 칸에서 레일로 가는 길에 블록 밖으로 나갔다 들어오게 된다 — 그 찰나에
       * `mouseleave`가 울려 레일이 숨고 `pointer-events: none`이 되어 다시는 닿지
       * 못한다. 패딩이면 그 4px도 레일의 몸이라 길이 끊기지 않는다.
       */
      style={{ position: 'absolute', right: '100%', marginRight: 0, paddingRight: 4, boxSizing: 'content-box', top: 0, bottom: 0, width: 14, display: geom ? 'block' : 'flex', flexDirection: 'column', gap: 4 }}
    >
      {rows.map((_, ri) => {
        const box = geom?.rows[ri];
        const on = sel?.mode === 'row' ? sel.r === ri : sel?.mode === 'all';
        const place: CSSProperties = box ? { position: 'absolute', top: box.t + 2, height: Math.max(6, box.h - 4), left: 0, width: 14 } : { position: 'relative', flex: 1, minHeight: 24, width: 14 };
        return (
          <div key={ri} data-note-table-rowslot={ri} style={{ ...place, ...showIf(railOn('row', ri)) }} onMouseEnter={() => setHot({ axis: 'row', i: ri })} onMouseLeave={() => setHot(null)}>
            {plus(ri === 0 ? '맨 위에 행 넣기' : `${ri + 1}번째 행 위에 행 넣기`, () => controller.addNoteTableRow(block.id, ri), { top: -10, left: -3, ...showIf(hot?.axis === 'row' && hot.i === ri) })}
            <button
              type="button"
              className="mf-note-thandle"
              data-note-table-rowhandle={ri}
              aria-label={`${ri + 1}번째 행 선택`}
              title="행 선택 · 우클릭하면 메뉴"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => handleClick(e, { mode: 'row', r: ri }, sel?.mode === 'row' && sel.r === ri)}
              onContextMenu={(e) => handleContext(e, { mode: 'row', r: ri })}
              style={{ width: '100%', height: '100%', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', justifyContent: 'center' }}
            >
              <span aria-hidden="true" style={{ display: 'block', width: 5, height: '100%', borderRadius: 999, background: handleTone(!!on, hot?.axis === 'row' && hot.i === ri) }} />
            </button>
          </div>
        );
      })}
    </div>
  );

  /**
   * 끝에 붙이는 ＋ 둘(제보) — **오른쪽 끝에 열**, **아래쪽 끝에 행**.
   *
   * 예전의 점선 띠를 스펙에 맞춰 뺐더니 "마지막에 하나 더" 하는 가장 흔한 동작이
   * 메뉴 안으로 들어가 버렸다. 그리드의 세 번째 열(18px)·세 번째 행(18px)이 원래
   * 이 자리를 위해 비워 둔 칸이라 거기에 세운다. 레일이 아니라 **표**에 마우스를
   * 얹으면 보인다 — 손잡이를 지나야 닿는 자리가 아니기 때문이다.
   */
  const endPlus = (label: string, onClick: () => void, area: 'col' | 'row') =>
    !readOnly && (
      <button
        type="button"
        className="mf-note-trail mf-note-tplus-end"
        data-note-table-append={area}
        title={label}
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClick}
        style={{
          // 표의 높이·너비를 그대로 두르는 **점선 띠**(시안) — 동그라미 하나보다
          // 어디에 붙는지가 한눈에 보인다(띠의 길이가 곧 그 축이다). 상자 바깥에
          // 떠서 페이지 자리를 먹지 않는다(요청).
          position: 'absolute',
          ...(area === 'col' ? { left: '100%', marginLeft: 4, top: 0, bottom: 0, width: 20 } : { top: '100%', marginTop: 4, left: 0, right: 0, height: 20 }),
          border: '1.5px dashed var(--mf-border)',
          borderRadius: 9,
          background: 'transparent',
          color: 'var(--mf-faint)',
          padding: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    );

  /** 지금 쓰는 크기 — 끄는 중이면 그 값, 아니면 문서의 값. */
  const colW = (live?.axis === 'col' ? live.sizes : block.colW) ?? null;
  const rowH = (live?.axis === 'row' ? live.sizes : block.rowH) ?? null;

  /**
   * 경계선 그립 — 열의 오른쪽 변·행의 아래 변에 얹힌 **얇은 띠**다.
   *
   * 값이 아직 없으면 지금 화면의 치수(`geom`)를 그대로 받아 적고 시작한다: 고정
   * 레이아웃으로 넘어가는 순간 나머지 열도 값이 있어야 손대지 않은 열이 제멋대로
   * 줄어들지 않는다. 최소값을 둬(열 56 · 행 28) 잡을 수 없게 작아지는 것을 막는다.
   */
  /**
   * @param end 마지막 행·열의 그립인가 — 그때는 잡는 자리를 **안쪽으로 6px** 당겨 두어
   *   (넘치면 모든 표에 유령 스크롤바가 생긴다) 보이는 선이 경계선보다 3px 앞에 섰다
   *   (제보: 선이 줄에 맞지 않고 틀어져 있다). 표식을 실어 보내면 CSS가 그 선만
   *   오른쪽·아래 끝으로 되돌린다.
   */
  const grip = (axis: 'col' | 'row', i: number, place: CSSProperties, end = false) => (
    <div
      key={`${axis}-${i}`}
      className="mf-note-tgrip"
      data-note-table-grip={`${axis}:${i}`}
      data-note-table-grip-end={end ? axis : undefined}
      role="separator"
      aria-label={axis === 'col' ? `${i + 1}번째 열 너비 조절` : `${i + 1}번째 행 높이 조절`}
      title={axis === 'col' ? '끌어서 열 너비 조절' : '끌어서 행 높이 조절'}
      onMouseDown={(e) => {
        if (readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        // 재어 온 값은 소수점이 붙는다 — 문서에는 **정수**만 적는다
        // (`178.984375`가 저장본에 남으면 사람이 읽을 수 없고 diff도 시끄럽다).
        const raw = (axis === 'col' ? (colW ?? geom?.cols.map((c) => c.w) ?? []) : (rowH ?? geom?.rows.map((r) => r.h) ?? [])).slice();
        const base = roundSizes(raw);
        if (!base.length) return;
        /**
         * **넘치지 않던 표는 잡는 순간에도 넘치지 않는다**(제보: 가로 스크롤이 없던
         * 크기에서도 열을 줄이면 막대가 생겼다 사라진다).
         *
         * 열마다 따로 반올림하면 합이 커질 수 있다(128.6 다섯 개 → 645). `width: 100%`
         * 로 판에 꼭 맞던 표가 **고정 폭으로 넘어가는 그 순간** 몇 px 넘쳐 막대가
         * 뜨고, 끌어서 줄이면 사라진다. 그래서 ① 누적 반올림으로 합을 보존하고
         * (`roundSizes`) ② 그래도 판보다 넓으면 **가장 넓은 열에서** 그만큼 깎는다.
         * 이미 넘치던 표(가로로 스크롤하던 표)는 건드리지 않는다.
         */
        const sc = scrollRef.current;
        if (axis === 'col' && sc && sc.scrollWidth <= sc.clientWidth + 1) {
          let over = base.reduce((a, b) => a + b, 0) - sc.clientWidth;
          while (over > 0) {
            const wide = base.reduce((best: number, v: number, k: number) => (v > (base[best] ?? 0) ? k : best), 0);
            const cut = Math.min(over, Math.max(0, (base[wide] ?? 0) - 56));
            if (cut <= 0) break;
            base[wide] = (base[wide] ?? 0) - cut;
            over -= cut;
          }
        }
        sizing.current = { axis, i, from: axis === 'col' ? e.clientX : e.clientY, base: base.slice(), boxTop: boxRef.current?.getBoundingClientRect().top ?? 0 };
        // 표 **윗변의 화면 자리**를 못박는다 — 끄는 동안 여기서 벗어나면 되돌린다.
        pin.current = { top: boxRef.current?.getBoundingClientRect().top ?? 0 };
        if (typeof requestAnimationFrame === 'function') pinRaf.current = requestAnimationFrame(keepTop);
        setLive({ axis, sizes: base.slice() });
      }}
      // 열 그립이 행 그립 **위**에 온다. 둘은 경계가 만나는 자리에서 6×6으로 겹치는데,
      // 행 그립은 표 너비를 통째로 덮으므로 순서만으로는 열을 잡을 수 없다(실측:
      // 열 경계를 겨냥해도 `elementFromPoint`가 행 그립을 돌려줬다).
      style={{ position: 'absolute', zIndex: axis === 'col' ? 2 : 1, ...place }}
    />
  );

  /**
   * **끄는 동안 표의 윗변을 화면에 못박는다**(제보: 행을 늘리면 아래가 아니라 위로
   * 자란다 — 윗 행이 밀려 올라가고 아랫 행은 제자리였다).
   *
   * 행이 커지면 표는 **아래로** 자라야 한다. 그런데 스크롤 판이 그 변화를 따라
   * 스스로 굴러 보정하면(브라우저의 스크롤 앵커링이 하는 일이다) 화면에서는 아랫부분이
   * 고정된 채 표가 위로 밀려 올라간 것처럼 보인다 — 자란 만큼 판이 함께 굴러서다.
   * 원인이 무엇이든(앵커링·확대 배율·레이아웃) 결과는 하나다: **윗변이 움직인다.**
   *
   * 그래서 잡은 순간의 윗변 자리를 적어 두고, 움직였으면 그만큼 스크롤을 되돌린다.
   * 제대로 자라는 경우에는 윗변이 애초에 움직이지 않으므로 아무 일도 하지 않는다
   * (실측: 우리 환경의 드리프트는 0이다). 프레임마다 도는 이유는 보정이 **레이아웃
   * 뒤에** 일어나기 때문이다 — 한 번만 재면 늘 한 프레임씩 늦는다. 손을 뗀 뒤에도
   * 잠깐(≈8프레임) 더 돌아 마지막 보정까지 따라잡는다.
   */
  const pin = useRef<{ top: number } | null>(null);
  const pinRaf = useRef(0);
  const keepTop = useCallback(() => {
    const box = boxRef.current;
    const want = pin.current?.top;
    const sc = box?.closest('[data-note-page]') as HTMLElement | null;
    if (box && sc && typeof want === 'number') {
      const drift = box.getBoundingClientRect().top - want;
      if (Math.abs(drift) > 0.5) sc.scrollTop += drift;
    }
    if (pin.current && typeof requestAnimationFrame === 'function') pinRaf.current = requestAnimationFrame(keepTop);
  }, []);
  useEffect(() => () => {
    pin.current = null;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pinRaf.current);
  }, []);

  /* 끄는 동안은 화면만, 손을 떼면 문서에 한 번. */
  useEffect(() => {
    if (!live) return;
    /**
     * 끄는 동안에는 **스크롤 앵커링을 끈다** — 크기가 바뀌는 그 순간 판이 스스로
     * 굴러 보정하면 표가 제자리에 있는데도 화면이 흔들린다(위 효과가 고치는 그
     * 증상의 표준 처방이다). 끝나면 원래대로 돌려준다.
     */
    const sc = boxRef.current?.closest('[data-note-page]') as HTMLElement | null;
    const hadAnchor = sc?.style.overflowAnchor ?? '';
    if (sc) sc.style.overflowAnchor = 'none';
    const move = (e: MouseEvent) => {
      const g = sizing.current;
      if (!g) return;
      const min = g.axis === 'col' ? 56 : 28;
      const d = (g.axis === 'col' ? e.clientX : e.clientY) - g.from;
      const next = g.base.slice();
      next[g.i] = Math.max(min, Math.round((g.base[g.i] ?? min) + d));
      setLive({ axis: g.axis, sizes: next });
    };
    const up = () => {
      const g = sizing.current;
      sizing.current = null;
      // 마지막 보정까지 따라잡고 놓아 준다(보정은 레이아웃 **뒤에** 온다).
      window.setTimeout(() => {
        pin.current = null;
      }, 140);
      setLive((cur) => {
        if (g && cur) controller.setNoteTableSizes(block.id, g.axis, cur.sizes);
        return null;
      });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (sc) sc.style.overflowAnchor = hadAnchor;
    };
  }, [live, block.id, controller]);

  /**
   * 고른 것을 말하던 **떠 있는 칩**은 걷었다(제보: "칸 선택 · 1칸 · 색 채우기" 툴팁 제거).
   * 표 위에 늘 떠 있어 바로 윗줄을 가리는 데다, 거기 있던 일은 전부 **우클릭 메뉴**에
   * 그대로 있다(색 채우기 › · 행 › 삭제 · 열 › 삭제 · 선택 ›). 고른 것이 무엇인지는
   * 칸에 칠해지는 면과 링이 이미 말해 준다.
   */

  return (
    <div
      ref={rootRef}
      className="mf-note-table"
      data-note-block={block.id}
      data-note-kind="table"
      data-menu={menu ? '1' : undefined}
      // 표 안의 누름은 본문의 드래그 선택을 깨우지 않는다(스펙 6) — 칸을 고르는 일과
      // 블록을 가로질러 글을 고르는 일이 한 번에 일어나면 둘 다 엉킨다.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      // 표를 벗어나면 얹힌 칸도 없다 — 레일이 마지막 자리에 남아 있지 않게.
      onMouseLeave={() => {
        setHoverAt(null);
        setRailZone(null);
      }}
      style={{ ...blockFlow(block), position: 'relative' }}
    >
      {/**
        * 표가 **페이지에서 차지하는 자리는 상자 하나뿐**이다(요청).
        *
        * 예전에는 그리드가 레일 18px·＋ 24px·틈 4px씩을 좌우 위아래로 **비워 두어**
        * 가로 50px·세로 46px을 표가 아니라 장식에 내주고 있었다. 레일과 ＋는 이제
        * 흐름 밖(`absolute`)에 떠서 본문 단의 여백 위에 그려진다 — 어차피 표에
        * 마우스를 얹어야 보이는 것들이라 평소에는 자리도 그림도 없다.
        *
        * 이 래퍼가 **상자의 크기를 그대로** 받아(`fit-content`) 레일의 `left/right`가
        * 표의 좌우 끝과 정확히 맞는다. 너비를 손대지 않은 표는 예전처럼 가로를 다
        * 쓴다 — 그때 표는 `width: 100%`라 내용 크기로 재면 서로를 참조해 폭이
        * 제멋대로 접힌다.
        */}
      <div style={{ position: 'relative', ...(colW ? { width: 'fit-content', maxWidth: '100%' } : {}) }}>
        {/* 좌상단의 **표 전체 선택 점**은 걷었다(요청) — 9×9짜리라 조준하기 어려웠고,
            레일에 마우스를 얹으면 어차피 숨었다. 표 전체는 우클릭 메뉴의 `선택 › 표 전체`로. */}
        {colRail}
        {rowRail}
        {endPlus('오른쪽 끝에 열 추가', () => controller.addNoteTableCol(block.id), 'col')}
        {endPlus('아래쪽 끝에 행 추가', () => controller.addNoteTableRow(block.id), 'row')}

        {/**
          * 넘침을 받는 판과 **테두리를 두른 상자**를 갈랐다(제보 3: 가로 스크롤이
          * 생기면 표의 마지막 줄 UI가 깨진다).
          *
          * 막대를 테두리 **안쪽** 바닥에 두면 둥근 모서리를 가로질러 마지막 행을
          * 잘라 먹는다. 바깥 판이 넘침을 받으면 막대가 **표 아래 제 자리**에 서고
          * (요청) 표의 테두리·모서리는 온전하다.
          */}
        <div
          ref={scrollRef}
          data-note-table-scroll
          className="mf-note-tscroll"
          onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}
          style={{
            minWidth: 0,
            overflowX: 'auto',
            /**
             * **세로는 절대 스크롤하지 않는다**(제보: 열을 줄이면 아래에 가로
             * 스크롤이 생겼다 사라졌다 한다).
             *
             * `overflow-x: auto`만 주면 `overflow-y`도 `auto`로 계산되어, 그립이나
             * 그림자가 1px만 넘쳐도 세로 막대가 생기고 → 가로 폭이 그만큼 줄어
             * → 가로 막대가 생기고 → 다시 세로가… 하며 끄는 동안 깜빡인다.
             * 세로를 못박으면 그 되먹임이 끊긴다(표는 세로로 스크롤할 것이 없다).
             */
            overflowY: 'hidden',
          }}
        >
        <div
          ref={boxRef}
          data-note-table-box
          tabIndex={-1}
          style={{
            position: 'relative',
            // 크기를 손으로 정한 표는 제 폭만큼, 아니면 판을 가득 — 어느 쪽이든
            // 테두리가 표를 정확히 두른다.
            width: colW ? 'max-content' : '100%',
            border: '1px solid var(--mf-hairline)',
            borderRadius: 12,
            background: 'var(--mf-card)',
            outline: 'none',
          }}
        >
          {/* 글자를 받는 자리(제보) — 칸을 고르면 여기로 포커스가 간다. 보이지 않지만
              `display:none`이면 포커스를 받지 못하므로 투명하게 눕혀 둔다. 한글 조합은
              **여기서 끝까지 돌리고**(`compositionend`) 그 결과를 칸에 옮겨 적는다. */}
          {!readOnly && (
            <input
              ref={keysRef}
              data-note-table-keys
              aria-hidden="true"
              tabIndex={-1}
              autoComplete="off"
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={(e) => {
                composing.current = false;
                const text = e.currentTarget.value;
                e.currentTarget.value = '';
                if (sel && text) openEdit(selAnchor(sel).r, selAnchor(sel).c, undefined, text);
              }}
              onChange={(e) => {
                // 조합 중에는 흘려보낸다 — 끝난 글자만 칸으로 옮긴다.
                if (composing.current) return;
                const text = e.currentTarget.value;
                e.currentTarget.value = '';
                if (sel && text) openEdit(selAnchor(sel).r, selAnchor(sel).c, undefined, text);
              }}
              style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0, border: 0, padding: 0, background: 'transparent', pointerEvents: 'none' }}
            />
          )}
          {/* 크기를 끌 수 있는 경계선 — 표 위에 얹은 얇은 띠(요청). 잡는 자리는
              보이는 선보다 넓고(6px), 재어 둔 치수가 있어야 놓을 수 있다. */}
          {/* **마지막 행·열에도 그립을 둔다**(제보) — 예전에는 "경계선 = 두 줄 사이"로만
              보고 끝의 하나를 빼서 맨 아래 행을 끌 수 없었다. 끝의 그립만 안쪽으로
              당기는 이유: 상자가 `overflow-x: auto`라 세로도 `auto`로 계산되어, 3px라도
              넘치면 그립이 잘리고 **모든 표에 유령 스크롤바**가 생긴다. */}
          {!readOnly && geom && geom.cols.map((c, ci) => grip('col', ci, { left: c.l + c.w - (ci === geom.cols.length - 1 ? 6 : 3), top: 0, width: 6, bottom: 0, cursor: 'col-resize' }, ci === geom.cols.length - 1))}
          {!readOnly && geom && geom.rows.map((r, ri) => grip('row', ri, { top: r.t + r.h - (ri === geom.rows.length - 1 ? 6 : 3), left: 0, height: 6, right: 0, cursor: 'row-resize' }, ri === geom.rows.length - 1))}
          <table
            ref={tableRef}
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              // 너비를 손으로 정한 순간부터 **고정 레이아웃**이다 — 그러지 않으면
              // 브라우저가 글 길이에 맞춰 다시 나눠 끈 값이 무시된다.
              //
              // 폭도 **합으로 못박는다**: `width: 100%`로 두면 합이 상자보다 작을 때
              // 남는 폭이 열들에 다시 뿌려져(CSS 2.1 §17.5.2.1) 마지막 열을 줄여도
              // 손을 떼는 순간 되돌아온다("잡히는데 안 줄어든다").
              ...(colW ? { tableLayout: 'fixed' as const, width: colW.reduce((a, b) => a + b, 0) } : {}),
            }}
          >
            {colW && (
              <colgroup>
                {Array.from({ length: width }, (_, ci) => (
                  <col key={ci} style={{ width: colW[ci] ?? undefined }} />
                ))}
              </colgroup>
            )}
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={rowH?.[ri] ? { height: rowH[ri] } : undefined}>
                  {row.map((cell, ci) => {
                    const on = selHas(sel, ri, ci);
                    const editing = edit?.r === ri && edit.c === ci;
                    /**
                     * **고른 칸**(한 칸짜리 선택) — 글을 고치는 중은 아니지만 키는 받는다.
                     * 그래서 `contentEditable`이어야 하고 글자를 고를 수 있어야 한다.
                     * 커서는 `cell` 그대로다 — 한 번의 누름은 여전히 "칸을 고르는 일"이다.
                     */
                    const armed = !editing && sel?.mode === 'cell' && sel.r === ri && sel.c === ci;
                    const align = block.colAlign?.[ci] ?? 'left';
                    const paint = fillAt(block.fills, ri, ci);
                    // 링은 **고른 구역의 바깥 경계에만** 그린다 — 네 이웃이 선택에
                    // 들었는지 보고 그쪽 변만 뺀다(스펙 3-3).
                    //
                    // **표 밖의 이웃은 "선택 아님"이다**(제보로 놓친 것을 잡았다):
                    // `selHas`만 물으면 행 선택에서 `c = -1`도 참이라 왼쪽·오른쪽
                    // 변이 빠지고, 표 전체 선택에서는 네 변이 다 빠져 **테두리가
                    // 아예 그려지지 않았다**. 범위를 먼저 재고 묻는다.
                    const inRing = (r: number, c: number) => r >= 0 && r < rows.length && c >= 0 && c < row.length && selHas(sel, r, c);
                    const ring = on
                      ? [
                          inRing(ri - 1, ci) ? '' : 'inset 0 1.5px 0 0 var(--mf-tsel-ring)',
                          inRing(ri + 1, ci) ? '' : 'inset 0 -1.5px 0 0 var(--mf-tsel-ring)',
                          inRing(ri, ci - 1) ? '' : 'inset 1.5px 0 0 0 var(--mf-tsel-ring)',
                          inRing(ri, ci + 1) ? '' : 'inset -1.5px 0 0 0 var(--mf-tsel-ring)',
                        ]
                          .filter(Boolean)
                          .join(', ')
                      : undefined;
                    const first = ci === 0;
                    const last = ci === row.length - 1;
                    const top = ri === 0;
                    const bottom = ri === rows.length - 1;
                    /**
                     * 모서리 반지름은 **네 귀퉁이를 따로** 센다(제보: 행이 하나면 테두리가 깨진다).
                     *
                     * 예전에는 `첫 행·첫 열이면 … 아니면 첫 행·끝 열이면 …`처럼 **먼저 맞는
                     * 가지 하나**만 골랐다. 행이 하나뿐인 표에서는 그 칸이 첫 행이면서 끝 행이라
                     * 위쪽 귀퉁이만 둥글어지고 아래쪽은 각져, 상자의 12px 곡선 밖으로 칸이
                     * 삐져나와 테두리가 잘려 보였다(열이 하나일 때도 같다).
                     */
                    const radius = `${top && first ? 12 : 0}px ${top && last ? 12 : 0}px ${bottom && last ? 12 : 0}px ${bottom && first ? 12 : 0}px`;
                    return (
                      <td
                        key={ci}
                        data-note-table-cell={`${ri}:${ci}`}
                        data-picked={on ? '1' : undefined}
                        // 고른 칸은 키를 받지만 **글을 고치는 중은 아니다** — CSS가
                        // 이 표식을 보고 캐럿과 선택 표시를 지운다(제보).
                        data-armed={armed ? '1' : undefined}
                        onMouseDown={(e) => {
                          // 글을 고치는 중인 칸 안의 끌기는 **글자 선택**이다 — 문서에
                          // 걸린 끌기 감시가 그것을 칸 선택으로 바꾸지 않게 비워 둔다.
                          if (readOnly || e.button !== 0 || editing) return;
                          drag.current = { r: ri, c: ci };
                        }}
                        onMouseEnter={() => {
                          setHoverAt({ r: ri, c: ci });
                          const from = drag.current;
                          if (!from || (from.r === ri && from.c === ci)) return;
                          // 칸을 넘어선 순간부터 **구간 선택**이다. 브라우저가 반쯤
                          // 그려 둔 글자 선택은 지운다(고른 것과 고치는 것이 갈린다).
                          window.getSelection()?.removeAllRanges();
                          pick({ mode: 'range', r0: from.r, c0: from.c, r1: ri, c1: ci, r: from.r, c: from.c });
                        }}
                        onMouseUp={() => {
                          const from = drag.current;
                          drag.current = null;
                          if (readOnly || !from) return;
                          // 글을 고치는 중인 칸을 다시 누른 것은 캐럿을 옮기는 일이다.
                          if (editing) return;
                          // 끌어서 구간을 고른 경우에도 **키 받을 자리**는 챙긴다.
                          if (from.r !== ri || from.c !== ci) {
                            focusKeys();
                            return;
                          }
                          setEdit(null);
                          pick({ mode: 'cell', r: ri, c: ci });
                        }}
                        // 두 번 누르면 그 자리에 캐럿이 들어간다(제보).
                        onDoubleClick={(e) => openEdit(ri, ci, { x: e.clientX, y: e.clientY })}
                        onContextMenu={(e) => {
                          if (readOnly) return;
                          e.preventDefault();
                          e.stopPropagation();
                          openMenu(e, selHas(sel, ri, ci) && sel ? sel : { mode: 'cell', r: ri, c: ci });
                        }}
                        style={{
                          // 격자는 **가로 줄이 또렷하고**(`--mf-hairline`) 세로는 그보다
                          // 옅다(`--mf-border-soft`) — 자료를 읽는 눈은 행을 따라 간다.
                          borderBottom: ri === rows.length - 1 ? 0 : '1px solid var(--mf-hairline)',
                          borderRight: last ? 0 : '1px solid var(--mf-border-soft)',
                          padding: '10px 12px',
                          // 세로 **가운데**(요청) — 위로 붙여 두면 한 줄짜리 칸과
                          // 두 줄짜리 칸이 한 행에 섞일 때 글줄이 들쭉날쭉해 보인다.
                          verticalAlign: 'middle',
                          // 모서리 칸에는 상자와 같은 12px를 따로 준다 — 없으면 선택
                          // 링이 곡선을 따라가지 못하고 모서리에서 잘린다.
                          borderRadius: radius,
                          boxShadow: ring,
                          // 선택 하이라이트가 채움색보다 앞선다(스펙 3-4).
                          background: on ? 'var(--mf-tsel-bg)' : paint,
                          fontSize: 13,
                          fontWeight: 400,
                          color: 'var(--mf-text)',
                          textAlign: align,
                          minWidth: 84,
                          // 칸 위의 커서는 `cell`이다(제보·스펙 3-2) — 한 번의 누름이
                          // 글자를 고르는 일이 아니라 **칸을 고르는 일**임을 커서가
                          // 먼저 말해 준다. 글을 여는 칸에서만 글자 커서로 돌아간다.
                          cursor: editing ? 'text' : 'cell',
                          // 고르려고 끄는 동안 글자가 함께 잡히면 둘 다 엉킨다.
                          // 고른 칸만 예외다 — 그 칸의 글자를 통째로 골라 두기 때문이다.
                          userSelect: editing || armed ? 'text' : 'none',
                        }}
                      >
                        <NoteLine
                          onFocusLine={focusBox}
                          lineKey={`${block.id}:r${ri}c${ci}`}
                          runs={cell}
                          readOnly={readOnly || !(editing || armed)}
                          placeholder=""
                          // Enter는 **편집을 닫는다**(요청) — 표의 칸은 문단이 아니라
                          // 값이라 "다 썼다"의 신호가 필요하다. 줄을 바꾸려면
                          // Shift+Enter(`NoteLine`이 그때는 이 고리를 부르지 않아
                          // 브라우저의 줄바꿈이 그대로 들어간다).
                          onEnter={() => {
                            setEdit(null);
                            pick({ mode: 'cell', r: ri, c: ci });
                            return true;
                          }}
                          onSlash={(at) => {
                            if (readOnly) return;
                            openSlash(`${block.id}:r${ri}c${ci}`, at);
                          }}
                          onChange={(runs) => {
                            /**
                             * 고른 칸에 **글자가 실제로 들어온 순간** 편집으로 넘어간다 —
                             * 포커스는 이미 이 칸에 있으므로 조합이 끊기지 않는다.
                             *
                             * 글이 달라졌는지 반드시 본다: `NoteLine`은 포커스를 잃을 때도
                             * 커밋하므로(`onBlur`), 그냥 `armed`만 보면 **다른 곳을 누르는
                             * 것만으로** 편집이 열리고 선택이 풀린다(우클릭 메뉴가 아예
                             * 동작하지 않았다).
                             */
                            if (armed && runsText(runs) !== runsText(cell)) {
                              setSel(null);
                              setEdit({ r: ri, c: ci });
                            }
                            controller.setNoteCell(block.id, ri, ci, runs);
                          }}
                          /**
                           * **`minHeight`를 줄 높이에 맞춘다**(제보: 칸의 글이 가운데가
                           * 아니라 살짝 위다). 기본값 `1.6em`은 13px 글씨에서 20.8px인데
                           * 줄 상자는 16px이라, 남는 4.8px이 **전부 아래에** 깔렸다 —
                           * `vertical-align: middle`은 그 20.8px짜리 상자를 가운데 놓을
                           * 뿐이라 글은 3px쯤 위로 떠 보였다(실측: 위 10px · 아래 16.3px).
                           */
                          style={{ fontSize: 13, lineHeight: '16px', minHeight: 16, color: 'inherit', textAlign: align, cursor: editing ? 'text' : 'cell' }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {menu && (
        <TableMenu
          controller={controller}
          block={block}
          sel={menu.sel}
          at={menu.at}
          rows={rows.length}
          cols={width}
          onPick={(next) => {
            pick(next);
            setMenu(null);
            focusFor(next);
          }}
          onFill={(color) => {
            fill(fillTargetOf(menu.sel), color);
            setMenu(null);
          }}
          onDone={() => {
            setMenu(null);
            setSel(null);
          }}
        />
      )}
    </div>
  );
}

/** 색 팔레트 여섯 + 지우기 — 칩과 메뉴가 같은 것을 쓴다. */
/** 표를 CSV 한 덩이로 — 쉼표·따옴표·줄바꿈이 든 칸은 따옴표로 감싸고 `"`를 두 번 쓴다. */
function tableCsv(rows: RichRun[][][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const t = runsText(c);
          return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        })
        .join(','),
    )
    .join('\n');
}

/**
 * 표 우클릭 메뉴 — 스펙 §4 그대로.
 *
 * 잘라내기·복사·붙여넣기 / **선택 ›**·**행 ›**·**열 ›**·**정렬 ›**·**색 채우기 ›** /
 * 머리글 행 사용 · 표 복제 · CSV로 복사 / 표 삭제.
 *
 * **좌표를 글자로 내보내지 않는다**(스펙 §1). 예전에는 머리가 `표 · A 머리글`이고
 * 날개가 `열 B`였는데, 스프레드시트를 쓰지 않는 사람에게 `A`·`B`는 아무것도
 * 가리키지 않는다. 지금은 고른 것의 **이름**만 말한다(`표 · 머리글 행`).
 *
 * 색은 **열 때의 선택**에 붓는다 — 그래서 `sel`을 스냅샷으로 받는다(라이브 값을
 * 읽으면 바깥 클릭 핸들러가 선택을 지운 뒤 엉뚱한 한 칸에 칠해진다).
 *
 * 날개는 메뉴의 **형제**로 띄운다 — 자식으로 두면 팝업 애니메이션이 남긴
 * `transform` 때문에 `fixed` 좌표가 메뉴 왼쪽 위에서 다시 세어진다(본문 우클릭
 * 메뉴에서 실측한 그 함정).
 */
function TableMenu({
  controller,
  block,
  sel,
  at,
  rows,
  cols,
  onPick,
  onFill,
  onDone,
}: {
  controller: EditorController;
  block: NoteBlock;
  sel: TableSel;
  at: { x: number; y: number };
  rows: number;
  cols: number;
  onPick: (sel: TableSel) => void;
  onFill: (color: string | null) => void;
  onDone: () => void;
}) {
  const [wing, setWing] = useState<'pick' | 'row' | 'col' | 'align' | 'fill' | null>(null);
  const spot = selAnchor(sel);
  /**
   * **고른 것에 뜻이 있는 항목만 그린다**(제보).
   *
   * `selAnchor`가 없는 축을 0으로 메우기 때문에, 지금까지 행을 골라도 `열 ›`·`정렬 ›`이
   * 함께 떠서 **언제나 1열**을 건드렸고 열을 골라도 `행 ›`이 떠서 **언제나 0행**을
   * 건드렸다. 고른 것과 대상이 다른 항목은 메뉴에 있으면 안 된다.
   *
   * 클립보드 셋(잘라내기·복사·붙여넣기)도 칸 **하나**만 읽고 쓰므로 행·열·전체에서는
   * 감춘다 — 그 자리의 표 전체 복사는 `CSV로 복사`가 맡는다.
   */
  const cellish = sel.mode === 'cell' || sel.mode === 'range';
  const showRow = cellish || sel.mode === 'row';
  const showCol = cellish || sel.mode === 'col';
  // 정렬은 `colAlign[c]` — **열 단위 속성**이라 행 선택에는 대응하는 뜻이 없다.
  const showAlign = showCol;
  // 높이는 세어서 넘긴다(470은 12항목짜리 고정값이었다): 항목 33 + gap 1,
  // 구분선 1 + margin 8 + gap 1, 머리말 22 + 팝업 패딩 14.
  const itemCount = (cellish ? 3 : 0) + 1 + (showRow ? 1 : 0) + (showCol ? 1 : 0) + (showAlign ? 1 : 0) + 1 + 2 + 1;
  const ruleCount = cellish ? 3 : 2;
  const base = cursorStyle(at, TABLE_MENU_W, 36 + itemCount * 34 + ruleCount * 10);
  const cell = block.rows?.[spot.r]?.[spot.c];
  const run = (fn: () => void) => () => {
    fn();
    onDone();
  };
  const write = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      /* 클립보드를 막아 둔 환경 — ⌘C가 그대로 동작한다 */
    }
  };
  const alignNow = block.colAlign?.[spot.c] ?? 'left';
  const label = selLabel(sel, rows, cols);
  /** 색 날개의 머리 — 무엇에 칠하는지 그 자리에서 말한다(스펙 §4-7). */
  const fillTitle =
    sel.mode === 'all' ? '표 전체 색' : sel.mode === 'row' ? '이 행 색' : sel.mode === 'col' ? '이 열 색' : sel.mode === 'range' ? `선택 ${label.count} 색` : '선택한 칸 색';
  return (
    <>
      <div
        data-note-table-menu
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ ...POP, ...base, display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <span style={{ ...POP_HEAD, textTransform: 'none', letterSpacing: 0 }}>표 · {label.name}</span>
        {cellish && (
          <>
            <CtxItem mark="t-cut" name="잘라내기" hint="⌘X" icon={CUT_ICON} onClick={run(() => { void write(runsText(cell ?? [])); controller.setNoteCell(block.id, spot.r, spot.c, textRuns('')); })} />
        <CtxItem mark="t-copy" name="복사" hint="⌘C" icon={<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>} onClick={run(() => void write(runsText(cell ?? [])))} />
        <CtxItem
          mark="t-paste"
          name="붙여넣기"
          hint="⌘V"
          icon={<><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /></>}
          onClick={run(() => {
            void navigator.clipboard
              .readText()
              .then((t) => t && controller.setNoteCell(block.id, spot.r, spot.c, textRuns(t.split('\n')[0]!)))
              .catch(() => undefined);
          })}
            />
          </>
        )}

        {cellish && <CtxRule />}
        <CtxItem mark="t-pick" name="선택" wing on={wing === 'pick'} onClick={() => setWing((v) => (v === 'pick' ? null : 'pick'))} icon={<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /></>} />
        {showRow && <CtxItem mark="t-row" name="행" wing on={wing === 'row'} onClick={() => setWing((v) => (v === 'row' ? null : 'row'))} icon={<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M3 15h18" /></>} />}
        {showCol && <CtxItem mark="t-col" name="열" wing on={wing === 'col'} onClick={() => setWing((v) => (v === 'col' ? null : 'col'))} icon={<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 5v14M15 5v14" /></>} />}
        {showAlign && <CtxItem mark="t-align" name="정렬" wing on={wing === 'align'} onClick={() => setWing((v) => (v === 'align' ? null : 'align'))} icon={<><path d="M4 6h16M4 12h10M4 18h16" /></>} />}
        <CtxItem mark="t-fill" name="색 채우기" wing on={wing === 'fill'} onClick={() => setWing((v) => (v === 'fill' ? null : 'fill'))} icon={<><path d="M19 11a7 7 0 1 1-7-7" /><path d="M12 4v7l5 4" /></>} />

        <CtxRule />
        <CtxItem mark="t-dup" name="표 복제" icon={<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>} onClick={run(() => controller.duplicateNoteBlock(block.id))} />
        <CtxItem
          mark="t-csv"
          name="CSV로 복사"
          icon={<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>}
          onClick={run(() => void write(tableCsv(block.rows ?? [])))}
        />

        <CtxRule />
        <CtxItem mark="t-del" name="표 삭제" danger icon={<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>} onClick={run(() => controller.removeNoteBlock(block.id))} />
      </div>

      {wing === 'pick' && (
        <CtxWing anchor={base} title="선택">
          <CtxItem mark="t-pick-cell" name="이 셀" on={sel.mode === 'cell'} onClick={() => onPick({ mode: 'cell', r: spot.r, c: spot.c })} dot={sel.mode === 'cell' ? 'var(--mf-accent)' : 'var(--mf-faint2)'} />
          <CtxItem mark="t-pick-row" name="행 전체" on={sel.mode === 'row'} onClick={() => onPick({ mode: 'row', r: spot.r })} dot={sel.mode === 'row' ? 'var(--mf-accent)' : 'var(--mf-faint2)'} />
          <CtxItem mark="t-pick-col" name="열 전체" on={sel.mode === 'col'} onClick={() => onPick({ mode: 'col', c: spot.c })} dot={sel.mode === 'col' ? 'var(--mf-accent)' : 'var(--mf-faint2)'} />
          <CtxItem mark="t-pick-all" name="표 전체" on={sel.mode === 'all'} onClick={() => onPick({ mode: 'all' })} dot={sel.mode === 'all' ? 'var(--mf-accent)' : 'var(--mf-faint2)'} />
        </CtxWing>
      )}
      {wing === 'row' && (
        <CtxWing anchor={base} title="행">
          <CtxItem mark="row-above" name="위에 행 추가" hint="⌥↑" onClick={run(() => controller.addNoteTableRow(block.id, spot.r))} />
          <CtxItem mark="row-below" name="아래에 행 추가" hint="⌥↓" onClick={run(() => controller.addNoteTableRow(block.id, spot.r + 1))} />
          <CtxItem mark="row-dup" name="행 복제" onClick={run(() => controller.duplicateNoteTableRow(block.id, spot.r))} />
          <CtxItem mark="row-up" name="행 위로 이동" disabled={spot.r === 0} onClick={run(() => controller.moveNoteTableRow(block.id, spot.r, -1))} />
          <CtxItem mark="row-down" name="행 아래로 이동" disabled={spot.r >= rows - 1} onClick={run(() => controller.moveNoteTableRow(block.id, spot.r, 1))} />
          <CtxItem mark="row-del" name="행 삭제" hint="⌫" danger disabled={rows <= 1} onClick={run(() => controller.removeNoteTableRow(block.id, spot.r))} />
        </CtxWing>
      )}
      {wing === 'col' && (
        <CtxWing anchor={base} title="열">
          <CtxItem mark="col-left" name="왼쪽에 열 추가" hint="⌥←" onClick={run(() => controller.addNoteTableCol(block.id, spot.c))} />
          <CtxItem mark="col-right" name="오른쪽에 열 추가" hint="⌥→" onClick={run(() => controller.addNoteTableCol(block.id, spot.c + 1))} />
          <CtxItem mark="col-left-move" name="열 왼쪽으로 이동" disabled={spot.c === 0} onClick={run(() => controller.moveNoteTableCol(block.id, spot.c, -1))} />
          <CtxItem mark="col-right-move" name="열 오른쪽으로 이동" disabled={spot.c >= cols - 1} onClick={run(() => controller.moveNoteTableCol(block.id, spot.c, 1))} />
          <CtxItem mark="col-del" name="열 삭제" hint="⌫" danger disabled={cols <= 1} onClick={run(() => controller.removeNoteTableCol(block.id, spot.c))} />
        </CtxWing>
      )}
      {wing === 'align' && (
        <CtxWing anchor={base} title="정렬">
          {(['left', 'center', 'right'] as const).map((a) => (
            <CtxItem
              key={a}
              mark={`align-${a}`}
              name={a === 'left' ? '왼쪽' : a === 'center' ? '가운데' : '오른쪽'}
              on={alignNow === a}
              hint={alignNow === a ? '현재' : undefined}
              icon={a === 'left' ? <><path d="M4 6h16M4 12h10M4 18h13" /></> : a === 'center' ? <><path d="M4 6h16M7 12h10M6 18h12" /></> : <><path d="M4 6h16M10 12h10M7 18h13" /></>}
              onClick={run(() => controller.setNoteTableAlign(block.id, spot.c, a))}
            />
          ))}
        </CtxWing>
      )}
      {wing === 'fill' && (
        <CtxWing anchor={base} title={fillTitle}>
          {CELL_FILLS.map(([hex, name]) => (
            <CtxItem key={hex} mark={`fill-${hex}`} name={name} swatch={hex} onClick={() => onFill(hex)} />
          ))}
          <CtxItem mark="fill-clear" name="색 지우기" dot="var(--mf-faint2)" onClick={() => onFill(null)} />
        </CtxWing>
      )}
    </>
  );
}

/** 표 메뉴 너비 — 날개가 이 값만큼 옆으로 붙는다. */
const TABLE_MENU_W = 214;

/** 본문 우클릭 메뉴가 잡아 둔 것 — 어느 블록의, 어느 편집 박스에서, 어디서 열렸나. */
interface BlockMenuAt {
  blockId: string;
  /** 오른쪽 클릭이 난 편집 박스(`data-note-line`) — 서식은 **이 박스의 선택**에 건다. */
  box: HTMLElement | null;
  x: number;
  y: number;
}

/** 문단 스타일 — 디자인 세 번째 이미지의 다섯(색 점이 종류를 말한다). */
const CTX_STYLES: { kind: NoteBlockKind; name: string; dot: string }[] = [
  { kind: 'p', name: '본문', dot: 'var(--mf-faint2)' },
  { kind: 'h2', name: '제목', dot: 'var(--mf-text)' },
  { kind: 'q', name: '인용', dot: '#D8794F' },
  { kind: 'ul', name: '글머리 기호', dot: '#7C9BD8' },
  { kind: 'ck', name: '체크리스트', dot: '#69B08A' },
];

/** 글꼴 — 디자인 네 번째 이미지의 일곱. `hl`·`c`는 기본 색으로 건다(팔레트는 툴바에). */
const CTX_FONTS: { kind: 'b' | 'i' | 'u' | 's' | 'hl' | 'c' | 'clear'; name: string; key: string; dot: string }[] = [
  { kind: 'b', name: '굵게', key: '⌘B', dot: 'var(--mf-text)' },
  { kind: 'i', name: '기울임', key: '⌘I', dot: 'var(--mf-subtext)' },
  { kind: 'u', name: '밑줄', key: '⌘U', dot: 'var(--mf-subtext)' },
  { kind: 's', name: '취소선', key: '⌘⇧X', dot: 'var(--mf-muted)' },
  { kind: 'hl', name: '형광펜', key: '⌘⇧H', dot: '#F2D45C' },
  { kind: 'c', name: '글자색', key: '', dot: '#E0632F' },
  { kind: 'clear', name: '서식 지우기', key: '⌘\\', dot: 'var(--mf-faint2)' },
];

/**
 * 본문 우클릭 메뉴 — 지금 이 블록에 할 수 있는 일 전부(요청·디자인 2·3·4번 이미지).
 *
 * 왜 필요한가: 조작이 툴바(서식)·`/`(넣기)·페이지 목록(장)으로 흩어져 있어서, **글을
 * 쓰다 말고** 하고 싶은 일(이 문단만 복사, 여기부터 목록으로, 이 줄을 할 일로)은
 * 손이 멀었다. 우클릭은 그 자리에서 열리는 유일한 메뉴다.
 *
 * 서식은 **오른쪽 클릭이 난 편집 박스**에 건다(`box`) — 메뉴를 여는 동안 브라우저는
 * 선택을 지우지 않으므로, 고른 글이 있으면 그 글에, 없으면 캐럿 자리에 걸린다.
 */
function BlockMenu({ controller, at, onClose }: { controller: EditorController; at: BlockMenuAt; onClose: () => void }) {
  const [wing, setWing] = useState<'style' | 'font' | 'todo' | null>(null);
  useAnchored(true, onClose);
  const blocks = controller.notePage?.blocks ?? [];
  const block = blocks.find((b) => b.id === at.blockId) ?? null;
  const text = block ? blockText(block) : '';
  const base = cursorStyle(at, CTX_MENU_W, 430);
  const done = (fn: () => void) => () => {
    fn();
    onClose();
  };

  /** 서식 — 툴바와 같은 길(`applyNoteFormat` → `commitLine`). 박스가 없으면 아무 일도 없다. */
  const format = (kind: (typeof CTX_FONTS)[number]['kind']) => {
    const el = at.box;
    if (!el) return;
    const val = kind === 'hl' ? 'yellow' : kind === 'c' ? '#E0632F' : undefined;
    const runs = applyNoteFormat(el, kind, val);
    if (runs) commitLine(controller, el.getAttribute('data-note-line') || '', runs);
  };

  /**
   * 잘라내기·복사 — 이 블록의 **글**을 클립보드로. 붙여넣기는 클립보드를 읽어
   * 아래에 문단으로 넣는다. 클립보드 접근은 브라우저가 막을 수 있어(권한·보안
   * 맥락) 실패하면 조용히 넘어간다 — 그때는 ⌘V가 그대로 동작한다.
   */
  const copy = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };
  const paste = async (plain: boolean) => {
    let read = '';
    try {
      read = await navigator.clipboard.readText();
    } catch {
      return;
    }
    const lines = read.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    // 서식 없이 붙여넣기는 **줄마다 문단 하나**. 그냥 붙여넣기도 지금은 같다 —
    // 우리가 다루는 클립보드가 글자뿐이라(HTML 조각을 읽지 않는다) 두 항목이
    // 같은 일을 한다는 사실을 숨기지 않는다(메뉴에는 둘 다 둔다 — 디자인).
    let after = at.blockId;
    for (const line of lines.slice(0, 40)) {
      const id = controller.addNoteBlock('p', after);
      if (!id) break;
      controller.setNoteBlockRuns(id, textRuns(plain ? line.replace(/[*_`~]/g, '') : line));
      after = id;
    }
  };

  return (
    <>
    <div
      data-note-block-menu
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ ...POP, ...base, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <span style={POP_HEAD}>블록</span>
      <CtxItem mark="cut" name="잘라내기" hint="⌘X" icon={CUT_ICON} onClick={done(() => void copy().then((ok) => ok && controller.removeNoteBlock(at.blockId)))} />
      <CtxItem mark="copy" name="복사" hint="⌘C" icon={<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>} onClick={done(() => void copy())} />
      <CtxItem mark="paste" name="붙여넣기" hint="⌘V" icon={<><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /></>} onClick={done(() => void paste(false))} />
      <CtxItem mark="paste-plain" name="서식 없이 붙여넣기" hint="⌘⇧V" icon={<><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /><path d="M9 13h6" /></>} onClick={done(() => void paste(true))} />

      <CtxRule />
      <CtxItem
        mark="style"
        name="문단 스타일"
        wing
        on={wing === 'style'}
        onClick={() => setWing((v) => (v === 'style' ? null : 'style'))}
        icon={<><path d="M4 6h16M9 6v13M4 6V4h16v2" /></>}
      />
      <CtxItem
        mark="font"
        name="글꼴"
        wing
        on={wing === 'font'}
        onClick={() => setWing((v) => (v === 'font' ? null : 'font'))}
        icon={<><path d="M5 20 12 4l7 16M8 14h8" /></>}
      />
      <CtxItem
        mark="link"
        name="링크 삽입"
        hint="⌘K"
        icon={<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>}
        onClick={done(() => {
          const el = at.box;
          if (!el) return;
          const url = typeof window === 'undefined' ? null : window.prompt('링크 주소');
          if (!url || !url.trim()) return;
          const runs = applyNoteFormat(el, 'link', url.trim());
          if (runs) commitLine(controller, el.getAttribute('data-note-line') || '', runs);
        })}
      />

      <CtxRule />
      <CtxItem mark="dup" name="블록 복제" hint="⌘D" icon={<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>} onClick={done(() => controller.duplicateNoteBlock(at.blockId))} />
      <CtxItem mark="comment" name="댓글 달기" icon={<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>} onClick={done(() => controller.openComments())} />
      <CtxItem
        mark="todo"
        name="할 일로 보내기"
        wing
        on={wing === 'todo'}
        icon={<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 5v14M15 5v14" /></>}
        onClick={() => setWing((v) => (v === 'todo' ? null : 'todo'))}
      />

      <CtxRule />
      <CtxItem mark="hr" name="아래에 구분선" icon={<path d="M4 12h16" />} onClick={done(() => controller.addNoteBlock('hr', at.blockId))} />
      <CtxItem
        mark="del"
        name="블록 삭제"
        hint="⌫"
        danger
        icon={<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>}
        onClick={done(() => controller.removeNoteBlock(at.blockId))}
      />

    </div>
      {/* 날개는 메뉴의 **형제**다 — 자식으로 두면 부모의 등장 애니메이션이 남긴
          `transform`이 컨테이닝 블록을 만들어 `fixed` 좌표가 메뉴 왼쪽 위에서
          다시 세어진다(실측: 왼쪽 708px만큼 밀려 화면 밖으로 나갔다). 페이지
          메뉴의 `다른 공책으로 이동`도 같은 이유로 비뚤어져 있었다. */}
      {wing === 'style' && (
        <CtxWing anchor={base} title="문단 스타일">
          {CTX_STYLES.map((s) => (
            <CtxItem
              key={s.kind}
              mark={`style-${s.kind}`}
              name={s.name}
              dot={s.dot}
              on={block?.kind === s.kind}
              onClick={done(() => controller.retypeNoteBlock(at.blockId, s.kind))}
            />
          ))}
        </CtxWing>
      )}
      {wing === 'font' && (
        <CtxWing anchor={base} title="글꼴">
          {CTX_FONTS.map((f) => (
            <CtxItem key={f.kind} mark={`font-${f.kind}`} name={f.name} hint={f.key} dot={f.dot} onClick={done(() => format(f.kind))} />
          ))}
        </CtxWing>
      )}
      {wing === 'todo' && <TodoWing controller={controller} anchor={base} blockId={at.blockId} onDone={onClose} />}
    </>
  );
}

/** 우클릭 메뉴 너비 — 날개가 이 값만큼 옆으로 붙는다. */
const CTX_MENU_W = 236;

/** 메뉴 사이의 가는 선 — 묶음이 넷이라(잘라내기·서식·블록·지우기) 선이 없으면 한 덩어리로 읽힌다. */
function CtxRule() {
  return <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', margin: '4px' }} />;
}

/**
 * 메뉴 한 줄 — [아이콘 또는 색 점] 이름 … [단축키 또는 ›].
 *
 * 아이콘과 색 점을 한 컴포넌트가 다루는 이유: 본 메뉴는 아이콘, 날개는 색 점인데
 * 줄 높이·여백·hover가 같아야 한 벌로 읽힌다(디자인 이미지 셋이 그렇다).
 */
function CtxItem({
  name,
  hint,
  icon,
  dot,
  swatch,
  danger,
  wing,
  on,
  disabled,
  mark,
  onClick,
}: {
  name: string;
  hint?: string;
  icon?: JSX.Element;
  dot?: string;
  /** 색 견본 — 점보다 큰 둥근 사각(색 날개가 쓴다). */
  swatch?: string;
  danger?: boolean;
  wing?: boolean;
  on?: boolean;
  disabled?: boolean;
  mark: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-note-ctx={mark}
      className="btn mf-note-item"
      disabled={disabled}
      // 기본 동작(포커스 이동)을 막아 **선택을 잃지 않는다** — 서식 항목이 그 선택에 건다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        ...MENU_ITEM,
        height: 33,
        color: disabled ? 'var(--mf-faint)' : danger ? 'var(--mf-danger)' : 'var(--mf-text)',
        cursor: disabled ? 'default' : 'pointer',
        // 면은 **켜졌을 때만** 적는다 — 인라인으로 `transparent`를 박으면 클래스의
        // hover(`.mf-note-item:hover`)를 덮어 마우스를 얹어도 아무 일이 없다(제보).
        ...(on ? { background: 'var(--mf-accent-soft)' } : {}),
      }}
    >
      {icon && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={danger ? 'currentColor' : 'var(--mf-subtext)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
          {icon}
        </svg>
      )}
      {dot && <span aria-hidden="true" style={{ width: 8, height: 8, flex: '0 0 auto', borderRadius: 999, background: dot, display: 'block' }} />}
      {swatch && <span aria-hidden="true" style={{ width: 13, height: 13, flex: '0 0 auto', borderRadius: 4, background: swatch, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.07)', display: 'block' }} />}
      {name}
      <span style={{ flex: 1 }} />
      {hint && <span style={POP_KEY}>{hint}</span>}
      {wing && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      )}
    </button>
  );
}

/** 날개 — 본 메뉴 오른쪽(자리가 없으면 왼쪽)에 붙는 두 번째 판. */
function CtxWing({ anchor, title, children }: { anchor: CSSProperties; title: string; children: ReactNode }) {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const left = typeof anchor.left === 'number' ? anchor.left : 8;
  const top = typeof anchor.top === 'number' ? anchor.top : 8;
  const width = 214;
  // 날개는 **부모 메뉴의 너비**만큼 옆으로 붙는다 — 예전에는 본문 메뉴의 폭(236)을
  // 박아 둬서 표 메뉴(214)에서는 28px 떠 있었다. `cursorStyle`이 폭을 스타일에
  // 실어 주므로 그 값을 읽는다(없으면 지금까지의 값으로 물러선다).
  const parentW = typeof anchor.width === 'number' ? anchor.width : CTX_MENU_W;
  const fits = left + parentW + width + 16 < vw;
  return (
    <div
      data-note-ctx-wing={title}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        ...POP,
        position: 'fixed',
        left: fits ? left + parentW + 6 : Math.max(8, left - width - 6),
        top: Math.min(top + 60, Math.max(8, vh - 300)),
        width,
        maxHeight: 320,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <span style={POP_HEAD}>{title}</span>
      {children}
    </div>
  );
}

/**
 * `할 일로 보내기`의 날개 — 이 스페이스의 **칸반 보드들**.
 *
 * 고른 보드의 **첫 열 맨 끝**에 카드를 만든다(`sendNoteBlockToBoard`). 회의록에서
 * 정한 일을 보드로 옮기는 것이 이 메뉴가 있는 이유라, 보드를 열고 카드를 만들고
 * 글을 옮겨 적는 세 단계가 한 번으로 줄어든다.
 */
function TodoWing({ controller, anchor, blockId, onDone }: { controller: EditorController; anchor: CSSProperties; blockId: string; onDone: () => void }) {
  const { rows, loading } = useBoards(controller);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  return (
    <CtxWing anchor={anchor} title="할 일로 보내기">
      {loading && <span style={{ padding: '8px 9px', fontSize: 12, color: 'var(--mf-faint)' }}>보드를 찾는 중…</span>}
      {!loading && rows.length === 0 && <span style={{ padding: '8px 9px', fontSize: 12, color: 'var(--mf-faint)', lineHeight: 1.5, wordBreak: 'keep-all' }}>이 스페이스에 칸반 보드가 없어요</span>}
      {rows.map((r) => (
        <button
          key={r.docId}
          type="button"
          data-note-todo-to={r.docId}
          className="btn mf-note-item"
          disabled={busy !== null}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setBusy(r.docId);
            setFailed(false);
            void controller.sendNoteBlockToBoard(blockId, r.docId).then((ok) => {
              setBusy(null);
              if (!ok) {
                setFailed(true);
                return;
              }
              // 보냈다는 것을 **잠깐 보여 주고** 닫는다 — 곧바로 닫히면 무슨 일이
              // 일어났는지 화면 어디에도 남지 않는다(보드는 다른 문서다).
              setSent(r.docId);
              window.setTimeout(onDone, 900);
            });
          }}
          style={{ ...MENU_ITEM, height: 36 }}
        >
          <span aria-hidden="true" style={{ width: 8, height: 8, flex: '0 0 auto', borderRadius: 2, background: 'var(--mf-doc-kanban)', display: 'block' }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
          {busy === r.docId && <span style={{ flex: '0 0 auto', fontSize: 10.5, color: 'var(--mf-faint)' }}>보내는 중…</span>}
          {sent === r.docId && <span style={{ flex: '0 0 auto', fontSize: 10.5, fontWeight: 800, color: 'var(--mf-accent-deep)' }}>보냄</span>}
        </button>
      ))}
      {failed && (
        <span data-note-todo-failed style={{ padding: '6px 9px', fontSize: 11, lineHeight: 1.5, color: 'var(--mf-danger)', wordBreak: 'keep-all' }}>
          보내지 못했어요 — 그 보드를 다른 곳에서 고치는 중일 수 있어요.
        </span>
      )}
    </CtxWing>
  );
}

/** 이 스페이스의 **칸반 보드들** — `useNotebooks`와 같은 길(열릴 때 한 번만 읽는다). */
function useBoards(controller: EditorController): { rows: { docId: string; title: string }[]; loading: boolean } {
  const docStore = useDocStore();
  const [rows, setRows] = useState<{ docId: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const metas = await docStore.list();
        const byId = new Map(metas.map((m) => [m.id, m]));
        const ids = controller.linkTargets.map((t) => t.docId);
        const bodies = await Promise.allSettled(ids.map((id) => docStore.loadPreview(id, byId.get(id))));
        if (!alive) return;
        const out: { docId: string; title: string }[] = [];
        bodies.forEach((r, i) => {
          if (r.status !== 'fulfilled' || !r.value) return;
          const id = ids[i]!;
          let parsed: Doc | null = null;
          try {
            parsed = parseDoc(JSON.parse(r.value) as Record<string, unknown>);
          } catch {
            parsed = null;
          }
          if (!parsed || parsed.kind !== 'kanban') return;
          out.push({ docId: id, title: byId.get(id)?.title || controller.linkTargets.find((t) => t.docId === id)?.title || '제목 없는 보드' });
        });
        setRows(out);
      } catch {
        /* 목록을 못 받아도 본문은 그대로 쓴다 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [docStore, controller.linkTargets]);
  return { rows, loading };
}

/**
 * 블록의 **흐름 속성** — 가로 정렬과 들여쓰기. 모델에는 처음부터 있던 칸인데
 * (`NoteBlock.align`·`indent`) 그릴 곳이 없어 화면에 나타나지 않았다. 툴바에 버튼이
 * 생기면서 이제 둘 다 보인다. 들여쓰기 한 단은 24px(체크·목록의 글머리 너비와 같다).
 */
function blockFlow(block: NoteBlock): CSSProperties {
  return {
    ...(block.align && block.align !== 'left' ? { textAlign: block.align } : {}),
    ...(block.indent ? { paddingLeft: block.indent * 24 } : {}),
  };
}

/**
 * 이미지 블록 — 파일을 올리면 본문에는 **참조만** 남는다(플로트 이미지와 같은 길:
 * `attachImageFile` → 저장소 업로드 → `mfimg:…`). 저장소가 없으면 데이터 URL로
 * 물러서고, 그때는 문서가 무거워지므로 `noteIfInlined`가 이미 경고를 켠다.
 */
function ImageBlock({ controller, block }: { controller: EditorController; block: NoteBlock }) {
  const readOnly = controller.readOnly;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const url = block.src ? (controller.imageUrls[block.src] ?? (block.src.startsWith('data:') ? block.src : '')) : '';
  return (
    <div data-note-block={block.id} data-note-kind="img" style={{ padding: '8px 0' }}>
      {url ? (
        <img
          src={url}
          alt=""
          data-note-image
          style={{ display: 'block', maxWidth: '100%', borderRadius: 10, border: '1px solid var(--mf-border-soft)' }}
        />
      ) : (
        <button
          type="button"
          data-note-image-pick
          disabled={readOnly}
          onClick={() => inputRef.current?.click()}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 96,
            borderRadius: 10,
            border: '1.5px dashed var(--mf-border)',
            background: 'transparent',
            color: 'var(--mf-muted)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m5 17 4.5-4.5L14 17l3-3 3 3" />
          </svg>
          {block.src ? '이미지를 불러오는 중…' : '이미지 올리기'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // 같은 파일을 다시 골라도 change가 오게
          if (file) void controller.setNoteImage(block.id, file);
        }}
      />
    </div>
  );
}

/**
 * 문서 링크 블록 — 이 앱의 **다른 문서**를 본문에 꽂는다(디자인의 `보드 링크`).
 *
 * 주소를 적는 것이 아니라 **문서를 고른다**: 제목이 바뀌어도 링크가 살아 있고,
 * 무엇보다 여기서 고를 수 있는 것이 곧 "내가 볼 수 있는 문서"라 끊어진 링크가
 * 생기지 않는다.
 */
function LinkBlock({ controller, block }: { controller: EditorController; block: NoteBlock }) {
  const [open, setOpen] = useState(false);
  const readOnly = controller.readOnly;
  const targets = controller.linkTargets;
  const target = targets.find((t) => t.docId === block.docId) ?? null;
  return (
    <div className="mf-note-link" data-note-block={block.id} data-note-kind="link" style={{ ...blockFlow(block), position: 'relative' }}>
      {target ? (
        /* 디자인의 링크 카드 — 종류 타일 · 이름 · `종류 · 스페이스` · 열기 표시.
           예전에는 점 하나 + `문서` 한 낱말이라 무엇으로 가는 링크인지 알 수 없었다. */
        <a
          href={target.href}
          data-note-link={target.docId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '11px 13px',
            borderRadius: 13,
            border: '1px solid var(--mf-border-soft)',
            background: 'var(--mf-card)',
            color: 'inherit',
            textDecoration: 'none',
            minWidth: 0,
          }}
        >
          <span aria-hidden="true" style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, background: `color-mix(in srgb, ${target.color} 16%, var(--mf-card))`, color: target.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7" />
              <path d="M9 9h7M9 13h7M9 17h4" />
            </svg>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.title}</span>
            <span style={{ fontSize: 11, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {target.kindName}
              {target.spaceName ? ` · ${target.spaceName}` : ''}
            </span>
          </span>
          {!readOnly && (
            <button type="button" className="btn mf-note-linkact" onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }} style={{ ...GHOST_BTN, height: 22, flex: '0 0 auto' }}>
              바꾸기
            </button>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
            <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      ) : (
        <button
          type="button"
          data-note-link-pick
          disabled={readOnly}
          onClick={() => setOpen((v) => !v)}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 52,
            borderRadius: 10,
            border: '1.5px dashed var(--mf-border)',
            background: 'transparent',
            color: 'var(--mf-muted)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          문서 고르기
        </button>
      )}
      {open && !readOnly && (
        <div
          data-note-link-menu
          className="lnb-scroll"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 30,
            maxHeight: 260,
            overflowY: 'auto',
            padding: 6,
            borderRadius: 12,
            background: 'var(--mf-card)',
            border: '1px solid var(--mf-border)',
            boxShadow: '0 20px 40px -22px rgba(46,42,38,.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {targets.length === 0 && <div style={{ padding: '10px 9px', fontSize: 11.5, color: 'var(--mf-faint)' }}>연결할 문서가 아직 없어요.</div>}
          {targets.map((t) => (
            <button
              key={t.docId}
              type="button"
              data-note-link-option={t.docId}
              className="btn"
              onClick={() => {
                controller.setNoteLinkDoc(block.id, t.docId);
                setOpen(false);
              }}
              style={MENU_ITEM}
            >
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: t.color, flex: '0 0 auto' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              <span style={{ fontSize: 10.5, color: 'var(--mf-faint)' }}>{t.kindName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * `/` 커맨드 목록 — 지금 블록의 **종류를 바꾼다**(새 블록을 만들지 않는다).
 *
 * 입력칸을 따로 두지 않는다(스펙 §1): `/`와 이어 친 글자는 **본문의 진짜 글자**이고,
 * 이 패널은 그것을 읽기만 한다. 그래서 취소하면 쓴 글이 그대로 남고, 조합 중인 한글을
 * 우리가 다시 그릴 일이 없다(그 순간 `안녕하세요`가 `안ㄴ녕ㅎ하세세요`가 된다).
 */
function SlashMenu({
  anchor,
  query,
  inline,
  onPick,
  onClose,
}: {
  /** 연 자리 — 칩이 놓일 곳과 패널이 위로 뒤집힐지. `null`이면 화면 밖(안전망). */
  anchor: SlashAnchor | null;
  /** 좁히는 글자 — **본문에 친 그 글자**다(`/` 뒤). 툴바로 열었으면 빈 문자열. */
  query: string;
  /** 본문에서 `/`로 열렸는가 — 그때는 키보드가 본문에 있으므로 우리가 가로챈다. */
  inline: boolean;
  onPick: (kind: NoteBlockKind) => void;
  onClose: () => void;
}) {
  // 바깥을 누르면 닫힌다(제보) — 목록 안의 누름은 뿌리에서 막는다. **스크롤로는 닫지
  // 않는다**(제보: 본문을 굴리며 고르는 자리다 — 자리는 호출부가 다시 재 준다).
  useAnchored(true, onClose, { closeOnScroll: false });
  const q = query.trim().toLowerCase();
  const hits = BLOCK_TYPES.filter((t) => !q || `${t.name}${t.desc}`.toLowerCase().includes(q));
  // 묶음 머리 — 찾는 중에는 그리지 않는다(결과가 몇 개뿐인데 머리가 더 길어진다).
  const groups = q ? [{ name: '', items: hits }] : ['기본', '목록', '강조', '넣기'].map((name) => ({ name, items: hits.filter((t) => t.group === name) }));
  const [cursor, setCursor] = useState(0);
  const flat = groups.flatMap((g) => g.items);
  // 목록이 좁혀지면 고른 줄을 처음으로 되돌린다(없는 줄을 가리키지 않게).
  useEffect(() => setCursor(0), [q]);
  /**
   * 키보드는 **본문에 있다**(캐럿이 그대로다 — 글은 계속 본문에 들어간다). 그래서
   * Enter·Tab·↑·↓·Esc만 **캡처 단계**에서 가로채 본문 핸들러에 닿지 않게 한다: 그러지
   * 않으면 Enter가 목록을 고르면서 새 블록도 만든다.
   */
  useEffect(() => {
    if (!inline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // **패널만** 접는다(스펙 §5) — blur도, 글자 손질도 하지 않는다. 조합 중에
        // `textContent`를 다시 쓰면 글자가 겹친다(`/안녕` → `/안녕녕`).
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      // 한글을 **확정하는** Enter는 가로채지 않는다(스펙 §5) — 조합 중이면 흘린다.
      const composing = e.isComposing || e.keyCode === 229;
      if ((e.key === 'Enter' || e.key === 'Tab') && !composing && flat.length) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onPick(flat[Math.min(cursor, flat.length - 1)]!.kind);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        // 끝에서 멈추지 않고 **돈다**(스펙 §5의 모듈러 순환).
        if (flat.length) setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        // 캐럿을 옮기는 것은 **고르는 일이 아니다**(요청) — 목록만 접고 글자는 그대로
        // 둔다(막지 않으므로 캐럿은 평소처럼 움직인다).
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [inline, flat, cursor, onPick, onClose]);
  const up = anchor?.up ?? false;
  return (
    <div data-note-slash onPointerDown={(e) => e.stopPropagation()}>
      {/* **앵커는 하나다**(스펙 §3) — 칩 래퍼만 `fixed`로 놓고, 패널은 그 안의
          `absolute` 자식이다. 둘을 각각 `fixed`로 두면 화면 밖으로 나가지 않게 당기는
          계산이 **따로 돌아** 칩과 패널이 서로 떨어진 자리에 뜬다. */}
      <div
        data-note-slash-anchor
        style={{
          position: 'fixed',
          left: anchor ? anchor.gx : -9999,
          top: anchor ? anchor.gy : -9999,
          zIndex: 40,
          // 블록 아랫선에서 20px 내려온 자리에 패널이 매달린다. 예전에는 그 20px에
          // **검색어 칩**이 있었는데, 친 글자가 본문에 그대로 있는데 바로 그 아래에
          // 한 번 더 보여서 걷었다(제보) — 자리를 잡는 구실만 남았다.
          height: inline ? 20 : 0,
          // 본문의 그 자리를 덮어 클릭을 먹지 않게 — 자리를 잡을 뿐 아무것도 받지 않는다.
          pointerEvents: 'none',
        }}
      >
        <div
          data-note-slash-panel
          style={{
            position: 'absolute',
            left: 0,
            ...(up ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }),
            width: SLASH_W,
            boxSizing: 'border-box',
            borderRadius: 14,
            background: 'var(--mf-card)',
            border: '1px solid var(--mf-border)',
            boxShadow: '0 24px 48px -22px rgba(46,42,38,.5)',
            animation: 'mf-note-pop .13s ease both',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
          }}
        >
          {/* 머리 — 이름과, 검색어가 **비어 있을 때만** 안내 한 줄. **검색어는 어디에도
              다시 그리지 않는다**(스펙 §7 + 제보): 친 글자는 본문에 그대로 있으므로
              머리에 적든 칩에 적든 같은 글자가 두 번 보인다. */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '9px 11px', borderBottom: '1px solid var(--mf-border-soft)' }}>
            <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-text)' }}>블록 넣기</span>
            {!query && (
              <span style={{ minWidth: 0, fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {inline ? '블록 이름을 이어서 입력하세요' : '넣을 블록을 고르세요'}
              </span>
            )}
          </div>
          <div className="lnb-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 7, maxHeight: anchor ? anchor.listH : 288, overflowY: 'auto' }}>
            {groups.map((g) =>
              g.items.length === 0 ? null : (
                <div key={g.name || 'hits'} style={{ display: 'contents' }}>
                  {g.name && <span style={POP_HEAD}>{g.name}</span>}
                  {g.items.map((t) => {
                    const active = flat[cursor] === t;
                    return (
                      <button
                        key={t.kind}
                        type="button"
                        data-note-slash-item={t.kind}
                        className="btn mf-note-item"
                        onMouseDown={(e) => e.preventDefault()}
                        // 마우스를 얹으면 **키보드 활성도 그리로 옮긴다**(스펙 §7) —
                        // 그러지 않으면 손으로 가리킨 줄과 Enter가 넣을 줄이 다르다.
                        onMouseEnter={() => setCursor(flat.indexOf(t))}
                        onClick={() => onPick(t.kind)}
                        aria-selected={active}
                        style={{ ...MENU_ITEM, height: 'auto', padding: '6px 9px', gap: 10, ...(active ? { background: 'var(--mf-note-hover)' } : {}) }}
                      >
                        {/* 아이콘 **타일** — 디자인은 28×28 면 위에 글리프를 얹는다(글자 옆의
                            맨 아이콘보다 줄이 또렷하게 나뉜다). */}
                        <span
                          aria-hidden="true"
                          style={{
                            width: 28,
                            height: 28,
                            flex: '0 0 auto',
                            borderRadius: 8,
                            background: active ? 'var(--mf-accent-soft)' : 'var(--mf-note-hover)',
                            color: active ? 'var(--mf-accent-deep)' : 'var(--mf-subtext)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            {t.icon}
                          </svg>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)' }}>{t.name}</span>
                          <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.desc}</span>
                        </span>
                        {/* `↵` — **고른 줄에만**. 항상 켜 두면 열다섯 줄이 모두 같은 말을
                            해서 어느 줄이 들어갈지를 도리어 흐린다(스펙 §7). */}
                        {active && <span style={{ ...POP_KEY, color: 'var(--mf-accent-deep)' }}>↵</span>}
                      </button>
                    );
                  })}
                </div>
              ),
            )}
            {hits.length === 0 && (
              // 맞는 것이 없어도 **닫지 않는다**(스펙 §8) — 한 글자 더 쳤다가 지우는
              // 일이 흔하고, 그때마다 목록이 사라지면 다시 `/`부터 쳐야 한다.
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '18px 9px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-subtext)' }}>맞는 블록이 없어요</span>
                <span style={{ fontSize: 10.5, color: 'var(--mf-faint)' }}>⌫ 로 글자를 지워 보세요</span>
              </div>
            )}
          </div>
          {/* 푸터 — 이 패널에서 쓸 수 있는 키 셋. 본문에 캐럿이 남아 있어 "지금 무엇을
              누를 수 있나"가 보이지 않으므로, 여기에 적어 둔다(스펙 §7). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 11px', borderTop: '1px solid var(--mf-border-soft)', background: 'var(--mf-note-body)' }}>
            {[
              ['↑↓', '고르기'],
              ['↵', '넣기'],
              ['esc', '닫기'],
            ].map(([cap, name]) => (
              <span key={cap} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--mf-faint)' }}>
                <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9.5, padding: '1px 4px', borderRadius: 4, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)' }}>{cap}</span>
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 지금 페이지의 강조색 — **페이지 태그 색**이고, 태그가 없으면 공책 표지 색으로
 * 물러선다(디자인: `allTags()[cTag] || '#E8845C'`).
 */
function pageAccent(controller: EditorController): string {
  const tag = controller.notePage?.tag?.trim();
  return tag ? noteTagColor(tag, controller.doc.tagColors) : noteCoverColor(controller.doc.cover);
}

/** 종류별 글자 모양 — 제목 셋이 크기·굵기로 갈리고 코드는 고정폭이다. */
function runStyleOf(kind: NoteBlockKind): CSSProperties {
  switch (kind) {
    case 'h1':
      return { fontSize: 23, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.45, marginTop: 14 };
    case 'h2':
      return { fontSize: 18.5, fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.5, marginTop: 12 };
    case 'h3':
      return { fontSize: 15.5, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.55, marginTop: 8 };
    case 'q':
      return { fontSize: 14, lineHeight: 1.8, color: 'var(--mf-subtext)', fontStyle: 'italic' };
    case 'code':
      return { fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12.5, lineHeight: 1.7, color: 'var(--mf-text)' };
    default:
      return { fontSize: 14.5, lineHeight: 1.85, color: 'var(--mf-text)' };
  }
}

/**
 * 그 편집 박스의 **지금 글자**(모델에서) — 블록·목록 항목·표 칸을 모두 가리키는 키.
 *
 * DOM에서 읽지 않는 이유: 렌더 도중에 DOM을 읽으면 아직 반영되지 않은 값을 볼 수
 * 있다(비제어 박스라 더욱 그렇다). 모델은 글쇠마다 커밋되므로 여기서는 늘 최신이다.
 */
function noteLineText(page: NotePage, key: string): string {
  const [blockId, rest] = key.split(':');
  const block = page.blocks.find((b) => b.id === blockId);
  if (!block) return '';
  if (!rest) return blockText(block);
  const cell = /^r(\d+)c(\d+)$/.exec(rest);
  if (cell) return runsText(block.rows?.[Number(cell[1])]?.[Number(cell[2])] ?? []);
  return runsText(block.items?.find((it) => it.id === rest)?.runs ?? []);
}

/**
 * 고른 뒤 본문에서 **`/질의`를 지운다** — 모델과 DOM을 함께.
 *
 * DOM까지 손대는 이유: 편집 박스는 비제어라(마운트할 때 한 번만 그린다) 모델만
 * 바꾸면 화면에는 친 글자가 그대로 남는다. 종류가 바뀌어 다시 그려지는 경우
 * (문단 → 목록)에는 이 손질이 덮이지만, 같은 모양으로 남는 경우(문단 → 인용)에는
 * 이것이 유일한 길이다.
 */
function dropSlashText(page: NotePage | null, key: string, at: number, query: string, controller: EditorController): void {
  if (!page) return;
  const text = noteLineText(page, key);
  if (text[at] !== '/') return;
  const next = text.slice(0, at) + text.slice(at + 1 + query.length);
  commitLine(controller, key, textRuns(next));
  const el = document.querySelector<HTMLElement>(`[data-note-line="${key}"]`);
  if (el) el.textContent = next;
}

/**
 * 편집 박스의 키(`data-note-line`)로 **어디에 커밋할지** 정한다.
 *
 * 키는 셋 중 하나다: `<블록id>` · `<블록id>:<항목id>` · `<블록id>:r<행>c<칸>`.
 * 툴바가 블록 구조를 다시 알아내지 않아도 되게, 그린 쪽이 자기 주소를 실어 둔다.
 */
function commitLine(controller: EditorController, key: string, runs: RichRun[]): void {
  if (!key) return;
  const [blockId, rest] = key.split(':');
  if (!blockId) return;
  if (!rest) {
    controller.setNoteBlockRuns(blockId, runs);
    return;
  }
  const cell = /^r(\d+)c(\d+)$/.exec(rest);
  if (cell) {
    controller.setNoteCell(blockId, Number(cell[1]), Number(cell[2]), runs);
    return;
  }
  controller.setNoteItemRuns(blockId, rest, runs);
}

/**
 * 본문의 **마크다운 단축** — `- ` 면 글머리 기호, `<수>. ` 면 그 수부터 번호 매기기.
 *
 * 문단 전체가 그 글자일 때만 맞다고 본다(`^…$`) — 글 중간의 `- `까지 잡으면 목록이
 * 아니라 그냥 글을 쓰던 사람이 매번 되돌려야 한다. 공백은 보통 칸과 `&nbsp;` 둘 다
 * 받는다(브라우저가 줄 끝의 공백을 후자로 바꿔 넣는다 — 그러지 않으면 단축이
 * "가끔만" 걸린다).
 */
function listShortcutOf(text: string): { kind: 'ul' | 'ol'; start?: number } | null {
  const t = text.replace(/\u00a0/g, ' ');
  if (/^[-*]\s$/.test(t)) return { kind: 'ul' };
  const m = /^(\d{1,3})[.)]\s$/.exec(t);
  if (m) return { kind: 'ol', start: Number(m[1]) };
  return null;
}

/**
 * 위·아래 방향키로 **줄 사이를 옮긴다**(제보: 방향키로 이동되지 않는다).
 *
 * `NoteLine`은 글의 맨 앞(위)·맨 끝(아래)에서만 이 고리를 부르므로, 여러 줄로 감긴
 * 문단 안에서는 평소처럼 브라우저가 캐럿을 옮긴다. 여기서는 그 경계를 넘을 때만
 * 다음/이전 **편집 가능한 줄**로 건너뛴다 — 표의 칸은 고르기 전에는 편집 가능이
 * 아니므로 건너뛴다(캐럿이 설 자리가 없다).
 *
 * 캐럿은 위로 가면 글 **끝**, 아래로 가면 글 **처음**에 놓는다 — 열(column)을 재서
 * 맞추는 것이 더 정확하지만, 그러려면 글자 좌표를 매번 재야 한다(지금 규칙으로도
 * 이어 쓰는 자리가 자연스럽다).
 */
function moveNoteCaret(dir: -1 | 1): boolean {
  if (typeof document === 'undefined') return false;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur?.hasAttribute?.('data-note-line') && !cur?.hasAttribute?.('data-note-hr')) return false;
  // 구분선도 **줄 하나로 센다** — 방향키로 그 위를 지나가야 고를 수 있고(고르면
  // 지울 수 있다), 지나갈 수만 있고 설 수 없으면 "여기 뭔가 있다"가 보이지 않는다.
  const all = [...document.querySelectorAll<HTMLElement>('[data-note-page] [data-note-line], [data-note-page] [data-note-hr]')];
  const i = all.indexOf(cur);
  if (i < 0) return false;
  for (let j = i + dir; j >= 0 && j < all.length; j += dir) {
    const el = all[j]!;
    if (el.hasAttribute('data-note-hr')) {
      el.focus({ preventScroll: false });
      return true;
    }
    if (el.getAttribute('contenteditable') !== 'true') continue;
    el.focus({ preventScroll: false });
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(dir === 1); // 아래로 가면 처음, 위로 가면 끝
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      /* 캐럿을 못 놓아도 포커스는 갔다 */
    }
    return true;
  }
  return false;
}

/**
 * **다음 프레임에** 이 키의 줄로 캐럿을 보낸다(기본은 글 끝).
 *
 * 모델을 고치면 그 자리의 DOM이 다시 그려지므로 지금 잡아 둔 요소는 쓸 수 없다.
 * `freshId`(마운트할 때의 `autoFocus`)로도 닿지 않는 자리가 있다 — **이미 떠 있던
 * 줄**(앞 항목·앞 블록)은 다시 마운트되지 않기 때문이다.
 */
function caretToLine(key: string, at: number | 'end' = 'end'): void {
  const go = () => {
    const el = document.querySelector<HTMLElement>(`[data-note-line="${key}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      if (at === 'end') range.collapse(false);
      else {
        // 글자 자리로 — 이어 붙인 자리(앞 글의 길이)에 캐럿을 둔다.
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let seen = 0;
        let node = walker.nextNode();
        let done = false;
        while (node) {
          const len = (node.nodeValue || '').length;
          if (seen + len >= at) {
            range.setStart(node, at - seen);
            range.collapse(true);
            done = true;
            break;
          }
          seen += len;
          node = walker.nextNode();
        }
        if (!done) range.collapse(false);
      }
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      /* 캐럿을 못 놓아도 포커스는 갔다 */
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  else setTimeout(go, 0);
}

/** 편집 박스 키에서 블록 id만. */
function blockIdOf(key: string): string {
  return key.split(':')[0] ?? '';
}

/** 툴바 단추 — 디자인은 **테두리 없는 30×30**이다(면이 아니라 글리프만 보인다). */
const TOOL_BTN: CSSProperties = {
  height: 30,
  width: 30,
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 9,
  border: 0,
  background: 'transparent',
  color: 'var(--mf-subtext)',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  padding: 0,
};

const GHOST_BTN: CSSProperties = {
  height: 26,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--mf-border)',
  background: 'transparent',
  color: 'var(--mf-subtext)',
  fontFamily: 'inherit',
  fontSize: 11.5,
  fontWeight: 700,
  cursor: 'pointer',
};

const MENU_ITEM: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  height: 32,
  padding: '0 9px',
  borderRadius: 9,
  border: 'none',
  // **면은 여기서 정하지 않는다** — 인라인으로 `transparent`를 박으면 클래스의
  // hover(`.mf-note-item:hover`)를 덮어 마우스를 얹어도 아무 일이 없다(제보). 기본
  // 면은 그 클래스가 준다(`editor.css`).
  color: 'var(--mf-text)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  textAlign: 'left',
  cursor: 'pointer',
  width: '100%',
  boxSizing: 'border-box',
};

/** 팝업 겉면 — 디자인의 값 한 벌(반지름 14 · 종이 · 옅은 테두리 · 멀리 퍼지는 그늘). */
const POP: CSSProperties = {
  position: 'absolute',
  zIndex: 40,
  boxSizing: 'border-box',
  padding: 7,
  borderRadius: 14,
  background: 'var(--mf-card)',
  border: '1px solid var(--mf-border-soft)',
  boxShadow: '0 22px 44px -22px rgba(46,42,38,.5)',
  animation: 'mf-note-pop .13s ease both',
};

/** 팝업 안의 작은 머리말 — `공책 이동`·`태그`처럼 무엇의 목록인지 알리는 줄. */
const POP_HEAD: CSSProperties = {
  padding: '4px 9px 6px',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '.07em',
  textTransform: 'uppercase',
  color: 'var(--mf-faint)',
};

/** 메뉴 오른쪽의 단축키 힌트 — 고정폭이라 여러 줄이 세로로 맞는다. */
const POP_KEY: CSSProperties = {
  flex: '0 0 auto',
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  color: 'var(--mf-faint2)',
};

const SWATCH_POP: CSSProperties = {
  ...POP,
  top: 'calc(100% + 6px)',
  left: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  borderRadius: 12,
  boxShadow: '0 18px 36px -22px rgba(46,42,38,.5)',
};

const SWATCH: CSSProperties = {
  width: 24,
  height: 24,
  flex: '0 0 auto',
  borderRadius: 7,
  border: '2px solid var(--mf-border)',
  cursor: 'pointer',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
