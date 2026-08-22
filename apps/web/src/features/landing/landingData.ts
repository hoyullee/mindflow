/**
 * 랜딩 v2의 글·데이터 — 디자인 원본(`Geurio 랜딩 리뉴얼 v2.dc.html`)의
 * `renderVals()`에서 옮긴 값이고, 문구는 더 친근하게 다듬었다.
 *
 * ⚠️ 정적 쌍둥이(`public/landing.html`)와 **같은 문구**여야 한다 — 크롤러가 보는
 * 것은 그쪽이다. 테스트(`Landing.test.tsx`)가 주요 문구의 동기화를 지킨다.
 */

export const CORAL = '#EE6B45';
export const BLUE = '#4A8FE0';
export const GREEN = '#69B08A';

/** 히어로 오른쪽 창의 보기 탭 = 회전 순서. */
export const HERO_TABS: { key: HeroSceneKey; name: string; dot: string }[] = [
  { key: 'mind', name: '마인드맵', dot: BLUE },
  { key: 'board', name: '화이트보드', dot: CORAL },
  { key: 'kanban', name: '칸반 보드', dot: GREEN },
];

export type HeroSceneKey = 'mind' | 'board' | 'kanban';

export interface HeroBox {
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
  text: string;
}

export interface HeroEdge {
  d: string;
  stroke: string;
  delay: string;
}

export interface HeroScene {
  file: string;
  caption: string;
  hint: string;
  pin: [string, string];
  pinText: string;
  edges: HeroEdge[];
  items: HeroBox[];
}

const BASE: Omit<HeroBox, 'l' | 't' | 'w' | 'h'> = {
  align: 'center',
  justify: 'flex-start',
  pad: '0 10px',
  r: '10px',
  bg: '#FFFDFB',
  border: '1px solid #EADFD4',
  shadow: '0 8px 18px -14px rgba(46,42,38,.5)',
  color: '#3A352F',
  fs: '11.5px',
  fw: 600,
  text: '',
};

function box(l: number, t: number, w: number, h: number, o: Partial<HeroBox> = {}): HeroBox {
  return { ...BASE, l: `${l}%`, t: `${t}%`, w: `${w}%`, h: `${h}%`, ...o };
}

type Tone = 'y' | 'p' | 'g' | 'w';
const TONE_BG: Record<Tone, string> = { y: '#FCF4C9', p: '#FBDCD5', g: '#E4F1E8', w: '#FFFDFB' };
const TONE_BD: Record<Tone, string> = { y: '#EEDD8F', p: '#F0BEB1', g: '#C2DCBE', w: '#EADFD4' };

function note(l: number, t: number, w: number, h: number, text: string, tone: Tone): HeroBox {
  return box(l, t, w, h, {
    text,
    align: 'flex-start',
    pad: '9px 10px',
    r: '11px',
    fs: '11px',
    bg: TONE_BG[tone],
    border: `1px solid ${TONE_BD[tone]}`,
    shadow: '0 10px 20px -14px rgba(46,42,38,.5)',
  });
}

function column(l: number, title: string, cards: { text: string; urgent?: boolean }[]): HeroBox[] {
  const out = [
    box(l, 6, 27, 88, { text: '', bg: '#FDFAF7', border: '1px solid #EFE4DA', shadow: 'none', r: '13px' }),
    box(l + 2, 10, 23, 9, { text: title, bg: 'transparent', border: '0', shadow: 'none', fs: '10.5px', fw: 800, color: '#8A8078', pad: '0 4px' }),
  ];
  cards.forEach((c, i) =>
    out.push(
      box(l + 2, 22 + i * 20, 23, 17, {
        text: c.text,
        align: 'flex-start',
        pad: '8px 9px',
        fs: '10.5px',
        r: '9px',
        border: `1px solid ${c.urgent ? '#F5D9CD' : '#F1E7DE'}`,
        shadow: '0 8px 16px -13px rgba(46,42,38,.5)',
      }),
    ),
  );
  return out;
}

