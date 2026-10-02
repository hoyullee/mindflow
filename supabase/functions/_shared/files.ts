// 공책 파일 첨부(`files`·`files-sweep` 함수) 공용 — R2 접속, 서명 URL, 입력 정리.
//
// 순수 함수와 `fetch` 한 겹뿐이라 Supabase 없이도 시험할 수 있다(backend/28-note-files.md).
// 파일 **본체는 R2**에 있고 브라우저가 서명 URL로 직접 주고받는다 — 바이트가 우리 함수를
// 지나지 않는다(함수 실행 시간·메모리·송신 한도를 먹지 않으려는 것이다).

import { AwsClient } from 'npm:aws4fetch@1.0.20';

export interface R2Config {
  accountId: string;
  bucket: string;
  client: AwsClient;
}

/** 서명 URL이 유효한 시간(초). 업로드는 느린 회선을 봐서 15분, 내려받기는 열자마자 쓰므로 10분. */
export const UPLOAD_TTL_SEC = 15 * 60;
export const DOWNLOAD_TTL_SEC = 10 * 60;

/**
 * R2 환경변수 넷이 **모두** 있어야 설정된 것이다. 하나라도 없으면 null —
 * 호출자는 200 `{ ok:false, reason:'not-configured' }`로 물러난다(설정 전에도 앱이 깨지지 않게).
 */
export function readR2Config(env: { get(k: string): string | undefined } = Deno.env): R2Config | null {
  const accountId = env.get('R2_ACCOUNT_ID') ?? '';
  const accessKeyId = env.get('R2_ACCESS_KEY_ID') ?? '';
  const secretAccessKey = env.get('R2_SECRET_ACCESS_KEY') ?? '';
  const bucket = env.get('R2_BUCKET') ?? '';
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  // R2는 리전이 없고 SigV4 서명에는 'auto'를 쓴다.
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  return { accountId, bucket, client };
}

/** 객체 키 = `<docId>/<fileId>`. 사용자가 정한 파일 이름은 **절대** 키에 들어가지 않는다. */
export function objectKey(docId: string, fileId: string): string {
  return `${docId}/${fileId}`;
}

/** 키의 각 마디를 퍼센트 인코딩해 R2 URL로 만든다(문서 id가 어떤 글자를 담아도 경로가 갈라지지 않게). */
export function objectUrl(cfg: R2Config, key: string): URL {
  const path = key.split('/').map(encodeURIComponent).join('/');
  return new URL(`https://${cfg.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(cfg.bucket)}/${path}`);
}

/**
 * 쿼리 서명(presigned) URL. `headers`에 준 것은 **서명에 포함**되어, 브라우저가 같은 값을
 * 보내지 않으면 R2가 403으로 거절한다(PUT의 Content-Type을 고정하려는 용도).
 * `query`는 서명 **전에** 붙인다(`response-content-disposition` 등 — 서명 뒤에 붙이면 무효).
 */
export async function presign(
  cfg: R2Config,
  key: string,
  method: 'GET' | 'PUT',
  ttlSec: number,
  opts: { headers?: Record<string, string>; query?: Record<string, string> } = {},
): Promise<string> {
  const url = objectUrl(cfg, key);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  url.searchParams.set('X-Amz-Expires', String(ttlSec));
  const signed = await cfg.client.sign(url.toString(), {
    method,
    headers: opts.headers,
    // allHeaders: aws4fetch는 기본으로 content-type·content-length 등을 서명에서 **뺀다** — 켜지 않으면
    // PUT 서명 URL의 `Content-Type`이 서명되지 않아(SignedHeaders=host) 브라우저가 아무 형식으로나 올릴 수 있다.
    // (하네스가 SignedHeaders를 읽어 잡았다. 생성자가 아니라 **요청마다** 주는 옵션이다.)
    aws: { signQuery: true, allHeaders: true },
  });
  // URLSearchParams는 공백을 `+`로 쓴다 — 서명은 `%20`로 계산되고 S3 호환 서버가 `+`를 공백으로 읽는지는
  // 구현마다 다르므로, 어느 쪽이 읽어도 같은 뜻이 되게 `%20`으로 바꿔 내보낸다(리터럴 `+`는 이미 `%2B`다).
  return signed.url.replace(/\+/g, '%20');
}

