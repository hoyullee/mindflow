// 공책의 **동영상 블록** — 붙여넣은 주소를 "어떻게 틀까"로 읽는다(순수 함수).
//
// 본문에 드는 것은 주소 원문(`NoteBlock.src`)뿐이고, 재생 주소·썸네일은 여기서 그때그때
// 만든다 — 서비스가 embed 주소 모양을 바꿔도 이 한 곳만 고치면 옛 공책이 따라온다.
//
// 처음에는 **썸네일 + 재생 단추**만 그린다(iframe은 누른 뒤에) — 페이지에 동영상이
// 여럿이면 iframe마다 플레이어 스크립트를 수 MB씩 받는다. 그래서 썸네일이 있는 서비스
// (YouTube)는 그림을, 없는 서비스(Vimeo·Loom)는 서비스 이름이 든 판을 먼저 보인다.

export type VideoProvider = 'youtube' | 'vimeo' | 'loom' | 'file';

export interface VideoSource {
  provider: VideoProvider;
  /** iframe에 넣을 재생 주소(`file`이면 `<video>`의 `src` — 원문 그대로). */
  embed: string;
  /** 누르기 전 판에 깔 그림. 모르면 없다. */
  thumb?: string;
  /** 「원본 열기」가 여는 주소 — 사람이 붙인 그 주소. */
  url: string;
  /** 판에 적는 서비스 이름. */
  label: string;
}

const YT_ID = /^[\w-]{11}$/;
const FILE_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;

/** `1h2m3s` · `90` · `90s` → 초. 못 읽으면 0. */
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !m[0]) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function youtube(id: string, url: string, start: number): VideoSource {
  // `youtube-nocookie` — 누르기 전에는 아무것도 안 받지만, 누른 뒤에도 쿠키를 덜 남긴다.
  const params = new URLSearchParams({ autoplay: '1', rel: '0' });
  if (start > 0) params.set('start', String(start));
  return {
    provider: 'youtube',
    embed: `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`,
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    url,
    label: 'YouTube',
  };
}

/**
 * 주소 한 줄을 동영상으로 읽는다. 동영상이 아니면 `null`.
 *
 * 앞뒤 공백은 봐주지만 **주소 하나만** 받는다 — 문장 속의 주소는 링크로 두어야 한다
 * (붙여넣기 쪽의 "빈 문단에 통째로" 규칙과 같은 태도).
 */
export function parseVideoUrl(raw: string): VideoSource | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www\.|m\.)/, '').toLowerCase();
  const path = u.pathname.split('/').filter(Boolean);
  const start = seconds(u.searchParams.get('t') ?? u.searchParams.get('start'));

  if (host === 'youtu.be') {
    const id = path[0] ?? '';
    return YT_ID.test(id) ? youtube(id, text, start) : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (path[0] === 'watch') {
      const id = u.searchParams.get('v') ?? '';
      return YT_ID.test(id) ? youtube(id, text, start) : null;
    }
    if ((path[0] === 'shorts' || path[0] === 'embed' || path[0] === 'live' || path[0] === 'v') && path[1]) {
      return YT_ID.test(path[1]) ? youtube(path[1], text, start) : null;
    }
    return null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // `vimeo.com/123` · `vimeo.com/123/abcdef`(비공개 해시) · `player.vimeo.com/video/123`
    const seg = path[0] === 'video' ? path.slice(1) : path.filter((s) => s !== 'channels' && s !== 'staffpicks');
    const idAt = seg.findIndex((s) => /^\d+$/.test(s));
    if (idAt < 0) return null;
    const id = seg[idAt]!;
    const hash = u.searchParams.get('h') ?? (seg[idAt + 1] && /^[\da-f]+$/i.test(seg[idAt + 1]!) ? seg[idAt + 1] : null);
    const params = new URLSearchParams({ autoplay: '1' });
    if (hash) params.set('h', hash);
    return { provider: 'vimeo', embed: `https://player.vimeo.com/video/${id}?${params.toString()}${start > 0 ? `#t=${start}s` : ''}`, url: text, label: 'Vimeo' };
  }
  if (host === 'loom.com') {
    if ((path[0] === 'share' || path[0] === 'embed') && path[1] && /^[\da-f]{16,}$/i.test(path[1])) {
      return { provider: 'loom', embed: `https://www.loom.com/embed/${path[1]}?autoplay=1`, url: text, label: 'Loom' };
    }
    return null;
  }
  if (FILE_EXT.test(u.pathname)) {
    return { provider: 'file', embed: text, url: text, label: (path[path.length - 1] ?? '동영상').slice(0, 80) };
  }
  return null;
}
