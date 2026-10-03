// 로그아웃하면 **이 기기에 남은 계정 데이터 사본을 지운다**(요청 — 공용 PC 대비).
//
// 서버 모드(Supabase)에서 원본은 서버에 있고, 브라우저의 localStorage에는 빨리 열기·오프라인 편집을 위한
// **사본**이 쌓인다(문서 본문 `mindflow_doc_*`, 기록·미리보기·일정·알림·도구 캐시 `mf_*` 등). 예전에는
// 회원 탈퇴 때만 지웠다 — 로그아웃 뒤에도 다음 사람이 개발자 도구로 본문을 읽을 수 있었다.
//
// **남기는 것**은 사람이 아니라 **기기**에 딸린 설정뿐이다(테마·시작 화면·보기 방식·창 크기 기억 등).
// 데모(로컬) 모드는 localStorage가 **유일한 원본**이라 지우면 데이터가 사라진다 — 부르는 쪽이 서버 모드일
// 때만 부른다.

/** 기기 설정 — 계정이 바뀌어도 그대로 두는 것. 새 기기 설정 키를 만들면 여기에 더한다. */
const DEVICE_KEYS = new Set([
  'mf_home_theme',
  'mf_home_landing',
  'mf_snap_grid',
  'mf_install_hint',
  'mf_update_applied_at',
  'mf_remember',
  'mf_login_notice',
  'mf_active_view',
  'mf_ws_view',
  'mf_embed_h',
]);

const isOurs = (k: string): boolean => k.startsWith('mindflow_') || k.startsWith('mf_');

function keysOf(store: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out;
}

/** 서버에 아직 못 올라간(오프라인에서 고친) 문서 수 — 로그아웃 확인 창이 알린다. */
export function pendingLocalEdits(store: Storage | undefined = safeLocal()): number {
  if (!store) return 0;
  try {
    return keysOf(store).filter((k) => k.startsWith('mindflow_doc') && k.endsWith('__pending')).length;
  } catch {
    return 0;
  }
}

/** 계정 데이터 사본을 지운다. 지운 키 수를 돌려준다. 저장소를 못 쓰면 0. */
export function clearAccountCache(store: Storage | undefined = safeLocal(), session: Storage | undefined = safeSession()): number {
  let n = 0;
  for (const s of [store, session]) {
    if (!s) continue;
    try {
      const doomed = keysOf(s).filter((k) => isOurs(k) && !DEVICE_KEYS.has(k));
      doomed.forEach((k) => s.removeItem(k));
      n += doomed.length;
    } catch {
      /* 저장소를 못 쓰면 지울 것도 없다 */
    }
  }
  return n;
}

function safeLocal(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function safeSession(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
