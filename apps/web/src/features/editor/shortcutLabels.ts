// 단축키 **표기** — 실제 키 처리는 `useEditorState`가 하고, 여기서는 그 키를
// 사람이 읽는 이름으로만 바꾼다.
//
// 왜 한곳에 모으나: 같은 동작의 표기가 화면마다 갈리면(메뉴는 `Ctrl+C`, 도움말은
// `⌘C`) 사용자는 둘이 다른 기능인지 의심한다. 그리고 세 환경을 함께 지원해야 한다 —
// **Mac**(⌘·⌫), **Windows·Linux**(Ctrl·Del), **모바일**(물리 키보드가 없으므로
// 표기 자체를 하지 않는다: 누를 수 없는 키를 적어 두면 자리만 차지한다).

/** Mac 계열인가 — 수정 키와 삭제 키 표기가 갈리는 기준. */
export function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

/** 수정 키 이름 — Mac은 `⌘`, 그 밖은 `Ctrl`. */
export function modLabel(): string {
  return isMacLike() ? '⌘' : 'Ctrl';
}

/** `Ctrl/⌘ + 글자` 표기 — Mac은 기호를 붙여 쓰고(`⌘C`) 나머지는 `+`로 잇는다(`Ctrl+C`). */
export function comboLabel(letter: string): string {
  return isMacLike() ? `⌘${letter.toUpperCase()}` : `Ctrl+${letter.toUpperCase()}`;
}

/** 삭제 키 — Mac 키보드에는 Del이 없다(⌫). 앱은 두 키를 모두 받지만 표기는 그 기기의 것. */
export function deleteKeyLabel(): string {
  return isMacLike() ? '⌫' : 'Del';
}

/** Enter — Mac 관례대로 기호(`↵`)를 쓰고, 그 밖은 낱말로 적는다. */
export function enterKeyLabel(): string {
  return isMacLike() ? '↵' : 'Enter';
}

/** 이름 편집 — 앱은 `F2`와 `Enter`를 모두 받는다. Mac 키보드에서는 F 키가
 * Fn과 겹쳐 있어 `↵`가 실제로 누르기 쉬운 키다(표기를 그 기기의 것으로 고른다). */
export function renameKeyLabel(): string {
  return isMacLike() ? '↵' : 'F2';
}

/** 윈도·리눅스에서 수식 기호가 갖는 이름 — 표기 규칙은 그 OS의 관례를 따른다. */
const WIN_MOD: Record<string, string> = { '⌘': 'Ctrl', '⌃': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' };

/**
 * **맥 표기를 그 기기의 표기로**(요청) — `⌘⌥C` → 맥은 그대로, 그 밖은 `Ctrl+Alt+C`.
 *
 * 화면에 적는 단축키를 **맥 기호 한 벌**로만 들고 다니다가 그리는 자리에서 바꾼다.
 * 반대로(OS마다 문자열을 둘씩) 들면 하나를 고칠 때 다른 하나가 남아 조용히 어긋난다 —
 * 실제로 공책의 메뉴·팝업이 윈도에서도 `⌘`를 그대로 보여 주고 있었다.
 *
 * 수식 기호가 하나도 없으면(`⌫`·`↵`·`F2`) 그대로 둔다 — 그 글리프는 두 OS에서
 * 같은 키를 가리키거나, 이미 따로 고르는 함수가 있다(`deleteKeyLabel` 등).
 */
/** 수식 키가 붙지 않는 **홀로 선 글리프** — 윈도·리눅스에서는 낱말로 적는다. */
const WIN_SOLO: Record<string, string> = { '⌫': 'Del', '↵': 'Enter' };

export function keyLabel(spec: string): string {
  if (!spec || isMacLike()) return spec;
  /**
   * **홀로 선 맥 글리프도 바꾼다**(요청 8의 남은 자리 — 실브라우저 스크린샷에서 봤다).
   *
   * 예전에는 "수식 기호가 없으면 그대로 둔다"였다: `⌫`·`↵`는 두 OS에서 같은 키를
   * 가리킨다고 봤기 때문인데, **윈도 글꼴에는 그 글리프가 없어** 메뉴에 두부(□)가
   * 떴다. 같은 뜻을 가리켜도 읽히지 않으면 표기가 아니다.
   */
  if (WIN_SOLO[spec]) return WIN_SOLO[spec] as string;
  const mods: string[] = [];
  let rest = spec;
  while (rest && WIN_MOD[rest[0] as string]) {
    const name = WIN_MOD[rest[0] as string] as string;
    if (!mods.includes(name)) mods.push(name);
    rest = rest.slice(1);
  }
  if (!mods.length) return spec;
  // 글자 키는 대문자로(`Ctrl+C`), 기호·화살표는 생긴 그대로.
  return [...mods, /^[a-z]$/.test(rest) ? rest.toUpperCase() : rest].filter(Boolean).join('+');
}
