"""AI-TestOps 산학공동연구프로젝트 포스터 v2 (A1 세로 594x841mm, 편집 가능한 PPTX).

python make_poster2.py <이미지 폴더> <출력 pptx>
꾸밈을 줄이고, 처음 보는 사람이 "무슨 서비스인지 → 무엇을 하는지 → 어떻게 만들었는지" 순서로 읽게 한다.
"""
import sys
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from lxml import etree
from PIL import Image

IMG, OUT = sys.argv[1], sys.argv[2]
FONT = 'Malgun Gothic'
INK = RGBColor(0x1A, 0x1D, 0x23)
GRAY = RGBColor(0x5F, 0x66, 0x73)
SOFT = RGBColor(0x9A, 0xA1, 0xAD)
RULE = RGBColor(0xD9, 0xDD, 0xE3)
ACCENT = RGBColor(0x2F, 0x4B, 0x9A)
PAPER = RGBColor(0xF4, 0xF6, 0xF9)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
L, C, R = PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.RIGHT
TOP, MID = MSO_ANCHOR.TOP, MSO_ANCHOR.MIDDLE


def mm(v):
    return Emu(int(round(v * 36000)))


prs = Presentation()
prs.slide_width, prs.slide_height = mm(594), mm(841)
slide = prs.slides.add_slide(prs.slide_layouts[6])


def rect(x, y, w, h, fill=None, line=None, lw=1.0):
    s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, mm(x), mm(y), mm(w), mm(h))
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


def rule(x, y, w, color=RULE, weight=0.6):
    rect(x, y, w, weight, fill=color)


