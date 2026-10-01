/**
 * 클립보드의 평문 — **줄 끝을 `\n` 하나로** 맞춰 읽는다.
 *
 * 왜(제보): 윈도우에서 코드 블록의 글을 잘라내기·붙여넣기하면 줄 사이에 빈 줄이 하나씩
 * 늘었다(두 번 하면 더). 윈도우의 클립보드는 평문의 줄 끝을 `\r\n`으로 싣는데, 우리는
 * 그것을 그대로 글자로 넣었다 — `\n`은 `<br>`이 되고 남은 `\r`은 `white-space: pre-wrap`
 * 안에서 **또 한 번의 줄바꿈**으로 그려졌다. 값에도 `\r`이 남아 다음 잘라내기에서
 * `\r\r\n`으로 불어났다. 맥·리눅스는 `\n`만 실어서 재현되지 않는다.
 *
 * 그래서 평문을 읽는 자리는 모두 이 함수를 거친다(`\r\n`·홀로 선 `\r` → `\n`).
 *
 * **`\r`이 몇 개 앞서든 줄바꿈 하나**로 본다(`\r\r\n` → `\n`). 이미 `\r`이 들어가 저장된
 * 코드 블록을 윈도우에서 잘라내면 글자 `\r` + 줄바꿈 `\r\n`이 실려 `\r\r\n`이 된다 —
 * 그것도 한 줄로 읽어야 한 번의 잘라내기·붙여넣기로 **예전 판이 낫는다**.
 */
export function clipText(data: DataTransfer | null | undefined): string {
  return normalizeNewlines(data?.getData('text/plain') ?? '');
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r*\n|\r+/g, '\n');
}
