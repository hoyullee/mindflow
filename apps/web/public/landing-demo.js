/*
 * 정적 랜딩(public/landing.html)의 히어로 창을 인터랙티브하게 올려 주는
 * 프로그레시브 인핸서. 계약은 "모든 내용이 JS 없이 원문 HTML에 보인다"이므로
 * 원문에는 **마인드맵 장면이 그대로** 들어 있고, 이 파일은 그 창을 세 보기로
 * 번갈아 보여 주고 탭으로 고정할 수 있게 만든다(React 쌍둥이 Landing.tsx의
 * HeroWindow와 같은 동작·같은 데이터).
 *
 * 첫 화면이 폴백과 동일하므로 예전 버전에 있던 가림막(veil)이 필요하지 않다.
 * 실패하거나 JS가 꺼져 있으면 원문 그대로 — 마인드맵 장면 한 장이 남는다.
 *
 * ⚠️ 장면 데이터는 src/features/landing/landingData.ts와 동기화할 것.
 */
(function () {
  'use strict';

  // 첫 페인트 전에(=이 스크립트는 head에서 블로킹 로드된다) 스크롤 등장을 켠다.
  // 숨기는 CSS 규칙이 `html.lp-js` 아래에만 있으므로, JS가 없으면 아래 섹션이
  // 그대로 보이고(크롤러 계약) 있으면 화면에 들어올 때 하나씩 올라온다.
  var docEl = document.documentElement;
  docEl.classList.add('lp-js');

  var CORAL = '#EE6B45';
  var ROTATE_MS = 6200;
  var HOLD_MS = 14000;

  var BASE = {
    align: 'center', justify: 'flex-start', pad: '0 10px', r: '10px', bg: '#FFFDFB',
    border: '1px solid #EADFD4', shadow: '0 8px 18px -14px rgba(46,42,38,.5)',
    color: '#3A352F', fs: '11.5px', fw: 600, text: '',
  };

  function box(l, t, w, h, o) {
    var d = {};
    for (var k in BASE) d[k] = BASE[k];
    d.l = l + '%'; d.t = t + '%'; d.w = w + '%'; d.h = h + '%';
    for (var j in o || {}) d[j] = o[j];
    return d;
  }

  var TONE = { y: ['#FCF4C9', '#EEDD8F'], p: ['#FBDCD5', '#F0BEB1'], g: ['#E4F1E8', '#C2DCBE'], w: ['#FFFDFB', '#EADFD4'] };
  function note(l, t, w, h, text, tone) {
    return box(l, t, w, h, {
      text: text, align: 'flex-start', pad: '9px 10px', r: '11px', fs: '11px',
      bg: TONE[tone][0], border: '1px solid ' + TONE[tone][1], shadow: '0 10px 20px -14px rgba(46,42,38,.5)',
    });
  }

  function column(l, title, cards) {
    var out = [
      box(l, 6, 27, 88, { text: '', bg: '#FDFAF7', border: '1px solid #EFE4DA', shadow: 'none', r: '13px' }),
      box(l + 2, 10, 23, 9, { text: title, bg: 'transparent', border: '0', shadow: 'none', fs: '10.5px', fw: 800, color: '#8A8078', pad: '0 4px' }),
    ];
    cards.forEach(function (c, i) {
      out.push(box(l + 2, 22 + i * 20, 23, 17, {
        text: c[0], align: 'flex-start', pad: '8px 9px', fs: '10.5px', r: '9px',
        border: '1px solid ' + (c[1] ? '#F5D9CD' : '#F1E7DE'), shadow: '0 8px 16px -13px rgba(46,42,38,.5)',
      }));
    });
    return out;
  }

  var SCENES = {
    mind: {
      file: '신제품 런치 플랜', caption: 'Tab 한 번이면 하위 주제가 붙어요', hint: 'Tab · Enter',
      pin: ['5%', '84%'], pinText: '채널은 3개까지만',
      edges: [
        ['M31 49 C37 49, 37 18, 43 18', '#E9A98F', '.05s'],
        ['M31 49 C37 49, 37 46, 43 46', '#E9A98F', '.12s'],
        ['M31 49 C37 49, 37 74, 43 74', '#E9A98F', '.19s'],
        ['M67 18 C71 18, 71 12, 74 12', '#DFCDA0', '.3s'],
        ['M67 18 C71 18, 71 28, 74 28', '#DFCDA0', '.36s'],
        ['M67 74 C71 74, 71 68, 74 68', '#B9D3BB', '.42s'],
      ],
      items: [
        box(6, 42, 25, 15, { text: '신제품 런치', bg: CORAL, border: '1px solid ' + CORAL, color: '#fff', fw: 800, fs: '12.5px', r: '99px', justify: 'center', pad: '0 8px' }),
        box(43, 12, 24, 13, { text: '메시지 정리' }),
        box(43, 40, 24, 13, { text: '채널 선정' }),
        box(43, 68, 24, 13, { text: '출시 일정' }),
        box(74, 6, 21, 12, { text: '핵심 문구', bg: '#FCF4C9', border: '1px solid #EEDD8F', fs: '11px' }),
        box(74, 22, 21, 12, { text: '경쟁 비교', bg: '#FCF4C9', border: '1px solid #EEDD8F', fs: '11px' }),
        box(74, 62, 21, 12, { text: 'D-14 티저', bg: '#E4F1E8', border: '1px solid #C2DCBE', fs: '11px' }),
      ],
    },
    board: {
      file: '문제 정의 워크숍', caption: '메모를 붙이고 영역으로 묶어요', hint: 'drag · frame',
      pin: ['50%', '84%'], pinText: '여기 투표할까요?', edges: [],
      items: [
        box(5, 8, 40, 84, { text: '', bg: 'rgba(74,143,224,.05)', border: '1.5px dashed #A9C4EA', shadow: 'none', r: '13px' }),
        note(9, 16, 15, 24, '지금 막히는 지점', 'y'),
        note(27, 14, 15, 22, '고객 문의 3건', 'y'),
        note(9, 46, 15, 22, '온보딩 이탈', 'p'),
        note(27, 42, 15, 26, '가격표 혼동', 'p'),
        note(15, 72, 22, 16, '다음 액션 2개', 'g'),
        note(52, 12, 20, 30, '아이디어 스티커', 'w'),
        note(76, 20, 19, 26, '스케치 첨부', 'w'),
        note(56, 56, 24, 22, '투표로 좁히기', 'y'),
      ],
    },
    kanban: {
      file: '8월 스프린트', caption: '카드를 옮기면 상태가 바뀌어요', hint: 'drag · ⌘D',
      pin: ['37%', '72%'], pinText: '이건 다음 주로', edges: [],
      items: column(5, '할 일', [['랜딩 카피 정리'], ['가격 실험 설계', true], ['FAQ 보강']])
        .concat(column(37, '진행 중', [['온보딩 재설계'], ['리텐션 지표']]))
        .concat(column(69, '완료', [['공유 링크 개선'], ['버그 12건 정리'], ['8월 회고']])),
    },
  };

  var ORDER = ['mind', 'board', 'kanban'];

  function start() {
    var root = document.querySelector('[data-hero-demo]');
    if (!root) return;
    var canvas = root.querySelector('[data-canvas]');
    var edgeSvg = root.querySelector('[data-edges]');
    var fileEl = root.querySelector('[data-file]');
    var capEl = root.querySelector('[data-caption]');
    var hintEl = root.querySelector('[data-hint]');
    var pinEl = root.querySelector('[data-pin]');
    var pinTextEl = root.querySelector('[data-pin-text]');
    var tabs = [].slice.call(root.querySelectorAll('[data-mode]'));
    if (!canvas || !edgeSvg || !fileEl || !tabs.length) return;

    var tick = 0;
    var flip = 0;
    var pinned = null;
    var holdT = null;
    var rotT = null;

    function draw(key) {
      var s = SCENES[key];
      if (!s) return;
      var anim = flip ? 'lp-in-a' : 'lp-in-b';

      // 도형: 이전 장면을 걷어내고 새로 그린다(핀·커서·엣지는 그대로 둔다).
      [].slice.call(canvas.querySelectorAll('.lp-shape')).forEach(function (el) { el.remove(); });
      s.items.forEach(function (b, i) {
        var d = document.createElement('div');
        d.className = 'lp-shape';
        d.style.cssText =
          'left:' + b.l + ';top:' + b.t + ';width:' + b.w + ';height:' + b.h +
          ';align-items:' + b.align + ';justify-content:' + b.justify + ';padding:' + b.pad +
          ';border-radius:' + b.r + ';background:' + b.bg + ';border:' + b.border +
          ';box-shadow:' + b.shadow + ';color:' + b.color + ';font-size:' + b.fs +
          ';font-weight:' + b.fw + ';animation:' + anim + ' .5s cubic-bezier(.2,.8,.3,1) ' + (0.04 * i).toFixed(2) + 's both';
        d.textContent = b.text;
        canvas.insertBefore(d, pinEl);
      });

      edgeSvg.innerHTML = '';
      s.edges.forEach(function (e) {
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', e[0]);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', e[1]);
        p.setAttribute('stroke-width', '0.5');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('vector-effect', 'non-scaling-stroke');
        p.style.strokeDasharray = '220';
        p.style.animation = 'lp-draw .7s cubic-bezier(.3,.8,.3,1) ' + e[2] + ' both';
        edgeSvg.appendChild(p);
      });

      fileEl.textContent = 'geurio.com — ' + s.file;
      if (capEl) capEl.textContent = s.caption;
      if (hintEl) hintEl.textContent = s.hint;
      if (pinEl) { pinEl.style.left = s.pin[0]; pinEl.style.top = s.pin[1]; }
      if (pinTextEl) pinTextEl.textContent = s.pinText;

      tabs.forEach(function (t) {
        var on = t.getAttribute('data-mode') === key;
        t.className = 'lp-tab' + (on ? ' is-on' : '');
      });
    }

    function current() {
      return pinned || ORDER[tick % ORDER.length];
    }

    function rotate() {
      if (pinned) return;
      tick += 1;
      flip = 1 - flip;
      draw(current());
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var key = t.getAttribute('data-mode');
        if (holdT) clearTimeout(holdT);
        holdT = setTimeout(function () { pinned = null; }, HOLD_MS);
        if (key !== current()) flip = 1 - flip;
        pinned = key;
        draw(key);
      });
    });

    rotT = setInterval(rotate, ROTATE_MS);
    // 탭이 백그라운드로 가면 회전을 멈춘다(보이지 않는 애니메이션은 낭비다).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (rotT) { clearInterval(rotT); rotT = null; }
      } else if (!rotT) {
        rotT = setInterval(rotate, ROTATE_MS);
      }
    });
  }

  /**
   * 화면에 들어온 요소를 하나씩 올려 준다 — React 쌍둥이의 useScrollReveal과 같은 규칙.
   *
   * 관측(IntersectionObserver)을 쓰지 않는 이유: 관측은 **교차 상태가 바뀔 때만** 알려
   * 주는데, 앵커를 눌러 훌쩍 건너뛴 섹션은 "아래에 있어 안 보임 → 위로 지나가
   * 안 보임"으로 0 → 0이라 콜백이 오지 않는다. 그러면 그 섹션은 되돌아와도
   * **영영 투명한 채로 남는다**(헤더의 #faq 앵커로 실브라우저 재현). 그래서
   * "접힘선을 넘었는가"를 직접 재고, 이미 지나간 것도 함께 공개한다.
   */
  function reveal() {
    var pending = [].slice.call(document.querySelectorAll('.lp-rv'));
    if (!pending.length) return;
    pending.forEach(function (el, i) {
      el.style.transitionDelay = (i % 6) * 55 + 'ms';
    });

    var queued = false;
    function pass() {
      queued = false;
      var line = window.innerHeight * 0.88;
      pending = pending.filter(function (el) {
        if (el.getBoundingClientRect().top >= line) return true;
        el.classList.add('lp-on');
        return false;
      });
      if (!pending.length) {
        window.removeEventListener('scroll', onMove);
        window.removeEventListener('resize', onMove);
      }
    }
    function onMove() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(pass);
    }

    window.addEventListener('scroll', onMove, { passive: true });
    window.addEventListener('resize', onMove);
    pass();
  }

  function boot() {
    reveal();
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