export const HERO_SCENES: Record<HeroSceneKey, HeroScene> = {
  mind: {
    file: '신제품 런치 플랜',
    caption: 'Tab 한 번이면 하위 주제가 붙어요',
    hint: 'Tab · Enter',
    pin: ['5%', '84%'],
    pinText: '채널은 3개까지만',
    edges: [
      { d: 'M31 49 C37 49, 37 18, 43 18', stroke: '#E9A98F', delay: '.05s' },
      { d: 'M31 49 C37 49, 37 46, 43 46', stroke: '#E9A98F', delay: '.12s' },
      { d: 'M31 49 C37 49, 37 74, 43 74', stroke: '#E9A98F', delay: '.19s' },
      { d: 'M67 18 C71 18, 71 12, 74 12', stroke: '#DFCDA0', delay: '.3s' },
      { d: 'M67 18 C71 18, 71 28, 74 28', stroke: '#DFCDA0', delay: '.36s' },
      { d: 'M67 74 C71 74, 71 68, 74 68', stroke: '#B9D3BB', delay: '.42s' },
    ],
    items: [
      box(6, 42, 25, 15, { text: '신제품 런치', bg: CORAL, border: `1px solid ${CORAL}`, color: '#fff', fw: 800, fs: '12.5px', r: '99px', justify: 'center', pad: '0 8px' }),
      box(43, 12, 24, 13, { text: '메시지 정리' }),
      box(43, 40, 24, 13, { text: '채널 선정' }),
      box(43, 68, 24, 13, { text: '출시 일정' }),
      box(74, 6, 21, 12, { text: '핵심 문구', bg: '#FCF4C9', border: '1px solid #EEDD8F', fs: '11px' }),
      box(74, 22, 21, 12, { text: '경쟁 비교', bg: '#FCF4C9', border: '1px solid #EEDD8F', fs: '11px' }),
      box(74, 62, 21, 12, { text: 'D-14 티저', bg: '#E4F1E8', border: '1px solid #C2DCBE', fs: '11px' }),
    ],
  },
  board: {
    file: '문제 정의 워크숍',
    caption: '메모를 붙이고 영역으로 묶어요',
    hint: 'drag · frame',
    pin: ['50%', '84%'],
    pinText: '여기 투표할까요?',
    edges: [],
    items: [
      box(5, 8, 40, 84, { text: '', bg: 'rgba(74,143,224,.05)', border: '1.5px dashed #A9C4EA', shadow: 'none', r: '13px' }),
      note(9, 16, 15, 24, '지금 막히는 지점', 'y'),
      note(27, 14, 15, 22, '고객 문의 3건', 'y'),
      note(9, 46, 15, 22, '온보딩 이탈', 'p'),
      note(27, 42, 15, 26, '가격표 혼동', 'p'),
      note(15, 72, 22, 16, '다음 액션 2개', 'g'),
      note(52, 12, 20, 30, '아이디어 스티커', 'w'),
      note(76, 20, 19, 26, '스케치 첨부', 'w'),
      note(56, 56, 24, 22, '투표로 좁히기', 'y'),
    ],
  },
  kanban: {
    file: '8월 스프린트',
    caption: '카드를 옮기면 상태가 바뀌어요',
    hint: 'drag · ⌘D',
    pin: ['37%', '72%'],
    pinText: '이건 다음 주로',
    edges: [],
    items: [
      ...column(5, '할 일', [{ text: '랜딩 카피 정리' }, { text: '가격 실험 설계', urgent: true }, { text: 'FAQ 보강' }]),
      ...column(37, '진행 중', [{ text: '온보딩 재설계' }, { text: '리텐션 지표' }]),
      ...column(69, '완료', [{ text: '공유 링크 개선' }, { text: '버그 12건 정리' }, { text: '8월 회고' }]),
    ],
  },
};

