// 접속자 얼굴 줄은 **연결이 아니라 사람**을 센다(제보: 혼자 쓰는데 내 얼굴이 하나 더 떴다).
import { describe, expect, it } from 'vitest';
import { accountKey } from './identity';
import { peopleOf, type PresenceUser } from './presence';

const me: PresenceUser = { name: '이호열', color: '#e0663f', authed: true, uid: accountKey('me@example.com') };
const peer = (clientId: number, user: PresenceUser) => ({ clientId, user });

describe('peopleOf — 얼굴 줄에 세울 사람', () => {
  it('같은 계정의 다른 연결(다른 탭·설치형 앱·재연결 전의 낡은 연결)은 나이므로 뺀다', () => {
    const peers = [peer(11, { ...me }), peer(12, { ...me, avatar: 'x' })];
    expect(peopleOf(peers, me)).toEqual([]);
  });

  it('다른 사람은 남고, 같은 사람이 두 연결이면 하나로 접는다', () => {
    const kim: PresenceUser = { name: '김서연', color: '#3fae9e', authed: true, uid: accountKey('kim@example.com') };
    const peers = [peer(1, kim), peer(2, { ...kim }), peer(3, { ...me })];
    expect(peopleOf(peers, me).map((p) => p.clientId)).toEqual([1]);
  });

  it('열쇠가 없는 옛 클라이언트는 로그인 이름+색으로 · 손님은 연결마다 따로', () => {
    const old = peer(5, { name: '이호열', color: '#e0663f', authed: true });
    const guestA = peer(6, { name: '차분한 수달', color: '#3f8fd0' });
    const guestB = peer(7, { name: '차분한 수달', color: '#3f8fd0' });
    expect(peopleOf([old, guestA, guestB], { name: '이호열', color: '#e0663f', authed: true }).map((p) => p.clientId)).toEqual([6, 7]);
  });

  it('계정 열쇠는 이메일을 싣지 않고, 대소문자·앞뒤 공백에 흔들리지 않는다', () => {
    const k = accountKey('Me@Example.com ');
    expect(k).toBe(accountKey('me@example.com'));
    expect(k).not.toContain('@');
    expect(k).not.toBe(accountKey('you@example.com'));
  });
});
