"""
一括請求書作成マクロ用 Excel テンプレート生成スクリプト

使い方:
    pip install openpyxl
    python create_template.py

生成されるファイル: BulkInvoiceTemplate.xlsx
"""

import openpyxl
from openpyxl.styles import (
    Font, Alignment, PatternFill, Border, Side, numbers
)
from openpyxl.utils import get_column_letter


# ---- スタイル定義 ----

def thin_border(**kwargs):
    sides = {k: Side(style="thin") for k in ("left", "right", "top", "bottom")}
    sides.update({k: Side(style=v) for k, v in kwargs.items()})
    return Border(**sides)

def medium_border(**kwargs):
    sides = {k: Side(style="thin") for k in ("left", "right", "top", "bottom")}
    sides.update({k: Side(style=v) for k, v in kwargs.items()})
    return Border(**sides)

HEADER_FILL   = PatternFill("solid", fgColor="1A3A6B")
SUBHEAD_FILL  = PatternFill("solid", fgColor="D6E4F7")
AMOUNT_FILL   = PatternFill("solid", fgColor="F0F4FF")
TOTAL_FILL    = PatternFill("solid", fgColor="1A3A6B")
ODD_ROW_FILL  = PatternFill("solid", fgColor="F8F9FF")

WHITE = Font(color="FFFFFF", bold=True)
BLUE  = Font(color="1A3A6B", bold=True)
GRAY  = Font(color="888888")
NUM_FMT = '#,##0'


# ================================================================
# 設定シート
# ================================================================
def setup_setting_sheet(ws):
    ws.title = "設定"

    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 45

    # タイトル行
    ws["A1"] = "【設定】自社情報・マクロ設定"
    ws["A1"].font = Font(bold=True, size=13, color="1A3A6B")
    ws.merge_cells("A1:B1")

    rows = [
        ("A2", "B2", "会社名",           "株式会社サンプル"),
        ("A3", "B3", "住所",             "〒100-0001 東京都千代田区○○1-2-3"),
        ("A4", "B4", "TEL",             "03-0000-0000"),
        ("A5", "B5", "振込先情報",        "○○銀行 △△支店 普通 1234567 カ）サンプル"),
        ("A6", "B6", "支払期限（日数）",   30),
        ("A7", "B7", "請求書番号プレフィックス", "INV"),
    ]

    for a_cell, b_cell, label, value in rows:
        ws[a_cell] = label
        ws[a_cell].font = Font(bold=True, color="555555")
        ws[a_cell].fill = SUBHEAD_FILL
        ws[a_cell].border = thin_border()
        ws[a_cell].alignment = Alignment(vertical="center")

        ws[b_cell] = value
        ws[b_cell].border = thin_border()
        ws[b_cell].alignment = Alignment(vertical="center", wrap_text=True)

    ws["B6"].number_format = "0"
    ws["B6"].alignment = Alignment(vertical="center", horizontal="left")

    # ガイドテキスト
    ws["A9"]  = "※ 支払期限（日数）: 請求日から何日後を支払期限とするか（例: 30 = 翌月末相当）"
    ws["A9"].font  = GRAY
    ws["A10"] = "※ 請求書番号プレフィックス: 請求書シート名の先頭文字列（例: INV → INV-0001）"
    ws["A10"].font = GRAY
    ws.merge_cells("A9:B9")
    ws.merge_cells("A10:B10")

    ws.sheet_view.showGridLines = True


