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
import { COMMENT_PIN_W } from './components/commentPinShape';
import { THREAD_BUBBLE_PATH } from './components/commentPinShape';

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

/** 댓글이 붙는 자리는 **댓글 핀** 하나뿐이다(요청 ⑧) — 핀 하나를 심은 문서. */
const PIN_ID = 'p1';
const DOC_WITH_PIN = { ...DOC, commentPins: [{ id: PIN_ID, x: 120, y: 60 }] };

/** 꽂혀 있는 핀을 눌러 그 핀의 댓글 팝업을 연다. */
async function openPinComments(): Promise<HTMLElement> {
  const el = await waitFor(() => {
    const e = document.querySelector(`[data-comment-pin="${PIN_ID}"]`) as HTMLElement;
    expect(e).toBeTruthy();
    return e;
  });
  fireEvent.click(el);
  return await screen.findByLabelText('스레드');
}

/** 배경 우클릭 → '댓글 추가' → 첫 댓글 말풍선. */
async function openDraftViaMenu(container: HTMLElement, clientX = 300, clientY = 240): Promise<HTMLElement> {
  fireEvent.contextMenu(container.querySelector('.mf-ed-vp') as HTMLElement, { clientX, clientY });
  fireEvent.mouseDown(await screen.findByText('스레드 추가'));
  return await screen.findByLabelText('첫 스레드 남기기');
}

/** jsdom에는 PointerEvent가 없다 — MouseEvent로 흉내 낸다(Board.test와 같은 처방).
 * `fireEvent.pointerDown`을 그대로 쓰면 clientX/Y가 실리지 않아 좌표 판정이 깨진다. */
function firePointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup', init: { clientX?: number; clientY?: number; button?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, button: init.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: 1, configurable: true });
  fireEvent(target as Element, event);
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

