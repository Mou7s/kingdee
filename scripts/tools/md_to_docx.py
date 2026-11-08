"""把 markdown 交付物（执行单 / SOP）转成可交付的 .docx。

依赖 python-docx，使用它直接生成；中文需显式设置 eastAsia 字体，否则 Word 里会回退成宋体。

用法：
  python scripts/tools/md_to_docx.py <输入.md> <输出.docx>

支持：# ~ #### 标题、| 表格 |（含分隔行）、``` 代码块、> 引用、- / - [ ] / 1. 列表、**加粗**、`行内代码`。
生成后务必回读核对段落数、表格数与表格行数，确认与 md 一致再交付。
"""
import re
import sys
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

CJK = "微软雅黑"


def set_cjk(run, name=CJK, size=None, bold=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold


def add_rich(par, text):
    """处理 **加粗** 与 `行内代码`。"""
    for seg in re.split(r"(\*\*.+?\*\*|`[^`]+`)", text):
        if not seg:
            continue
        if seg.startswith("**") and seg.endswith("**"):
            set_cjk(par.add_run(seg[2:-2]), bold=True)
        elif seg.startswith("`") and seg.endswith("`"):
            r = par.add_run(seg[1:-1])
            set_cjk(r, name="Consolas")
            r.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)
        else:
            set_cjk(par.add_run(seg))


def main(src, dst):
    lines = open(src, encoding="utf-8").read().split("\n")
    doc = Document()

    normal = doc.styles["Normal"]
    normal.font.name = CJK
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), CJK)

    i = 0
    while i < len(lines):
        stripped = lines[i].strip()

        # 代码块
        if stripped.startswith("```"):
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                p = doc.add_paragraph()
                p.paragraph_format.space_after = Pt(0)
                set_cjk(p.add_run(lines[i] if lines[i].strip() else " "), name="Consolas", size=9.5)
                i += 1
            i += 1
            continue

        # 表格
        if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            header, body = rows[0], rows[2:]
            table = doc.add_table(rows=1, cols=len(header))
            table.style = "Table Grid"
            for ci, cell_text in enumerate(header):
                cell = table.rows[0].cells[ci]
                cell.text = ""
                set_cjk(cell.paragraphs[0].add_run(cell_text.replace("**", "")), bold=True)
            for row in body:
                cells = table.add_row().cells
                for ci in range(len(header)):
                    cells[ci].text = ""
                    add_rich(cells[ci].paragraphs[0], row[ci] if ci < len(row) else "")
            doc.add_paragraph()
            continue

        # 标题
        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            level, title = min(len(m.group(1)), 4), m.group(2)
            h = doc.add_heading(level=level)
            set_cjk(h.add_run(title), size={1: 18, 2: 15, 3: 13, 4: 12}[level], bold=True)
            i += 1
            continue

        # 引用
        if stripped.startswith(">"):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Pt(18)
            add_rich(p, stripped.lstrip("> ").strip())
            for r in p.runs:
                r.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
                r.font.size = Pt(9.5)
            i += 1
            continue

        # 分隔线
        if stripped in ("---", "***"):
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_cjk(p.add_run("————————————————"), size=8)
            i += 1
            continue

        # 列表 / 待办
        m = re.match(r"^(- \[[ x]\]|[-*]|\d+\.)\s+(.*)$", stripped)
        if m:
            mark, text = m.group(1), m.group(2)
            prefix = {"- [ ]": "☐ ", "- [x]": "☑ "}.get(mark, "• " if mark in ("-", "*") else mark + " ")
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Pt(14)
            p.paragraph_format.space_after = Pt(2)
            set_cjk(p.add_run(prefix))
            add_rich(p, text)
            i += 1
            continue

        if not stripped:
            i += 1
            continue

        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        add_rich(p, stripped)
        i += 1

    doc.save(dst)
    print("已生成:", dst)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("用法: python scripts/tools/md_to_docx.py <输入.md> <输出.docx>")
    main(sys.argv[1], sys.argv[2])
