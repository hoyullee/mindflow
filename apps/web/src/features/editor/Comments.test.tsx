import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import { LocalDocStore } from '../../adapters/local/localDocStore';
import type { Backend, DocStore, ShareStore } from '../../adapters/ports';
import { setLinearSelection } from './richtextDom';

// 댓글(0020) — 주제에 붙는 논의. 본문이 아니라 별도 저장소(`CommentStore`)에 산다.
// 로컬/데모 어댑터가 Supabase와 같은 포트를 구현하므로 흐름은 여기서 그대로 검증된다.

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트 주제', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '자식 주제', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  // 캔버스의 댓글은 **댓글 핀**에만 붙는다(요청) — 대부분의 테스트가 이 핀을 눌러 연다.
  commentPins: [{ id: 'p1', x: 60, y: 60 }],
  layoutMode: 'right',
  themeKey: 'coral',
};

const MY_EMAIL = 'me@example.com';

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 핀을 눌러 그 자리의 논의를 연다 — 캔버스 댓글의 유일한 진입점(요청).
 * 키보드 활성화를 쓰는 이유는 jsdom에 포인터 캡처가 없어서다(동작은 같은 경로). */
async function openCommentsOnPin(pinId = 'p1'): Promise<HTMLElement> {
  const pin = await waitFor(() => {
    const el = document.querySelector(`[data-comment-pin="${pinId}"]`) as HTMLElement;
    expect(el).toBeTruthy();
    return el;
  });
  fireEvent.keyDown(pin, { key: 'Enter' });
  return await screen.findByLabelText('댓글');
}

function seedComment(documentId: string, nodeId: string, body: string, extra?: Record<string, unknown>): void {
  const list = JSON.parse(localStorage.getItem('mf_comments') || '[]') as unknown[];
  list.push({ id: `c${list.length + 1}`, documentId, nodeId, authorName: '나', body, createdAt: new Date().toISOString(), ...extra });
  localStorage.setItem('mf_comments', JSON.stringify(list));
}

function storedComments(): { id: string; nodeId: string; parentId?: string | null; body: string; resolvedAt?: string | null; mentions?: { email: string; name: string }[] }[] {
  return JSON.parse(localStorage.getItem('mf_comments') || '[]');
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: MY_EMAIL } }));
});
afterEach(() => cleanup());