describe('댓글(핀에 붙는 논의)', () => {
  it('꽂은 자리의 말풍선에 첫 댓글을 남기면 그때 핀이 생기고 저장된다(요청 ④)', async () => {
    localStorage.setItem('mindflow_doc_cm1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=cm1&title=x');
    await waitFor(() => expect(container.querySelector('.mf-ed-vp')).toBeTruthy());

    const bubble = await openDraftViaMenu(container);
    // 아직 핀도, 팝업도 없다 — 말풍선 하나가 첫 마디를 기다린다.
    expect(container.querySelector('[data-comment-pin]')).toBeNull();
    expect(screen.queryByLabelText('스레드')).toBeNull();

    fireEvent.change(within(bubble).getByLabelText('스레드 입력'), { target: { value: '여기 정리가 필요해요' } });
    fireEvent.click(within(bubble).getByRole('button', { name: '남기기' }));

    const pin = await waitFor(() => {
      const el = container.querySelector('[data-comment-pin]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    await waitFor(() => expect(container.querySelector('[data-comment-draft]')).toBeNull());
    const stored = storedComments();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ nodeId: pin.getAttribute('data-comment-pin')!, body: '여기 정리가 필요해요' });
    // 문서에도 그 핀이 들어간다 — 자동저장이 실어 나른다(요청 ①).
    await waitFor(
      () => {
        const now = JSON.parse(localStorage.getItem('mindflow_doc_cm1') || '{}') as { commentPins?: { id: string }[] };
        expect(now.commentPins?.[0]?.id).toBe(pin.getAttribute('data-comment-pin'));
      },
      { timeout: 4000 },
    );
  });

  it('내 댓글은 지울 수 있다', async () => {
    localStorage.setItem('mindflow_doc_cm2', JSON.stringify(DOC_WITH_PIN));
    seedComment('cm2', PIN_ID, '지울 댓글');
    renderEditor('/editor?map=cm2&title=x');
    const panel = await openPinComments();
    await waitFor(() => expect(within(panel).getByText('지울 댓글')).toBeTruthy());
    fireEvent.click(within(panel).getByRole('button', { name: '스레드 글 삭제' }));
    await waitFor(() => expect(within(panel).queryByText('지울 댓글')).toBeNull());
    expect(JSON.parse(localStorage.getItem('mf_comments') || '[]')).toHaveLength(0);
  });

  it('핀에 댓글 수가 적히고, 누르면 그 핀의 논의가 열린다 — 제목에 "사라진 대상"은 없다(요청 ⑥)', async () => {
    localStorage.setItem('mindflow_doc_cm3', JSON.stringify(DOC_WITH_PIN));
    seedComment('cm3', PIN_ID, '핀에 남긴 말');
    seedComment('cm3', PIN_ID, '하나 더');
    renderEditor('/editor?map=cm3&title=x');
    await waitFor(() => expect((document.querySelector('[data-pin-count]') as HTMLElement)?.textContent).toBe('2'));

    const panel = await openPinComments();
    expect(within(panel).getByText('핀에 남긴 말')).toBeTruthy();
    expect(within(panel).queryByText('사라진 대상')).toBeNull();
  });

  it('답글이 스레드 아래에 달리고 parentId로 저장된다', async () => {
    localStorage.setItem('mindflow_doc_cm5', JSON.stringify(DOC_WITH_PIN));
    seedComment('cm5', PIN_ID, '뿌리 댓글');
    renderEditor('/editor?map=cm5&title=x');
    const panel = await openPinComments();
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

  // 시안 ①: 스레드 머리에 **해결** 토글이 있고, 해결하면 핀에 초록 체크가 뜬다.
  // 좋아요(공감)는 그대로 각 글에 붙는다.
  it('머리의 해결을 누르면 핀에 체크가 뜨고, 좋아요는 수가 오르내린다', async () => {
    localStorage.setItem('mindflow_doc_cmlike', JSON.stringify(DOC_WITH_PIN));
    seedComment('cmlike', PIN_ID, '좋아요 대상');
    renderEditor('/editor?map=cmlike&title=x');
    const panel = await openPinComments();
    await waitFor(() => expect(within(panel).getByText('좋아요 대상')).toBeTruthy());

    // 해결 토글 — 누르면 핀이 해결 표시(초록 체크)로 바뀐다.
    fireEvent.click(within(panel).getByTitle('해결됨으로 표시'));
    await waitFor(() => expect(document.querySelector('[data-pin-resolved]')).toBeTruthy());
    expect(document.querySelector('[data-pin-count]')).toBeNull(); // 개수 자리를 체크가 대신한다
    fireEvent.click(within(panel).getByTitle('해결 표시 지우기'));
    await waitFor(() => expect(document.querySelector('[data-pin-resolved]')).toBeNull());

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

  // 요청 ⑧: 주제·메모·선·영역에는 댓글을 달 수 없다 — 진입점도 표시도 없다.
  it('기존 객체에는 댓글 진입점이 없다(보기 메뉴 항목·객체 배지 모두)', async () => {
    const doc = { ...DOC, floats: [{ id: 'fm1', x: -300, y: 40, w: 180, text: '주간 회고 메모' }] };
    localStorage.setItem('mindflow_doc_cm12', JSON.stringify(doc));
    // 옛 데이터(객체에 달려 있던 댓글)가 남아 있어도 화면에는 드러나지 않는다.
    seedComment('cm12', 'fm1', '옛 메모 댓글');
    const { container } = renderEditor('/editor?map=cm12&title=x');
    await waitFor(() => expect(container.querySelector('[data-float-id="fm1"]')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(await screen.findByText('맵')).toBeTruthy(); // 메뉴는 열렸다
    expect(screen.queryByRole('button', { name: '댓글' })).toBeNull();
    expect(document.querySelector('[data-comment-badge]')).toBeNull();
  });

  it('@ 입력에 참가자 자동완성이 뜨고, 고르면 멘션이 저장·강조된다', async () => {
    localStorage.setItem('mindflow_doc_cm7', JSON.stringify(DOC_WITH_PIN));
    seedComment('cm7', PIN_ID, '먼저 있던 말');
    // 멘션 후보 = 공유 참가자(소유자 + 초대). 초대 한 명을 심는다.
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm7', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm7&title=x');
    const panel = await openPinComments();

    const box = within(panel).getByLabelText('스레드 입력') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@fri', selectionStart: 4 } });
    const candidate = await within(panel).findByText('friend@example.com');
    fireEvent.mouseDown(candidate.closest('button')!);
    await waitFor(() => expect(box.value).toContain('@friend'));

    fireEvent.change(box, { target: { value: box.value + ' 확인 부탁해요' } });
    fireEvent.click(within(panel).getByRole('button', { name: '남기기' }));
    // 먼저 심어 둔 말(핀을 살려 두는 첫 댓글) 뒤에 새 댓글이 붙는다.
    await waitFor(() => expect(storedComments()).toHaveLength(2));
    expect(storedComments()[1]!.mentions).toEqual([{ email: 'friend@example.com', name: 'friend' }]);
    // 본문에서 멘션만 강조된다.
    const mark = panel.querySelector('[data-mention]')!;
    expect(mark.textContent).toBe('@friend');
  });

  it('작성 중에도 멘션이 강조된다 — 백드롭 오버레이(요청), 이름이 깨지면 해제', async () => {
    localStorage.setItem('mindflow_doc_cm11', JSON.stringify(DOC_WITH_PIN));
    seedComment('cm11', PIN_ID, '먼저 있던 말');
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm11', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm11&title=x');
    const panel = await openPinComments();

    const box = within(panel).getByLabelText('스레드 입력') as HTMLTextAreaElement;
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
    localStorage.setItem('mindflow_doc_cm10', JSON.stringify(DOC_WITH_PIN));
    seedComment('cm10', PIN_ID, '먼저 있던 말');
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm10', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm10&title=x');
    const panel = await openPinComments();

    const box = within(panel).getByLabelText('스레드 입력') as HTMLTextAreaElement;
    // 질의 없는 맨 '@' — 전체 후보가 나온다. 참가자는 소유자(나=me@example.com)와
    // 초대(friend) 둘인데, 나는 걸러져 friend만 남아야 한다.
    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } });
    await within(panel).findByText('friend@example.com');
    expect(within(panel).queryByText(MY_EMAIL)).toBeNull();
  });

  it('댓글 멘션 리스트: ↑/↓로 항목을 이동하고 Enter로 활성 후보를 고른다(요청)', async () => {
    localStorage.setItem('mindflow_doc_cm15', JSON.stringify(DOC_WITH_PIN));
    seedComment('cm15', PIN_ID, '먼저 있던 말');
    localStorage.setItem(
      'mf_doc_shares',
      JSON.stringify([
        { documentId: 'cm15', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' },
        { documentId: 'cm15', email: 'buddy@example.com', role: 'edit', createdAt: '2026-01-02T00:00:00.000Z' },
      ]),
    );
    renderEditor('/editor?map=cm15&title=x');
    const panel = await openPinComments();

    const box = within(panel).getByLabelText('스레드 입력') as HTMLTextAreaElement;
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
    localStorage.setItem('mindflow_doc_cm8', JSON.stringify(DOC_WITH_PIN));
    seedComment('cm8', PIN_ID, '먼저 있던 말');
    // 실시간 구독은 공유된 문서에서만(혼자 쓰는 문서에는 신호를 보낼 상대가 없다).
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'cm8', email: 'friend@example.com', role: 'edit', createdAt: '2026-01-01T00:00:00.000Z' }]));
    renderEditor('/editor?map=cm8&title=x');
    const panel = await openPinComments();
    await waitFor(() => expect(within(panel).getByText('먼저 있던 말')).toBeTruthy());

    // 다른 탭의 저장소 인스턴스가 댓글을 단다 — BroadcastChannel 신호로 이 화면이
    // 스스로 다시 읽어야 한다(패널을 닫았다 열지 않아도).
    const other = new LocalCommentStore();
    await waitFor(async () => {
      // 구독 effect가 붙기 전의 add는 신호가 유실될 수 있어, 붙을 때까지 재시도.
      if (storedComments().length === 1) await other.add('cm8', PIN_ID, '옆 탭에서 단 댓글');
      expect(within(panel).getByText('옆 탭에서 단 댓글')).toBeTruthy();
    });
  });

  // 노드 우클릭 진입점은 좌표 히트테스트가 필요해 ContextMenu.interactions.test.tsx에서 검증.

  it('알림 딥링크(?comments=<대상 id>)로 열면 그 핀의 댓글 패널이 바로 뜬다', async () => {
    localStorage.setItem('mindflow_doc_cmd1', JSON.stringify(DOC_WITH_PIN));
    seedComment('cmd1', PIN_ID, '딥링크 대상 논의');
    renderEditor(`/editor?map=cmd1&title=x&comments=${PIN_ID}`);
    const panel = await screen.findByLabelText('스레드');
    await waitFor(() => expect(within(panel).getByText('딥링크 대상 논의')).toBeTruthy());
  });

  it('다른 핀을 고르면 패널이 따라간다 — 어느 자리의 논의인지 흐려지지 않게', async () => {
    const doc = { ...DOC, commentPins: [{ id: PIN_ID, x: 120, y: 60 }, { id: 'p2', x: 260, y: 160 }] };
    localStorage.setItem('mindflow_doc_cm4', JSON.stringify(doc));
    seedComment('cm4', PIN_ID, '첫 핀의 말');
    seedComment('cm4', 'p2', '둘째 핀의 말');
    renderEditor('/editor?map=cm4&title=x');
    const panel = await openPinComments();
    await waitFor(() => expect(within(panel).getByText('첫 핀의 말')).toBeTruthy());

    fireEvent.click(document.querySelector('[data-comment-pin="p2"]') as HTMLElement);
    await waitFor(() => expect(within(panel).getByText('둘째 핀의 말')).toBeTruthy());
    expect(within(panel).queryByText('첫 핀의 말')).toBeNull();
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
    const shareStore = { ...new LocalShareStore(), list: async () => [] } as unknown as ShareStore;
    return { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore, feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'supabase' };
  }

  it('꽂혀 있는 핀의 댓글도, 배경 메뉴의 댓글 추가도 없다', async () => {
    localStorage.setItem('mindflow_doc_lk9', JSON.stringify(DOC_WITH_PIN));
    seedComment('lk9', PIN_ID, '보이면 안 되는 말');
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
    // 핀은 그려지지만(문서의 일부다) 그 논의는 서버가 내주지 않아 수도 붙지 않는다.
    await waitFor(() => expect(document.querySelector('[data-pin-count]')).toBeNull());
    expect(screen.queryByText('보이면 안 되는 말')).toBeNull();
  });
});