/** 크기 헤더 하나를 읽는다 — **없으면 null**(`Number(null)`은 0이라 그대로 쓰면 "0바이트"가 된다). */
export function lengthOf(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** `Content-Range: bytes 0-0/12345` → 12345. 모르면 null. */
export function totalOfRange(raw: string | null): number | null {
  const m = raw ? /\/(\d+)\s*$/.exec(raw) : null;
  return m ? Number(m[1]) : null;
}

/**
 * 실제 객체의 크기를 잰다. 없으면 null, 그 밖의 실패는 던진다(없음과 장애를 섞지 않는다).
 *
 * **크기 헤더가 빠진 응답을 0으로 읽지 않는다**(제보: md 파일이 `0B`로 보였다). 글자 형식(`text/*`)은
 * 압축된 채로 오면 길이를 미리 알 수 없어 `Content-Length`가 빠지고, Deno의 fetch는 압축을 풀면서 그
 * 헤더를 지운다 — 예전 코드는 `Number(null)` = 0을 그대로 크기로 적었다. 그래서 ① 압축하지 말라고
 * 묻고(`Accept-Encoding: identity`) ② 그래도 없으면 첫 바이트만 받아 `Content-Range`의 전체 길이를 읽는다.
 */
export async function headObjectSize(cfg: R2Config, key: string): Promise<number | null> {
  const url = objectUrl(cfg, key).toString();
  const res = await cfg.client.fetch(url, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
  const n = lengthOf(res.headers.get('content-length'));
  if (n !== null) return n;
  const part = await cfg.client.fetch(url, { method: 'GET', headers: { 'Accept-Encoding': 'identity', Range: 'bytes=0-0' } });
  await part.body?.cancel();
  if (part.status === 404) return null;
  // 0바이트 파일은 범위를 줄 수 없어 416(또는 200 + 길이 0)이 온다 — 그때만 진짜 0이다.
  if (part.status === 416) return 0;
  if (!part.ok) throw new Error(`R2 GET range ${part.status}`);
  const total = totalOfRange(part.headers.get('content-range')) ?? (part.status === 200 ? lengthOf(part.headers.get('content-length')) : null);
  if (total === null) throw new Error('R2 object size unknown');
  return total;
}

/** 객체를 지운다. 이미 없으면(404) 지운 것으로 친다 — 재시도가 안전하도록. */
export async function deleteObject(cfg: R2Config, key: string): Promise<void> {
  const res = await cfg.client.fetch(objectUrl(cfg, key).toString(), { method: 'DELETE' });
  if (res.status === 404 || res.ok) return;
  throw new Error(`R2 DELETE ${res.status}`);
}

// ── 입력 정리 ─────────────────────────────────────────────────────────────

/** 이름 상한(글자 수). */
export const NAME_MAX = 200;
/** MIME 상한(글자 수). */
export const MIME_MAX = 120;

/**
 * 파일 이름을 저장 가능한 모양으로: 제어문자·경로 구분자(`/` `\`)를 걷어내고 앞뒤 공백을 자른다.
 * 200자를 넘으면 **확장자(20자 이하일 때)를 살려** 앞을 자른다. 비면 null(요청 거절).
 * 이름은 표시와 `Content-Disposition`에만 쓰이고 객체 키에는 쓰이지 않는다.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // deno-lint-ignore no-control-regex
  // eslint-disable-next-line no-control-regex
  let name = raw.replace(/[\u0000-\u001f\u007f\u0080-\u009f/\\]/g, '').trim();
  // 점만 남는 이름(`..`)은 파일 이름으로 쓰지 않는다.
  if (!name || /^\.+$/.test(name)) return null;
  if (name.length > NAME_MAX) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 20 ? name.slice(dot) : '';
    name = name.slice(0, NAME_MAX - ext.length) + ext;
  }
  return name;
}

/**
 * MIME을 헤더에 안전하게: 제어문자를 걷어내고 120자로 자른다. 비면 기본값.
 * 이 값이 서명된 `Content-Type`이 되므로 응답의 `headers`로 **그대로** 돌려준다 —
 * 클라이언트는 자기가 보낸 값이 아니라 응답에 담긴 값을 쓴다.
 */
export function sanitizeMime(raw: unknown): string {
  if (typeof raw !== 'string') return 'application/octet-stream';
  // deno-lint-ignore no-control-regex
  // eslint-disable-next-line no-control-regex
  const mime = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MIME_MAX);
  return mime || 'application/octet-stream';
}

/** RFC 5987 `filename*` 값. `encodeURIComponent`가 남기는 `' ( ) *`도 인코딩한다. */
function rfc5987(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `Content-Disposition` 값: `attachment; filename="<ASCII 대체>"; filename*=UTF-8''<인코딩>`.
 * 비 ASCII·따옴표·역슬래시·`%`는 ASCII 대체 쪽에서 `_`로 바꾼다(`filename*`를 모르는 낡은 클라이언트용).
 */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${rfc5987(name)}`;
}

/**
 * 브라우저가 **페이지처럼 실행**할 수 있는 형식인가. `inline`으로 열면 R2 출처(우리 앱과는 다른
 * 출처)에서 스크립트가 도는 피싱 면이 되므로, 이런 형식은 `inline`을 요청해도 첨부로 내려 준다.
 */
export function isActiveContent(mime: string): boolean {
  const m = mime.split(';')[0].trim().toLowerCase();
  return (
    m === 'text/html' ||
    m === 'application/xhtml+xml' ||
    m === 'image/svg+xml' ||
    m === 'text/xml' ||
    m === 'application/xml' ||
    m === 'text/javascript' ||
    m === 'application/javascript' ||
    m.endsWith('+xml')
  );
}
