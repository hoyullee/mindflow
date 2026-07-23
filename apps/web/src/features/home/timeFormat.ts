// 맵 카드의 "마지막 수정 시각" 표기 — 파일 목록 도구들의 관례(Google Drive/
// Notion)를 따른다: 최근 것은 상대 시간("3시간 전" — 훑어볼 때 훨씬 빠르게
// 읽힘), 일주일이 지나면 절대 날짜(상대 표기는 오래될수록 부정확하고 무의미).
// 정확한 전체 일시는 카드에 마우스를 올렸을 때 툴팁(formatFullDateTime)으로.

/** ISO 시각 → 카드 표시용 문자열. 값이 없거나 epoch(메타 없던 옛 문서)면 ''. */
export function formatLastEdited(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return '';
  const diffMs = now.getTime() - t;
  if (diffMs < 60_000) return '방금 전'; // 미래 시각(기기 시계 왜곡)도 여기로
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(t);
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 툴팁용 전체 일시: "2026. 7. 23. 14:05". 값이 없으면 ''. */
export function formatFullDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const t = d.getTime();
  if (!Number.isFinite(t) || t <= 0) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${hh}:${mm}`;
}