// 요청 ④·⑤·③·⑦: 댓글 핀은 Figma처럼 **두 걸음**으로 생긴다 — 도구/메뉴가 초안
// 말풍선을 띄우고, 첫 마디를 남겨야 문서에 들어간다. 옮기는 동안에는 서버를 다시
// 읽지 않고, 팝업은 그 핀 옆에 뜬다.
describe('댓글 핀(캔버스 객체)', () => {
  it('첫 댓글을 쓰지 않고 다른 곳을 누르면 초안이 사라진다 — 문서에는 아무것도 남지 않는다(요청 ⑤)', async () => {
    localStorage.setItem('mindflow_doc_pin2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=pin2&title=x');
    await waitFor(() => expect(container.querySelector('.mf-ed-vp')).toBeTruthy());
    await openDraftViaMenu(container);

    firePointer(container.querySelector('.mf-ed-vp') as HTMLElement, 'pointerdown', { clientX: 500, clientY: 400 });
    await waitFor(() => expect(container.querySelector('[data-comment-draft]')).toBeNull());
    expect(container.querySelector('[data-comment-pin]')).toBeNull();
    expect(storedComments()).toHaveLength(0);
  });

  // 제보 ①: 저장된 핀이 열자마자 사라졌다(로드 직후 정리 로직이 낡은 목록을 보고
  // 전부 고아로 판정 → 그 상태가 자동저장). 문서를 다시 열어도 핀은 남아야 한다.
  it('댓글이 달린 핀은 문서를 다시 열어도 남는다(요청 ①)', async () => {
    localStorage.setItem('mindflow_doc_pin3', JSON.stringify(DOC_WITH_PIN));
    seedComment('pin3', PIN_ID, '남아 있어야 하는 말');
    const { container } = renderEditor('/editor?map=pin3&title=x');
    await waitFor(() => expect(container.querySelector(`[data-comment-pin="${PIN_ID}"]`)).toBeTruthy());
    // 목록 로드가 끝나고 자동저장이 한 바퀴 돌아도 핀은 그대로다.
    await waitFor(() => expect((document.querySelector('[data-pin-count]') as HTMLElement)?.textContent).toBe('1'));
    await new Promise((r) => setTimeout(r, 1300));
    expect(container.querySelector(`[data-comment-pin="${PIN_ID}"]`)).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem('mindflow_doc_pin3') || '{}') as { commentPins?: { id: string }[] };
    expect(saved.commentPins?.[0]?.id).toBe(PIN_ID);
  });

  it('핀을 끌어 옮겨도 댓글 목록을 다시 읽지 않는다(제보 ③)', async () => {
    localStorage.setItem('mindflow_doc_pin4', JSON.stringify(DOC_WITH_PIN));
    seedComment('pin4', PIN_ID, '핀의 말');
    const store = new LocalCommentStore();
    let listCalls = 0;
    const commentStore = {
      list: (id: string) => {
        listCalls += 1;
        return store.list(id);
      },
      add: (...a: Parameters<LocalCommentStore['add']>) => store.add(...a),
      remove: (...a: Parameters<LocalCommentStore['remove']>) => store.remove(...a),
      setResolved: (...a: Parameters<LocalCommentStore['setResolved']>) => store.setResolved(...a),
      setLiked: (...a: Parameters<LocalCommentStore['setLiked']>) => store.setLiked(...a),
      subscribe: (...a: Parameters<LocalCommentStore['subscribe']>) => store.subscribe(...a),
    } as unknown as LocalCommentStore;
    const backend: Backend = {
      auth: new LocalAuth(),
      docStore: new LocalDocStore(),
      spaceStore: new LocalSpaceStore(),
      shareStore: new LocalShareStore(),
      feedbackStore: new LocalFeedbackStore(),
      imageStore: new LocalImageStore(),
      commentStore,
      notificationStore: new LocalNotificationStore(),
      mode: 'local',
    };
    const { container } = render(
      <MemoryRouter initialEntries={['/editor?map=pin4&title=x']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/editor" element={<Editor />} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );
    const pin = await waitFor(() => {
      const el = container.querySelector(`[data-comment-pin="${PIN_ID}"]`) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    await waitFor(() => expect(listCalls).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 200)); // 초기 로드(마운트·권한 판별)가 잦아들 때까지
    const before = listCalls;

    // 끌어서 옮긴다 — 드래그 끝의 click은 "열기"가 아니다.
    firePointer(pin, 'pointerdown', { clientX: 100, clientY: 100 });
    firePointer(window, 'pointermove', { clientX: 160, clientY: 140 });
    firePointer(window, 'pointerup', { clientX: 160, clientY: 140 });
    fireEvent.click(pin);
    await new Promise((r) => setTimeout(r, 50));
    expect(listCalls).toBe(before);
    expect(screen.queryByLabelText('스레드')).toBeNull();

    // 평범한 클릭(움직이지 않음)은 예전처럼 팝업을 연다.
    fireEvent.click(pin);
    await screen.findByLabelText('스레드');
  });

  it('팝업이 그 핀 옆에 뜬다(요청 ⑦)', async () => {
    localStorage.setItem('mindflow_doc_pin5', JSON.stringify(DOC_WITH_PIN));
    seedComment('pin5', PIN_ID, '핀의 말');
    const { container } = renderEditor('/editor?map=pin5&title=x');
    const panel = await openPinComments();
    // 화면 자리 = 문서 좌표 × 줌 + 팬(팬 레이어의 transform에서 읽는다).
    const panLayer = container.querySelector('[data-pan-layer]') as HTMLElement;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(panLayer.style.transform || '');
    expect(m).toBeTruthy();
    const px = 120 * parseFloat(m![3]!) + parseFloat(m![1]!);
    // 우상단 고정(right/top)이 아니라 핀 근처의 left/top이다.
    expect(panel.style.right).toBe('');
    expect(Math.abs(parseFloat(panel.style.left) - px)).toBeLessThan(200);
  });
});

// 프리뷰 확인 후 5건(요청) — 팝업이 핀을 가리지 않게, 작성 뒤 선택 도구 복귀,
// 커서·초안 핀 모양 통일, 핀에서 벗어나면 팝업 닫기.
describe('댓글 핀 다듬기(프리뷰 후속)', () => {
  it('팝업이 핀을 가리지 않고 그 오른쪽에 선다(요청 ①)', async () => {
    localStorage.setItem('mindflow_doc_pf1', JSON.stringify(DOC_WITH_PIN));
    seedComment('pf1', PIN_ID, '핀의 말');
    seedComment('pf1', PIN_ID, '둘');
    seedComment('pf1', PIN_ID, '셋'); // 개수가 늘어도 본체 폭은 그대로여야 한다
    const { container } = renderEditor('/editor?map=pf1&title=x');
    const panel = await openPinComments();
    const pin = container.querySelector(`[data-comment-pin="${PIN_ID}"]`) as HTMLElement;

    // 핀 본체는 개수와 무관하게 고정 폭 — 개수는 본체 **밖** 배지다.
    expect(pin.style.width).toBe(`${COMMENT_PIN_W}px`);
    expect((pin.querySelector('[data-pin-count]') as HTMLElement).style.position).toBe('absolute');
    // 팝업 왼쪽 변이 핀의 오른쪽 변보다 오른쪽에 있다(가리지 않는다).
    const panLayer = container.querySelector('[data-pan-layer]') as HTMLElement;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(panLayer.style.transform || '')!;
    const pinLeft = 120 * parseFloat(m[3]!) + parseFloat(m[1]!);
    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(pinLeft + COMMENT_PIN_W);
  });

  // 시안 ①·②: 미선택 = 흰 몸통 + 얼굴, 선택 = 강조색 몸통 + 잉크 배지.
  // 그리고 **브라우저 기본 포커스 외곽선을 끈다** — 클릭한 핀에 검은 링이 얹혀
  // 디자인이 통째로 깨졌다(제보 스크린샷).
  it('핀은 고르면 강조색 몸통 + 잉크 배지가 되고, 검은 포커스 링은 없다(시안 ①·②)', async () => {
    localStorage.setItem('mindflow_doc_pf5', JSON.stringify(DOC_WITH_PIN));
    seedComment('pf5', PIN_ID, '핀의 말');
    const { container } = renderEditor('/editor?map=pf5&title=x');
    const pin = await waitFor(() => {
      const el = container.querySelector(`[data-comment-pin="${PIN_ID}"]`) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    // 미선택 — 흰 몸통에 얼굴, 배지는 강조색.
    await waitFor(() => expect(container.querySelector('[data-pin-count]')).toBeTruthy());
    const idleBadge = container.querySelector('[data-pin-count]') as HTMLElement;
    expect(pin.style.background).not.toContain('gradient');
    expect(pin.style.outline).toBe('none');
    const idleBg = idleBadge.style.background;
    // 얼굴은 핀을 거의 채우고(시안 실측 비율), 미선택에서는 이름에서 나온 색이다.
    const idleAvatar = pin.querySelector('[data-avatar]') as HTMLElement;
    expect(parseFloat(idleAvatar.style.width)).toBeGreaterThanOrEqual(COMMENT_PIN_W - 8);
    expect(idleAvatar.style.background).not.toContain('255, 255, 255');

    // 선택은 pointerdown이 정한다(클릭은 팝업 열기) — 실제 조작 순서 그대로.
    firePointer(pin, 'pointerdown', { clientX: 10, clientY: 10 });
    firePointer(window, 'pointerup', { clientX: 10, clientY: 10 });
    fireEvent.click(pin);
    await waitFor(() => expect(container.querySelector('[data-comment-pin]')!.getAttribute('style')).toContain('gradient'));
    // 배지는 잉크색으로 뒤집힌다 — 강조색 몸통 위에서 강조색 배지는 묻힌다.
    expect((container.querySelector('[data-pin-count]') as HTMLElement).style.background).not.toBe(idleBg);
    // 실루엣은 두 상태가 같다(같은 물건이다) — 왼쪽 아래만 각진 둥근 사각.
    expect((container.querySelector('[data-comment-pin]') as HTMLElement).style.borderRadius).toBe(pin.style.borderRadius);
    // 얼굴은 **반투명 흰 원 + 흰 글자**가 된다(시안 ②) — 파스텔 얼굴에 흰 링을
    // 두르면 코럴 몸통과 겹쳐 과녁처럼 보였다(제보 "이전과 동일하게 보인다").
    const selAvatar = container.querySelector('[data-comment-pin]')!.querySelector('[data-avatar]') as HTMLElement;
    expect(selAvatar.style.background).toContain('255, 255, 255');
    expect(selAvatar.style.border).toBe('');
  });

  it('첫 댓글을 남기면 선택 도구로 돌아온다(요청 ②)', async () => {
    const board = { ...DOC, kind: 'board', nodes: {}, floats: [] };
    localStorage.setItem('mindflow_doc_pf2', JSON.stringify(board));
    const { container } = renderEditor('/editor?map=pf2&title=보드');
    await waitFor(() => expect(container.querySelector('[data-board-toolbar]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '스레드' }));
    expect(screen.getByRole('button', { name: '스레드' }).getAttribute('aria-pressed')).toBe('true');

    const layer = container.querySelector('[data-board-draw-layer]') as HTMLElement;
    firePointer(layer, 'pointerdown', { clientX: 320, clientY: 260 });
    firePointer(layer, 'pointerup', { clientX: 320, clientY: 260 });
    const bubble = await screen.findByLabelText('첫 스레드 남기기');
    fireEvent.change(within(bubble).getByLabelText('스레드 입력'), { target: { value: '첫 마디' } });
    fireEvent.click(within(bubble).getByRole('button', { name: '남기기' }));

    await waitFor(() => expect(container.querySelector('[data-comment-pin]')).toBeTruthy());
    // 댓글 모드에 머물면 방금 만든 핀을 만지려는 클릭이 또 새 초안을 띄운다.
    await waitFor(() => expect(screen.getByRole('button', { name: '선택' }).getAttribute('aria-pressed')).toBe('true'));
    expect(container.querySelector('[data-board-draw-layer]')).toBeNull();
    // 그리고 **그 스레드가 열린 채로 남는다**(요청 ①) — 방금 쓴 말과 이어서 답글을
    // 달 자리가 바로 보여야 한다(핀을 다시 눌러야 하지 않게).
    const panel = await waitFor(() => {
      const el = container.querySelector('[data-comment-panel]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    await waitFor(() => expect(within(panel).getByText('첫 마디')).toBeTruthy());
  });

  // 요청: 팝업은 **내용만큼** 자라고 화면을 벗어나지 않는 선에서 멈춘다. 예전에는
  // 420px 고정 상한이라 글이 조금만 늘어도 그 안에서 스크롤이 났다.
  it('스레드 팝업은 내용만큼 자라고 상한은 화면 높이에서 나온다 — 목록에 얇은 스크롤바(요청)', async () => {
    localStorage.setItem('mindflow_doc_pf7', JSON.stringify(DOC_WITH_PIN));
    for (let i = 0; i < 12; i += 1) seedComment('pf7', PIN_ID, `${i}번째 글 — 길게 적어 목록이 넘치게 한다`.repeat(2));
    const { container } = renderEditor('/editor?map=pf7&title=x');
    const pin = await waitFor(() => {
      const el = container.querySelector(`[data-comment-pin="${PIN_ID}"]`) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    firePointer(pin, 'pointerdown', { clientX: 10, clientY: 10 });
    firePointer(window, 'pointerup', { clientX: 10, clientY: 10 });
    fireEvent.click(pin);
    const panel = await screen.findByLabelText('스레드');

    // 상한이 420 고정이 아니다 — 화면 높이에서 나온 값(여백을 뺀 만큼).
    expect(panel.style.maxHeight).not.toBe('420px');
    expect(parseFloat(panel.style.maxHeight)).toBeGreaterThan(500);
    // 높이 자체는 인라인으로 고정하지 않는다(내용이 정한다).
    expect(panel.style.height).toBe('');
    // 스크롤은 목록에서만 나고, 얇은 스크롤바 클래스와 그 색 변수가 붙는다.
    const list = panel.querySelector('[data-comment-list]') as HTMLElement;
    expect(list.classList.contains('mf-cmt-scroll')).toBe(true);
    expect(list.style.overflowY).toBe('auto');
    expect(panel.style.getPropertyValue('--mf-cmt-sb')).toBeTruthy();
  });

  it('스레드 팝업 스크롤바 CSS 계약 — 화살표 버튼 없음, 표준 속성은 Firefox 전용으로 격리', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    // vitest의 import.meta.url이 file: 스킴이 아닐 수 있어 cwd 기준 경로를 함께 본다(#389).
    const cssPath = ['src/features/editor/editor.css', 'apps/web/src/features/editor/editor.css'].find((f) => existsSync(f))!;
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.mf-cmt-scroll::-webkit-scrollbar\s*\{[^}]*width:\s*8px/);
    expect(css).toMatch(/\.mf-cmt-scroll::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.mf-cmt-scroll::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px/);
    // 크롬 121+는 표준 속성이 지정된 요소에서 웹킷 커스텀을 통째로 무시한다(#391).
    expect(css).toMatch(/@supports not selector\(::-webkit-scrollbar\)\s*\{\s*\.mf-cmt-scroll/);
    expect(css).not.toMatch(/\n\.mf-cmt-scroll \{/);
  });

  // 요청(용어 통일): 캔버스(핀)의 논의는 **스레드**, 칸반 카드의 논의는 **댓글**이다.
  // 예전에는 같은 팝업 안에서 제목만 '스레드'이고 닫기·입력·빈 안내는 '댓글'이었다.
  it('캔버스 팝업의 문구는 스레드로 통일된다 — 화면에 "댓글"이 남지 않는다', async () => {
    localStorage.setItem('mindflow_doc_pf9', JSON.stringify(DOC_WITH_PIN));
    seedComment('pf9', PIN_ID, '핀에 남긴 말');
    renderEditor('/editor?map=pf9&title=x');
    const panel = await openPinComments();
    expect(within(panel).getByLabelText('스레드 닫기')).toBeTruthy();
    expect(within(panel).getByLabelText('스레드 입력')).toBeTruthy();
    expect((within(panel).getByLabelText('스레드 입력') as HTMLTextAreaElement).placeholder).toContain('스레드 남기기');
    expect(within(panel).getByRole('button', { name: '스레드 글 삭제' })).toBeTruthy();
    // 접근 이름·플레이스홀더까지 통틀어 '댓글'이라는 낱말이 남아 있지 않다.
    const words = [
      panel.textContent ?? '',
      ...Array.from(panel.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label') ?? ''),
      ...Array.from(panel.querySelectorAll('textarea')).map((e) => (e as HTMLTextAreaElement).placeholder),
    ].join(' ');
    expect(words).not.toContain('댓글');
  });

  // 요청: 스크롤이 생긴 팝업에서 ① 답글 칸을 열면 그 자리로 옮기고, ② 내가 남긴
  // 글이 화면에 들어오게 목록 끝으로 옮긴다(예전엔 둘 다 아래에 가려 보이지 않았다).
  it('스크롤이 생긴 스레드에서 답글 칸을 열면 그 자리로, 글을 남기면 목록 끝으로 옮긴다(요청)', async () => {
    const seen: { el: Element; opts: unknown }[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, opts?: unknown) {
      seen.push({ el: this, opts });
    } as typeof Element.prototype.scrollIntoView;
    try {
      localStorage.setItem('mindflow_doc_pf8', JSON.stringify(DOC_WITH_PIN));
      for (let i = 0; i < 8; i += 1) seedComment('pf8', PIN_ID, `${i}번째 글`);
      const { container } = renderEditor('/editor?map=pf8&title=x');
      const pin = await waitFor(() => {
        const el = container.querySelector(`[data-comment-pin="${PIN_ID}"]`) as HTMLElement;
        expect(el).toBeTruthy();
        return el;
      });
      firePointer(pin, 'pointerdown', { clientX: 10, clientY: 10 });
      firePointer(window, 'pointerup', { clientX: 10, clientY: 10 });
      fireEvent.click(pin);
      const panel = await screen.findByLabelText('스레드');

      // ① 답글 칸을 열면 그 칸이 보이도록 목록을 민다.
      const thread = container.querySelector('[data-comment-thread]') as HTMLElement;
      fireEvent.click(within(thread).getByRole('button', { name: '답글' }));
      const composer = await waitFor(() => {
        const el = thread.querySelector('[data-reply-composer]') as HTMLElement;
        expect(el).toBeTruthy();
        return el;
      });
      expect(seen.some((c) => c.el === composer)).toBe(true);

      // ② 새 스레드 글을 남기면 목록 끝으로 — 스크롤이 있을 때만 뜻이 있으므로
      // 목록의 스크롤 높이를 심어 두고 실제로 끝까지 갔는지 본다.
      // jsdom은 레이아웃이 없어 scrollTop 대입이 늘 0으로 되돌아간다 — 세터를 지켜본다.
      const list = panel.querySelector('[data-comment-list]') as HTMLElement;
      let scrolledTo: number | null = null;
      Object.defineProperty(list, 'scrollHeight', { value: 900, configurable: true });
      Object.defineProperty(list, 'scrollTop', {
        configurable: true,
        get: () => scrolledTo ?? 0,
        set: (v: number) => {
          scrolledTo = v;
        },
      });
      fireEvent.change(within(panel).getByLabelText('스레드 입력'), { target: { value: '마지막 글' } });
      fireEvent.click(within(panel).getByRole('button', { name: '남기기' }));
      await waitFor(() => expect(scrolledTo).toBe(900));
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  // 제보: 아주 긴 답글을 남기면 그 답글로 스크롤이 가지 않았다. 원인 둘 — 답글에는
  // 표시를 아예 세우지 않았고(끝으로도 안 갔다), "끝으로"는 긴 글의 **꼬리**를
  // 보여 준다. 이제 새 글을 찾아 그 글이 보이도록 옮긴다(길면 머리를 위에).
  it('길게 쓴 답글을 남기면 그 답글의 머리가 보이게 목록을 옮긴다(제보)', async () => {
    localStorage.setItem('mindflow_doc_pf9', JSON.stringify(DOC_WITH_PIN));
    for (let i = 0; i < 6; i += 1) seedComment('pf9', PIN_ID, `${i}번째 글`);
    const { container } = renderEditor('/editor?map=pf9&title=x');
    const pin = await waitFor(() => {
      const el = container.querySelector(`[data-comment-pin="${PIN_ID}"]`) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    firePointer(pin, 'pointerdown', { clientX: 10, clientY: 10 });
    firePointer(window, 'pointerup', { clientX: 10, clientY: 10 });
    fireEvent.click(pin);
    const panel = await screen.findByLabelText('스레드');
    const thread = container.querySelector('[data-comment-thread]') as HTMLElement;
    fireEvent.click(within(thread).getByRole('button', { name: '답글' }));
    await waitFor(() => expect(thread.querySelector('[data-reply-composer]')).toBeTruthy());

    // jsdom은 레이아웃이 없다 — 목록 높이 300, 새 답글은 그보다 긴 600에 목록
    // 좌표 940에 있다고 심는다(스크롤에 따라 움직이는 진짜 rect처럼).
    const LONG = '아주 긴 답글'.repeat(40);
    const list = panel.querySelector('[data-comment-list]') as HTMLElement;
    let scrolledTo = 0;
    Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1600, configurable: true });
    Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => scrolledTo, set: (v: number) => { scrolledTo = v; } });
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this === list) return { top: 0, height: 300, left: 0, right: 0, bottom: 300, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      if (this instanceof HTMLElement && this.dataset.commentItem && this.textContent?.includes(LONG)) {
        return { top: 940 - scrolledTo, height: 600, left: 0, right: 0, bottom: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      }
      return origRect.call(this) as DOMRect;
    } as typeof Element.prototype.getBoundingClientRect;
    try {
      fireEvent.change(within(thread).getByLabelText('답글 입력'), { target: { value: LONG } });
      const submits = within(thread).getAllByRole('button', { name: '답글' });
      fireEvent.click(submits[submits.length - 1] as HTMLElement);
      // 머리(940)가 위에서 8px 아래에 오게 — 끝(1300)으로 가지 않는다.
      await waitFor(() => expect(scrolledTo).toBe(932));
    } finally {
      Element.prototype.getBoundingClientRect = origRect;
    }
  });

  // 요청 ②: 아래 입력칸은 답글이 아니라 **새 스레드 글**이다. 예전에는 이 칸이 첫
  // 글의 답글로 들어가, `답글` 버튼으로 남긴 것과 결과가 구별되지 않았다.
  it('팝업 아래 입력칸은 새 스레드 글로 남고, 답글은 답글 버튼만 맡는다(요청 ②)', async () => {
    localStorage.setItem('mindflow_doc_pf6', JSON.stringify(DOC_WITH_PIN));
    seedComment('pf6', PIN_ID, '첫 글');
    const { container } = renderEditor('/editor?map=pf6&title=x');
    const pin = await waitFor(() => {
      const el = container.querySelector(`[data-comment-pin="${PIN_ID}"]`) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    firePointer(pin, 'pointerdown', { clientX: 10, clientY: 10 });
    firePointer(window, 'pointerup', { clientX: 10, clientY: 10 });
    fireEvent.click(pin);
    const panel = await screen.findByLabelText('스레드');

    // 문구도 '스레드 남기기'다(예전 '답글 남기기' — 하는 일과 어긋났다).
    const box = within(panel).getByLabelText('스레드 입력') as HTMLTextAreaElement;
    expect(box.placeholder).toContain('스레드 남기기');
    fireEvent.change(box, { target: { value: '두 번째 스레드' } });
    fireEvent.click(within(panel).getByRole('button', { name: '남기기' }));

    // 저장된 두 글 모두 뿌리(parentId 없음) → 스레드 블록도 둘이 된다.
    await waitFor(() => expect(container.querySelectorAll('[data-comment-thread]').length).toBe(2));
    const rows = JSON.parse(localStorage.getItem('mf_comments') || '[]') as { body: string; parentId?: string }[];
    expect(rows.map((r) => [r.body, r.parentId ?? null])).toEqual([
      ['첫 글', null],
      ['두 번째 스레드', null],
    ]);

    // 대조군: `답글` 버튼이 여는 칸은 그대로 답글(parentId가 붙는다).
    const thread = container.querySelector('[data-comment-thread]') as HTMLElement;
    fireEvent.click(within(thread).getByRole('button', { name: '답글' }));
    const replyBox = within(thread).getByLabelText('답글 입력') as HTMLTextAreaElement;
    expect(replyBox.placeholder).toContain('답글 남기기');
    fireEvent.change(replyBox, { target: { value: '답글이야' } });
    // 이 스레드에는 '답글' 이름의 버튼이 둘이다(줄의 토글 + 입력칸의 등록) — 뒤가 등록.
    const replyButtons = within(thread).getAllByRole('button', { name: '답글' });
    fireEvent.click(replyButtons[replyButtons.length - 1]!);
    await waitFor(() => {
      const after = JSON.parse(localStorage.getItem('mf_comments') || '[]') as { body: string; parentId?: string }[];
      expect(after.find((r) => r.body === '답글이야')?.parentId).toBeTruthy();
    });
  });

  it('초안 핀은 확정된 핀과 같은 모양이고, 커서도 그 핀 그림이다(요청 ③·④)', async () => {
    const board = { ...DOC, kind: 'board', nodes: {}, floats: [], commentPins: [{ id: PIN_ID, x: 40, y: 20 }] };
    localStorage.setItem('mindflow_doc_pf3', JSON.stringify(board));
    seedComment('pf3', PIN_ID, '이미 있는 말');
    const { container } = renderEditor('/editor?map=pf3&title=보드');
    await waitFor(() => expect(container.querySelector('[data-comment-pin]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '스레드' }));
    const layer = container.querySelector('[data-board-draw-layer]') as HTMLElement;
    firePointer(layer, 'pointerdown', { clientX: 500, clientY: 380 });
    firePointer(layer, 'pointerup', { clientX: 500, clientY: 380 });
    await screen.findByLabelText('첫 스레드 남기기');

    const pin = container.querySelector('[data-comment-pin]') as HTMLElement;
    const draftPin = container.querySelector('[data-comment-draft-pin]') as HTMLElement;
    // 크기·실루엣이 같다 — 예전엔 초안이 더 작고 점선이라 딴 물건처럼 보였다.
    expect(draftPin.style.width).toBe(pin.style.width);
    expect(draftPin.style.height).toBe(pin.style.height);
    expect(draftPin.style.borderRadius).toBe(pin.style.borderRadius);
    expect(draftPin.style.borderStyle).not.toBe('dashed');
    // 담는 것만 다르다: 꽂힌 핀은 **첫 글을 쓴 사람의 얼굴**(시안 ①), 초안은 말풍선(시안 ②).
    expect(pin.querySelector('[data-avatar]')?.textContent).toBe('나');
    expect(draftPin.querySelector('svg path')?.getAttribute('d')).toBe(THREAD_BUBBLE_PATH);
    // 커서도 초안 핀과 같은 말풍선을 굽는다.
    expect(decodeURIComponent(layer.style.cursor)).toContain(THREAD_BUBBLE_PATH);
  });

  it('배경이나 다른 객체를 고르면 팝업이 닫힌다(요청 ⑤)', async () => {
    const doc = { ...DOC, floats: [{ id: 'fm1', x: -300, y: 40, w: 180, text: '메모' }], commentPins: [{ id: PIN_ID, x: 120, y: 60 }] };
    localStorage.setItem('mindflow_doc_pf4', JSON.stringify(doc));
    seedComment('pf4', PIN_ID, '핀의 말');
    const { container } = renderEditor('/editor?map=pf4&title=x');
    await openPinComments();

    // 다른 객체(메모)를 고르면 닫힌다.
    const memo = container.querySelector('[data-float-id="fm1"]') as HTMLElement;
    firePointer(memo, 'pointerdown', { clientX: 60, clientY: 60 });
    firePointer(window, 'pointerup', { clientX: 60, clientY: 60 });
    await waitFor(() => expect(screen.queryByLabelText('스레드')).toBeNull());

    // 다시 열고, 이번엔 빈 배경을 눌러 닫는다.
    await openPinComments();
    const vp = container.querySelector('.mf-ed-vp') as HTMLElement;
    firePointer(vp, 'pointerdown', { clientX: 700, clientY: 520 });
    firePointer(window, 'pointerup', { clientX: 700, clientY: 520 });
    await waitFor(() => expect(screen.queryByLabelText('스레드')).toBeNull());
  });
});

// 요청 ④: 화이트보드 도구 막대의 댓글은 **도구**다 — 누르는 즉시 핀이 생기지 않고,
// 캔버스를 누른 자리에 첫 댓글 말풍선이 뜬다.
describe('댓글 도구(화이트보드)', () => {
  const BOARD = { ...DOC, kind: 'board', nodes: {}, floats: [{ id: 'bf1', x: -200, y: -40, w: 180, text: '메모' }] };

  it('도구를 켜도 핀이 생기지 않고, 캔버스를 누른 자리에 말풍선이 뜬다', async () => {
    localStorage.setItem('mindflow_doc_bcm1', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=bcm1&title=보드');
    await waitFor(() => expect(container.querySelector('[data-board-toolbar]')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '스레드' }));
    // 켜는 것만으로는 아무것도 만들지 않는다(예전엔 즉시 핀이 꽂혔다).
    expect(container.querySelector('[data-comment-pin]')).toBeNull();
    expect(container.querySelector('[data-comment-draft]')).toBeNull();

    const layer = await waitFor(() => {
      const el = container.querySelector('[data-board-draw-layer]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    // 커서가 댓글 아이콘이 된다.
    expect(layer.style.cursor).toContain('data:image/svg+xml');

    firePointer(layer, 'pointerdown', { clientX: 320, clientY: 260 });
    firePointer(layer, 'pointerup', { clientX: 320, clientY: 260 });
    await screen.findByLabelText('첫 스레드 남기기');
    expect(container.querySelector('[data-comment-pin]')).toBeNull();
  });
});

// 요청: 마인드맵에서도 스레드를 쓸 수 있게. 기능(핀·팝업·답글)은 원래 문서 종류와
// 무관하게 동작했지만 **진입 방식**이 갈려 있었다 — 도구 모드·단축키 C·도구 버튼은
// 하단 도구 막대(화이트보드 전용)에만 있어서, 맵에서는 배경 우클릭이 유일한 길이었다.
describe('마인드맵 스레드 진입점(요청)', () => {
  it('삽입 메뉴의 스레드 추가가 초안 말풍선을 띄운다', async () => {
    localStorage.setItem('mindflow_doc_mp1', JSON.stringify(DOC));
    renderEditor('/editor?map=mp1&title=맵');
    fireEvent.click(await screen.findByRole('button', { name: '삽입' }));
    fireEvent.click(await screen.findByRole('button', { name: '스레드 추가' }));
    const bubble = await screen.findByLabelText('첫 스레드 남기기');
    // 다른 삽입과 달리 **문서에는 아직 아무것도 들어가지 않는다**(요청 ⑤).
    expect(JSON.parse(localStorage.getItem('mindflow_doc_mp1') as string).commentPins ?? []).toHaveLength(0);
    fireEvent.change(within(bubble).getByLabelText('스레드 입력'), { target: { value: '맵에서 남긴 첫 마디' } });
    fireEvent.click(within(bubble).getByRole('button', { name: '남기기' }));
    await waitFor(() => expect(document.querySelector('[data-comment-pin]')).toBeTruthy());
  });

  it('C로 스레드 도구를 켜 누른 자리에 남기고, Escape로 끈다', async () => {
    localStorage.setItem('mindflow_doc_mp2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=mp2&title=맵');
    await waitFor(() => expect(container.querySelector('.mf-ed-vp')).toBeTruthy());
    // 맵에는 하단 도구 막대가 없다 — 단축키가 그 자리를 대신한다.
    expect(container.querySelector('[data-board-toolbar]')).toBeNull();

    fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
    const layer = await waitFor(() => {
      const el = container.querySelector('[data-board-draw-layer]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    firePointer(layer, 'pointerdown', { clientX: 420, clientY: 300 });
    firePointer(layer, 'pointerup', { clientX: 420, clientY: 300 });
    await screen.findByLabelText('첫 스레드 남기기');
    // 자리를 정한 순간 손은 선택 도구로 돌아온다(보드와 같은 규칙).
    await waitFor(() => expect(container.querySelector('[data-board-draw-layer]')).toBeNull());

    // 켜 두고 마음이 바뀌면 Escape — 맵에는 도구 막대가 없으므로 전역 키가 받는다.
    fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
    await waitFor(() => expect(container.querySelector('[data-board-draw-layer]')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-board-draw-layer]')).toBeNull());
  });

  it('그리기 도구는 맵에서 켜지지 않는다(화이트보드 전용)', async () => {
    localStorage.setItem('mindflow_doc_mp3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=mp3&title=맵');
    await waitFor(() => expect(container.querySelector('.mf-ed-vp')).toBeTruthy());
    for (const [key, code] of [
      ['p', 'KeyP'],
      ['h', 'KeyH'],
      ['e', 'KeyE'],
    ] as const) {
      fireEvent.keyDown(window, { key, code });
    }
    expect(container.querySelector('[data-board-draw-layer]')).toBeNull();
  });
});

// 제보 ①②: ⋯의 "스레드 삭제"가 **글 하나씩** 지워서 여러 번 눌러야 스레드가 비었고,
// 다 비운 뒤에는 가리킬 핀을 잃은 팝업이 **화면 우측 옛 자리**로 밀려나 "다른 댓글
// 팝업이 떴다"로 보였다.
describe('스레드 삭제(제보)', () => {
  it('⋯ 삭제는 확인을 받고 스레드의 모든 글을 지우며, 팝업과 핀이 함께 사라진다', async () => {
    localStorage.setItem('mindflow_doc_td1', JSON.stringify(DOC_WITH_PIN));
    seedComment('td1', PIN_ID, '뿌리 글');
    seedComment('td1', PIN_ID, '그 답글', { parentId: 'c1' });
    seedComment('td1', PIN_ID, '두 번째 뿌리 글');
    const { container } = renderEditor('/editor?map=td1&title=x');
    const panel = await openPinComments();
    await waitFor(() => expect(within(panel).getByText('두 번째 뿌리 글')).toBeTruthy());

    fireEvent.click(within(panel).getByRole('button', { name: '스레드 메뉴' }));
    fireEvent.click(within(panel).getByRole('button', { name: '스레드 삭제' }));

    // ① 확인창이 먼저 뜨고, 무엇이 몇 개 사라지는지 밝힌다.
    const dialog = await screen.findByRole('dialog', { name: '스레드 삭제 확인' });
    expect(within(dialog).getByText(/글 3개/)).toBeTruthy();
    // 취소하면 아무것도 지워지지 않는다.
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '스레드 삭제 확인' })).toBeNull());
    expect(storedComments()).toHaveLength(3);

    fireEvent.click(within(panel).getByRole('button', { name: '스레드 메뉴' }));
    fireEvent.click(within(panel).getByRole('button', { name: '스레드 삭제' }));
    const dialog2 = await screen.findByRole('dialog', { name: '스레드 삭제 확인' });
    fireEvent.click(within(dialog2).getByRole('button', { name: '삭제' }));

    // 한 번에 **모든 글**이 사라진다(예전에는 첫 뿌리 글 하나만 지워졌다).
    await waitFor(() => expect(storedComments()).toHaveLength(0));
    // ② 그리고 팝업은 남지 않는다 — 가리킬 핀이 없으면 열려 있을 이유가 없다.
    await waitFor(() => expect(container.querySelector('[data-comment-panel]')).toBeNull());
    await waitFor(() => expect(container.querySelector('[data-comment-pin]')).toBeNull());
  });
});