def text(x, y, w, h, paras, size=20, color=INK, bold=False, align=L, anchor=TOP, spacing=1.2, after=0, shape=None):
    """paras: 문자열, 또는 문단 목록. 문단은 문자열이나 [(글, {size,bold,color})] 목록."""
    tb = shape or slide.shapes.add_textbox(mm(x), mm(y), mm(w), mm(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    paras = paras if isinstance(paras, list) else [paras]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        p.space_after = Pt(after)
        for t, o in ([(para, {})] if isinstance(para, str) else para):
            r = p.add_run()
            r.text = t
            r.font.name = FONT
            r.font.size = Pt(o.get('size', size))
            r.font.bold = o.get('bold', bold)
            r.font.color.rgb = o.get('color', color)
    return tb


def picture(name, x, y, w, h=None, border=True):
    """폭 w 에 맞춰 넣는다(h 가 있으면 그 칸 안에 비율 유지). 넣은 높이를 돌려준다."""
    iw, ih = Image.open(f'{IMG}/{name}').size
    if h is None:
        pw, ph, px, py = w, w * ih / iw, x, y
    else:
        k = min(w / iw, h / ih)
        pw, ph = iw * k, ih * k
        px, py = x, y
    pic = slide.shapes.add_picture(f'{IMG}/{name}', mm(px), mm(py), mm(pw), mm(ph))
    if border:
        pic.line.color.rgb = RULE
        pic.line.width = Pt(0.75)
    return ph


def arrow(x1, y, x2, color=SOFT):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, mm(x1), mm(y), mm(x2), mm(y))
    c.line.color.rgb = color
    c.line.width = Pt(1.5)
    tail = etree.SubElement(c.line._get_or_add_ln(), '{http://schemas.openxmlformats.org/drawingml/2006/main}tailEnd')
    tail.set('type', 'triangle')


M = 26
W = 594 - 2 * M


def heading(y, kicker, title):
    """작은 구분 이름(평가 항목) + 쉬운 말 제목"""
    rule(M, y, W, color=INK, weight=0.9)
    text(M, y + 4, 200, 8, kicker, size=19, color=ACCENT, bold=True)
    text(M, y + 12, W, 16, title, size=40, bold=True)
    return y + 32


# ================================================================== 머리
text(M, 16, 420, 8, '2026-2학기 산학공동연구프로젝트 성과공유회', size=20, color=GRAY)
text(M, 25, 420, 36, 'AI-TestOps', size=112, color=ACCENT, bold=True, spacing=0.9)
text(M, 70, 420, 24, ['웹사이트 주소만 넣으면 화면을 살펴보고,', '테스트를 만들어 실행해 주는 웹 테스트 자동화 서비스'],
     size=28, bold=True, spacing=1.15)
text(M, 97, 440, 16, [
    [('팀  ', {'color': GRAY}), ('aQm', {'bold': True}),
     ('        지도교수  ', {'color': GRAY}), ('양옥수', {'bold': True})],
    [('참여학생  ', {'color': GRAY}), ('장준호(팀장), 김윤재, 장동현, 박준서, 김상원', {'bold': True})],
], size=21, spacing=1.25)

QS = 74
QX, QY = M + W - QS, 16
picture('qr.png', QX, QY, QS, border=False)
text(QX - 10, QY + QS + 1, QS + 10, 8, '휴대폰 카메라로 찍으면', size=17, color=GRAY, align=C)
text(QX - 10, QY + QS + 8, QS + 10, 8, '바로 써 볼 수 있습니다', size=17, color=INK, bold=True, align=C)

# ================================================================== 1. 개요: 어떤 서비스인가
y = heading(121, '프로젝트 개요', 'AI-TestOps는 어떤 서비스인가요')
LW = 214
text(M, y, LW, 160, [
    '웹 서비스는 고칠 때마다 화면이 제대로 동작하는지 다시 확인해야 합니다. 이 확인을 사람이 하거나 '
    '테스트 코드로 직접 짜려면 시간과 인력이 많이 듭니다.',
    'AI-TestOps에 사이트 주소를 등록하면 실제 화면을 먼저 둘러보고, 어떤 화면과 버튼이 있는지 지도로 '
    '정리합니다. 그 지도에 있는 버튼과 입력창만 써서 테스트를 만들고, 따로 떨어진 실행 환경에서 돌려 결과를 보여 줍니다.',
    [('왜 먼저 살펴보나요? ', {'bold': True}),
     ('AI에게 화면을 보여 주지 않고 테스트를 맡겼더니 6건 중 1건만 고치지 않고 통과했습니다. '
      '화면을 먼저 살펴보게 하자 6건 중 5건이 통과했습니다.', {})],
    [('이런 팀에 맞습니다. ', {'bold': True}),
     ('QA 담당자가 따로 없는 스타트업과 작은 개발팀, 배포 전 확인을 자동으로 하고 싶은 팀.', {})],
], size=20, spacing=1.3, color=INK, after=12)
HX = M + LW + 12
HW = W - LW - 12
hh = picture('f-projects.jpg', HX, y + 1, HW)
text(HX, y + 1 + hh + 2, HW, 7, '프로젝트 목록. 테스트할 사이트마다 카드가 하나씩 있고, 마지막 실행 결과가 바로 보입니다.',
     size=16, color=GRAY)
y = max(y + 150, y + hh + 10) + 8

# ================================================================== 2. 주요 기능
y = heading(y, '주요 기능', '할 수 있는 일')
features = [
    ('사이트 구조 분석', '저장소 코드와 실제 사이트를 둘러보고 화면, 화면 사이 이동, 버튼과 입력창을 모읍니다.', 'g-graph.jpg'),
    ('문장으로 테스트 만들기', '확인하고 싶은 내용을 문장으로 쓰면 AI가 지도에 있는 요소로 Playwright 테스트 코드를 씁니다.', 'g-aigen.jpg'),
    ('클릭 녹화', '브라우저에서 직접 눌러 보면 그 순서가 테스트 코드로 저장됩니다. AI를 꺼도 쓸 수 있습니다.', 'g-recorder.jpg'),
    ('격리 실행과 결과', '테스트는 컨테이너에서 따로 실행되고, 실패한 순간의 화면, 영상, 로그가 남습니다.', 'g-results.jpg'),
    ('AI 검토와 채팅', 'AI가 고친 코드는 사람이 바뀐 부분을 보고 승인해야 실제 파일에 들어갑니다.', 'g-review.jpg'),
    ('차수별 대시보드', '1차, 2차처럼 돌린 순서대로 결과를 비교해 무엇이 새로 실패했는지 보여 줍니다.', 'g-rounds.jpg'),
]
FW = (W - 2 * 12) / 3
IH = FW * 0.39
for i, (title, desc, img) in enumerate(features):
    fx = M + (i % 3) * (FW + 12)
    fy = y + (i // 3) * (IH + 36)
    picture(img, fx, fy, FW, IH)
    text(fx, fy + IH + 4, FW, 9, [[(f'{i + 1}  ', {'color': ACCENT}), (title, {})]], size=23, bold=True)
    text(fx, fy + IH + 13, FW, 22, desc, size=17, color=GRAY, spacing=1.25)
y += 2 * (IH + 36)

# ================================================================== 3. 수행 내용 및 방법
y = heading(y, '수행 내용 및 방법', '어떻게 만들었나요')
LW3 = 352
steps = ['주소 등록', '화면 분석과 지도', '테스트 만들기', '컨테이너에서 실행', '결과 확인과 수정']
sw = (LW3 - 4 * 8) / 5
for i, s in enumerate(steps):
    sx = M + i * (sw + 8)
    rect(sx, y, sw, 15, fill=PAPER)
    text(sx, y, sw, 15, [[(f'{i + 1}  ', {'color': ACCENT}), (s, {})]], size=17, bold=True, align=C, anchor=MID)
    if i < 4:
        arrow(sx + sw + 1, y + 7.5, sx + sw + 7)
techs = [
    ('지식 그래프', '화면(노드), 화면 사이 이동(엣지), 버튼과 입력창(셀렉터)을 저장한 사이트 지도. '
                '테스트 생성과 화면 표시가 모두 이 지도 하나를 씁니다.'),
    ('Playwright', '실제 브라우저를 움직이는 테스트 도구. 지도에 있는 셀렉터로만 코드를 만들어 '
                   '없는 버튼을 짐작해 쓰는 일을 막습니다.'),
    ('Docker 컨테이너', '실행, 녹화, 사이트 탐색을 일회용 컨테이너에서 합니다. 테스트끼리 섞이지 않고, '
                      'AI의 수정도 사본에서만 검증합니다.'),
    ('LLM (Claude, GPT)', '분석 보조, 테스트 작성, 실패 설명에 씁니다. API 키는 서버에만 두고, '
                          'AI가 바꾼 내용은 사람이 승인해야 반영됩니다.'),
]
TW = (LW3 - 12) / 2
for i, (t, d) in enumerate(techs):
    tx = M + (i % 2) * (TW + 12)
    ty = y + 22 + (i // 2) * 40
    text(tx, ty, TW, 38, [[(t, {'bold': True, 'size': 21, 'color': INK})], d], size=17, color=GRAY, spacing=1.25)

SX = M + LW3 + 14
SW = W - LW3 - 14
rect(SX, y, SW, 102, fill=PAPER)
text(SX + 8, y + 6, SW - 16, 9, '기술 스택', size=21, bold=True)
stack = [('FE', 'React, TypeScript'), ('BE', 'Spring Boot, Java 21'), ('DB', 'PostgreSQL'),
         ('테스트 실행', 'Playwright'), ('인프라', 'Docker, GitHub Actions'), ('AI', 'Claude, GPT API')]
for i, (k, v) in enumerate(stack):
    ry = y + 18 + i * 13.5
    text(SX + 8, ry, 50, 10, k, size=18, color=ACCENT, bold=True, anchor=MID)
    text(SX + 58, ry, SW - 66, 10, v, size=18, anchor=MID)
    if i < len(stack) - 1:
        rule(SX + 8, ry + 11.7, SW - 16, weight=0.4)
y += 106

# ================================================================== 4. 성과 / 5. 활용
y = heading(y, '주요 성과  ·  활용 가능성과 확장성', '해낸 것과 앞으로')
RW4 = 282
results = [
    ('6건 중 5건', '화면을 먼저 분석하고 만든 테스트가 그대로 통과 (분석 없이는 6건 중 1건)'),
    ('9개 중 9개', '시험 대상 사이트의 화면을 빠짐없이 찾음'),
    ('508개', '플랫폼 자체를 지키는 자동 테스트 (API 303, 웹 198, E2E 7)'),
    ('운영 중', '실제 서버에 배포해 운영, 변경은 GitHub Actions로 자동 배포'),
    ('발명신고', 'Playwright와 도커, 생성형 AI를 활용한 웹 자동화 테스트 플랫폼'),
]
for i, (n, d) in enumerate(results):
    ry = y + i * 17
    text(M, ry, 72, 15, n, size=24, color=ACCENT, bold=True, anchor=MID)
    text(M + 74, ry, RW4 - 74, 15, d, size=17, color=INK, spacing=1.15, anchor=MID)
    if i < len(results) - 1:
        rule(M, ry + 16, RW4, weight=0.4)
text(M, y + 5 * 17 + 1, RW4, 6, '수치는 중간보고(2026.11.3) 측정 기준', size=14, color=SOFT)

UX = M + RW4 + 16
UW = W - RW4 - 16
text(UX, y, UW, 90, [
    [('어디에 쓸 수 있나', {'bold': True, 'size': 21})],
    '스타트업과 1인 개발 서비스의 배포 전 확인, 사내 QA 보조 도구, 교육용 프로젝트의 품질 관리에 바로 쓸 수 있습니다. '
    'CI에 연결하면 배포할 때마다 자동으로 돌릴 수 있습니다.',
    '',
    [('다음 단계', {'bold': True, 'size': 21})],
    '실패를 분류하고 고친 뒤 다시 검증해 PR까지 올리는 자동 루프(LangGraph), 휴대폰 기기별 실행, '
    '결함 관리 흐름을 더하고 있습니다. 특허 출원과 기업용 테스트 플랫폼으로의 사업화도 준비합니다.',
], size=17, color=GRAY, spacing=1.3)
end = y + 5 * 17 + 8

# ================================================================== 바닥
rule(M, 825, W, weight=0.6)
text(M, 828, W, 8, '한성대학교 2026-2학기 산학공동연구프로젝트  |  팀 aQm  |  AI-TestOps', size=16, color=GRAY)
print('본문 끝 y =', round(end, 1), '(바닥 선 825 전이어야 함)')
prs.save(OUT)