export const HERO_FACTS = ['가입은 30초', '카드 등록 없이', '만든 보드는 언제든 내보내기'];

/** 세 보기 소개 카드 — 미니 그림은 위치·색만 담은 사각형들이다. */
export interface MiniShape {
  l: string;
  t: string;
  w: string;
  h: string;
  bg: string;
  bd: string;
  r: string;
}

const MINI_PAL: Record<string, [string, string]> = {
  n: ['#FBEFB6', '#EEDD8F'],
  g: ['#DDEEDA', '#C2DCBE'],
  p: ['#FBDCD5', '#F0BEB1'],
  b: ['#E7EEFA', '#CFDDF2'],
  w: ['#FFFFFF', '#EADFD4'],
};

function mini(l: number, t: number, w: number, h: number, k: keyof typeof MINI_PAL): MiniShape {
  const pal = MINI_PAL[k]!;
  return { l: `${l}%`, t: `${t}%`, w: `${w}%`, h: `${h}%`, bg: pal[0], bd: pal[1], r: '5px' };
}

export interface ModeCard {
  name: string;
  dot: string;
  wash: string;
  desc: string;
  points: string[];
  shapes: MiniShape[];
}

export const MODE_CARDS: ModeCard[] = [
  {
    name: '마인드맵',
    dot: BLUE,
    wash: '#FCF8F3',
    desc: '중심 주제에서 가지를 뻗으며 생각의 뼈대를 잡아요. 마우스로 손을 옮기지 않고 키보드만으로도 구조가 쭉쭉 넓어져요.',
    points: ['Tab으로 하위 주제, Enter로 형제 주제', '가지를 접어 큰 흐름만 보기', '주제마다 메모와 이미지 붙이기'],
    shapes: [mini(6, 42, 22, 14, 'p'), mini(36, 18, 20, 14, 'w'), mini(36, 42, 20, 14, 'w'), mini(36, 66, 20, 14, 'w'), mini(64, 24, 18, 12, 'n'), mini(64, 60, 18, 12, 'g')],
  },
  {
    name: '화이트보드',
    dot: CORAL,
    wash: '#FCFAF6',
    desc: '정해진 구조 없이 메모와 이미지, 도형을 원하는 자리에 놓아요. 여러 사람이 한꺼번에 의견을 쏟아내는 워크숍이나 회고에 잘 맞아요.',
    points: ['관련 있는 메모는 영역으로 묶기', '펜으로 그리고 이미지 붙이기', '핀 하나로 그 자리에서 이야기하기'],
    shapes: [mini(8, 14, 28, 34, 'n'), mini(42, 20, 26, 30, 'n'), mini(14, 56, 32, 26, 'w'), mini(56, 58, 30, 24, 'g'), mini(74, 16, 18, 26, 'p')],
  },
  {
    name: '칸반 보드',
    dot: GREEN,
    wash: '#FBFAF7',
    desc: '할 일을 열로 나눠 두고 카드를 옮기며 진행 상황을 봐요. 카드를 열면 담당자와 기한, 주고받은 이야기가 한 화면에 모여요.',
    points: ['드래그로 상태 옮기기', '급한 카드는 테두리로 표시', '카드마다 댓글과 기록'],
    shapes: [mini(6, 10, 20, 76, 'w'), mini(30, 10, 20, 52, 'n'), mini(54, 10, 20, 64, 'g'), mini(78, 10, 16, 38, 'b')],
  },
];

export interface CollabPoint {
  title: string;
  body: string;
  iconBg: string;
  iconFg: string;
  /** SVG path 문자열(선 아이콘) */
  icon: string;
}

