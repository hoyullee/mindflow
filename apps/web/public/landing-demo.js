/* 랜딩 히어로 데모 인핸서 — 정적 landing.html의 head에서 블로킹 로드된다
 * (defer 없음 — 이유는 아래 [1]).
 *
 * 원칙(프로그레시브 인핸스먼트): 이 파일이 실행되지 않아도(크롤러·JS 꺼짐)
 * 랜딩은 완성 상태의 폴백 SVG 한 장으로 온전히 보인다. 실행되면 그 자리를
 * React 쌍둥이(src/features/landing/Landing.tsx의 DemoMap)와 같은 인터랙티브
 * 데모로 교체한다 — 등장 애니메이션(480ms, rev 1→7)·가지 토글·"처음부터"·
 * 축소 스케일. 지오메트리·색·타이밍을 DemoMap과 동기화할 것.
 * 외부 요청 없음(순수 DOM 조작만). */
(() => {
  'use strict';

  // [1] head 실행 시점(=body 파싱 전)에 폴백 SVG를 가리는 스타일을 심는다 —
  // 첫 페인트에 완성 맵이 그려졌다가 걷히는 깜빡임 방지. JS가 없으면 이
  // 스타일 자체가 없으므로 폴백이 그대로 보인다(별도 noscript 불필요).
  // 직계 자식 svg만 — 아래에서 만드는 인터랙티브 svg는 래퍼 div 안이라 무관.
  const veil = document.createElement('style');
  veil.textContent = '.demo-canvas > svg { visibility: hidden }';
  document.head.appendChild(veil);

  const init = () => {
  const canvas = document.querySelector('#demo .demo-canvas');
  const bar = document.querySelector('#demo .demo-bar');
  if (!canvas || !bar) {
    veil.remove(); // 마크업이 예상과 다르면 손대지 않고 폴백 복원
    return;
  }

  const RX = 320;
  const RY = 210;
  const BRANCHES = [
    { id: 'a1', side: -1, y: 66, color: '#EF8F30', label: '메시지', children: ['핵심 한 줄', '타깃별 문구'] },
    { id: 'a2', side: -1, y: 210, color: '#7CA84A', label: '채널', children: ['블로그', '뉴스레터'] },
    { id: 'a3', side: -1, y: 354, color: '#E0447E', label: '리스크', children: ['재고', '문의 대응'] },
    { id: 'a4', side: 1, y: 66, color: '#EE6146', label: '일정', children: ['프리뷰 주간', 'D-Day'] },
    { id: 'a5', side: 1, y: 210, color: '#E3B93C', label: '채널별 예산', children: ['광고', '콘텐츠'] },
    { id: 'a6', side: 1, y: 354, color: '#2FAF9A', label: '성과 지표', children: ['가입 수', '유지율'] },
  ];

  // 폴백 SVG를 걷어내고 640×420 고정 좌표계 박스를 세운다
  const fallback = canvas.querySelector('svg');
  if (fallback) fallback.remove();
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:50%;top:50%;width:640px;height:420px;transform:translate(-50%,-50%);transform-origin:center center';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 640 420');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;inset:0;width:640px;height:420px';
  box.appendChild(svg);
  canvas.insertBefore(box, canvas.firstChild);

  let rev = 1; // 등장 단계: 1=중심만 → 7=가지 6개 전부
  const exp = {}; // 가지별 펼침 상태
  const items = []; // render()가 상태를 다시 칠할 대상들

  const baseCss = (x, y) =>
    'position:absolute;left:' + x + 'px;top:' + y + 'px;' +
    'transition:opacity .45s ease, transform .45s cubic-bezier(.2,.9,.3,1.3);' +
    'white-space:nowrap;font-family:inherit;letter-spacing:-.01em;cursor:default;';

  const mkNode = (x, y, css, visible, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = baseCss(x, y) + css;
    if (onClick) {
      b.style.cursor = 'pointer';
      b.addEventListener('click', onClick);
    }
    box.appendChild(b);
    items.push({
      apply() {
        const v = visible();
        b.style.opacity = v ? '1' : '0';
        b.style.transform = 'translate(-50%,-50%) scale(' + (v ? 1 : 0.72) + ')';
        b.style.pointerEvents = v ? 'auto' : 'none';
        b.tabIndex = v && onClick ? 0 : -1;
        b.setAttribute('aria-hidden', String(!v));
      },
    });
    return b;
  };

  const mkLine = (d, color, width, maxOpacity, visible) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.style.cssText = 'stroke:' + color + ';stroke-width:' + width + ';stroke-linecap:round;transition:opacity .5s ease';
    svg.appendChild(p);
    items.push({
      apply() {
        p.style.opacity = visible() ? String(maxOpacity) : '0';
      },
    });
  };

  const render = () => items.forEach((it) => it.apply());

  const root = mkNode(
    RX,
    RY,
    'padding:14px 26px;font-size:17px;font-weight:700;color:#fff;border-radius:14px;border:1px solid #E85E33;background:linear-gradient(180deg,#F2764C,#E85E33);box-shadow:0 12px 26px -12px rgba(232,94,51,.65)',
    () => rev >= 1,
    null,
  );
  root.textContent = '신제품 런치 플랜';

  BRANCHES.forEach((b, i) => {
    const bx = RX + b.side * 158;
    const by = b.y;
    const vis = () => rev >= i + 2;
    const open = () => !!exp[b.id];
    const toggle = () => {
      exp[b.id] = !exp[b.id];
      render();
    };

    const node = mkNode(
      bx,
      by,
      'padding:9px 16px;font-size:14px;font-weight:600;color:#3A352F;min-width:104px;text-align:center;box-sizing:border-box;border-radius:10px;background:#FFFDFB;border:1.5px solid ' + b.color + ';box-shadow:0 4px 12px -8px rgba(46,42,38,.45)',
      vis,
      toggle,
    );
    node.textContent = b.label;

    const t = mkNode(
      bx + b.side * 52,
      by,
      'width:19px;height:19px;padding:0;display:flex;align-items:center;justify-content:center;line-height:1;font-size:12px;font-weight:700;color:' + b.color + ';border-radius:999px;background:#FFFDFB;border:1.5px solid ' + b.color,
      vis,
      toggle,
    );
    items.push({
      apply() {
        t.textContent = open() ? '−' : '+';
      },
    });

    const sx = RX + b.side * 62;
    mkLine('M' + sx + ' ' + RY + ' C ' + (sx + b.side * 60) + ' ' + RY + ', ' + (bx - b.side * 70) + ' ' + by + ', ' + bx + ' ' + by, b.color, 3, 1, vis);

    b.children.forEach((label, j) => {
      const cx = bx + b.side * 128;
      const cy = by + (j === 0 ? -38 : 38);
      const cvis = () => vis() && open();
      const c = mkNode(
        cx,
        cy,
        'padding:7px 13px;font-size:12.5px;font-weight:500;color:#5C564E;border-radius:8px;background:#FFFDFB;border:1.5px solid ' + b.color + '66',
        cvis,
        null,
      );
      c.textContent = label;
      const cs = bx + b.side * 62;
      mkLine('M' + cs + ' ' + by + ' C ' + (cs + b.side * 46) + ' ' + by + ', ' + (cx - b.side * 58) + ' ' + cy + ', ' + cx + ' ' + cy, b.color, 2.2, 0.9, cvis);
    });
  });

  let timer;
  const play = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (rev >= 7) {
        clearInterval(timer);
        return;
      }
      rev += 1;
      render();
    }, 480);
  };

  // 데모 바의 자리표시 스페이서 → "처음부터" 버튼(무JS에선 버튼이 없어야 하므로 여기서 주입)
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'demo-reset';
  reset.textContent = '처음부터';
  reset.addEventListener('click', () => {
    rev = 1;
    for (const k of Object.keys(exp)) delete exp[k];
    render();
    play();
  });
  const spacer = bar.lastElementChild;
  if (spacer && !spacer.classList.contains('demo-url')) spacer.replaceWith(reset);
  else bar.appendChild(reset);

  // 캔버스가 664×436(여백 12px 포함)보다 좁으면 통째로 축소
  const measure = () => {
    const s = Math.min(1, canvas.clientWidth / 664, canvas.clientHeight / 436);
    box.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  };
  measure();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(canvas);

  const hint = canvas.querySelector('.demo-hint');
  if (hint) hint.textContent = '노드를 눌러 가지를 펼쳐 보세요';

  render();
  play();
  };

  const boot = () => {
    try {
      init();
    } catch (e) {
      veil.remove(); // 어떤 이유로든 실패하면 폴백 SVG를 되살린다
      throw e;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
