// 사진 위 주석 도우미.
//
// annotate(page, items, opts) 는 페이지 위에 오버레이 DOM 을 얹는다.
//   - 대상 요소를 감싸는 둥근 강조 상자(굵은 테두리)
//   - 상자 모서리의 번호 원(진한 강조색 배경 · 흰 글씨)
//   - 상자 옆 말풍선(번호 + 한 줄 설명). 화면 밖으로 나가지 않게, 다른 상자를 덮지 않게 자리를 고른다.
// 찍은 뒤에는 clearAnnotations(page) 로 지운다. shot() 이 알아서 지운다.
//
// items: [{ target, label, n?, place?, pad?, noBox? }]
//   target: CSS/Playwright selector 문자열 | Playwright Locator | { x, y, width, height } (뷰포트 좌표)
//   label : 말풍선 글(한국어 한 줄, 20자 안팎). 비우면 번호만 붙는다.
//   n     : 번호(생략하면 1부터 차례대로)
//   place : 'right' | 'left' | 'bottom' | 'top' 중 먼저 시도할 쪽(생략하면 자동)
//   pad   : 상자 여백(px, 기본 6)
//   scroll: true 면 재기 전에 그 요소가 보이도록 스크롤(기본은 스크롤하지 않음)

const ACCENT = '#D9480F'; // 진한 주황 — 앱의 파란 계열과 겹치지 않는 한 가지 강조색
const ACCENT_SOFT = 'rgba(217, 72, 15, 0.10)';

async function resolveBox(page, target, { scroll = false } = {}) {
  if (!target) return null;
  if (typeof target === 'object' && 'x' in target && 'width' in target) return target;
  const locator = typeof target === 'string' ? page.locator(target).first() : target.first ? target.first() : target;
  await locator.waitFor({ state: 'visible', timeout: 8000 });
  // 여러 대상을 차례로 스크롤하면 앞서 잰 상자가 어긋난다. 스크롤은 장면이 정하고, 여기서는 요청할 때만 한다.
  if (scroll) await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) throw new Error(`주석 대상을 찾지 못했습니다: ${String(target)}`);
  return box;
}