export const COLLAB_POINTS: CollabPoint[] = [
  { title: '누가 어디를 보는지', body: '함께 있는 사람의 커서가 이름과 함께 움직여요.', iconBg: '#E9F0FC', iconFg: '#4A78D0', icon: 'M5 3l14 8-6.5 1.6L9.5 19z' },
  { title: '자리를 가리키는 댓글', body: '핀을 꽂은 곳에서 대화가 열려서 무슨 이야기인지 헷갈리지 않아요.', iconBg: '#FBEDE6', iconFg: '#D0562F', icon: 'M20 12a7 7 0 0 1-7 7H9l-5 3 1.3-4.4A7 7 0 1 1 20 12z' },
  { title: '끝난 이야기는 접기', body: '해결 표시를 하면 스레드가 접혀서 보드가 다시 깔끔해져요.', iconBg: '#EAF3EC', iconFg: '#4E8C67', icon: 'm5 13 4.5 4.5L19 7' },
];

export interface Thread {
  who: string;
  when: string;
  text: string;
  bg: string;
  opacity: number;
  resolved: boolean;
}

export const THREADS: Thread[] = [
  { who: '지수', when: '방금', text: '이 채널은 예산을 반으로 줄여도 괜찮을까요?', bg: CORAL, opacity: 1, resolved: false },
  { who: '민준', when: '어제', text: '온보딩 문구는 이대로 확정했습니다.', bg: BLUE, opacity: 0.55, resolved: true },
];

export interface Feature {
  title: string;
  body: string;
  icon: string;
}

export const FEATURES: Feature[] = [
  { title: '문서에 바로 붙이기', body: '이미지나 PDF로 내보내 보고서와 발표 자료에 그대로 써요.', icon: '<path d="M12 4v12M8 12l4 4 4-4M4 20h16"/>' },
  { title: '스페이스로 나누기', body: '팀 작업과 개인 메모를 스페이스로 갈라 두면 서로 섞이지 않아요.', icon: '<rect x="3" y="4" width="7" height="7" rx="2"/><rect x="14" y="4" width="7" height="7" rx="2"/><rect x="3" y="15" width="7" height="5" rx="2"/><rect x="14" y="15" width="7" height="5" rx="2"/>' },
  { title: '빈 화면 대신 템플릿', body: '회고와 우선순위, 스프린트 보드를 골라 바로 채우기 시작해요.', icon: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9h16M9 9v11"/>' },
  { title: '저장은 신경 쓰지 않아도', body: '고친 내용은 자동으로 저장되고, 언제든 이전 상태로 돌아갈 수 있어요.', icon: '<path d="M3 12a9 9 0 1 0 2.6-6.3L3 8"/><path d="M3 3v5h5"/>' },
  { title: '공유는 하되 수정은 막기', body: '링크로 열어 보게 하면서 편집 권한은 따로 정해 둬요.', icon: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  { title: '브라우저에서 바로', body: '따로 설치하거나 확장 프로그램을 깔지 않아도 돼요.', icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>' },
];

export const FAQS: { q: string; a: string }[] = [
  {
    q: '세 가지 보기를 한 보드에서 같이 쓸 수 있나요?',
    a: '보드를 만들 때 보기를 하나 고르고, 같은 스페이스 안에 필요한 만큼 보드를 만들어 나란히 두는 방식이에요. 마인드맵으로 뼈대를 잡고 칸반으로 실행을 옮기는 흐름을 많이 쓰세요.',
  },
  { q: '정말 무료인가요?', a: '지금은 모든 기능을 무료로 쓸 수 있어요. 유료 계획이 생기면 미리 알려 드리고, 이미 만든 보드는 그대로 열 수 있게 할게요.' },
  { q: '팀원은 몇 명까지 초대할 수 있나요?', a: '인원 제한은 없어요. 이메일로 초대하거나 링크를 공유하면 되고, 편집·댓글·보기 권한은 사람마다 따로 정할 수 있어요.' },
  { q: '만든 보드를 밖으로 가져갈 수 있나요?', a: '이미지와 PDF로 내보낼 수 있어요. 실수로 지웠더라도 휴지통에 남아 있어 되살릴 수 있어요.' },
];
