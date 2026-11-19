"""AI-TestOps 산학공동연구프로젝트 포스터 (A1 세로 594x841mm, 편집 가능한 PPTX).

python make_poster.py <이미지 폴더> <출력 pptx>
"""
import sys
from lxml import etree
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from PIL import Image

IMG, OUT = sys.argv[1], sys.argv[2]

FONT = 'Malgun Gothic'
NAVY = RGBColor(0x1F, 0x2A, 0x44)
BLUE = RGBColor(0x3F, 0x5B, 0xA9)
SKY = RGBColor(0x9F, 0xB4, 0xE8)
LIGHT = RGBColor(0xEE, 0xF2, 0xFA)
LINE = RGBColor(0xC9, 0xD2, 0xE8)
GREEN = RGBColor(0x2E, 0x9E, 0x5B)
ORANGE = RGBColor(0xE0, 0x7A, 0x1F)
TEXT = RGBColor(0x22, 0x22, 0x22)
SUB = RGBColor(0x55, 0x5E, 0x6E)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
C, L, R = PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.RIGHT
MID = MSO_ANCHOR.MIDDLE


def mm(v):
    return Emu(int(v * 36000))


prs = Presentation()
prs.slide_width, prs.slide_height = mm(594), mm(841)
slide = prs.slides.add_slide(prs.slide_layouts[6])


def box(x, y, w, h, fill=None, line=None, radius=None, oval=False, lw=1.2):
    kind = MSO_SHAPE.OVAL if oval else (MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE)
    s = slide.shapes.add_shape(kind, mm(x), mm(y), mm(w), mm(h))
    if radius and not oval:
        s.adjustments[0] = radius
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(lw)
    s.shadow.inherit = False
    return s


