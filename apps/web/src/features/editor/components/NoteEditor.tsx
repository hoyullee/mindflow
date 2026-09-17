// 공책 에디터 — 캔버스가 아니라 **페이지의 글**.
//
// 화면은 둘로 갈린다(디자인 원본):
//   왼쪽  페이지 목록 — 이 공책의 페이지들. 제목 + 첫 줄 + 태그.
//   가운데 페이지 본문 — 제목 한 줄 + 블록들. 위에 서식 툴바가 붙는다.
//
// 팬·줌·미니맵·그리기·레이아웃이 없다(에디터가 `isNote`로 그 UI를 통째로 걷어낸다).
// 대신 다루는 것이 순서와 글이고, 규칙은 전부 코어 `note.ts`에 있다.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import type { Doc, NoteBlock, NoteBlockKind, NoteCalloutTone, NoteExportScope, NotePage, RichRun } from '@mindflow/mindmap-core';
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
  runsText,
  textRuns,
  blockText,
} from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { useDocStore } from '../../../adapters/BackendContext';
import type { Theme } from '../theme';
import { applyNoteFormat, noteActiveMarks, noteEditBoxInSelection } from '../noteRichDom';
import { buildSelection, caretAt, clearPaint as clearSelectionPaint, paint as paintSelection, selectionText, supportsHighlight, type LineSel } from '../noteTextSelect';
import { NoteLine } from './NoteLine';
import { downloadFile } from '../download';
import { exportDocx } from '../docx';
import { openNotePrint } from '../notePrint';
import { PresenceAvatars } from './PresenceAvatars';
import { Avatar } from './commentPinShape';
import { formatLastEdited } from '../../home/timeFormat';

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
  { kind: 'ul', name: '글머리 목록', hint: '', desc: '점으로 나열', group: '목록',   icon: (<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></>) },
  { kind: 'ol', name: '번호 목록', hint: '', desc: '순서가 있는 나열', group: '목록',  icon: <path d="M10 6h10M10 12h10M10 18h10M4 5.5h1.5V9M4 9h3" /> },
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
  { kind: 'ul', name: '글머리 목록', icon: (<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" /></>) },
  { kind: 'ol', name: '번호 목록', icon: (<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5.5h1.5V9M4 9h3M4 13.5c0-1 2-1.2 2-.2 0 .6-.6.9-2 2.2h2.4M4.2 17.5h1.6c1.2 0 1.2 1.5 0 1.5h-1.6" /></>) },
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
  const [slashAt, setSlashAt] = useState<DOMRect | null>(null);
  /**
   * `/`가 놓인 **글자 자리** — 목록이 그 뒤에 이어 친 글자로 좁혀진다(요청·노션).
   * 툴바 단추로 열었으면 `null`이고, 그때는 예전처럼 목록이 그대로 다 보인다.
   */
  const [slashAtChar, setSlashAtChar] = useState<number | null>(null);
  const openSlashAt = (blockId: string, from?: Element | number | null) => {
    const at = typeof from === 'number' ? from : null;
    const el = typeof from === 'number' || !from ? document.querySelector(`[data-note-line="${blockId}"]`) : from;
    setSlashAt(el ? el.getBoundingClientRect() : null);
    setSlashFor(blockId);
    setSlashAtChar(at);
  };
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
    // 이름에 없는 글자를 이어 쳐 맞는 것이 하나도 없으면 접는다(노션과 같은 결).
    const q = slashQuery.trim().toLowerCase();
    if (q && !BLOCK_TYPES.some((t) => `${t.name}${t.desc}`.toLowerCase().includes(q))) closeSlash();
  }, [slashFor, slashAtChar, slashQuery, page, closeSlash]);

  /** 고른 줄들의 블록 id — 칠하기가 안 되는 브라우저에서 면으로 물러설 때 쓴다. */
  const selectedIds = useMemo(() => (textSel ?? []).map((l) => blockIdOf(l.key)), [textSel]);

  /** 칠하기는 DOM 작업이라 그리고 난 뒤에 — 선택이 바뀔 때마다 다시 칠한다. */
  useEffect(() => {
    if (textSel && textSel.length) paintSelection(textSel);
    else clearSelectionPaint();
    return () => clearSelectionPaint();
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
      const head = (first.el.textContent ?? '').slice(0, first.from);
      const tail = (last.el.textContent ?? '').slice(last.to);
      // 가운데(와 마지막) 줄이 든 블록을 먼저 뺀다 — 뒤에서부터 지워야 자리가 안 밀린다.
      const drop = [...new Set(sel.slice(1).map((l) => blockIdOf(l.key)))].filter((id) => id !== blockIdOf(first.key));
      for (const id of drop.reverse()) controller.removeNoteBlock(id);
      commitLine(controller, first.key, textRuns(head + tail));
      // 비제어 박스라 DOM도 함께 고쳐 준다(모델만 바꾸면 화면에 옛 글자가 남는다).
      first.el.textContent = head + tail;
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

  if (!page) return null;

  return (
    <div
      data-note-editor
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
            style={{ maxWidth: 700, margin: '0 auto', padding: '0 30px', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}
          >
            <PageHead controller={controller} page={page} />
            {/* 머리와 본문 사이의 선(요청) — 위는 이 장이 무엇인지(제목·태그·사람),
                아래는 그 내용이다. 블록 간격(19px)만으로는 그 경계가 서지 않는다. */}
            <span aria-hidden="true" style={{ height: 1, background: 'var(--mf-border-soft)', display: 'block', marginTop: -6 }} />
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
                  controller.retypeNoteBlock(slashFor, kind);
                  closeSlash();
                  setFreshId(slashFor);
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

            <PageStats page={page} />
          </div>
        </div>
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
function useAnchored(open: boolean, close: () => void): { ref: RefObject<HTMLElement | null>; rect: DOMRect | null } {
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
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onDown);
    document.addEventListener('scroll', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onDown);
      document.removeEventListener('scroll', onDown, true);
    };
  }, [open, close]);
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
        const ids = controller.linkTargets.map((t) => t.docId).concat(controller.docId);
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
  }, [open, docStore, controller.linkTargets, controller.docId]);
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
            <span>{controller.notePages.length}쪽</span>
            <span aria-hidden="true">·</span>
            <span style={{ color: saving === 'saved' || readOnly ? 'var(--mf-faint)' : 'var(--mf-accent-deep)', fontWeight: saving === 'saved' || readOnly ? 600 : 800 }}>{saveLabel}</span>
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
            <button type="button" className="mf-note-crumb" onClick={controller.goBack} style={{ flex: '0 0 auto', height: 26, padding: '0 9px', border: 0, borderRadius: 8, background: 'transparent', color: 'var(--mf-muted)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
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
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 9, border: 0, background: 'transparent', color: 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3" />
            <path d="M3 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 19a5 5 0 0 0-4-4.9" />
          </svg>
          공유
          {/* 함께 보고 있는 얼굴들 — 겹쳐 놓는다(시안). 혼자면 아무것도 그리지 않는다.
              GNB가 쓰는 그 컴포넌트를 그대로 쓴다(같은 뜻은 같은 그림). */}
          <PresenceAvatars controller={controller} isMobile />
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
                  background: t.on ? 'var(--mf-accent-soft)' : 'transparent',
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
                  data-note-sort={key}
                  aria-pressed={sort === key}
                  onClick={() => setSort(key)}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    height: 25,
                    border: 0,
                    borderRadius: 8,
                    background: sort === key ? 'var(--mf-card)' : 'transparent',
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
                        background: on ? 'var(--mf-accent-soft)' : 'transparent',
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
            border: '1.5px dashed var(--mf-border)',
            borderRadius: 11,
            background: 'transparent',
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

      {/* 거르개와 목록 사이의 선(요청) — 위는 "무엇을 볼까"를 고르는 줄, 아래는 그
          결과다. 선 하나가 그 둘을 갈라 준다. */}
      <span aria-hidden="true" style={{ height: 1, flex: '0 0 auto', background: 'var(--mf-border-soft)', display: 'block', margin: '0 14px 8px' }} />
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
                onClick={() => controller.addNotePage()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', border: '1.5px dashed var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
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
        background: active ? 'var(--mf-card)' : 'transparent',
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
function PageStats({ page }: { page: NotePage }) {
  const text = pageText(page);
  const chars = [...text.replace(/\s+/g, '')].length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return (
    <div
      data-note-stats
      style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 14, borderTop: '1px solid var(--mf-border-soft)', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10.5, color: 'var(--mf-faint)', flexWrap: 'wrap' }}
    >
      <span>{chars}자</span>
      <span aria-hidden="true">·</span>
      {/* `읽기 n분`은 뺐다(요청) — 디자인에는 있지만 한 장짜리 공책 페이지에서
          500자/분 추정이 말해 주는 것이 거의 없다(대개 `1분`으로 고정된다). 길이는
          자·단어 두 값이 이미 말한다. */}
      <span>{words}단어</span>
      <span style={{ flex: 1, minWidth: 0 }} />
      {page.updatedAt && <span>{formatLastEdited(page.updatedAt)} 수정</span>}
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
                style={{ ...MENU_ITEM, height: 30, gap: 8, fontWeight: on ? 800 : 600, background: on ? 'var(--mf-tag-on)' : 'transparent' }}
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
          {tag && (
            <button type="button" data-note-tag-clear className="btn mf-note-item" onClick={() => { controller.setNotePageTag(page.id, null); setOpen(() => false); }} style={{ ...MENU_ITEM, height: 28, color: 'var(--mf-muted)', fontSize: 11.5 }}>
              태그 없음
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
    <div className="mf-note-head" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
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
                if (id) controller.retypeNoteBlock(id, t.kind);
                setOpen(false);
              }}
              style={{ ...MENU_ITEM, fontWeight: cur?.kind === t.kind ? 800 : 600, background: cur?.kind === t.kind ? 'var(--mf-accent-soft)' : 'transparent' }}
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
  /** `/`를 쳤다 — 그 **글자 자리**와 함께 종류 목록을 연다(글자는 본문에 남는다). */
  openSlash: (blockId: string, at?: number) => void;
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
  const enterBlock = (): boolean => {
    if (readOnly) return false;
    const next = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3' ? 'p' : block.kind;
    setFreshId(controller.addNoteBlock(next === 'hr' || next === 'table' ? 'p' : next, block.id));
    return true;
  };

  /** 맨 앞 백스페이스 — 빈 블록이면 지우고, 글이 있으면 문단으로 되돌린다. */
  const backBlock = (): boolean => {
    if (readOnly) return false;
    const empty = runsText(block.runs) === '';
    if (empty && index > 0) {
      controller.removeNoteBlock(block.id);
      return true;
    }
    if (block.kind !== 'p') {
      controller.retypeNoteBlock(block.id, 'p');
      return true;
    }
    return false;
  };

  if (shape === 'empty') {
    return (
      <div data-note-block={block.id} data-note-kind={block.kind} style={blockFlow(block)}>
        <hr style={{ border: 'none', borderTop: '1px solid var(--mf-border)', margin: 0 }} />
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
              onChange={(runs) => {
                const itemId = block.items?.[0]?.id;
                if (itemId) controller.setNoteItemRuns(block.id, itemId, runs);
                else controller.addNoteItem(block.id);
              }}
              style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--mf-subtext)' }}
            />
          </div>
        )}
      </div>
    );
  }

  if (shape === 'items') {
    return (
      <div data-note-block={block.id} data-note-kind={block.kind} style={{ ...blockFlow(block), display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(block.items ?? []).map((item, j) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
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
              <span aria-hidden="true" style={{ flex: '0 0 auto', width: 18, marginTop: 3, textAlign: 'right', fontSize: 13, color: 'var(--mf-faint)', fontFamily: block.kind === 'ol' ? 'ui-monospace, monospace' : undefined }}>
                {block.kind === 'ol' ? `${j + 1}.` : '•'}
              </span>
            )}
            <NoteLine
              onFocusLine={focusBox}
              lineKey={`${block.id}:${item.id}`}
              runs={item.runs}
              readOnly={readOnly}
              placeholder={j === 0 ? '항목' : ''}
              autoFocus={freshId === item.id}
              onChange={(runs) => controller.setNoteItemRuns(block.id, item.id, runs)}
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
              onBackspaceAtStart={() => {
                if (readOnly) return false;
                if (runsText(item.runs) !== '') return false;
                if ((block.items ?? []).length > 1) {
                  controller.removeNoteItem(block.id, item.id);
                  return true;
                }
                controller.retypeNoteBlock(block.id, 'p');
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
    return <TableBlock controller={controller} block={block} focusBox={focusBox} />;
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
      onChange={(runs) => controller.setNoteBlockRuns(block.id, runs)}
      onEnter={enterBlock}
      onBackspaceAtStart={backBlock}
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

/** 표에서 지금 고른 것 — 칸 하나, 또는 손잡이로 고른 행·열 전체. */
type TablePick = { kind: 'cell' | 'row' | 'col' | 'all'; r: number; c: number };

/**
 * 표 블록 — 칸을 고르고, 행·열을 넣고 빼고 옮긴다(요청: "셀 별 선택, 열 제거, 행 제거").
 *
 * 손잡이를 **표의 일부로** 그린다(맨 위의 손잡이 줄, 각 행 맨 앞의 손잡이 칸). 겹쳐
 * 띄우는 방식은 열 너비가 글에 따라 달라지는 표에서 어긋나고, 가로로 스크롤되는 표
 * (`overflow-x:auto`)에서는 따로 논다 — 표 안에 있으면 배치가 저절로 맞는다.
 *
 * 메뉴는 세 자리에서 같은 일을 한다: 열 손잡이(열 기준) · 행 손잡이(행 기준) · 칸 안
 * 우클릭(행과 열을 함께). 마지막 한 행·한 열은 지우지 못한다 — 0칸짜리 표는 화면에서
 * 사라져 되돌릴 손잡이조차 없어진다(표 자체를 지우려면 블록을 지운다).
 */
function TableBlock({ controller, block, focusBox }: { controller: EditorController; block: NoteBlock; focusBox: (el: HTMLElement) => void }) {
  const readOnly = controller.readOnly;
  const rows = block.rows ?? [];
  const width = rows[0]?.length ?? 0;
  const [pick, setPick] = useState<TablePick | null>(null);
  const [menu, setMenu] = useState<{ pick: TablePick; at: { x: number; y: number } } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useAnchored(!!menu, closeMenu);
  const openAt = (e: { clientX: number; clientY: number }, p: TablePick) => {
    setPick(p);
    setMenu({ pick: p, at: { x: e.clientX, y: e.clientY } });
  };
  /** 이 칸이 고른 것에 드는가 — 칸 하나, 또는 고른 행·열 전체. */
  const picked = (r: number, c: number) =>
    !!pick &&
    (pick.kind === 'all'
      ? true
      : pick.kind === 'cell'
        ? pick.r === r && pick.c === c
        : pick.kind === 'row'
          ? pick.r === r
          : pick.c === c);
  const handle: CSSProperties = {
    border: 0,
    padding: 0,
    background: 'transparent',
    display: 'block',
    width: '100%',
    height: '100%',
    cursor: 'pointer',
  };
  return (
    <div className="mf-note-table" data-note-block={block.id} data-note-kind="table" style={blockFlow(block)}>
      <div style={{ overflowX: 'auto', border: '1px solid var(--mf-border-soft)', borderRadius: 13 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <tbody>
            {/* 열 손잡이 줄 — 표에 마우스를 얹어야 보인다(`editor.css`). 종이에 그린
                표라는 인상을 늘 붙어 있는 회색 띠 두 줄이 깨뜨린다. */}
            {!readOnly && (
              <tr className="mf-note-thandle-row">
                <td style={{ width: 14, padding: 0, border: 0 }} />
                {Array.from({ length: width }, (_, ci) => (
                  <td key={ci} style={{ height: 11, padding: 0, border: 0 }}>
                    <button
                      type="button"
                      data-note-table-colhandle={ci}
                      aria-label={`${ci + 1}번째 열`}
                      title="열 설정"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openAt(e, { kind: 'col', r: 0, c: ci })}
                      style={{ ...handle, height: 9 }}
                    >
                      <span
                        style={{
                          display: 'block',
                          height: 4,
                          margin: '0 3px',
                          borderRadius: 999,
                          background: pick && pick.kind === 'col' && pick.c === ci ? 'var(--mf-accent)' : 'var(--mf-border)',
                        }}
                      />
                    </button>
                  </td>
                ))}
              </tr>
            )}
            {rows.map((row, ri) => (
              <tr key={ri}>
                {!readOnly && (
                  <td style={{ width: 14, padding: 0, border: 0 }}>
                    <button
                      type="button"
                      data-note-table-rowhandle={ri}
                      aria-label={`${ri + 1}번째 행`}
                      title="행 설정"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openAt(e, { kind: 'row', r: ri, c: 0 })}
                      style={{ ...handle, padding: '0 3px' }}
                    >
                      <span
                        style={{
                          display: 'block',
                          width: 4,
                          height: '100%',
                          minHeight: 18,
                          borderRadius: 999,
                          background: pick && pick.kind === 'row' && pick.r === ri ? 'var(--mf-accent)' : 'var(--mf-border)',
                        }}
                      />
                    </button>
                  </td>
                )}
                {row.map((cell, ci) => {
                  // 첫 행이 머리인가 — 메뉴의 `머리글 행 사용`으로 끌 수 있다(자료가
                  // 아니라 목록인 표에서는 첫 줄만 진하면 잘못 읽힌다).
                  const head = ri === 0 && block.head !== false;
                  const on = picked(ri, ci);
                  const align = block.colAlign?.[ci] ?? 'left';
                  return (
                    <td
                      key={ci}
                      data-note-table-cell={`${ri}:${ci}`}
                      data-picked={on ? '1' : undefined}
                      onClick={() => !readOnly && setPick({ kind: 'cell', r: ri, c: ci })}
                      onContextMenu={(e) => {
                        if (readOnly) return;
                        e.preventDefault();
                        e.stopPropagation();
                        openAt(e, { kind: 'cell', r: ri, c: ci });
                      }}
                      style={{
                        border: '1px solid var(--mf-border-soft)',
                        padding: '7px 10px',
                        verticalAlign: 'top',
                        // 고른 **칸 하나**는 테두리가 아니라 안쪽 선으로 표시한다 —
                        // 테두리를 굵히면 그 줄만 1px 밀려 표 전체가 흔들린다. 행·열을
                        // 고른 것은 칸마다 선을 두르면 시끄러워 배경 한 톤으로 말한다.
                        boxShadow: on && pick?.kind === 'cell' ? 'inset 0 0 0 2px var(--mf-accent)' : undefined,
                        background: on && pick?.kind !== 'cell' ? 'var(--mf-accent-soft)' : head ? 'var(--mf-panel2)' : 'transparent',
                        fontWeight: head ? 700 : 400,
                        textAlign: align,
                        minWidth: 90,
                      }}
                    >
                      <NoteLine
                        onFocusLine={focusBox}
                        lineKey={`${block.id}:r${ri}c${ci}`}
                        runs={cell}
                        readOnly={readOnly}
                        placeholder={head ? '머리' : ''}
                        onChange={(runs) => controller.setNoteCell(block.id, ri, ci, runs)}
                        style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--mf-text)', textAlign: align }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 행·열 추가는 **표에 마우스를 얹었을 때만** 뜬다(`editor.css`) — 디자인의
          표는 종이에 그린 표처럼 보여야 하고, 늘 붙어 있는 버튼 둘이 그 인상을 깬다. */}
      {!readOnly && (
        <div className="mf-note-tableact" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <button type="button" data-note-table-row className="btn" onClick={() => controller.addNoteTableRow(block.id)} style={GHOST_BTN}>
            행 추가
          </button>
          <button type="button" data-note-table-col className="btn" onClick={() => controller.addNoteTableCol(block.id)} style={GHOST_BTN}>
            열 추가
          </button>
          <span style={{ fontSize: 10.5, color: 'var(--mf-faint2)' }}>행·열 손잡이나 칸 우클릭으로 넣고 지울 수 있어요</span>
        </div>
      )}
      {menu && (
        <TableMenu
          controller={controller}
          block={block}
          pick={menu.pick}
          at={menu.at}
          rows={rows.length}
          cols={width}
          onPickKind={(kind) => {
            // `선택 ›`은 메뉴를 **닫지 않는다** — 고른 범위를 보고 다음 항목을 고른다.
            setPick((cur) => (cur ? { ...cur, kind } : cur));
            setMenu((cur) => (cur ? { ...cur, pick: { ...cur.pick, kind } } : cur));
          }}
          onDone={() => {
            setMenu(null);
            setPick(null);
          }}
        />
      )}
    </div>
  );
}

/** 열 이름 — `A`·`B`…`Z`·`AA`(스프레드시트의 관례. 머리글이 비어 있어도 가리킬 이름이 있다). */
function colName(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

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
 * 표 우클릭 메뉴 — 디자인 다섯 번째 이미지 그대로.
 *
 * [표 · A 머리글] / 잘라내기·복사·붙여넣기 / **선택 ›**·**행 ›**·**열 ›**·**정렬 ›** /
 * 머리글 행 사용 · 표 복제 · CSV로 복사 / 표 삭제.
 *
 * 머리가 `표 · A 머리글`인 이유: 표 안에서는 "지금 어느 칸을 겨냥했나"가 메뉴의
 * 절반이다. 열 이름은 스프레드시트의 `A`·`B`를 쓰고(머리글이 비어 있어도 가리킬
 * 이름이 있다), 머리 행이면 그렇게 말한다.
 *
 * 날개는 메뉴의 **형제**로 띄운다 — 자식으로 두면 팝업 애니메이션이 남긴
 * `transform` 때문에 `fixed` 좌표가 메뉴 왼쪽 위에서 다시 세어진다(본문 우클릭
 * 메뉴에서 실측한 그 함정).
 */
function TableMenu({
  controller,
  block,
  pick,
  at,
  rows,
  cols,
  onPickKind,
  onDone,
}: {
  controller: EditorController;
  block: NoteBlock;
  pick: TablePick;
  at: { x: number; y: number };
  rows: number;
  cols: number;
  onPickKind: (kind: TablePick['kind']) => void;
  onDone: () => void;
}) {
  const [wing, setWing] = useState<'pick' | 'row' | 'col' | 'align' | null>(null);
  const base = cursorStyle(at, TABLE_MENU_W, 430);
  const head = block.head !== false;
  const cell = block.rows?.[pick.r]?.[pick.c];
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
  const alignNow = block.colAlign?.[pick.c] ?? 'left';
  return (
    <>
      <div
        data-note-table-menu
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ ...POP, ...base, display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <span style={{ ...POP_HEAD, textTransform: 'none', letterSpacing: 0 }}>
          표 · {colName(pick.c)}
          {head && pick.r === 0 ? ' 머리글' : ` ${pick.r + 1}`}
        </span>
        <CtxItem mark="t-cut" name="잘라내기" hint="⌘X" icon={<><path d="M6 3v12a3 3 0 1 0 3 3" /><path d="M18 3v12a3 3 0 1 1-3 3" /><path d="m6 9 12 6M18 9 6 15" /></>} onClick={run(() => { void write(runsText(cell ?? [])); controller.setNoteCell(block.id, pick.r, pick.c, textRuns('')); })} />
        <CtxItem mark="t-copy" name="복사" hint="⌘C" icon={<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>} onClick={run(() => void write(runsText(cell ?? [])))} />
        <CtxItem
          mark="t-paste"
          name="붙여넣기"
          hint="⌘V"
          icon={<><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /></>}
          onClick={run(() => {
            void navigator.clipboard
              .readText()
              .then((t) => t && controller.setNoteCell(block.id, pick.r, pick.c, textRuns(t.split('\n')[0]!)))
              .catch(() => undefined);
          })}
        />

        <CtxRule />
        <CtxItem mark="t-pick" name="선택" wing on={wing === 'pick'} onClick={() => setWing((v) => (v === 'pick' ? null : 'pick'))} icon={<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /></>} />
        <CtxItem mark="t-row" name="행" wing on={wing === 'row'} onClick={() => setWing((v) => (v === 'row' ? null : 'row'))} icon={<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M3 15h18" /></>} />
        <CtxItem mark="t-col" name="열" wing on={wing === 'col'} onClick={() => setWing((v) => (v === 'col' ? null : 'col'))} icon={<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 5v14M15 5v14" /></>} />
        <CtxItem mark="t-align" name="정렬" wing on={wing === 'align'} onClick={() => setWing((v) => (v === 'align' ? null : 'align'))} icon={<><path d="M4 6h16M4 12h10M4 18h16" /></>} />

        <CtxRule />
        {/* 머리글 행 — 끄면 첫 줄이 보통 칸이 된다(자료가 아니라 목록인 표). */}
        <CtxItem
          mark="t-head"
          name="머리글 행 사용"
          hint={head ? '켜짐' : '꺼짐'}
          icon={head ? <path d="m4 12 5 5L20 6" /> : <path d="M6 6h12v12H6z" />}
          onClick={run(() => controller.toggleNoteTableHead(block.id))}
        />
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
          <CtxItem mark="t-pick-cell" name="칸" on={pick.kind === 'cell'} onClick={() => onPickKind('cell')} dot="var(--mf-faint2)" />
          <CtxItem mark="t-pick-row" name="행" on={pick.kind === 'row'} onClick={() => onPickKind('row')} dot="var(--mf-doc-map)" />
          <CtxItem mark="t-pick-col" name="열" on={pick.kind === 'col'} onClick={() => onPickKind('col')} dot="var(--mf-doc-board)" />
          <CtxItem mark="t-pick-all" name="표 전체" on={pick.kind === 'all'} onClick={() => onPickKind('all')} dot="var(--mf-doc-kanban)" />
        </CtxWing>
      )}
      {wing === 'row' && (
        <CtxWing anchor={base} title={`행 ${pick.r + 1}`}>
          <CtxItem mark="row-above" name="위에 행 넣기" onClick={run(() => controller.addNoteTableRow(block.id, pick.r))} />
          <CtxItem mark="row-below" name="아래에 행 넣기" onClick={run(() => controller.addNoteTableRow(block.id, pick.r + 1))} />
          <CtxItem mark="row-up" name="행 위로 옮기기" disabled={pick.r === 0} onClick={run(() => controller.moveNoteTableRow(block.id, pick.r, -1))} />
          <CtxItem mark="row-down" name="행 아래로 옮기기" disabled={pick.r >= rows - 1} onClick={run(() => controller.moveNoteTableRow(block.id, pick.r, 1))} />
          <CtxItem mark="row-del" name="행 지우기" danger disabled={rows <= 1} onClick={run(() => controller.removeNoteTableRow(block.id, pick.r))} />
        </CtxWing>
      )}
      {wing === 'col' && (
        <CtxWing anchor={base} title={`열 ${colName(pick.c)}`}>
          <CtxItem mark="col-left" name="왼쪽에 열 넣기" onClick={run(() => controller.addNoteTableCol(block.id, pick.c))} />
          <CtxItem mark="col-right" name="오른쪽에 열 넣기" onClick={run(() => controller.addNoteTableCol(block.id, pick.c + 1))} />
          <CtxItem mark="col-left-move" name="열 왼쪽으로 옮기기" disabled={pick.c === 0} onClick={run(() => controller.moveNoteTableCol(block.id, pick.c, -1))} />
          <CtxItem mark="col-right-move" name="열 오른쪽으로 옮기기" disabled={pick.c >= cols - 1} onClick={run(() => controller.moveNoteTableCol(block.id, pick.c, 1))} />
          <CtxItem mark="col-del" name="열 지우기" danger disabled={cols <= 1} onClick={run(() => controller.removeNoteTableCol(block.id, pick.c))} />
        </CtxWing>
      )}
      {wing === 'align' && (
        <CtxWing anchor={base} title={`정렬 · ${colName(pick.c)} 열`}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <CtxItem
              key={a}
              mark={`align-${a}`}
              name={a === 'left' ? '왼쪽' : a === 'center' ? '가운데' : '오른쪽'}
              on={alignNow === a}
              icon={a === 'left' ? <><path d="M4 6h16M4 12h10M4 18h13" /></> : a === 'center' ? <><path d="M4 6h16M7 12h10M6 18h12" /></> : <><path d="M4 6h16M10 12h10M7 18h13" /></>}
              onClick={run(() => controller.setNoteTableAlign(block.id, pick.c, a))}
            />
          ))}
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
  { kind: 'ul', name: '글머리 목록', dot: '#7C9BD8' },
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
      <CtxItem mark="cut" name="잘라내기" hint="⌘X" icon={<><path d="M6 3v12a3 3 0 1 0 3 3" /><path d="M18 3v12a3 3 0 1 1-3 3" /><path d="m6 9 12 6M18 9 6 15" /></>} onClick={done(() => void copy().then((ok) => ok && controller.removeNoteBlock(at.blockId)))} />
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
        background: on ? 'var(--mf-accent-soft)' : 'transparent',
      }}
    >
      {icon && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={danger ? 'currentColor' : 'var(--mf-subtext)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
          {icon}
        </svg>
      )}
      {dot && <span aria-hidden="true" style={{ width: 8, height: 8, flex: '0 0 auto', borderRadius: 999, background: dot, display: 'block' }} />}
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
  const fits = left + CTX_MENU_W + width + 16 < vw;
  return (
    <div
      data-note-ctx-wing={title}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        ...POP,
        position: 'fixed',
        left: fits ? left + CTX_MENU_W + 6 : Math.max(8, left - width - 6),
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
 * 빈 블록에서만 열리므로 "이 줄을 무엇으로 만들까"가 곧 요청이고, 새로 만들면
 * 빈 줄이 하나 남는다. 좁혀 찾을 수 있게 입력칸을 함께 둔다(블록이 열다섯이다).
 */
function SlashMenu({
  anchor,
  query,
  inline,
  onPick,
  onClose,
}: {
  /** 연 자리 — 여기 아래에 뜬다. `null`이면 화면 가운데 위쪽에 뜬다(안전망). */
  anchor: DOMRect | null;
  /** 좁히는 글자 — **본문에 친 그 글자**다(`/` 뒤). 툴바로 열었으면 빈 문자열. */
  query: string;
  /** 본문에서 `/`로 열렸는가 — 그때는 키보드가 본문에 있으므로 우리가 가로챈다. */
  inline: boolean;
  onPick: (kind: NoteBlockKind) => void;
  onClose: () => void;
}) {
  // 바깥을 누르면 닫힌다(제보) — 지금까지는 Esc로만 닫혀서, 목록을 열어 둔 채
  // 다른 곳을 눌러도 그대로 떠 있었다. 목록 안의 누름은 뿌리에서 막는다.
  useAnchored(true, onClose);
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
   * Enter·↑·↓·Esc만 **캡처 단계**에서 가로채 본문 핸들러에 닿지 않게 한다: 그러지
   * 않으면 Enter가 목록을 고르면서 새 블록도 만든다.
   */
  useEffect(() => {
    if (!inline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Enter' && flat.length) {
        e.preventDefault();
        e.stopPropagation();
        onPick(flat[Math.min(cursor, flat.length - 1)]!.kind);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setCursor((c) => Math.max(0, Math.min(flat.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1))));
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [inline, flat, cursor, onPick, onClose]);
  return (
    <div data-note-slash onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ ...POP, ...anchoredStyle(anchor, 290, { maxHeight: 380 }), padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 머리 — **본문에 친 글자**를 그대로 되비친다(입력칸이 아니다). 글은 본문에
            들어가고 목록은 그것으로 좁혀지므로, 여기서 한 번 더 받을 이유가 없다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 11px', borderBottom: '1px solid var(--mf-border-soft)' }}>
          <span aria-hidden="true" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, fontWeight: 700, color: 'var(--mf-subtext)' }}>
            /
          </span>
          <span data-note-slash-q style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: query ? 'var(--mf-text)' : 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {query || '이어서 이름을 치면 좁혀져요'}
          </span>
          <span style={POP_KEY}>Esc</span>
        </div>
        <div className="lnb-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 7, maxHeight: 300, overflowY: 'auto' }}>
          {groups.map((g) =>
            g.items.length === 0 ? null : (
              <div key={g.name || 'hits'} style={{ display: 'contents' }}>
                {g.name && <span style={POP_HEAD}>{g.name}</span>}
                {g.items.map((t) => (
                  <button
                    key={t.kind}
                    type="button"
                    data-note-slash-item={t.kind}
                    className="btn mf-note-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(t.kind)}
                    aria-selected={flat[cursor]?.kind === t.kind}
                    style={{ ...MENU_ITEM, height: 'auto', padding: '6px 9px', gap: 10, background: flat[cursor]?.kind === t.kind ? 'var(--mf-note-hover)' : 'transparent' }}
                  >
                    {/* 아이콘 **타일** — 디자인은 28×28 면 위에 글리프를 얹는다(글자 옆의
                        맨 아이콘보다 줄이 또렷하게 나뉜다). */}
                    <span aria-hidden="true" style={{ width: 28, height: 28, flex: '0 0 auto', borderRadius: 8, background: 'var(--mf-note-hover)', color: 'var(--mf-subtext)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        {t.icon}
                      </svg>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)' }}>{t.name}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            ),
          )}
          {hits.length === 0 && <span style={{ padding: '14px 9px', fontSize: 12, color: 'var(--mf-faint)' }}>맞는 블록이 없어요</span>}
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
  background: 'transparent',
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