# ================================================================
# 請求先リストシート
# ================================================================
def setup_list_sheet(ws):
    ws.title = "請求先リスト"

    # タイトル
    ws["A1"] = "【請求先リスト】ここにデータを入力してください"
    ws["A1"].font = Font(bold=True, size=13, color="1A3A6B")
    ws.merge_cells("A1:U1")

    # ヘッダー行
    headers = [
        ("A2", "No.",    6),
        ("B2", "取引先名", 20),
        ("C2", "請求日",  13),
        ("D2", "支払期限", 13),
        ("E2", "品目1",   20),
        ("F2", "数量1",    8),
        ("G2", "単価1",   12),
        ("H2", "品目2",   18),
        ("I2", "数量2",    8),
        ("J2", "単価2",   12),
        ("K2", "品目3",   18),
        ("L2", "数量3",    8),
        ("M2", "単価3",   12),
        ("N2", "品目4",   18),
        ("O2", "数量4",    8),
        ("P2", "単価4",   12),
        ("Q2", "品目5",   18),
        ("R2", "数量5",    8),
        ("S2", "単価5",   12),
        ("T2", "消費税率(%)", 12),
        ("U2", "備考",    25),
    ]

    for cell_ref, label, width in headers:
        col_letter = cell_ref[0]
        ws.column_dimensions[col_letter].width = width

        c = ws[cell_ref]
        c.value     = label
        c.font      = WHITE
        c.fill      = HEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border    = thin_border()

    ws.row_dimensions[2].height = 30

    # サンプルデータ（3行）
    samples = [
        (1, "株式会社テスト商事",  "2026/1/31", "",          "システム開発費",   1,  500000, "保守費",         1, 50000, "", "", "", "", "", "", "", "", "", 10, ""),
        (2, "有限会社サンプル工業", "2026/1/31", "2026/2/28", "製品A",           10,  15000, "製品B",          5, 20000, "送料", 1, 2000, "", "", "", "", "", "", 10, ""),
        (3, "○○株式会社",         "2026/2/28", "",          "コンサルティング費", 1, 200000, "",              "", "",    "",     "", "", "", "", "", "", "", "", 10, "月次レポート含む"),
    ]

    for row_idx, data in enumerate(samples, start=3):
        fill = ODD_ROW_FILL if row_idx % 2 == 1 else PatternFill()
        for col_idx, value in enumerate(data, start=1):
            c = ws.cell(row=row_idx, column=col_idx, value=value)
            c.border    = thin_border()
            c.alignment = Alignment(vertical="center")
            c.fill      = fill

            # 数値セル（単価・数量）のフォーマット
            if col_index_is_numeric(col_idx):
                c.number_format = NUM_FMT
                c.alignment = Alignment(horizontal="right", vertical="center")

        # 日付セルのフォーマット
        ws.cell(row=row_idx, column=3).number_format = "yyyy/m/d"
        ws.cell(row=row_idx, column=4).number_format = "yyyy/m/d"

    # 空行（入力用）を10行追加
    for row_idx in range(len(samples) + 3, len(samples) + 13):
        for col_idx in range(1, 22):
            c = ws.cell(row=row_idx, column=col_idx)
            c.border = thin_border()
            if col_index_is_numeric(col_idx):
                c.number_format = NUM_FMT

    # 列AA（27列目）= 生成済みシート名（マクロが自動入力）
    ws.cell(row=2, column=27).value = "生成済みシート名"
    ws.cell(row=2, column=27).font  = GRAY
    ws.column_dimensions["AA"].width = 18

    ws.freeze_panes = "B3"
    ws.sheet_view.showGridLines = True


def col_index_is_numeric(col_idx):
    """数量・単価列かどうか"""
    numeric_cols = {6, 7, 9, 10, 12, 13, 15, 16, 18, 19, 20}
    return col_idx in numeric_cols


