/**
 * 로그인 화면 오른쪽 미리보기의 장면 데이터 — 디자인 원본의 `scene()`을 그대로
 * 옮긴 순수 데이터다(세 보기를 4.2초마다 번갈아 보여 준다). 화면을 만들지 않고
 * 값만 돌려주므로 DOM·React를 모른다.
 */

export type AuthSceneKey = 'mind' | 'board' | 'kanban';

export interface SceneBox {
  l: string;
  t: string;
  w: string;
  h: string;
  align: string;
  justify: string;
  pad: string;
  r: string;
  bg: string;
  border: string;
  shadow: string;
  color: string;
  fs: string;
  fw: number;
  wrap: 'nowrap' | 'normal';
  text: string;
}

export interface SceneEdge {
  d: string;
  delay: string;
}

export interface AuthScene {
  /** 창 제목 줄(등폭) */
  title: string;
  /** 아래쪽 설명 — "누가 방금 무엇을 했는지" */
  caption: string;
  pin: [string, string];
  pinText: string;
  cursor: [string, string];
  edges: SceneEdge[];
  items: SceneBox[];
}

const BOX: Omit<SceneBox, 'l' | 't' | 'w' | 'h'> = {
  align: 'center',
  justify: 'flex-start',
  pad: '0 13px',
  r: '11px',
  bg: '#FFFDFB',
  border: '1px solid #EADFD4',
  shadow: '0 10px 20px -16px rgba(46,42,38,.5)',
  color: '#3A352F',
  fs: '12.5px',
  fw: 600,
  wrap: 'nowrap',
  text: '',
};

function box(l: number, t: number, w: number, h: number, o: Partial<SceneBox> = {}): SceneBox {
  return { ...BOX, l: `${l}%`, t: `${t}%`, w: `${w}%`, h: `${h}%`, ...o };
}

type NoteTone = 'y' | 'p' | 'g' | 'w';
const NOTE_BG: Record<NoteTone, string> = { y: '#FCF4C9', p: '#FBDCD5', g: '#E4F1E8', w: '#FFFDFB' };
const NOTE_BD: Record<NoteTone, string> = { y: '#EEDD8F', p: '#F0BEB1', g: '#C2DCBE', w: '#EADFD4' };
const NOTE_FG: Record<NoteTone, string> = { y: '#7A6A35', p: '#8A5442', g: '#43714F', w: '#3A352F' };

function note(l: number, t: number, w: number, h: number, text: string, tone: NoteTone): SceneBox {
  return box(l, t, w, h, {
    text,
    align: 'flex-start',
    pad: '10px 11px',
    r: '12px',
    fs: '11.5px',
    wrap: 'normal',
    bg: NOTE_BG[tone],
    border: `1px solid ${NOTE_BD[tone]}`,
    color: NOTE_FG[tone],
    shadow: '0 14px 26px -20px rgba(46,42,38,.55)',
  });
}

/** 칸반 열 하나 — [열 배경][열 제목][카드들]. `urgent`면 카드 테두리가 코럴 계열. */
function column(l: number, title: string, cards: { text: string; urgent?: boolean }[]): SceneBox[] {
  const out = [
    box(l, 6, 28, 88, { text: '', bg: '#FDFAF7', border: '1px solid #EFE4DA', shadow: 'none', r: '13px' }),
    box(l + 2, 10, 24, 8, { text: title, bg: 'transparent', border: '0', shadow: 'none', fs: '10.5px', fw: 800, color: '#8A8078', pad: '0 3px' }),
  ];
  cards.forEach((c, i) => {
    out.push(
      box(l + 2, 21 + i * 21, 24, 17, {
        text: c.text,
        align: 'flex-start',
        pad: '8px 9px',
        fs: '10.5px',
        r: '9px',
        wrap: 'normal',
        border: `1px solid ${c.urgent ? '#F5D9CD' : '#F1E7DE'}`,
        shadow: '0 8px 16px -13px rgba(46,42,38,.5)',
      }),
    );
  });
  return out;
}

