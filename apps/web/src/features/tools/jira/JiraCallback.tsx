import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingOverlay } from '../../auth/LoadingOverlay';
import { jiraSource } from './jiraApi';
import { applyJiraStatus } from './jiraStore';

/**
 * Atlassian 동의 화면이 돌아오는 자리 — `/auth/jira?code=…&state=…`.
 *
 * 코드를 서버에 넘겨 교환하고(토큰은 서버에 남는다) 홈으로 돌아간다. 프로젝트를 아직 안
 * 골랐으면 `?jira=setup`으로 돌아가 곧바로 고르게 한다(결정 2026-09-30: "연결 시 선택").
 * 문지기(`RequireAuth`) 안에 있다 — 교환은 **이 사용자의** 행을 만들기 때문이다.
 *
 * ⚠️ Atlassian developer console의 **Callback URL**이 이 주소여야 한다(`backend/26-jira.md`).
 */
export function JiraCallback() {
  const navigate = useNavigate();
  const ran = useRef(false);
  useEffect(() => {
    // StrictMode의 두 번 마운트에서 코드를 두 번 교환하면 두 번째가 실패해 오류로 돌아간다.
    if (ran.current) return;
    ran.current = true;
    const q = new URLSearchParams(window.location.search);
    const code = q.get('code') ?? '';
    const state = q.get('state') ?? '';
    const denied = q.get('error');
    const back = (params: string) => navigate(`/home?${params}`, { replace: true });
    if (denied || !code) {
      back(`jira=error&reason=${encodeURIComponent(denied === 'access_denied' ? 'denied' : 'exchange-failed')}`);
      return;
    }
    const redirectUri = `${window.location.origin}/auth/jira`;
    void jiraSource()
      .exchange(code, state, redirectUri)
      .then((r) => {
        if (!r.ok) {
          back(`jira=error&reason=${encodeURIComponent(r.reason)}`);
          return;
        }
        applyJiraStatus(r);
        back(!r.site || !r.projects.length ? 'jira=setup' : 'jira=connected');
      });
  }, [navigate]);
  return <LoadingOverlay message="Jira 연결을 마무리하는 중" />;
}
