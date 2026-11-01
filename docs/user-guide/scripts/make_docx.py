#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convert docs/user-guide/README.md to styled AI-TestOps-사용자-가이드.docx
"""

import os
import re
from PIL import Image

import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
README_PATH = os.path.join(BASE_DIR, 'README.md')
OUTPUT_PATH = os.path.join(BASE_DIR, 'AI-TestOps-사용자-가이드.docx')
PUBLIC_OUTPUT_PATH = os.path.abspath(os.path.join(BASE_DIR, '../../apps/web/public/guide/AI-TestOps-사용자-가이드.docx'))

# Colors
COLOR_PRIMARY = RGBColor(217, 74, 15)      # #D94A0F (AI-TestOps Brand Accent)
COLOR_TEXT = RGBColor(30, 41, 59)          # #1E293B
COLOR_MUTED = RGBColor(100, 116, 139)      # #64748B
COLOR_BORDER = 'E2E8F0'
COLOR_HEADER_BG = 'F8FAFC'
COLOR_TIP_BG = 'EFF6FF'
COLOR_TIP_BORDER = '3B82F6'
COLOR_WARN_BG = 'FFFBEB'
COLOR_WARN_BORDER = 'F59E0B'
COLOR_QUOTE_BG = 'FFF7ED'
COLOR_QUOTE_BORDER = 'D94A0F'
COLOR_CODE_BG = 'F1F5F9'

FONT_FAMILY = 'Malgun Gothic'
FONT_CODE = 'Consolas'

def set_run_font(run, font_name=FONT_FAMILY, size_pt=10.5, color=COLOR_TEXT, bold=False, italic=False):
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.font.color.rgb = color
    run.bold = bold
    run.italic = italic
    run._element.rPr.rFonts.set(qn('w:eastAsia'), font_name)

def set_cell_margins(cell, top=140, bottom=140, left=180, right=180):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}>'
                      f'<w:top w:w="{top}" w:type="dxa"/>'
                      f'<w:bottom w:w="{bottom}" w:type="dxa"/>'
                      f'<w:left w:w="{left}" w:type="dxa"/>'
                      f'<w:right w:w="{right}" w:type="dxa"/>'
                      f'</w:tcMar>')
    tcPr.append(tcMar)

def set_cell_shading(cell, color_hex):
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{color_hex}"/>')
    cell._tc.get_or_add_tcPr().append(shd)

def set_cell_border(cell, top=None, bottom=None, left=None, right=None):
    tcPr = cell._tc.get_or_add_tcPr()
    borders_xml = [f'<w:tcBorders {nsdecls("w")}>']
    for side, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        if val:
            color, sz, val_type = val
            borders_xml.append(f'<w:{side} w:val="{val_type}" w:sz="{sz}" w:space="0" w:color="{color}"/>')
        else:
            borders_xml.append(f'<w:{side} w:val="none"/>')
    borders_xml.append('</w:tcBorders>')
    tcPr.append(parse_xml(''.join(borders_xml)))

def parse_inline(paragraph, text, default_size=10.5, default_color=COLOR_TEXT, is_lead=False):
    # Regex for tokens: `code`, **bold**, *italic*, [text](url)
    token_pattern = re.compile(
        r'(`[^`]+`)|'
        r'(\*\*[^*]+\*\*)|'
        r'(\*[^*]+\*)|'
        r'(\[[^\]]+\]\([^)]+\))'
    )
    
    pos = 0
    for match in token_pattern.finditer(text):
        start, end = match.span()
        if start > pos:
            plain = text[pos:start]
            r = paragraph.add_run(plain)
            set_run_font(r, size_pt=default_size, color=default_color)
        
        token = match.group(0)
        if token.startswith('`') and token.endswith('`'):
            code_text = token[1:-1]
            r = paragraph.add_run(code_text)
            set_run_font(r, font_name=FONT_CODE, size_pt=default_size - 1, color=RGBColor(217, 74, 15), bold=True)
        elif token.startswith('**') and token.endswith('**'):
            bold_text = token[2:-2]
            r = paragraph.add_run(bold_text)
            set_run_font(r, size_pt=default_size, color=default_color, bold=True)
        elif token.startswith('*') and token.endswith('*'):
            italic_text = token[1:-1]
            r = paragraph.add_run(italic_text)
            set_run_font(r, size_pt=default_size, color=default_color, italic=True)
        elif token.startswith('[') and ']' in token and '(' in token:
            link_text = re.search(r'\[([^\]]+)\]', token).group(1)
            r = paragraph.add_run(link_text)
            set_run_font(r, size_pt=default_size, color=RGBColor(217, 74, 15), bold=False)
        pos = end
        
    if pos < len(text):
        plain = text[pos:]
        r = paragraph.add_run(plain)
        set_run_font(r, size_pt=default_size, color=default_color)

def build_docx():
    print(f"Reading {README_PATH}...")
    with open(README_PATH, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    doc = docx.Document()

    # Page setup: A4, 0.8 inch margins
    section = doc.sections[0]
    section.page_width = Inches(8.27)
    section.page_height = Inches(11.69)
    section.top_margin = Inches(0.8)
    section.bottom_margin = Inches(0.8)
    section.left_margin = Inches(0.8)
    section.right_margin = Inches(0.8)
    content_width = 8.27 - 1.6  # 6.67 inches

    # Set normal style font
    normal_style = doc.styles['Normal']
    normal_style.font.name = FONT_FAMILY
    normal_style.font.size = Pt(10.5)
    normal_style.font.color.rgb = COLOR_TEXT

    i = 0
    total_lines = len(lines)
    in_toc = False

    while i < total_lines:
        line = lines[i].rstrip('\r\n')
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # Horizontal Rule
        if stripped == '---':
            i += 1
            continue

        # Document Title (# AI-TestOps 사용자 가이드)
        if stripped.startswith('# '):
            title_text = stripped[2:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(10)
            p.paragraph_format.space_after = Pt(4)
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            # Badge
            r_badge = p.add_run('AI-TestOps 사용자 가이드\n')
            set_run_font(r_badge, size_pt=24, color=COLOR_PRIMARY, bold=True)
            
            p_sub = doc.add_paragraph()
            p_sub.paragraph_format.space_after = Pt(18)
            p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r_sub = p_sub.add_run('웹 테스트 자동화의 시작 — 비전공자를 위한 친절한 설명서')
            set_run_font(r_sub, size_pt=11.5, color=COLOR_MUTED)
            i += 1
            continue

        # Major Headings (## ...)
        if stripped.startswith('## '):
            heading_text = stripped[3:].strip()
            
            # Check if this is 목차
            if heading_text == '목차':
                in_toc = True
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(16)
                p.paragraph_format.space_after = Pt(8)
                r = p.add_run('📑 목차')
                set_run_font(r, size_pt=14, color=COLOR_PRIMARY, bold=True)
                i += 1
                continue
            else:
                in_toc = False

            # Major section heading
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(20)
            p.paragraph_format.space_after = Pt(6)
            p.paragraph_format.keep_with_next = True
            
            r = p.add_run(heading_text)
            set_run_font(r, size_pt=15, color=COLOR_PRIMARY, bold=True)
            i += 1
            continue

        # Sub Headings (### ...)
        if stripped.startswith('### '):
            sub_text = stripped[4:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(14)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.keep_with_next = True
            
            r = p.add_run(sub_text)
            set_run_font(r, size_pt=12.5, color=RGBColor(15, 23, 42), bold=True)
            i += 1
            continue

        # TOC items (1. [제목](#링크))
        if in_toc and re.match(r'^\d+\.\s+\[.+\]\(.+\)', stripped):
            match = re.match(r'^(\d+)\.\s+\[(.+)\]\(.+\)', stripped)
            num = match.group(1)
            title = match.group(2)
            
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.2)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            
            r_num = p.add_run(f'{int(num):02d}  ')
            set_run_font(r_num, size_pt=10, color=COLOR_PRIMARY, bold=True)
            r_title = p.add_run(title)
            set_run_font(r_title, size_pt=10, color=COLOR_TEXT)
            i += 1
            continue

        # Image (![alt](images/filename.jpg))
        img_match = re.match(r'^!\[(.*?)\]\((images/[^)]+)\)', stripped)
        if img_match:
            alt_text = img_match.group(1)
            img_rel_path = img_match.group(2)
            img_full_path = os.path.join(BASE_DIR, img_rel_path)

            if os.path.exists(img_full_path):
                # Calculate display width
                with Image.open(img_full_path) as im:
                    orig_w, orig_h = im.size
                
                # Fit width: max 6.2 inches, but don't stretch small crops
                target_w_inches = min(6.2, orig_w / 160.0)
                if target_w_inches < 3.8:
                    target_w_inches = max(target_w_inches, 3.5)

                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_before = Pt(8)
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.keep_with_next = True
                
                r = p.add_run()
                r.add_picture(img_full_path, width=Inches(target_w_inches))

                if alt_text:
                    p_cap = doc.add_paragraph()
                    p_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    p_cap.paragraph_format.space_before = Pt(0)
                    p_cap.paragraph_format.space_after = Pt(8)
                    r_cap = p_cap.add_run(f'▲ {alt_text}')
                    set_run_font(r_cap, size_pt=9, color=COLOR_MUTED, italic=False)
            i += 1
            continue

        # Blockquote (> ...)
        if stripped.startswith('> '):
            quote_text = stripped[2:].strip()
            table = doc.add_table(rows=1, cols=1)
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            cell = table.cell(0, 0)
            cell.width = Inches(content_width)
            set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
            set_cell_shading(cell, COLOR_QUOTE_BG)
            set_cell_border(cell, left=(COLOR_QUOTE_BORDER, '24', 'single'))
            
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            parse_inline(p, quote_text, default_size=10.5, default_color=RGBColor(124, 45, 18))
            
            # Spacer after table
            p_space = doc.add_paragraph()
            p_space.paragraph_format.space_before = Pt(0)
            p_space.paragraph_format.space_after = Pt(4)
            i += 1
            continue

        # Tips (💡 **팁** — ...)
        if stripped.startswith('💡 '):
            tip_text = stripped
            table = doc.add_table(rows=1, cols=1)
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            cell = table.cell(0, 0)
            cell.width = Inches(content_width)
            set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
            set_cell_shading(cell, COLOR_TIP_BG)
            set_cell_border(cell, left=(COLOR_TIP_BORDER, '24', 'single'))
            
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            parse_inline(p, tip_text, default_size=10, default_color=RGBColor(30, 64, 175))
            
            p_space = doc.add_paragraph()
            p_space.paragraph_format.space_before = Pt(0)
            p_space.paragraph_format.space_after = Pt(4)
            i += 1
            continue

        # Warning (⚠ **주의** — ...)
        if stripped.startswith('⚠ '):
            warn_text = stripped
            table = doc.add_table(rows=1, cols=1)
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            cell = table.cell(0, 0)
            cell.width = Inches(content_width)
            set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
            set_cell_shading(cell, COLOR_WARN_BG)
            set_cell_border(cell, left=(COLOR_WARN_BORDER, '24', 'single'))
            
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            parse_inline(p, warn_text, default_size=10, default_color=RGBColor(146, 64, 14))
            
            p_space = doc.add_paragraph()
            p_space.paragraph_format.space_before = Pt(0)
            p_space.paragraph_format.space_after = Pt(4)
            i += 1
            continue

        # Code Block (``` ... ```)
        if stripped.startswith('```'):
            code_lines = []
            i += 1
            while i < total_lines and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i].rstrip('\r\n'))
                i += 1
            i += 1  # Skip closing ```
            
            table = doc.add_table(rows=1, cols=1)
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            cell = table.cell(0, 0)
            cell.width = Inches(content_width)
            set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
            set_cell_shading(cell, COLOR_CODE_BG)
            set_cell_border(cell, top=(COLOR_BORDER, '4', 'single'),
                                  bottom=(COLOR_BORDER, '4', 'single'),
                                  left=(COLOR_BORDER, '4', 'single'),
                                  right=(COLOR_BORDER, '4', 'single'))
            
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            code_text = '\n'.join(code_lines)
            r = p.add_run(code_text)
            set_run_font(r, font_name=FONT_CODE, size_pt=9.5, color=RGBColor(30, 41, 59))
            
            p_space = doc.add_paragraph()
            p_space.paragraph_format.space_before = Pt(0)
            p_space.paragraph_format.space_after = Pt(4)
            continue

        # Table (| ... |)
        if stripped.startswith('|') and stripped.endswith('|'):
            table_lines = []
            while i < total_lines and lines[i].strip().startswith('|') and lines[i].strip().endswith('|'):
                table_lines.append(lines[i].strip())
                i += 1

            if len(table_lines) >= 2:
                # Parse headers, separator, rows
                header_cells = [c.strip() for c in table_lines[0].split('|')[1:-1]]
                row_cells_list = []
                for tline in table_lines[2:]:  # skip separator at index 1
                    row_cells_list.append([c.strip() for c in tline.split('|')[1:-1]])

                num_cols = len(header_cells)
                table = doc.add_table(rows=len(row_cells_list) + 1, cols=num_cols)
                table.alignment = WD_TABLE_ALIGNMENT.CENTER

                # Header Row
                for col_idx, h_text in enumerate(header_cells):
                    cell = table.cell(0, col_idx)
                    set_cell_margins(cell, top=120, bottom=120, left=140, right=140)
                    set_cell_shading(cell, COLOR_HEADER_BG)
                    set_cell_border(cell, top=(COLOR_BORDER, '8', 'single'),
                                          bottom=('94A3B8', '12', 'single'),
                                          left=(COLOR_BORDER, '4', 'single'),
                                          right=(COLOR_BORDER, '4', 'single'))
                    p = cell.paragraphs[0]
                    p.paragraph_format.space_before = Pt(2)
                    p.paragraph_format.space_after = Pt(2)
                    parse_inline(p, h_text, default_size=9.5, default_color=RGBColor(15, 23, 42))
                    for r in p.runs:
                        r.bold = True

                # Data Rows
                for row_idx, r_data in enumerate(row_cells_list):
                    for col_idx in range(num_cols):
                        cell_text = r_data[col_idx] if col_idx < len(r_data) else ''
                        cell = table.cell(row_idx + 1, col_idx)
                        set_cell_margins(cell, top=100, bottom=100, left=140, right=140)
                        bg = 'FFFFFF' if row_idx % 2 == 0 else 'F8FAFC'
                        set_cell_shading(cell, bg)
                        set_cell_border(cell, top=(COLOR_BORDER, '4', 'single'),
                                              bottom=(COLOR_BORDER, '4', 'single'),
                                              left=(COLOR_BORDER, '4', 'single'),
                                              right=(COLOR_BORDER, '4', 'single'))
                        p = cell.paragraphs[0]
                        p.paragraph_format.space_before = Pt(2)
                        p.paragraph_format.space_after = Pt(2)
                        parse_inline(p, cell_text, default_size=9.5, default_color=COLOR_TEXT)

                # Set relative column widths
                if num_cols == 2:
                    col_widths = [Inches(1.8), Inches(content_width - 1.8)]
                elif num_cols == 3:
                    col_widths = [Inches(1.4), Inches(2.4), Inches(content_width - 3.8)]
                else:
                    col_widths = [Inches(content_width / num_cols)] * num_cols

                for row in table.rows:
                    for idx, width in enumerate(col_widths):
                        row.cells[idx].width = width

                p_space = doc.add_paragraph()
                p_space.paragraph_format.space_before = Pt(0)
                p_space.paragraph_format.space_after = Pt(4)
            continue

        # Numbered List (1. ...)
        num_list_match = re.match(r'^(\d+)\.\s+(.*)', stripped)
        if num_list_match:
            num = num_list_match.group(1)
            item_text = num_list_match.group(2)
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.25)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            
            r_num = p.add_run(f'{num}. ')
            set_run_font(r_num, size_pt=10.5, color=COLOR_PRIMARY, bold=True)
            parse_inline(p, item_text, default_size=10.5, default_color=COLOR_TEXT)
            i += 1
            continue

        # Bullet List (- ...)
        if stripped.startswith('- '):
            bullet_text = stripped[2:].strip()
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.25)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            
            r_bullet = p.add_run('• ')
            set_run_font(r_bullet, size_pt=10.5, color=COLOR_PRIMARY, bold=True)
            parse_inline(p, bullet_text, default_size=10.5, default_color=COLOR_TEXT)
            i += 1
            continue

        # Standard Paragraph
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.2
        parse_inline(p, stripped, default_size=10.5, default_color=COLOR_TEXT)
        i += 1

    print(f"Saving docx to {OUTPUT_PATH}...")
    doc.save(OUTPUT_PATH)
    file_size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"Generated {OUTPUT_PATH} ({file_size_mb:.2f} MB)")

    print(f"Copying to {PUBLIC_OUTPUT_PATH}...")
    os.makedirs(os.path.dirname(PUBLIC_OUTPUT_PATH), exist_ok=True)
    import shutil
    shutil.copy2(OUTPUT_PATH, PUBLIC_OUTPUT_PATH)
    print(f"Copied to {PUBLIC_OUTPUT_PATH}")

if __name__ == '__main__':
    build_docx()
