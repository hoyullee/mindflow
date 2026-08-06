// 접속자 표시 + **연결 상태**. 상태 표시가 왜 있는지: 배포 후 공유 맵을 둘이 열었는데
// 편집·접속자·커서가 한꺼번에 오지 않았고, 화면은 "혼자 있는 것"과 똑같아서 무엇이
// 고장났는지 알 수 없었다. 실시간 채널이 죽었다는 사실이 반드시 화면에 남아야 한다.
//
// 컨트롤러 전체가 아니라 이 컴포넌트만 세워 검증한다 — 상태 조합(전송 종류 × 백엔드
// 모드)을 에디터 전체 하이드레이션 없이 직접 만들 수 있기 때문.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UI_THEME } from '../theme';
import type { EditorController } from '../useEditorState';
import { PresenceBar } from './PresenceBar';

type Peer = EditorController['presence']['peers'][number];

function stub(over: { peers?: Peer[]; collabStatus?: EditorController['collabStatus']; backendMode?: 'local' | 'supabase'; sharedDoc?: boolean }): EditorController {
  return {
    uiTheme: UI_THEME,
    presence: { peers: over.peers ?? [], reportCursor: () => undefined, clearCursor: () => undefined },
    collabStatus: over.collabStatus ?? 'connected',
    backendMode: over.backendMode ?? 'supabase',
    // 기본값 true: 아래 대부분의 케이스는 "함께 쓰는 맵"을 전제한다(공유 여부 자체를
    // 다루는 테스트만 false로 뒤집는다).
    sharedDoc: over.sharedDoc ?? true,
  } as unknown as EditorController;
}

function peer(name: string): Peer {
  return { clientId: 1, user: { name, color: '#3f8fd0' } } as unknown as Peer;
}

afterEach(cleanup); // 이 저장소는 전역 cleanup을 걸지 않는다 — 앞 테스트의 DOM이 남는다

describe('PresenceBar', () => {
  it('혼자이고 연결이 정상이면 아무것도 그리지 않는다 (단독 사용은 소음이 없다)', () => {
    const { container } = render(<PresenceBar controller={stub({})} />);
    expect(container.firstChild).toBeNull();
  });

  it('접속자가 있으면 아바타와 인원수를 보여 준다', () => {
    render(<PresenceBar controller={stub({ peers: [peer('차분한 수달')] })} />);
    expect(screen.getByText('1명 접속 중')).toBeTruthy();
    expect(screen.getByTitle('차분한 수달')).toBeTruthy();
  });

  it('공유된 맵에서 전송이 끊기면 알린다 — 조용히 죽지 않는다', () => {
    render(<PresenceBar controller={stub({ collabStatus: 'offline' })} />);
    expect(screen.getByText('공동 편집 연결 끊김')).toBeTruthy();
  });

  it('혼자 쓰는 맵에서는 끊겨도 띄우지 않는다 — 저장과 무관한데 "저장이 안 된다"로 읽혔다(제보)', () => {
    const { container } = render(<PresenceBar controller={stub({ collabStatus: 'offline', sharedDoc: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('공유 판별 전이라도 접속자가 있으면 알린다', () => {
    render(<PresenceBar controller={stub({ collabStatus: 'offline', sharedDoc: false, peers: [peer('차분한 수달')] })} />);
    expect(screen.getByText('공동 편집 연결 끊김')).toBeTruthy();
  });

  it('툴팁은 저장이 정상이라는 말로 시작한다(오해를 직접 푼다)', () => {
    render(<PresenceBar controller={stub({ collabStatus: 'offline' })} />);
    const tip = screen.getByText('공동 편집 연결 끊김').closest('div')?.getAttribute('title') ?? '';
    expect(tip.startsWith('저장은 정상이에요')).toBe(true);
  });

  it('접속 중(connecting)에는 아무것도 띄우지 않는다 — 진입할 때마다 뜨던 거짓 경보의 원인', () => {
    const { container } = render(<PresenceBar controller={stub({ collabStatus: 'connecting' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('붙을 대상이 없는 데모/로컬 모드에서는 끊김을 띄우지 않는다 (그건 고장이 아니다)', () => {
    const { container } = render(<PresenceBar controller={stub({ collabStatus: 'offline', backendMode: 'local' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('인증되지 않은 공개 채널로 폴백했으면 협업은 그대로 두고 경고만 덧붙인다', () => {
    render(<PresenceBar controller={stub({ peers: [peer('차분한 수달')], collabStatus: 'connected-insecure' })} />);
    expect(screen.getByText('1명 접속 중')).toBeTruthy(); // 협업은 막지 않는다
    expect(screen.getByLabelText('보안 경고')).toBeTruthy();
  });

  it('정상 연결에는 경고를 붙이지 않는다', () => {
    render(<PresenceBar controller={stub({ peers: [peer('차분한 수달')], collabStatus: 'connected' })} />);
    expect(screen.queryByLabelText('보안 경고')).toBeNull();
  });
});
