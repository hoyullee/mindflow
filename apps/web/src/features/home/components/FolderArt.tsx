/**
 * 폴더 그림 — 모바일 스페이스(모바일 홈 디자인)의 그 그림 하나를 **PC 폴더 카드도 쓴다**(요청).
 * 안에 문서가 있으면 종이가 꽂힌 모양이고, 비었으면 앞판만 있다. 원본 크기는 56×50이고
 * `width`를 주면 같은 비율로 줄이거나 키운다(선 굵기도 함께 — 같은 그림이 작아질 뿐이다).
 *
 * 색은 `--mf-m-folder*` 토큰이다 — 이름은 모바일이지만 홈 테마 전체(`homeThemeVars`)가 싣는
 * 값이라 PC에서도 테마를 따라간다.
 */
export function FolderArt({ full, width = 56 }: { full: boolean; width?: number }) {
  const ink = 'var(--mf-m-folder-ink)';
  return (
    <svg data-folder-art={full ? 'full' : 'empty'} width={width} height={Math.round((width * 50) / 56)} viewBox="0 0 56 50" fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M5 11a3 3 0 0 1 3-3h11.2a3 3 0 0 1 2.2 1l2.8 3H48a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="var(--mf-m-folder)" stroke={ink} strokeWidth="1.4" />
      {full ? (
        <>
          <rect x="14" y="4" width="24" height="26" rx="2.5" fill="var(--mf-m-card)" stroke={ink} strokeWidth="1.4" />
          <path d="M19 11h14M19 15.5h14M19 20h9" stroke="var(--mf-m-faint)" strokeWidth="1.4" />
          <path d="M5 21a3 3 0 0 1 3-3h40a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="var(--mf-m-folder-front)" stroke={ink} strokeWidth="1.4" />
          <rect x="11" y="25" width="14" height="4" rx="2" fill="var(--mf-accent)" />
        </>
      ) : (
        <path d="M5 18a3 3 0 0 1 3-3h40a3 3 0 0 1 3 3v23a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="var(--mf-m-folder-front)" stroke={ink} strokeWidth="1.4" />
      )}
    </svg>
  );
}