def text(x, y, w, h, runs, size=20, color=TEXT, bold=False, align=L, anchor=MSO_ANCHOR.TOP,
         spacing=1.12, shape=None, after=0, hang=0):
    """runs: 문자열, 또는 문단 리스트. 문단은 문자열이나 [(글, {옵션})] 목록."""
    tb = shape or slide.shapes.add_textbox(mm(x), mm(y), mm(w), mm(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = mm(0)
    tf.vertical_anchor = anchor
    paras = runs if isinstance(runs, list) else [runs]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        p.space_after = Pt(after)
        if hang:
            pPr = p._p.get_or_add_pPr()
            pPr.set('marL', str(int(hang * 36000)))
            pPr.set('indent', str(int(-hang * 36000)))
        for t, opt in ([(para, {})] if isinstance(para, str) else para):
            r = p.add_run()
            r.text = t
            r.font.name = FONT
            r.font.size = Pt(opt.get('size', size))
            r.font.bold = opt.get('bold', bold)
            r.font.color.rgb = opt.get('color', color)
    return tb


def label(shape, runs, **kw):
    """도형 안 가운데 글"""
    return text(0, 0, 0, 0, runs, shape=shape, align=kw.pop('align', C), anchor=kw.pop('anchor', MID), **kw)


def picture(path, x, y, w, h=None):
    """w 폭에 맞춰 넣는다. h 를 주면 그 상자 안에 비율을 지켜 가운데 맞춤. 넣은 높이를 돌려준다."""
    iw, ih = Image.open(path).size
    if h is None:
        pw, ph, px, py = w, w * ih / iw, x, y
    else:
        k = min(w / iw, h / ih)
        pw, ph = iw * k, ih * k
        px, py = x + (w - pw) / 2, y + (h - ph) / 2
    pic = slide.shapes.add_picture(path, mm(px), mm(py), mm(pw), mm(ph))
    pic.line.color.rgb = LINE
    pic.line.width = Pt(1)
    return ph


def line(x1, y1, x2, y2, color=BLUE, width=2.5, head=True, dash=False):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, mm(x1), mm(y1), mm(x2), mm(y2))
    c.line.color.rgb = color
    c.line.width = Pt(width)
    if dash:
        c.line.dash_style = 4
    if head:
        tail = etree.SubElement(c.line._get_or_add_ln(), '{http://schemas.openxmlformats.org/drawingml/2006/main}tailEnd')
        tail.set('type', 'triangle')
    return c


M = 22            # 좌우 여백
W = 594 - 2 * M   # 본문 폭
SEC = 25          # 섹션 머리 높이


def section(num, title, y, note=None):
    label(box(M, y, 16, 16, fill=BLUE, oval=True), num, size=28, color=WHITE, bold=True)
    text(M + 21, y - 1, W - 21, 18, title, size=42, color=NAVY, bold=True, anchor=MID)
    if note:
        text(M + W - 220, y + 3, 220, 10, note, size=19, color=SUB, align=R, anchor=MID)
    box(M, y + 19.5, W, 0.8, fill=LINE)
    return y + SEC


# ================================================================== 머리
box(0, 0, 594, 116, fill=NAVY)
box(0, 116, 594, 2.5, fill=BLUE)
text(M, 9, W, 10, '2026-2학기 산학공동연구프로젝트 성과공유회', size=24, color=LINE)
text(M, 18, W, 34, [[('[aQm] ', {'color': SKY}), ('AI-TestOps', {})]], size=100, color=WHITE, bold=True, spacing=0.9)
text(M, 55, W, 14, '지식 그래프 · Playwright · Docker · LLM을 접목한 관찰 기반 웹 E2E 테스트 자동화 플랫폼',
     size=33, color=WHITE, bold=True)
text(M, 75, W, 10, '사이트 주소 하나로 — 관찰하고, 만들고, 돌리고, 고친다', size=28, color=SKY)
text(M, 96, W, 12, [[
    ('지도교수  ', {'bold': True, 'color': SKY}), ('[○○○ 교수]', {}),
    ('      참여학생  ', {'bold': True, 'color': SKY}), ('장준호(팀장) · 김윤재 · 장동현 · 박준서', {}),
    ('      참여기업  ', {'bold': True, 'color': SKY}), ('[참여기업명]', {}),
]], size=25, color=WHITE)

# ================================================================== 01 프로젝트 개요
y = section('1', '프로젝트 개요', 126)
LW = 300
text(M, y, LW, 9, '왜 필요한가 — 현장의 문제', size=26, color=BLUE, bold=True)
problems = [
    ('QA 인력 부재', '스타트업 · 1인 개발팀은 배포마다 회귀 검증을 할 사람이 없다'),
    ('셀렉터 수작업', '요소마다 직접 작성하고, 화면이 바뀌면 테스트가 깨진다'),
    ('LLM의 추측', '화면을 보지 않고 셀렉터를 지어내 무수정 통과가 6건 중 1건'),
    ('원인 판별 지연', '실패가 테스트 · 앱 결함 · 실행 환경 중 무엇인지 가리기 어렵다'),
]
top = y + 11
py = top
for i, (head, body) in enumerate(problems):
    box(M, py, LW, 21, fill=LIGHT, radius=0.12)
    label(box(M + 4, py + 3.5, 14, 14, fill=WHITE, line=BLUE, oval=True, lw=1.5), str(i + 1), size=22, color=BLUE, bold=True)
    text(M + 22, py + 1, LW - 26, 19, [[(head, {'bold': True, 'size': 24, 'color': NAVY})], [(body, {'size': 20, 'color': SUB})]],
         spacing=1.02, anchor=MID)
    py += 24
RX, RW = M + LW + 10, W - LW - 10
box(RX, y, RW, py - 3 - y, fill=NAVY, radius=0.05)
text(RX + 8, y + 6, RW - 16, 9, '해결 방향', size=22, color=SKY, bold=True)
text(RX + 8, y + 15, RW - 16, 16, '“추측하지 말고, 먼저 관찰한다”', size=36, color=WHITE, bold=True)
text(RX + 8, y + 33, RW - 16, 32,
     '대상 사이트를 먼저 관찰해 지식 그래프로 만들고, 그 그래프에 있는 셀렉터로만 '
     'Playwright 테스트를 생성 · 격리 실행 · 분석하는 테스트 운영 플랫폼',
     size=21, color=WHITE, spacing=1.15)
goals = ['관찰 기반 생성', 'AI 없이도 동작', '사람 승인 반영']
gw = (RW - 16 - 8) / 3
for k, g in enumerate(goals):
    label(box(RX + 8 + k * (gw + 4), py - 3 - 17, gw, 11, fill=BLUE, radius=0.3), '✓ ' + g, size=19, color=WHITE, bold=True)
y = py + 6

# ================================================================== 02 수행 내용 및 방법
y = section('2', '수행 내용 및 방법', y, note='지식 그래프 + Playwright + Docker + LLM API')
steps = [('사이트 등록', '주소 · 저장소'), ('구조 분석', '코드 · 사이트 탐색'), ('지식 그래프', '화면 · 전환 · 셀렉터'),
         ('테스트 생성', 'Playwright'), ('사람 승인', '바뀐 코드 검토'), ('격리 실행', 'Docker 컨테이너'), ('결과 분석', '리포트 · 영상')]
sw, gap = 64, 12.2
for i, (h, sub) in enumerate(steps):
    sx = M + i * (sw + gap)
    key = h in ('지식 그래프', '테스트 생성', '격리 실행')
    label(box(sx, y, sw, 20, fill=BLUE if key else WHITE, line=BLUE, radius=0.15, lw=1.5),
          [[(h, {'bold': True, 'size': 23, 'color': WHITE if key else NAVY})],
           [(sub, {'size': 16, 'color': RGBColor(0xDC, 0xE4, 0xF5) if key else SUB})]], spacing=1.0)
    if i < len(steps) - 1:
        line(sx + sw + 1.5, y + 10, sx + sw + gap - 1.5, y + 10)
loop_y = y + 25
end_x = M + 6 * (sw + gap) + sw / 2
kg_x = M + 2 * (sw + gap) + sw / 2
line(end_x, y + 20, end_x, loop_y, color=GREEN, head=False, dash=True)
line(end_x, loop_y, kg_x, loop_y, color=GREEN, head=False, dash=True)
line(kg_x, loop_y, kg_x, y + 21, color=GREEN)
text(kg_x + 4, loop_y + 1.2, end_x - kg_x - 8, 6, '실행 결과로 그래프의 확인 상태를 갱신 (통과 · 확인됨 · 안 봄 · 막힘)',
     size=17, color=GREEN, bold=True, align=C)
y = loop_y + 9

CW, CH = (W - 10) / 2, 100
pillars = [
    ('지식 그래프', 'Knowledge Graph', [
        '저장소 코드 분석과 실제 사이트 탐색으로 화면(노드) · 전환(엣지) · 셀렉터를 수집',
        '분석 · 테스트 생성 · 화면이 공유하는 하나의 계약',
        'LLM이 뽑은 글자가 원본에 없으면 버려 환각 차단, 파일 해시로 바뀐 화면만 재분석',
    ], 'p-graph.jpg', '구조 탭 — 화면 하나가 노드 하나, 색은 확인 상태'),
    ('Playwright', 'Generate · Record', [
        '그래프에 있는 셀렉터로만 테스트 생성 (testid → 역할 · 이름 → 라벨 순)',
        '실제 브라우저를 클릭해 녹화하면 Playwright 코드로 변환, 비밀번호는 환경변수로',
        '실패 시점의 리포트 · 스크린샷 · 영상 제공',
    ], 'p-recorder.jpg', '클릭 녹화 — 누른 순서대로 단계가 쌓임'),
    ('Docker Container', 'Isolated Runner', [
        '테스트 실행 · 녹화 · 사이트 탐색을 일회용 컨테이너에 격리',
        'AI 수정은 컨테이너 안 사본에서만 검증, 원본 반영은 승인 후 한 곳에서만',
        'Docker Compose 운영, GitHub Actions 자동 배포',
    ], None, '컨테이너는 API 키를 받지 않는다'),
    ('LLM API', 'Claude · GPT', [
        '모든 LLM 호출은 서버 게이트웨이 한 곳 — API 키는 서버만 보관',
        '컨테이너는 작업 전용 토큰으로 프록시를 거쳐 호출',
        'AI 도구 권한 3단계(읽기 · 실행 · 변경), 파일 변경은 사람 승인 후 반영',
    ], 'p-review.jpg', 'AI 검토 — 바뀌는 코드를 보고 승인'),
]
for i, (title, eng, bullets, img, cap) in enumerate(pillars):
    cx, cy = M + (i % 2) * (CW + 10), y + (i // 2) * (CH + 7)
    box(cx, cy, CW, CH, fill=WHITE, line=LINE, radius=0.04, lw=1.5)
    box(cx, cy, CW, 16, fill=LIGHT, radius=0.3)
    text(cx + 6, cy + 1.5, CW - 12, 13, [[(f'0{i + 1}  ', {'color': BLUE}), (title, {}),
                                          ('   ' + eng, {'size': 18, 'bold': False, 'color': SUB})]],
         size=30, color=NAVY, bold=True, anchor=MID)
    TW = CW * 0.46
    text(cx + 6, cy + 20, TW - 6, CH - 23, [[('•  ' + b, {})] for b in bullets], size=18, spacing=1.06, after=5, hang=4.6)
    ix, iw, iy, ih = cx + TW + 4, CW - TW - 10, cy + 20, CH - 20 - 10
    if img:
        picture(f'{IMG}/{img}', ix, iy, iw, ih)
    else:
        # Docker 구성도: 왼쪽 LLM · API · DB, 오른쪽 컨테이너 3개
        aw = 48
        label(box(ix, iy + 1, aw, 10, fill=WHITE, line=ORANGE, radius=0.3, lw=1.5), 'Claude / GPT',
              size=16, color=ORANGE, bold=True)
        label(box(ix, iy + 16, aw, 34, fill=NAVY, radius=0.1),
              [[('API 서버', {'bold': True, 'size': 20})], [('Spring Boot', {'size': 14})],
               [('승인 · 실행 조율', {'size': 14})], [('LLM 프록시', {'size': 14})]], color=WHITE, spacing=1.0)
        line(ix + aw / 2, iy + 16, ix + aw / 2, iy + 11.5, color=ORANGE, width=2)
        label(box(ix, iy + 54, aw, 10, fill=LIGHT, line=LINE, radius=0.3), 'PostgreSQL', size=15, color=NAVY, bold=True)
        rx, rw = ix + aw + 10, iw - aw - 10
        for k, (rh, rs) in enumerate([('실행 러너', 'Playwright 실행'), ('녹화 · 탐색', '일회용 브라우저'),
                                      ('AI 러너', '사본에서 재검증')]):
            ry = iy + 1 + k * 22
            label(box(rx, ry, rw, 19, fill=WHITE, line=BLUE, radius=0.15, lw=1.5),
                  [[(rh, {'bold': True, 'size': 18, 'color': NAVY})], [(rs, {'size': 14, 'color': SUB})]], spacing=1.0)
            line(ix + aw + 0.5, iy + 33, rx - 0.5, ry + 9.5, width=1.6)
    text(ix, cy + CH - 8.5, iw, 7, cap, size=15, color=SUB, align=C)
y += 2 * CH + 7 + 3
text(M, y, W, 7, [[('기술 스택  ', {'bold': True, 'color': BLUE}),
                   ('React 19 · TypeScript  |  Spring Boot 3.3 · Java 21  |  PostgreSQL 16  |  Playwright  |  '
                    'Docker · Compose  |  Claude · GPT  |  GitHub Actions', {})]], size=19, color=SUB, align=C)
y += 14

# ================================================================== 03 주요 성과
y = section('3', '주요 성과', y, note='중간보고(11/3) 측정 기준')
kpis = [
    ('5 / 6', '관찰 후 생성한 테스트 무수정 통과', '관찰 없이 생성하면 1 / 6', GREEN),
    ('9 / 9', '대상 사이트 화면 발견', '정답 화면 대비', BLUE),
    ('508', '플랫폼 자동 테스트', 'API 303 · 웹 198 · E2E 7', BLUE),
    ('0건', '승인 없는 AI 반영', '반영 경로 전수 검사 테스트로 보장', GREEN),
]
KW = (W - 3 * 7) / 4
for i, (big, lab, sub, col) in enumerate(kpis):
    kx = M + i * (KW + 7)
    box(kx, y, KW, 42, fill=LIGHT, radius=0.1)
    text(kx, y + 2, KW, 18, big, size=56, color=col, bold=True, align=C, anchor=MID)
    text(kx + 3, y + 21, KW - 6, 12, lab, size=20, color=NAVY, bold=True, align=C, spacing=1.0)
    text(kx + 3, y + 34, KW - 6, 6, sub, size=15, color=SUB, align=C)
y += 47
DW = 250
dh = picture(f'{IMG}/p-rounds.jpg', M, y, DW)
text(M, y + dh + 1.5, DW, 6, 'N차 테스트 대시보드 — 한 문장 결과 · 차수별 막대 · 지난번 대비 변화', size=15, color=SUB, align=C)
tx, tw = M + DW + 10, W - DW - 10
outcomes = [
    ('배포 서버에서 실제 운영', '사이트 등록부터 분석 · 생성 · 실행 · 알림까지 동작'),
    ('AI 없이도 동작', 'AI를 꺼도 기본 점검 · 클릭 녹화 · 실행 · 예약 · 알림 제공'),
    ('계획 중심 대시보드', '1차 · 2차 테스트 비교와 화면별 케이스 트리로 비전공자도 한눈에'),
    ('특허 발명신고', '“Playwright와 도커 그리고 생성형 AI를 활용한 웹 자동화 테스트 플랫폼”'),
]
oy = y
for head, body in outcomes:
    text(tx, oy, tw, 25, [[('■ ' + head, {'bold': True, 'size': 23, 'color': NAVY})], [(body, {'size': 19, 'color': SUB})]],
         spacing=1.05)
    oy += 27
y = max(y + dh + 9, oy) + 5

# ================================================================== 04 활용 가능성 및 확장성
y = section('4', '결과의 활용 가능성 및 확장성', y)
HW = (W - 10) / 2
blocks = [
    ('활용 가능성', BLUE, ['스타트업 · 1인 개발 웹 서비스의 배포마다 회귀 검증', '사내 QA 보조 도구 — 테스트 작성 · 유지 비용 절감',
                       '교육 · 캡스톤 프로젝트의 품질 관리', 'CI/CD에 연결한 배포 전 스모크 테스트 자동화']),
    ('확장성', GREEN, ['LangGraph 자율 루프 — 실패 분류 → 수정 → 격리 재검증 → 승인 → PR',
                    '모바일 기기 프로필(PC · iPhone · Android) 실행과 모바일 승인',
                    '결함 관리 워크플로우, Canvas 화면의 시각 기반 분석',
                    '특허 출원과 기업 사내 테스트 플랫폼으로 기술사업화']),
]
BH = 827 - 6 - y
for k, (title, col, items) in enumerate(blocks):
    hx = M + k * (HW + 10)
    box(hx, y + 3, HW, BH - 3, fill=WHITE, line=col, radius=0.05, lw=2)
    label(box(hx + 6, y - 2, 50, 10, fill=col, radius=0.4), title, size=22, color=WHITE, bold=True)
    text(hx + 7, y + 12, HW - 14, BH - 16, [[('▸  ' + it, {})] for it in items], size=19, spacing=1.05, after=4, hang=5.2)

# ================================================================== 바닥
box(0, 827, 594, 14, fill=NAVY)
text(M, 827, W, 14, [[('aQm   ', {'bold': True}),
                      ('AI-TestOps — QA 팀이 없어도, 사이트 주소 하나로 테스트를 만들고 돌리고 고치는 플랫폼', {})]],
     size=20, color=WHITE, anchor=MID)
print('04 칸 높이(mm) =', round(BH, 1), ' (40 이상이면 들어감)')
prs.save(OUT)
