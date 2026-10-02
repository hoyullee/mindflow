// 첨부 파일 블록의 순수 규칙 — 아이콘 갈래 · 크기 글씨 · 막혔을 때의 문구.

import type { FileUploadError } from '../../adapters/ports';

export type FileKindKey = 'pdf' | 'doc' | 'sheet' | 'slide' | 'image' | 'video' | 'audio' | 'zip' | 'text' | 'code' | 'other';

export interface FileKind {
  key: FileKindKey;
  /** 카드 아랫줄에 붙는 이름 — `PDF 문서`. */
  label: string;
  /** 아이콘 칸의 글자 — 확장자(최대 4자). */
  badge: string;
  tint: string;
  ink: string;
}

const LOOK: Record<FileKindKey, { label: string; tint: string; ink: string }> = {
  pdf: { label: 'PDF 문서', tint: '#fbe3df', ink: '#c4442f' },
  doc: { label: '문서', tint: '#dfe9fb', ink: '#2f5fb8' },
  sheet: { label: '스프레드시트', tint: '#dcf2e3', ink: '#24814a' },
  slide: { label: '프레젠테이션', tint: '#fdebd8', ink: '#c06a17' },
  image: { label: '이미지', tint: '#efe3fb', ink: '#7b45b8' },
  video: { label: '동영상', tint: '#e3e6f0', ink: '#3d4660' },
  audio: { label: '오디오', tint: '#e0f3f4', ink: '#227a80' },
  zip: { label: '압축 파일', tint: '#f1ead9', ink: '#7d6431' },
  text: { label: '텍스트', tint: '#ececec', ink: '#555555' },
  code: { label: '코드', tint: '#e6ecef', ink: '#3b5563' },
  other: { label: '파일', tint: '#ececec', ink: '#666666' },
};

const BY_EXT: Record<string, FileKindKey> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', hwp: 'doc', hwpx: 'doc', pages: 'doc', rtf: 'doc', odt: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', numbers: 'sheet', ods: 'sheet', tsv: 'sheet',
  ppt: 'slide', pptx: 'slide', key: 'slide', odp: 'slide',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', heic: 'image', bmp: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', ogg: 'audio',
  zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip', tgz: 'zip',
  txt: 'text', md: 'text', log: 'text',
  json: 'code', js: 'code', ts: 'code', tsx: 'code', py: 'code', java: 'code', sql: 'code', html: 'code', css: 'code', xml: 'code', yml: 'code', yaml: 'code',
};

/** 확장자(점 뒤, 소문자). 없으면 빈 문자열. */
export function extOf(name: string): string {
  const at = name.lastIndexOf('.');
  return at > 0 && at < name.length - 1 ? name.slice(at + 1).toLowerCase() : '';
}

/** 이름(확장자)을 먼저, 모르면 MIME으로 갈래를 정한다. */
export function fileKindOf(name: string, mime?: string): FileKind {
  const ext = extOf(name);
  let key: FileKindKey = BY_EXT[ext] ?? 'other';
  if (key === 'other' && mime) {
    if (mime === 'application/pdf') key = 'pdf';
    else if (mime.startsWith('image/')) key = 'image';
    else if (mime.startsWith('video/')) key = 'video';
    else if (mime.startsWith('audio/')) key = 'audio';
    else if (mime.startsWith('text/')) key = 'text';
  }
  const look = LOOK[key];
  const badge = (ext || (key === 'other' ? 'FILE' : key)).slice(0, 4).toUpperCase();
  return { key, label: look.label, badge, tint: look.tint, ink: look.ink };
}

/** 브라우저가 바로 보여 줄 수 있는 갈래 — 누르면 새 탭에서 연다(나머지는 받는다). */
export function isPreviewable(key: FileKindKey): boolean {
  return key === 'pdf' || key === 'image' || key === 'video' || key === 'audio' || key === 'text';
}

/** `2.4MB` · `812KB` · `0B`. 1000이 아니라 1024로 — 한도(200MB = 200×1024²)와 같은 자로 잰다. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0B';
  if (n < 1024) return `${n}B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}GB`;
}

/** 올리기가 막힌 까닭 → 화면 문구. 숫자는 서버가 알려 준 한도를 그대로 쓴다. */
export function fileUploadMessage(e: FileUploadError): string {
  switch (e.reason) {
    case 'too-large':
      return e.detail.fileLimit ? `파일 하나는 ${formatBytes(e.detail.fileLimit)}까지 올릴 수 있어요` : '파일이 너무 커요';
    case 'quota':
      return e.detail.limit ? `저장 공간이 부족해요 — ${formatBytes(e.detail.used ?? 0)} / ${formatBytes(e.detail.limit)} 사용 중` : '저장 공간이 부족해요';
    case 'forbidden':
      return '이 공책에 파일을 올릴 권한이 없어요';
    case 'not-configured':
      return '파일 첨부는 아직 준비 중이에요';
    case 'network':
      return '올리지 못했어요 — 연결을 확인하고 다시 시도해 주세요';
    case 'aborted':
      return '올리기를 멈췄어요';
    case 'missing':
      return '올린 파일을 찾지 못했어요 — 다시 시도해 주세요';
    default:
      return '올리지 못했어요 — 다시 시도해 주세요';
  }
}