# ================================================================
# 請求書テンプレートシート
# ================================================================
def setup_template_sheet(ws):
    ws.title = "請求書テンプレート"

    # 列幅設定
    col_widths = {"A": 3, "B": 26, "C": 8, "D": 4, "E": 10, "F": 12, "G": 14, "H": 16}
    for col, width in col_widths.items():
        ws.column_dimensions[col].width = width

    # 行高設定
    for row in range(1, 30):
        ws.row_dimensions[row].height = 18
    ws.row_dimensions[6].height = 28
    ws.row_dimensions[9].height = 22

    # --- 自社情報エリア（左上）---
    ws["B2"] = "（会社名）"
    ws["B2"].font = Font(bold=True, size=14, color="1A3A6B")

    ws["B3"] = "（住所）"
    ws["B3"].font = GRAY

    ws["B4"] = "（TEL）"
    ws["B4"].font = GRAY

    # --- 請求書タイトル（右上）---
    ws["G1"] = "請　求　書"
    ws["G1"].font      = Font(bold=True, size=18, color="1A3A6B")
    ws["G1"].alignment = Alignment(horizontal="right", vertical="center")
    ws.merge_cells("G1:H1")

    for cell_ref, label in (("G2", "請求書番号："), ("G3", "発行日："), ("G4", "支払期限：")):
        c = ws[cell_ref]
        c.value     = label
        c.font      = Font(bold=True, color="555555")
        c.alignment = Alignment(horizontal="right", vertical="center")

    for cell_ref in ("H2", "H3", "H4"):
        c = ws[cell_ref]
        c.value     = "（自動入力）"
        c.font      = GRAY
        c.alignment = Alignment(horizontal="left", vertical="center")

    # 区切り線
    for col in range(1, 9):
        ws.cell(row=5, column=col).border = Border(bottom=Side(style="medium", color="1A3A6B"))

    # --- 取引先・請求金額エリア ---
    ws["B6"] = "（取引先名）御中"
    ws["B6"].font      = Font(bold=True, size=13)
    ws["B6"].alignment = Alignment(vertical="center")
    ws.merge_cells("B6:D6")

    ws["G6"] = "ご請求金額"
    ws["G6"].font      = Font(bold=True, color="555555")
    ws["G6"].fill      = SUBHEAD_FILL
    ws["G6"].alignment = Alignment(horizontal="center", vertical="center")
    ws["G6"].border    = thin_border()

    ws["H6"] = 0
    ws["H6"].font         = Font(bold=True, size=14, color="1A3A6B")
    ws["H6"].number_format = '¥#,##0－'
    ws["H6"].alignment    = Alignment(horizontal="right", vertical="center")
    ws["H6"].border       = thin_border()

    ws["B7"] = "下記のとおりご請求申し上げます。"
    ws["B7"].font = Font(color="555555")
    ws.merge_cells("B7:H7")

    # 区切り線
    for col in range(1, 9):
        ws.cell(row=8, column=col).border = Border(bottom=Side(style="thin", color="AAAAAA"))

    # --- 品目ヘッダー ---
    item_headers = [("B9", "品　目", 22), ("E9", "数量", 10), ("F9", "単価", 12), ("G9", "金額（税抜）", 14)]
    for cell_ref, label, _ in item_headers:
        c = ws[cell_ref]
        c.value     = label
        c.font      = WHITE
        c.fill      = HEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border    = thin_border()

    ws.merge_cells("B9:D9")

    # --- 品目行（10〜14行目）---
    for row in range(10, 15):
        fill = ODD_ROW_FILL if row % 2 == 0 else PatternFill()

        # 品目列（B〜D結合）
        for col in ("B", "C", "D"):
            c = ws[f"{col}{row}"]
            c.fill = fill
        ws.merge_cells(f"B{row}:D{row}")
        c = ws[f"B{row}"]
        c.border    = thin_border()
        c.alignment = Alignment(vertical="center")

        # 数量・単価・金額
        for col_letter, fmt in (("E", NUM_FMT), ("F", NUM_FMT), ("G", NUM_FMT)):
            c = ws[f"{col_letter}{row}"]
            c.fill         = fill
            c.number_format = fmt
            c.alignment    = Alignment(horizontal="right", vertical="center")
            c.border       = thin_border()

    # --- 区切り ---
    for col in range(1, 9):
        ws.cell(row=15, column=col).border = Border(
            bottom=Side(style="medium", color="1A3A6B"),
            top=Side(style="thin")
        )

    # --- 集計エリア ---
    summary_rows = [
        (16, "小　計", "G16", NUM_FMT, False),
        (17, "消費税（10%）", "G17", NUM_FMT, False),
        (18, "合　計（税込）", "G18", NUM_FMT, True),
    ]
    for row, label, val_cell, fmt, is_total in summary_rows:
        # ラベル
        lc = ws[f"F{row}"]
        lc.value     = label
        lc.font      = WHITE if is_total else Font(bold=True, color="555555")
        lc.fill      = TOTAL_FILL if is_total else SUBHEAD_FILL
        lc.alignment = Alignment(horizontal="right", vertical="center")
        lc.border    = thin_border()

        # 値
        vc = ws[val_cell]
        vc.value         = 0
        vc.font          = WHITE if is_total else Font(bold=True)
        vc.fill          = TOTAL_FILL if is_total else AMOUNT_FILL
        vc.number_format = fmt
        vc.alignment     = Alignment(horizontal="right", vertical="center")
        vc.border        = thin_border()

        ws.row_dimensions[row].height = 22

    # --- 振込先 ---
    ws["B20"] = "【振込先】"
    ws["B20"].font = Font(bold=True, color="1A3A6B")
    ws.merge_cells("B20:H20")

    ws["B21"] = "（振込先情報が自動入力されます）"
    ws["B21"].font = GRAY
    ws.merge_cells("B21:H21")

    ws["B22"].border = Border(bottom=Side(style="thin", color="CCCCCC"))
    ws.merge_cells("B22:H22")

    # --- 備考 ---
    ws["B23"] = "【備考】"
    ws["B23"].font = Font(bold=True, color="1A3A6B")
    ws.merge_cells("B23:H23")

    ws["B24"] = "（備考が自動入力されます）"
    ws["B24"].font = GRAY
    ws.merge_cells("B24:H24")
    ws.row_dimensions[24].height = 40
    ws["B24"].alignment = Alignment(wrap_text=True, vertical="top")

    # 外枠
    for row in range(1, 25):
        for col in (1, 8):
            existing = ws.cell(row=row, column=col).border
            ws.cell(row=row, column=col).border = Border(
                left=Side(style="medium") if col == 1 else existing.left,
                right=Side(style="medium") if col == 8 else existing.right,
                top=existing.top,
                bottom=existing.bottom,
            )

    # 印刷設定
    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT
    ws.page_setup.paperSize   = ws.PAPERSIZE_A4
    ws.page_setup.fitToPage   = True
    ws.page_setup.fitToWidth  = 1
    ws.page_setup.fitToHeight = 1
    ws.print_area = "A1:H26"
    ws.sheet_view.showGridLines = False


# ================================================================
# メイン処理
# ================================================================
def main():
    wb = openpyxl.Workbook()

    # シート作成
    ws_setting  = wb.active
    ws_list     = wb.create_sheet("請求先リスト")
    ws_template = wb.create_sheet("請求書テンプレート")

    setup_setting_sheet(ws_setting)
    setup_list_sheet(ws_list)
    setup_template_sheet(ws_template)

    # 設定シートをアクティブに
    wb.active = ws_setting

    output = "BulkInvoiceTemplate.xlsx"
    wb.save(output)
    print(f"✅ テンプレートファイルを作成しました: {output}")
    print()
    print("【次の手順】")
    print("  1. BulkInvoiceTemplate.xlsx を Excel で開く")
    print("  2. Alt+F11 でVBAエディタを開く")
    print("  3. ファイル → ファイルのインポート → BulkInvoiceMacro.bas を選択")
    print("  4. 「設定」シートに自社情報を入力")
    print("  5. 「請求先リスト」シートに請求データを入力")
    print("  6. Alt+F8 → 一括請求書作成 → 実行")


if __name__ == "__main__":
    main()