const MIND: AuthScene = {
  title: '이번 분기 계획 · 마인드맵',
  caption: '지수님이 방금 가지를 하나 붙였어요',
  pin: ['52%', '31%'],
  pinText: '여기부터 볼게요',
  cursor: ['12%', '68%'],
  edges: [
    { d: 'M32 50 C39 50, 39 21, 46 21', delay: '.16s' },
    { d: 'M32 50 C39 50, 39 50, 46 50', delay: '.24s' },
    { d: 'M32 50 C39 50, 39 79, 46 79', delay: '.32s' },
  ],
  items: [
    box(5, 43, 27, 12, {
      text: '이번 분기 목표',
      bg: '#EE6B45',
      border: '1px solid #EE6B45',
      color: '#fff',
      fw: 800,
      fs: '13.5px',
      r: '999px',
      justify: 'center',
      pad: '0 10px',
      shadow: '0 14px 26px -14px rgba(238,107,69,.8)',
    }),
    box(46, 14, 32, 11, { text: '온보딩 다시 그리기' }),
    box(46, 43, 24, 11, { text: '가격 실험' }),
    box(46, 72, 27, 11, { text: '리텐션 지표' }),
    box(6, 6, 30, 20, {
      text: '첫 화면에서 뭘 먼저 보여줄까',
      bg: '#FCF4C9',
      border: '1px solid #EEDD8F',
      color: '#7A6A35',
      fs: '11.5px',
      align: 'flex-start',
      pad: '10px 12px',
      r: '12px',
      wrap: 'normal',
      shadow: '0 14px 26px -20px rgba(46,42,38,.55)',
    }),
  ],
};

const BOARD: AuthScene = {
  title: '문제 정의 워크숍 · 화이트보드',
  caption: '민준님이 메모를 옮겼어요',
  pin: ['62%', '62%'],
  pinText: '이건 투표할까요?',
  cursor: ['78%', '74%'],
  edges: [],
  items: [
    box(4, 8, 44, 84, { text: '', bg: 'rgba(74,143,224,.05)', border: '1.5px dashed #A9C4EA', shadow: 'none', r: '13px' }),
    note(8, 16, 17, 24, '지금 막히는 곳', 'y'),
    note(28, 14, 17, 22, '문의 3건', 'y'),
    note(8, 46, 17, 22, '온보딩 이탈', 'p'),
    note(28, 42, 17, 26, '가격표 혼동', 'p'),
    note(14, 74, 24, 15, '다음 액션 2개', 'g'),
    note(54, 12, 21, 28, '아이디어 스티커', 'w'),
    note(78, 22, 18, 24, '스케치 첨부', 'w'),
  ],
};

const KANBAN: AuthScene = {
  title: '8월 스프린트 · 칸반 보드',
  caption: '카드 2개가 완료로 옮겨졌어요',
  pin: ['36%', '74%'],
  pinText: '이건 다음 주로',
  cursor: ['6%', '83%'],
  edges: [],
  items: [
    ...column(4, '할 일', [{ text: '랜딩 카피 정리' }, { text: '가격 실험 설계', urgent: true }, { text: 'FAQ 보강' }]),
    ...column(36, '진행 중', [{ text: '온보딩 재설계' }, { text: '리텐션 지표' }]),
    ...column(68, '완료', [{ text: '공유 링크 개선' }, { text: '버그 12건' }, { text: '8월 회고' }]),
  ],
};

export const AUTH_SCENES: Record<AuthSceneKey, AuthScene> = { mind: MIND, board: BOARD, kanban: KANBAN };

/** 칩 순서 = 회전 순서. 색은 홈 카드의 문서 종류 색과 같은 계열이다. */
export const AUTH_SCENE_CHIPS: { key: AuthSceneKey; name: string; dot: string }[] = [
  { key: 'mind', name: '마인드맵', dot: '#4A8FE0' },
  { key: 'board', name: '화이트보드', dot: '#EE6B45' },
  { key: 'kanban', name: '칸반 보드', dot: '#69B08A' },
];
