// AI-TestOps 성과공유회 포스터 v3 — A1 세로(594x841mm), pptxgenjs + 테마
// node poster.js <이미지 폴더> <출력.pptx> <apply_theme.js 경로>
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const si = require('react-icons/si');
const lu = require('react-icons/lu');
const { imageSize } = require('./imgsize');

const [IMG, OUT, THEME_JS] = process.argv.slice(2);
const { applyTheme } = require(THEME_JS);

const THEME = {
  name: 'aQm Poster',
  headFontFace: 'Malgun Gothic',
  bodyFontFace: 'Malgun Gothic',
  colors: {
    dk1: '1B2130', lt1: 'FFFFFF', dk2: '15213F', lt2: 'F1F4F9',
    accent1: '3460D9', accent2: '1E9E6A', accent3: 'D64545', accent4: 'E3A220',
    accent5: '6A7385', accent6: 'C9D0DC', hlink: '3460D9', folHlink: '6A7385',
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.defineLayout({ name: 'A1P', width: 594 / 25.4, height: 841 / 25.4 });
pres.layout = 'A1P';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'AI-TestOps 포스터';
const C = pres.SchemeColor;
const INK = C.text1, NAVY = C.text2, PAPER = C.background2, WHITE = C.background1;
const BLUE = C.accent1, GREEN = C.accent2, RED = C.accent3, GRAY = C.accent5, LINE = C.accent6;

const u = (mm) => mm / 25.4;
const slide = pres.addSlide();
slide.background = { color: 'FFFFFF' };

function text(str, x, y, w, h, o = {}) {
  slide.addText(str, {
    x: u(x), y: u(y), w: u(w), h: u(h), margin: 0, isTextBox: true, valign: 'top',
    fontSize: 18, color: INK, ...o,
  });
}
function rect(x, y, w, h, o = {}) {
  slide.addShape(o.radius ? pres.shapes.ROUNDED_RECTANGLE : pres.shapes.RECTANGLE, {
    x: u(x), y: u(y), w: u(w), h: u(h), line: { type: 'none' }, ...o,
    rectRadius: o.radius ? u(o.radius) : undefined,
  });
}
const soft = () => ({ type: 'outer', color: '15213F', opacity: 0.16, blur: 14, offset: 3, angle: 90 });

/** 그림을 w 폭으로 넣는다. h 를 주면 그 칸을 채우도록 잘라 넣는다(cover). 넣은 높이를 돌려준다. */
function image(file, x, y, w, h) {
  const p = path.join(IMG, file);
  const { width, height } = imageSize(p);
  if (!h) {
    h = (w * height) / width;
    slide.addImage({ path: p, x: u(x), y: u(y), w: u(w), h: u(h) });
  } else {
    slide.addImage({ path: p, x: u(x), y: u(y), w: u(w), h: u(h), sizing: { type: 'cover', w: u(w), h: u(h) } });
  }
  return h;
}

/** 브라우저 창 틀에 넣은 화면. 포스터 전체의 공통 모양(모티프). */
function browser(file, x, y, w, h, shadow = true) {
  const bar = Math.max(4, w * 0.028);
  rect(x, y, w, h + bar, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, radius: 2.2, shadow: shadow ? soft() : undefined });
  rect(x + 0.4, y + 0.4, w - 0.8, bar - 0.4, { fill: { color: 'EEF1F6' }, radius: 1.8 });
  [0, 1, 2].forEach((i) => slide.addShape(pres.shapes.OVAL, {
    x: u(x + 3 + i * bar * 0.55), y: u(y + bar * 0.32), w: u(bar * 0.36), h: u(bar * 0.36),
    fill: { color: ['F26D6D', 'F2C14E', '5CC27A'][i] }, line: { type: 'none' },
  }));
  return bar + image(file, x + 0.4, y + bar, w - 0.8, h);
}

async function icon(Comp, hex, px = 384) {
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: '#' + hex, size: px }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

(async () => {
  const M = 26, W = 594 - 2 * M;

  // ============================================================ 머리 (어두운 첫 화면)
  rect(0, 0, 594, 178, { fill: { color: HEX.dk2 } });
  text('2026-2학기 산학공동연구프로젝트 성과공유회', M, 18, 260, 8, { fontSize: 19, color: HEX.accent6 });
  text('AI-TestOps', M, 28, 290, 40, { fontSize: 112, bold: true, color: WHITE, fontFace: 'Malgun Gothic' });
  text([
    { text: '웹사이트 주소나 GitHub 저장소만 넣으면', options: { breakLine: true } },
    { text: '알아서 살펴보고, 테스트를 만들어 돌려 줍니다' },
  ], M, 76, 270, 26, { fontSize: 27, bold: true, color: WHITE, lineSpacingMultiple: 1.15 });
  text([
    { text: '팀 aQm', options: { bold: true, color: WHITE } },
    { text: '   지도교수 양옥수', options: { color: 'C9D0DC', breakLine: true } },
    { text: '장준호(팀장) · 김윤재 · 장동현 · 박준서 · 김상원', options: { color: 'C9D0DC' } },
  ], M, 107, 270, 18, { fontSize: 19, lineSpacingMultiple: 1.3 });

  // QR: 흰 카드
  rect(M, 130, 40, 40, { fill: { color: 'FFFFFF' }, radius: 2 });
  slide.addImage({ path: path.join(IMG, 'qr.png'), x: u(M + 2), y: u(132), w: u(36), h: u(36) });
  text([
    { text: '지금 바로 써 보기', options: { bold: true, color: WHITE, fontSize: 20, breakLine: true } },
    { text: '휴대폰 카메라로 QR을 비추면', options: { color: 'C9D0DC', breakLine: true } },
    { text: '로그인 화면이 열립니다', options: { color: 'C9D0DC' } },
  ], M + 46, 138, 120, 24, { fontSize: 16, lineSpacingMultiple: 1.3 });

  // 대표 화면: 어두운 칸과 흰 칸에 걸쳐 놓는다
  const HX = 318, HW = 594 - M - HX;
  browser('hero.jpg', HX, 22, HW, 0);

  // ============================================================ 유저플로우
  let y = 204;
  text('유저플로우', M, y, 300, 16, { fontSize: 40, bold: true, color: NAVY });
  text('처음 쓰는 사람이 따라가는 순서입니다', M, y + 16, 300, 8, { fontSize: 18, color: GRAY });
  y += 32;
  const steps = [
    ['01', '사이트 등록', '주소나 GitHub 저장소를 넣고\n프로젝트를 만듭니다', 'f-projects.jpg'],
    ['02', '구조 분석', '코드와 실제 화면을 살펴\n사이트 지도를 그립니다', 'g-graph.jpg'],
    ['03', '테스트 만들기', '문장으로 쓰거나 직접 녹화하거나\n지도에서 경로를 고릅니다', 'g-aigen.jpg'],
    ['04', '실행', '격리된 컨테이너에서 돌리고\n실패 화면 · 영상 · 로그를 봅니다', 'g-results.jpg'],
    ['05', '비교와 개선', '1차 · 2차 결과를 비교하고\nAI 수정안은 승인해야 반영됩니다', 'g-rounds.jpg'],
  ];
  const SG = 9, SW = (W - 4 * SG) / 5, SH = SW * 0.66;
  steps.forEach(([n, t, d, img], i) => {
    const sx = M + i * (SW + SG);
    browser(img, sx, y, SW, SH, false);
    text(n, sx, y + SH + 9, 20, 10, { fontSize: 26, bold: true, color: BLUE });
    text(t, sx + 17, y + SH + 9.5, SW - 17, 10, { fontSize: 22, bold: true, color: INK });
    text(d, sx, y + SH + 20, SW, 16, { fontSize: 15.5, color: GRAY, lineSpacingMultiple: 1.25 });
    if (i < 4) {
      slide.addShape(pres.shapes.CHEVRON, {
        x: u(sx + SW + SG / 2 - 1.6), y: u(y + SH / 2 - 2.5), w: u(3.2), h: u(5), rotate: 0,
        fill: { color: HEX.accent6 }, line: { type: 'none' }, flipV: false,
      });
    }
  });
  y += SH + 50;

  // ============================================================ 주요 기능
  text('주요 기능', M, y, 300, 16, { fontSize: 40, bold: true, color: NAVY });
  y += 22;
  const features = [
    [lu.LuGithub, '코드베이스 분석', 'GitHub 저장소의 라우트 · 폼 · 버튼을 읽어\n화면 목록을 만듭니다'],
    [lu.LuNetwork, '지식 그래프 사이트 지도', '화면, 화면 사이 이동, 버튼을\n하나의 지도로 저장하고 보여 줍니다'],
    [lu.LuSparkles, 'AI 테스트 생성', '확인할 내용을 문장으로 쓰면 지도에 있는\n요소로만 Playwright 코드를 씁니다'],
    [lu.LuMousePointerClick, '클릭 녹화', '브라우저에서 직접 눌러 본 순서를\n테스트 코드로 저장합니다'],
    [lu.LuContainer, '격리 실행과 리포트', '테스트마다 Docker 컨테이너에서 따로 돌리고\n리포트와 영상을 남깁니다'],
    [lu.LuShieldCheck, '승인 후 반영', 'AI가 고친 코드는 바뀐 부분을 사람이 보고\n승인해야 반영됩니다'],
  ];
  const FG = 12, FW = (W - 2 * FG) / 3;
  for (let i = 0; i < features.length; i++) {
    const [Ic, t, d] = features[i];
    const fx = M + (i % 3) * (FW + FG), fy = y + Math.floor(i / 3) * 40;
    rect(fx, fy, 15, 15, { fill: { color: 'E8EEFB' }, radius: 3.5 });
    slide.addImage({ data: await icon(Ic || lu.LuCircle, HEX.accent1), x: u(fx + 3.5), y: u(fy + 3.5), w: u(8), h: u(8) });
    text(t, fx + 20, fy - 0.5, FW - 20, 9, { fontSize: 21, bold: true });
    text(d, fx + 20, fy + 8.5, FW - 20, 18, { fontSize: 15.5, color: GRAY, lineSpacingMultiple: 1.22 });
  }
  y += 2 * 40 + 10;

  // ============================================================ 주요 성과
  text('주요 성과', M, y, 300, 16, { fontSize: 40, bold: true, color: NAVY });
  y += 22;
  const CW = (W - 12) / 2, CH = 192;

  // 성과 1: 저장소 → 자동 테스트
  let cx = M;
  rect(cx, y, CW, CH, { fill: { color: HEX.lt2 }, radius: 4 });
  text('GitHub 저장소만 연결하면', cx + 10, y + 9, CW - 20, 10, { fontSize: 20, color: BLUE, bold: true });
  text('코드베이스 분석으로 자동화 테스트가 돌아갑니다', cx + 10, y + 19, CW - 20, 22,
    { fontSize: 27, bold: true, lineSpacingMultiple: 1.15 });
  const flow = [
    [si.SiGithub, '저장소 연결', '레포 주소와 브랜치'],
    [lu.LuFileSearch, '코드베이스 분석', '라우트 · 폼 · 버튼 추출'],
    [lu.LuNetwork, '사이트 지도', '화면 9개 · 이동 경로'],
    [lu.LuPlay, '테스트 생성 · 실행', '만들고 바로 실행'],
  ];
  const NW = (CW - 20 - 3 * 7) / 4;
  for (let i = 0; i < flow.length; i++) {
    const [Ic, t, d] = flow[i];
    const nx = cx + 10 + i * (NW + 7), ny = y + 54;
    rect(nx, ny, NW, 60, { fill: { color: 'FFFFFF' }, radius: 3, shadow: soft() });
    slide.addImage({ data: await icon(Ic, i === 3 ? HEX.accent2 : HEX.dk2), x: u(nx + NW / 2 - 7), y: u(ny + 8), w: u(14), h: u(14) });
    text(t, nx + 2, ny + 27, NW - 4, 9, { fontSize: 17, bold: true, align: 'center' });
    text(d, nx + 2, ny + 37, NW - 4, 16, { fontSize: 14, color: GRAY, align: 'center', lineSpacingMultiple: 1.15 });
    if (i < 3) {
      slide.addShape(pres.shapes.CHEVRON, {
        x: u(nx + NW + 2), y: u(ny + 27.5), w: u(3), h: u(5), fill: { color: HEX.accent6 }, line: { type: 'none' },
      });
    }
  }
  text([
    { text: '등록하는 순간 분석부터 첫 실행까지 사람 손이 필요 없습니다. ', options: {} },
    { text: 'AI가 뽑은 이름이 실제 코드에 없으면 버리고, 바뀐 파일만 다시 분석해 빠르고 정확합니다.', options: { color: GRAY } },
  ], cx + 10, y + 128, CW - 20, 34, { fontSize: 18, lineSpacingMultiple: 1.32 });
  text([
    { text: '분석 결과 ', options: { color: GRAY } },
    { text: '대상 사이트 화면 9개 모두 발견', options: { bold: true, color: GREEN } },
  ], cx + 10, y + 174, CW - 20, 9, { fontSize: 19 });

  // 성과 2: 지식 그래프로 사이트 보기
  cx = M + CW + 12;
  rect(cx, y, CW, CH, { fill: { color: HEX.lt2 }, radius: 4 });
  text('지식 그래프로', cx + 10, y + 9, CW - 20, 10, { fontSize: 20, color: BLUE, bold: true });
  text('테스트 중인 웹사이트를 한눈에 봅니다', cx + 10, y + 19, CW - 20, 12, { fontSize: 27, bold: true });
  const gw = CW - 20;
  const gh = browser('graph-wide.jpg', cx + 10, y + 36, gw, 108, true);
  const legend = [['2E9E5B', '테스트 통과'], ['3B82F6', '화면에서 확인됨'], ['9AA3B2', '아직 안 봄'], ['D64545', '막힘 · 고칠 곳']];
  legend.forEach(([c, t], i) => {
    const lx = cx + 10 + i * (gw / 4);
    slide.addShape(pres.shapes.OVAL, { x: u(lx), y: u(y + 36 + gh + 6.5), w: u(4), h: u(4), fill: { color: c }, line: { type: 'none' } });
    text(t, lx + 6, y + 36 + gh + 5.5, gw / 4 - 6, 7, { fontSize: 15, color: INK });
  });
  text('화면 하나가 상자 하나, 색이 곧 상태입니다. 막힌 곳을 누르면 이유와 고칠 방법이 나옵니다',
    cx + 10, y + 36 + gh + 15, CW - 20, 14, { fontSize: 16, color: GRAY, lineSpacingMultiple: 1.25 });
  y += CH + 12;

  // 성과 한 줄씩
  const facts = [
    ['운영 중', '실제 서버에서 운영 중\nGitHub Actions로 자동 배포'],
    ['자동 테스트 508개', '플랫폼 자체도 API · 웹 · E2E\n테스트로 배포마다 검증'],
    ['AI 단독 반영 0건', '파일을 바꾸는 모든 경로가\n사람 승인을 거치도록 테스트로 확인'],
    ['특허 발명신고', 'Playwright · 도커 · 생성형 AI를 활용한\n웹 자동화 테스트 플랫폼'],
  ];
  const KW = (W - 3 * 10) / 4;
  facts.forEach(([k, d], i) => {
    const kx = M + i * (KW + 10);
    text(k, kx, y, KW, 11, { fontSize: 24, bold: true, color: NAVY });
    text(d, kx, y + 11, KW, 16, { fontSize: 15, color: GRAY, lineSpacingMultiple: 1.22 });
  });
  y += 42;

  // ============================================================ 기술스택 + 앞으로
  const TW = 340;
  text('기술스택', M, y, 200, 16, { fontSize: 40, bold: true, color: NAVY });
  const stack = [
    ['FE', 'React · TypeScript', [si.SiReact, si.SiTypescript]],
    ['BE', 'Spring Boot · Java 21', [si.SiSpringboot]],
    ['DB', 'PostgreSQL', [si.SiPostgresql]],
    ['Test', 'Playwright', [lu.LuMonitorPlay]],
    ['Infra', 'Docker · GitHub Actions', [si.SiDocker, si.SiGithubactions]],
    ['AI', 'Claude · GPT', [si.SiClaude || si.SiAnthropic]],
  ];
  const brand = { SiReact: '149ECA', SiTypescript: '3178C6', SiSpringboot: '6DB33F', SiPostgresql: '4169E1', SiDocker: '2496ED', SiGithubactions: '2088FF', SiClaude: 'D97757', SiAnthropic: '191919', LuMonitorPlay: '2EAD33' };
  const TG = 8, TCW = (TW - 2 * TG) / 3;
  for (let i = 0; i < stack.length; i++) {
    const [k, v, icons] = stack[i];
    const tx = M + (i % 3) * (TCW + TG), ty = y + 22 + Math.floor(i / 3) * 30;
    rect(tx, ty, TCW, 26, { fill: { color: 'FFFFFF' }, line: { color: HEX.accent6, width: 0.75 }, radius: 3 });
    for (let j = 0; j < icons.length; j++) {
      const Ic = icons[j];
      const name = Object.keys(si).find((n) => si[n] === Ic) || Object.keys(lu).find((n) => lu[n] === Ic);
      slide.addImage({ data: await icon(Ic, brand[name] || HEX.dk2), x: u(tx + 4 + j * 9), y: u(ty + 8.5), w: u(9), h: u(9) });
    }
    const off = 6 + icons.length * 9;
    text(k, tx + off, ty + 4.5, TCW - off - 3, 7, { fontSize: 13.5, bold: true, color: BLUE });
    text(v, tx + off, ty + 12, TCW - off - 3, 10, { fontSize: 15.5, bold: true, color: INK });
  }

  const AX = M + TW + 16, AW = W - TW - 16;
  text('앞으로', AX, y, AW, 16, { fontSize: 40, bold: true, color: NAVY });
  text([
    { text: '바로 쓸 곳', options: { bold: true, color: INK, breakLine: true } },
    { text: 'QA 담당자가 없는 스타트업 · 1인 개발 서비스', options: { color: GRAY, breakLine: true } },
    { text: '배포 전 확인, 사내 QA 보조, CI 연동', options: { color: GRAY, breakLine: true } },
    { text: '더할 것', options: { bold: true, color: INK, breakLine: true } },
    { text: '실패를 고쳐 PR까지 올리는 자동 수정 루프', options: { color: GRAY, breakLine: true } },
    { text: '휴대폰 기기별 실행, 결함 관리', options: { color: GRAY } },
  ], AX, y + 22, AW, 58, { fontSize: 16.5, lineSpacingMultiple: 1.3 });

  text('한성대학교 2026-2학기 산학공동연구프로젝트 · 팀 aQm', M, 829, W, 7, { fontSize: 14, color: GRAY });
  console.log('기술스택 칸 끝 y =', (y + 22 + 2 * 30).toFixed(1), '(829 전이어야 함)');

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
})().catch((e) => { console.error(e); process.exit(1); });
