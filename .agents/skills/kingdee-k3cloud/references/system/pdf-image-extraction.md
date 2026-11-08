# 图片型 PDF / 扫描件取字（建料、对账、单据取证通用）

## 判定：是「没文字层」不是「文件坏了」

- `read_file` 打开客户资料 PDF 报 `Failed to read binary file: JVBERi0x...`（回吐 base64）或 `NeedsOcr`，`pdftotext` / `pymupdf get_text()` 为空 → 图片型 PDF（整页 JPEG/DCTDecode），内容只在像素里。
- 此时不要反复换读取工具，也不要报「无法读取该附件」；直接转渲染路线。

## 渲染 → 读字两条路线

1. **pymupdf 渲染**（本机 `python`/`python3` 有 `pymupdf`，`import fitz` 或 `import pymupdf` 均可）：
   ```python
   import pymupdf, os
   d = pymupdf.open(r"C:\...\xxx.pdf")
   for i, p in enumerate(d):
       pix = p.get_pixmap(dpi=150)          # 表格/装配图 150 够；小字用 200
       pix.save(os.path.join(OUT, f"page{i}.png"))
   ```
2. **横排表格页 / 装配图 / 丝印图** → 渲染后直接 `vision_analyze` 提取字段（实测封装资料表格字段全中：成品型号、封装形式、晶圆名称、批号、片数、MARK）。
3. **竖排扫描表格、或数字必须精确** → RapidOCR（`hermes-agent/venv/Scripts/python.exe` 下才有 `rapidocr_onnxruntime`；竖排先 `cv2.rotate` 转 90°）。OCR 误读数字（4→5、0↔O）是常态。

## 铁规则

- **任何从图里读出的数字（晶圆批号、片数、尺寸、数量）落库前必须双向核对**：与用户截图、成品型号、同族现役料规格交叉对不上就先 dry-run 展示、文字请用户拍板；存疑字段的处置同「建料决定类问题问出去没等到回话」条。
- 读出的字段只作为**建料参数的来源之一**，最终以同组模板 `View` 逐字段 diff 为准（见 `material-create.md`）。
- `vision_analyze` 支持本地图路径，无需先转 base64；带 `region` 可裁剪放大局部小字。
