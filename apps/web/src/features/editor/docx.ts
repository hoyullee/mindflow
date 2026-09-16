// 공책 → Word 문서(.docx) — **압축하지 않는 zip**을 직접 쓴다.
//
// `.docx`는 XML 몇 장을 담은 zip이다. 라이브러리를 들이는 대신 여기서 zip을 쓰는 이유:
// 우리가 넣을 것은 작은 XML 셋뿐이고, zip은 **압축 없이(stored)** 담아도 완전히
// 유효하다 — Word·한글·Pages 모두 그대로 연다. 그래서 필요한 것은 CRC32와 헤더 두
// 종류가 전부이고, deflate 구현이 필요 없다(그게 라이브러리를 쓰는 유일한 이유였다).
//
// 한글은 XML이 UTF-8이라 그냥 실린다 — PDF와 갈리는 지점이다(그쪽은 글꼴을 파일에
// 심어야 해서 훨씬 큰 일이다).

import type { Doc } from '@mindflow/mindmap-core';
import { noteLines, notePagesFor, type NoteExportScope } from '@mindflow/mindmap-core';
import { downloadFile } from './download';

/** CRC32 — zip 항목마다 필요하다. 표를 한 번 만들어 두고 재사용한다. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** 압축하지 않는 zip 한 덩이(로컬 헤더들 + 중앙 디렉터리 + 끝 기록). */
function zip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // 로컬 파일 헤더
    lv.setUint16(4, 20, true); // 필요 버전
    lv.setUint16(6, 0x0800, true); // UTF-8 이름
    lv.setUint16(8, 0, true); // 압축 없음(stored)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, e.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); // 중앙 디렉터리 헤더
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + e.data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // 끝 기록
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** XML 문자 이스케이프 — 본문에 `<`나 `&`가 있으면 문서가 깨진다. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 한 문단 — `style`은 아래 `styles.xml`에 정의한 이름이다. */
function para(text: string, style: string, indent = 0): string {
  const ind = indent ? `<w:ind w:left="${indent * 400}"/>` : '';
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${ind}</w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

/** 공책(또는 한 페이지)을 `.docx`로 내려받는다. */
export function exportDocx(doc: Doc, title: string, scope: NoteExportScope, pageId: string | null, filename: string): void {
  const pages = notePagesFor(doc, scope, pageId);
  const body: string[] = [];
  if (scope === 'book' && title) body.push(para(title, 'Title'));
  for (const page of pages) {
    body.push(para(page.title.trim() || '제목 없는 페이지', scope === 'book' ? 'Heading1' : 'Title'));
    for (const l of noteLines(page)) {
      if (l.kind === 'h1') body.push(para(l.text, 'Heading1', l.depth));
      else if (l.kind === 'h2') body.push(para(l.text, 'Heading2', l.depth));
      else if (l.kind === 'h3') body.push(para(l.text, 'Heading3', l.depth));
      else if (l.kind === 'li') body.push(para(`• ${l.text}`, 'Normal', l.depth + 1));
      else if (l.kind === 'oli') body.push(para(`- ${l.text}`, 'Normal', l.depth + 1));
      else if (l.kind === 'todo') body.push(para(`☐ ${l.text}`, 'Normal', l.depth + 1));
      else if (l.kind === 'done') body.push(para(`☑ ${l.text}`, 'Normal', l.depth + 1));
      else if (l.kind === 'quote') body.push(para(l.text, 'Quote', l.depth));
      else if (l.kind === 'code') body.push(para(l.text, 'Code', l.depth));
      else if (l.kind === 'hr') body.push(para('────────', 'Normal', l.depth));
      else if (l.kind === 'table' && l.rows?.length) for (const r of l.rows) body.push(para(r.join('    '), 'Normal', l.depth));
      else body.push(para(l.text, 'Normal', l.depth));
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418"/></w:sectPr></w:body></w:document>`;

  const style = (id: string, name: string, size: number, bold: boolean, color = '333333'): string =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}<w:color w:val="${color}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${style('Normal', 'Normal', 22, false)}${style('Title', 'Title', 44, true)}${style('Heading1', 'heading 1', 32, true)}${style('Heading2', 'heading 2', 28, true)}${style('Heading3', 'heading 3', 24, true)}${style('Quote', 'Quote', 22, false, '6E675F')}${style('Code', 'Code', 20, false, '332E29')}</w:styles>`;

  const files: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    },
    {
      name: '_rels/.rels',
      data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    },
    { name: 'word/document.xml', data: enc(document) },
    { name: 'word/styles.xml', data: enc(styles) },
  ];

  const bytes = zip(files);
  downloadFile(`${filename}.docx`, new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

/** 테스트용 — 만든 zip을 항목 이름으로 되읽는다(형식이 유효한지 확인). */
export function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < bytes.length - 4; i += 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      const v = new DataView(bytes.buffer, bytes.byteOffset + i);
      const len = v.getUint16(26, true);
      names.push(dec.decode(bytes.subarray(i + 30, i + 30 + len)));
    }
  }
  return names;
}

/** 테스트용 — 파일을 내려받지 않고 바이트만. */
export function buildDocxZip(entries: { name: string; text: string }[]): Uint8Array {
  return zip(entries.map((e) => ({ name: e.name, data: enc(e.text) })));
}