describe('주제 댓글', () => {
  it('보기 메뉴에서 열어 댓글을 남기면 목록에 뜨고 저장된다', async () => {
    localStorage.setItem('mindflow_doc_cm1', JSON.stringify(DOC));
    renderEditor('/editor?map=cm1&title=x');
    const panel = await openCommentsOnPin();
    // 핀에는 이름이 없다 — 예전 폴백 문구("사라진 대상")를 지어내지 않는다(제보).
    expect(within(panel).queryByText('사라진 대상')).toBeNull();
    expect(within(panel).getByText(/아직 댓글이 없어요/)).toBeTruthy();

    fireEvent.change(within(panel).getByLabelText('댓글 입력'), { target: { value: '여기 정리가 필요해요' } });
    fireEvent.click(within(panel).getByRole('button', { name: '남기기' }));

    await waitFor(() => expect(within(panel).getByText('여기 정리가 필요해요')).toBeTruthy());
    const stored = JSON.parse(localStorage.getItem('mf_comments') || '[]') as { documentId: string; nodeId: string; body: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ documentId: 'cm1', nodeId: 'p1', body: '여기 정리가 필요해요' });
  });

  it('내 댓글은 지울 수 있다', async () => {
    localStorage.setItem('mindflow_doc_cm2', JSON.stringify(DOC));
    seedComment('cm2', 'p1', '지울 댓글');
    renderEditor('/editor?map=cm2&title=x');
    const panel = await openCommentsOnPin();
    await waitFor(() => expect(within(panel).getByText('지울 댓글')).toBeTruthy());
    fireEvent.click(within(panel).getByRole('button', { name: '댓글 삭제' }));
    await waitFor(() => expect(within(panel).queryByText('지울 댓글')).toBeNull());
    expect(JSON.parse(localStorage.getItem('mf_comments') || '[]')).toHaveLength(0);
  });

  it('핀에 댓글 수가 붙고, 눌러서 그 자리의 논의를 연다', async () => {
    localStorage.setItem('mindflow_doc_cm3', JSON.stringify(DOC));
    seedComment('cm3', 'p1', '핀에 남긴 말');
    seedComment('cm3', 'p1', '하나 더');
    renderEditor('/editor?map=cm3&title=x');
    const pin = await screen.findByLabelText('댓글 2개');
    expect(pin.getAttribute('data-comment-pin')).toBe('p1');
    expect(pin.querySelector('[data-pin-count]')!.textContent).toBe('2');

    fireEvent.keyDown(pin, { key: 'Enter' });
    const panel = await screen.findByLabelText('댓글');
    expect(within(panel).getByText('핀에 남긴 말')).toBeTruthy();
  });

  it('답글이 스레드 아래에 달리고 parentId로 저장된다', async () => {
    localStorage.setItem('mindflow_doc_cm5', JSON.stringify(DOC));
    seedComment('cm5', 'p1', '뿌리 댓글');
    renderEditor('/editor?map=cm5&title=x');
    const panel = await openCommentsOnPin();
    await waitFor(() => expect(within(panel).getByText('뿌리 댓글')).toBeTruthy());

    fireEvent.click(within(panel).getByRole('button', { name: '답글' }));
    const replyBox = within(panel).getByLabelText('답글 입력');
    fireEvent.change(replyBox, { target: { value: '답글이에요' } });
    fireEvent.keyDown(replyBox, { key: 'Enter', ctrlKey: true }); // 등록 = Ctrl+Enter

    await waitFor(() => expect(within(panel).getByText('답글이에요')).toBeTruthy());
    const stored = storedComments();
    expect(stored).toHaveLength(2);
    expect(stored[1]!.parentId).toBe(stored[0]!.id);
  });

  // 해결 기능은 걷어냈다(요청: 해결 대신 좋아요). 스레드는 하나의 목록이고,
  // 공감은 좋아요 수로 남는다 — 서버 컬럼(0021)은 그대로 두되 UI에서 사라진다.
  it('해결 버튼은 없고, 좋아요를 누르면 수가 오르고 다시 누르면 내린다', async () => {
    localStorage.setItem('mindflow_doc_cmlike', JSON.stringify(DOC));
    seedComment('cmlike', 'p1', '좋아요 대상');
    renderEditor('/editor?map=cmlike&title=x');
    const panel = await openCommentsOnPin();
    await waitFor(() => expect(within(panel).getByText('좋아요 대상')).toBeTruthy());

    expect(screen.queryByTitle('해결됨으로 표시')).toBeNull();
    const like = await waitFor(() => {
      const el = document.querySelector('[data-like-button]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(like.getAttribute('aria-pressed')).toBe('false');
    expect(like.textContent).toContain('0');

    fireEvent.click(like);
    await waitFor(() => expect((document.querySelector('[data-like-button]') as HTMLElement).getAttribute('aria-pressed')).toBe('true'));
    expect((document.querySelector('[data-like-button]') as HTMLElement).textContent).toContain('1');

    fireEvent.click(document.querySelector('[data-like-button]') as HTMLElement);
    await waitFor(() => expect((document.querySelector('[data-like-button]') as HTMLElement).getAttribute('aria-pressed')).toBe('false'));
  });

  it('핀이 아닌 객체에는 댓글 진입점이 없다 — 배지도 메뉴 항목도(요청)', async () => {
    const doc = { ...DOC, floats: [{ id: 'fm1', x: -300, y: 40, w: 180, text: '주간 회고 메모' }] };
    localStorage.setItem('mindflow_doc_cm12', JSON.stringify(doc));
    // 옛 데이터: 메모에 달려 있던 댓글. 배지도 진입점도 만들지 않는다.
    seedComment('cm12', 'fm1', '옛 메모 댓글');
    renderEditor('/editor?map=cm12&title=x');
    await waitFor(() => expect(document.querySelector('[data-float-id="fm1"]')).toBeTruthy());
    expect(document.querySelector('[data-comment-badge]')).toBeNull();

    // 보기 메뉴에도 "댓글"이 없다 — 대상 없이 여는 항목은 뜻이 없다(핀이 대상이다).
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(screen.queryByRole('button', { name: '댓글' })).toBeNull();
  });

  it('@ 입력에 참가자 자동완성이 뜨고, 고르면 멘션이 저장·강조된다', async () => {
    localStorage.setItem('mindflow_doc_cm7', JSON.stringify(DOC));
    // 멘션 후보 = 공유 참가자(소유자 + 초대). 초대 한 명을 심는다.
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm7', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm7&title=x');
    const panel = await openCommentsOnPin();

    const box = within(panel).getByLabelText('댓글 입력') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@fri', selectionStart: 4 } });
    const candidate = await within(panel).findByText('friend@example.com');
    fireEvent.mouseDown(candidate.closest('button')!);
    await waitFor(() => expect(box.value).toContain('@friend'));

    fireEvent.change(box, { target: { value: box.value + ' 확인 부탁해요' } });
    fireEvent.click(within(panel).getByRole('button', { name: '남기기' }));
    await waitFor(() => expect(storedComments()).toHaveLength(1));
    expect(storedComments()[0]!.mentions).toEqual([{ email: 'friend@example.com', name: 'friend' }]);
    // 본문에서 멘션만 강조된다.
    const mark = panel.querySelector('[data-mention]')!;
    expect(mark.textContent).toBe('@friend');
  });

  it('작성 중에도 멘션이 강조된다 — 백드롭 오버레이(요청), 이름이 깨지면 해제', async () => {
    localStorage.setItem('mindflow_doc_cm11', JSON.stringify(DOC));
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm11', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm11&title=x');
    const panel = await openCommentsOnPin();

    const box = within(panel).getByLabelText('댓글 입력') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@fri', selectionStart: 4 } });
    const candidate = await within(panel).findByText('friend@example.com');
    fireEvent.mouseDown(candidate.closest('button')!);
    await waitFor(() => expect(box.value).toContain('@friend'));

    // 제출 전인데도 오버레이가 멘션 구간만 강조해 그린다.
    const overlay = panel.querySelector('[data-mention-overlay]')!;
    const mark = overlay.querySelector('[data-mention-draft]')!;
    expect(mark.textContent).toBe('@friend');
    // 강조는 캐럿과 어긋나지 않게 색·배경뿐 — 굵게(폭 변화)는 쓰지 않는다.
    expect((mark as HTMLElement).style.fontWeight).toBe('');
    // textarea 글자는 백드롭이 대신 그린다(이중 렌더 방지) + 캐럿은 남긴다.
    expect(box.style.color).toBe('transparent');
    expect(box.style.caretColor).not.toBe('');

    // 이름 글자를 지워 "@frien"이 되면 멘션이 아니다 — 강조도 함께 사라진다
    // (제출 시 멘션 목록에서 빠지는 것과 같은 규칙).
    fireEvent.change(box, { target: { value: box.value.replace('@friend', '@frien'), selectionStart: 6 } });
    await waitFor(() => expect(panel.querySelector('[data-mention-draft]')).toBeNull());
  });

  it('멘션 후보에 나 자신은 없다 — 멘션은 남을 부르는 도구다(제보)', async () => {
    localStorage.setItem('mindflow_doc_cm10', JSON.stringify(DOC));
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm10', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm10&title=x');
    const panel = await openCommentsOnPin();

    const box = within(panel).getByLabelText('댓글 입력') as HTMLTextAreaElement;
    // 질의 없는 맨 '@' — 전체 후보가 나온다. 참가자는 소유자(나=me@example.com)와
    // 초대(friend) 둘인데, 나는 걸러져 friend만 남아야 한다.
    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } });
    await within(panel).findByText('friend@example.com');
    expect(within(panel).queryByText(MY_EMAIL)).toBeNull();
  });

  it('댓글 멘션 리스트: ↑/↓로 항목을 이동하고 Enter로 활성 후보를 고른다(요청)', async () => {
    localStorage.setItem('mindflow_doc_cm15', JSON.stringify(DOC));
    localStorage.setItem(
      'mf_doc_shares',
      JSON.stringify([
        { documentId: 'cm15', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' },
        { documentId: 'cm15', email: 'buddy@example.com', role: 'edit', createdAt: '2026-01-02T00:00:00.000Z' },
      ]),
    );
    renderEditor('/editor?map=cm15&title=x');
    const panel = await openCommentsOnPin();

    const box = within(panel).getByLabelText('댓글 입력') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } });
    await waitFor(() => expect(panel.querySelectorAll('[data-mention-candidate]')).toHaveLength(2));

    // 첫 행이 활성으로 뜨고, ↑는 마지막으로 순환·↓는 다음으로(캔버스 리스트와 동일).
    const activeEmail = (): string | null => panel.querySelector('[data-mention-candidate][data-active]')?.getAttribute('data-mention-candidate') ?? null;
    expect(activeEmail()).toBe('friend@example.com');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    await waitFor(() => expect(activeEmail()).toBe('buddy@example.com'));
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    await waitFor(() => expect(activeEmail()).toBe('friend@example.com'));
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    await waitFor(() => expect(activeEmail()).toBe('buddy@example.com'));

    // Enter = **활성** 후보 선택(예전엔 항상 첫 후보였다) — 리스트는 닫힌다.
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(box.value).toContain('@buddy '));
    expect(box.value).not.toContain('@friend');
    expect(panel.querySelector('[data-mention-candidate]')).toBeNull();
  });

  it('캔버스 인라인 멘션: 후보를 고르면 도형 박스가 그 자리에서 다시 측정돼 커진다(제보)', async () => {
    localStorage.setItem('mindflow_doc_cm13', JSON.stringify(DOC));
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm13', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    const { container } = renderEditor('/editor?map=cm13&title=x');

    const nodeBox = await waitFor(() => {
      const el = container.querySelector('[data-node-id="c1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.doubleClick(nodeBox);
    const editor = container.querySelector('.mf-richedit') as HTMLDivElement;
    expect(editor).toBeTruthy();

    // 내용을 "@f"로 바꾸고 캐럿을 끝에 — 멘션 토큰 감지(selectionchange/input).
    editor.textContent = '@f';
    fireEvent.input(editor);
    setLinearSelection(editor, 2, 2);
    fireEvent(document, new Event('selectionchange'));
    const pick = await waitFor(() => {
      const b = document.querySelector('[data-mention-pick="friend@example.com"]') as HTMLElement;
      expect(b).toBeTruthy();
      return b;
    });

    // "@f"(2자) 기준 박스 폭 — 멘션을 고르면 "@friend "(8자)로 길어지므로
    // 박스가 곧바로 커져야 한다. 예전엔 다시 그리기만 하고 재측정을 안 태워
    // 텍스트가 도형을 벗어났다(제보 스크린샷).
    const widthOf = (): number => parseFloat((container.querySelector('[data-node-id="c1"]') as HTMLElement).style.width || '0');
    const before = widthOf();
    fireEvent.mouseDown(pick);
    expect(editor.textContent).toContain('@friend');
    await waitFor(() => expect(widthOf()).toBeGreaterThan(before));
  });

  it('캔버스 멘션 리스트: ↑/↓로 항목을 이동하고 Enter로 선택한다(요청) — Enter가 편집을 확정하지 않는다', async () => {
    localStorage.setItem('mindflow_doc_cm14', JSON.stringify(DOC));
    localStorage.setItem(
      'mf_doc_shares',
      JSON.stringify([
        { documentId: 'cm14', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' },
        { documentId: 'cm14', email: 'buddy@example.com', role: 'edit', createdAt: '2026-01-02T00:00:00.000Z' },
      ]),
    );
    const { container } = renderEditor('/editor?map=cm14&title=x');

    const nodeBox = await waitFor(() => {
      const el = container.querySelector('[data-node-id="c1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.doubleClick(nodeBox);
    const editor = container.querySelector('.mf-richedit') as HTMLDivElement;
    editor.textContent = '@';
    fireEvent.input(editor);
    setLinearSelection(editor, 1, 1);
    fireEvent(document, new Event('selectionchange'));
    await waitFor(() => expect(document.querySelectorAll('[data-mention-pick]')).toHaveLength(2));

    // 처음엔 첫 항목이 활성 — ↓로 다음 항목으로 이동한다(끝에서는 처음으로 순환).
    const activeEmail = (): string | null => document.querySelector('[data-mention-pick][data-active]')?.getAttribute('data-mention-pick') ?? null;
    expect(activeEmail()).toBe('friend@example.com');
    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    await waitFor(() => expect(activeEmail()).toBe('buddy@example.com'));
    fireEvent.keyDown(editor, { key: 'ArrowUp' });
    await waitFor(() => expect(activeEmail()).toBe('friend@example.com'));
    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    await waitFor(() => expect(activeEmail()).toBe('buddy@example.com'));

    // Enter = 활성 항목 선택 — 멘션이 들어가고 **편집 세션은 그대로**다
    // (가로채지 않으면 Enter가 편집 확정으로 새어 리스트만 닫힌다).
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(editor.textContent).toContain('@buddy'));
    expect(container.querySelector('.mf-richedit')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-mention-suggest]')).toBeNull());
  });

  it('실시간: 다른 곳(다른 탭)의 댓글이 신호를 타고 즉시 나타난다 — 공유된 문서', async () => {
    localStorage.setItem('mindflow_doc_cm8', JSON.stringify(DOC));
    // 실시간 구독은 공유된 문서에서만(혼자 쓰는 문서에는 신호를 보낼 상대가 없다).
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm8', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm8&title=x');
    const panel = await openCommentsOnPin();
    await waitFor(() => expect(within(panel).getByText(/아직 댓글이 없어요/)).toBeTruthy());

    // 다른 탭의 저장소 인스턴스가 댓글을 단다 — BroadcastChannel 신호로 이 화면이
    // 스스로 다시 읽어야 한다(패널을 닫았다 열지 않아도).
    const other = new LocalCommentStore();
    await waitFor(async () => {
      // 구독 effect가 붙기 전의 add는 신호가 유실될 수 있어, 붙을 때까지 재시도.
      if (storedComments().length === 0) await other.add('cm8', 'p1', '옆 탭에서 단 댓글');
      expect(within(panel).getByText('옆 탭에서 단 댓글')).toBeTruthy();
    });
  });

  // 노드 우클릭 진입점은 좌표 히트테스트가 필요해 ContextMenu.interactions.test.tsx에서 검증.

  it('알림 딥링크(?comments=<id>)로 열면 그 핀의 댓글 패널이 바로 뜬다', async () => {
    localStorage.setItem('mindflow_doc_cmd1', JSON.stringify(DOC));
    seedComment('cmd1', 'p1', '딥링크 대상 논의');
    renderEditor('/editor?map=cmd1&title=x&comments=p1');
    const panel = await screen.findByLabelText('댓글');
    await waitFor(() => expect(within(panel).getByText('딥링크 대상 논의')).toBeTruthy());
  });

});

/**
 * 링크 공유(0017)로 연 사람에게는 서버가 댓글을 아예 내주지 않는다(0020의 select
 * 정책 — 링크는 누구에게나 전달될 수 있는데 댓글은 내부 논의다). "열리는 척하다 빈
 * 목록"이 되지 않게 진입점부터 감춘다.
 */
describe('링크로 연 맵', () => {
  function linkViewerBackend(): Backend {
    const local = new LocalDocStore();
    const docStore = {
      ...local,
      list: () => local.list(),
      loadPreview: (id: string) => local.loadPreview(id),
      save: (...a: Parameters<DocStore['save']>) => local.save(...a),
      remove: (id: string) => local.remove(id),
      restore: (id: string) => local.restore(id),
      purge: (id: string) => local.purge(id),
      rename: (id: string, t: string) => local.rename(id, t),
      listEditorNames: () => local.listEditorNames(),
      load: vi.fn(async (id: string) => {
        const res = await local.load(id);
        return res ? { ...res, ownedByMe: false } : null;
      }),
    } as unknown as DocStore;
    // 링크로 들어온 사람에게는 초대 행이 하나도 보이지 않는다(RLS의 결).
    // 인스턴스 스프레드는 프로토타입 메서드를 잃는다 — 덮어쓸 것만 갈아 끼운다.
    const shareStore = Object.assign(new LocalShareStore(), { list: async () => [] }) as unknown as ShareStore;
    return { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore, feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'supabase' };
  }

  it('보기 메뉴에 댓글 항목이 없고, 남의 댓글 배지도 뜨지 않는다', async () => {
    localStorage.setItem('mindflow_doc_lk9', JSON.stringify(DOC));
    seedComment('lk9', 'c1', '보이면 안 되는 말');
    render(
      <MemoryRouter initialEntries={['/editor?map=lk9&title=x']}>
        <BackendProvider backend={linkViewerBackend()}>
          <Routes>
            <Route path="/editor" element={<Editor />} />
            <Route path="/home" element={<div>HOME_PAGE</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText('보기 전용').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(screen.queryByRole('button', { name: '댓글' })).toBeNull();
    await waitFor(() => expect(screen.queryByLabelText('댓글 1개')).toBeNull());
  });
});

// 요청: 댓글을 "객체에 다는 것"이 아니라 **캔버스에 꽂는 객체**로(Figma 방식).
// 핀은 자리만 들고(`Doc.commentPins`) 말은 지금 표에 그 핀 id를 대상으로 저장된다 —
// 서버는 한 줄도 바뀌지 않는다.
describe('댓글 핀(캔버스 객체)', () => {
  const BOARD = { ...DOC, kind: 'board', nodes: {}, commentPins: [] };

  /** 화이트보드 하단 도구 막대의 댓글 버튼 → 캔버스 클릭. */
  async function placeDraft(container: HTMLElement, at = { clientX: 300, clientY: 240 }): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { name: '댓글 추가' }));
    const layer = await waitFor(() => {
      const el = container.querySelector('[data-comment-tool-layer]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.pointerDown(layer, { button: 0, ...at });
    return await waitFor(() => {
      const el = container.querySelector('[data-comment-draft]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
  }

  it('도구로 누른 자리에 말풍선만 뜨고, 첫 댓글이 저장돼야 핀이 생긴다(요청)', async () => {
    localStorage.setItem('mindflow_doc_pin1', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=pin1&title=x');
    const draft = await placeDraft(container);

    // 아직 문서에는 아무것도 없다 — "빈 핀"이라는 상태 자체가 생기지 않는다.
    expect(container.querySelector('[data-comment-pin]')).toBeNull();
    expect(JSON.parse(localStorage.getItem('mindflow_doc_pin1')!).commentPins ?? []).toHaveLength(0);

    const box = within(draft).getByLabelText('댓글 입력');
    fireEvent.change(box, { target: { value: '여기 정리해요' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });

    const pin = await waitFor(() => {
      const el = container.querySelector('[data-comment-pin]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    await waitFor(() => expect((container.querySelector('[data-pin-count]') as HTMLElement)?.textContent).toBe('1'));
    expect(storedComments()).toHaveLength(1);
    expect(storedComments()[0]!.nodeId).toBe(pin.getAttribute('data-comment-pin'));
    // 말풍선은 사라지고 그 핀의 논의가 열린다.
    expect(container.querySelector('[data-comment-draft]')).toBeNull();
    expect(screen.getByLabelText('댓글')).toBeTruthy();
  });

  it('첫 댓글을 쓰지 않고 다른 곳을 누르면 말풍선은 흔적 없이 사라진다(요청)', async () => {
    localStorage.setItem('mindflow_doc_pin2', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=pin2&title=x');
    await placeDraft(container);

    fireEvent.pointerDown(container.querySelector('.mf-ed-vp') as HTMLElement, { button: 0, clientX: 80, clientY: 80 });
    await waitFor(() => expect(container.querySelector('[data-comment-draft]')).toBeNull());
    expect(container.querySelector('[data-comment-pin]')).toBeNull();
    expect(storedComments()).toHaveLength(0);
  });

  // 제보: "댓글을 작성했을 때 저장이 안 된다". 실제로는 저장된 댓글의 **자리**가
  // 사라진 것이었다 — 빈 핀을 정리하던 효과가 목록이 도착하기 전(문서 로드 직후,
  // `comments`가 아직 빈 배열인 순간)에 멀쩡한 핀을 지웠다.
  it('저장된 댓글이 있는 핀은 문서를 다시 열어도 그대로 있다(제보 회귀)', async () => {
    localStorage.setItem('mindflow_doc_pin3', JSON.stringify(DOC));
    seedComment('pin3', 'p1', '지난번에 남긴 말');
    const { container } = renderEditor('/editor?map=pin3&title=x');
    await waitFor(() => expect(container.querySelector('[data-comment-pin="p1"]')).toBeTruthy());
    // 목록이 도착한 뒤에도(개수가 붙은 뒤) 여전히 살아 있다.
    await waitFor(() => expect((container.querySelector('[data-pin-count]') as HTMLElement)?.textContent).toBe('1'));
    expect(container.querySelector('[data-comment-pin="p1"]')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('mindflow_doc_pin3')!).commentPins).toHaveLength(1);
  });

  it('마지막 댓글을 지우면 핀도 함께 사라진다(핀은 논의의 자리다)', async () => {
    localStorage.setItem('mindflow_doc_pin4', JSON.stringify(DOC));
    seedComment('pin4', 'p1', '유일한 댓글');
    const { container } = renderEditor('/editor?map=pin4&title=x');
    const panel = await openCommentsOnPin();
    await waitFor(() => expect(within(panel).getByText('유일한 댓글')).toBeTruthy());

    fireEvent.click(within(panel).getByRole('button', { name: '댓글 삭제' }));
    await waitFor(() => expect(container.querySelector('[data-comment-pin]')).toBeNull());
  });
});