async function annotate(page, items, opts = {}) {
  await clearAnnotations(page);
  const resolved = [];
  let auto = 1;
  for (const item of items) {
    const box = await resolveBox(page, item.target, { scroll: Boolean(item.scroll) });
    resolved.push({
      box,
      label: item.label || '',
      n: item.n ?? auto,
      place: item.place || null,
      pad: item.pad ?? 6,
      noBox: Boolean(item.noBox),
    });
    auto = (item.n ?? auto) + 1;
  }
  await page.evaluate(
    ({ resolved, ACCENT, ACCENT_SOFT, spotlight, bounds }) => {
      // 말풍선이 머무를 범위. 부분 캡처(clip)일 때는 그 범위 안에 둔다.
      const bx0 = bounds ? bounds.x : 0;
      const by0 = bounds ? bounds.y : 0;
      const vw = bounds ? bounds.x + bounds.width : window.innerWidth;
      const vh = bounds ? bounds.y + bounds.height : window.innerHeight;
      const root = document.createElement('div');
      root.id = '__guide_overlay__';
      root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:"Pretendard","Noto Sans KR","Noto Sans CJK KR","Malgun Gothic",sans-serif;';
      document.body.appendChild(root);

      const boxes = resolved.map((r) => ({
        x: r.box.x - r.pad,
        y: r.box.y - r.pad,
        w: r.box.width + r.pad * 2,
        h: r.box.height + r.pad * 2,
      }));

      // 강조한 곳만 밝게 두고 나머지를 살짝 어둡게(선택)
      if (spotlight && boxes.length) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', window.innerWidth);
        svg.setAttribute('height', window.innerHeight);
        svg.style.cssText = 'position:absolute;inset:0;';
        const holes = boxes
          .filter((_, i) => !resolved[i].noBox)
          .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="black"/>`)
          .join('');
        svg.innerHTML = `<defs><mask id="__guide_mask"><rect width="100%" height="100%" fill="white"/>${holes}</mask></defs><rect width="100%" height="100%" fill="rgba(15,23,42,0.38)" mask="url(#__guide_mask)"/>`;
        root.appendChild(svg);
      }

      const placed = []; // 이미 놓인 말풍선 사각형
      const inter = (a, b) => {
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return w > 0 && h > 0 ? w * h : 0;
      };
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const M = 10; // 화면 가장자리 여백
      const GAP = 14; // 상자와 말풍선 사이

      resolved.forEach((r, i) => {
        const b = boxes[i];
        if (!r.noBox) {
          const frame = document.createElement('div');
          frame.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:4px solid ${ACCENT};border-radius:12px;background:${ACCENT_SOFT};box-shadow:0 0 0 3px rgba(255,255,255,0.9),0 6px 18px rgba(0,0,0,0.18);box-sizing:border-box;`;
          root.appendChild(frame);
        }
        // 말풍선이 없을 때만 상자 모서리에 번호 원을 단다(말풍선에는 번호가 들어 있다)
        if (r.label) return;
        const badge = document.createElement('div');
        const bx = clamp(b.x - 15, bx0 + 2, vw - 34);
        const by = clamp(b.y - 15, by0 + 2, vh - 34);
        badge.textContent = String(r.n);
        badge.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:32px;height:32px;border-radius:50%;background:${ACCENT};color:#fff;font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);box-sizing:border-box;`;
        root.appendChild(badge);
      });

      // 말풍선과 상자를 잇는 선(말풍선보다 아래 층)
      const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      lines.setAttribute('width', window.innerWidth);
      lines.setAttribute('height', window.innerHeight);
      lines.style.cssText = 'position:absolute;inset:0;overflow:visible;';
      root.appendChild(lines);
      const nearest = (rect, px, py) => ({
        x: clamp(px, rect.x, rect.x + rect.w),
        y: clamp(py, rect.y, rect.y + rect.h),
      });

      resolved.forEach((r, i) => {
        if (!r.label) return;
        const b = boxes[i];
        const bubble = document.createElement('div');
        bubble.style.cssText = `position:absolute;left:0;top:0;display:flex;align-items:center;gap:8px;padding:6px 14px 6px 6px;background:#fff;color:#1a1a1a;border:3px solid ${ACCENT};border-radius:999px;font-size:18px;font-weight:700;line-height:1.25;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,0.25);`;
        const num = document.createElement('span');
        num.textContent = String(r.n);
        num.style.cssText = `flex:none;width:28px;height:28px;border-radius:50%;background:${ACCENT};color:#fff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;`;
        const text = document.createElement('span');
        text.textContent = r.label;
        bubble.append(num, text);
        root.appendChild(bubble);
        const bw = bubble.offsetWidth;
        const bh = bubble.offsetHeight;

        const cy = b.y + b.h / 2 - bh / 2;
        const candidates = {
          right: { x: b.x + b.w + GAP, y: cy },
          left: { x: b.x - GAP - bw, y: cy },
          bottom: { x: b.x, y: b.y + b.h + GAP },
          top: { x: b.x, y: b.y - GAP - bh },
          'bottom-end': { x: b.x + b.w - bw, y: b.y + b.h + GAP },
          'top-end': { x: b.x + b.w - bw, y: b.y - GAP - bh },
          'right-down': { x: b.x + b.w + GAP, y: cy + bh * 0.6 + 4 },
          'right-up': { x: b.x + b.w + GAP, y: cy - bh * 0.6 - 4 },
          'left-down': { x: b.x - GAP - bw, y: cy + bh * 0.6 + 4 },
          'left-up': { x: b.x - GAP - bw, y: cy - bh * 0.6 - 4 },
          inside: { x: b.x + 10, y: b.y + b.h - bh - 10 },
        };
        const order = ['right', 'left', 'bottom', 'top', 'bottom-end', 'top-end', 'right-down', 'right-up', 'left-down', 'left-up', 'inside'];
        if (r.place && candidates[r.place]) order.unshift(r.place);

        let best = null;
        for (const key of order) {
          const raw = candidates[key];
          const fits = raw.x >= bx0 + M && raw.y >= by0 + M && raw.x + bw <= vw - M && raw.y + bh <= vh - M;
          const rect = {
            x: clamp(raw.x, bx0 + M, vw - M - bw),
            y: clamp(raw.y, by0 + M, vh - M - bh),
            w: bw,
            h: bh,
          };
          let cost = fits ? 0 : 5000 + Math.abs(rect.x - raw.x) + Math.abs(rect.y - raw.y);
          boxes.forEach((o, j) => {
            if (j === i && key !== 'inside') cost += inter(rect, o) * 4;
            else if (j !== i) cost += inter(rect, o) * 2;
          });
          placed.forEach((p) => (cost += inter(rect, p) * 6));
          if (key === 'inside') cost += 3000;
          if (!best || cost < best.cost) best = { rect, cost };
          if (cost === 0) break;
        }
        bubble.style.left = `${best.rect.x}px`;
        bubble.style.top = `${best.rect.y}px`;
        placed.push(best.rect);
        // 잇는 선: 말풍선 가운데에서 가장 가까운 상자 가장자리까지
        const bc = { x: best.rect.x + bw / 2, y: best.rect.y + bh / 2 };
        const onBox = nearest(b, bc.x, bc.y);
        const onBubble = nearest(best.rect, onBox.x, onBox.y);
        const dist = Math.hypot(onBox.x - onBubble.x, onBox.y - onBubble.y);
        if (dist > 3) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', onBubble.x);
          line.setAttribute('y1', onBubble.y);
          line.setAttribute('x2', onBox.x);
          line.setAttribute('y2', onBox.y);
          line.setAttribute('stroke', ACCENT);
          line.setAttribute('stroke-width', '3');
          line.setAttribute('stroke-linecap', 'round');
          lines.appendChild(line);
        }
      });
    },
    { resolved, ACCENT, ACCENT_SOFT, spotlight: Boolean(opts.spotlight), bounds: opts.bounds || null }
  );
}

async function clearAnnotations(page) {
  await page.evaluate(() => document.getElementById('__guide_overlay__')?.remove()).catch(() => {});
}

module.exports = { annotate, clearAnnotations, resolveBox, ACCENT };
