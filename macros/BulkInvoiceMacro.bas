Attribute VB_Name = "BulkInvoiceMacro"
Option Explicit

'==============================================================
' 一括請求書作成マクロ
'
' 【使い方】
'   1. create_template.py を実行して BulkInvoiceTemplate.xlsx を生成
'   2. Excel で開き、Alt+F11 → ファイル → ファイルのインポートで
'      このファイル（BulkInvoiceMacro.bas）をインポート
'   3. 「設定」シートに自社情報を入力
'   4. 「請求先リスト」シートに請求データを入力
'   5. Alt+F8 → 一括請求書作成 → 実行
'==============================================================

' ===== シート名 =====
Private Const SHEET_LIST      As String = "請求先リスト"
Private Const SHEET_TEMPLATE  As String = "請求書テンプレート"
Private Const SHEET_SETTING   As String = "設定"

' ===== 設定シートのセル位置 =====
Private Const SET_COMPANY_NAME    As String = "B2"
Private Const SET_COMPANY_ADDRESS As String = "B3"
Private Const SET_COMPANY_TEL     As String = "B4"
Private Const SET_BANK_INFO       As String = "B5"
Private Const SET_PAYMENT_DAYS    As String = "B6"   ' 支払期限（日数）
Private Const SET_INV_PREFIX      As String = "B7"   ' 請求書番号プレフィックス

' ===== 請求先リストの列番号 =====
Private Const COL_NO           As Long = 1   ' A: No.（連番）
Private Const COL_COUNTERPARTY As Long = 2   ' B: 取引先名
Private Const COL_INV_DATE     As Long = 3   ' C: 請求日
Private Const COL_DUE_DATE     As Long = 4   ' D: 支払期限（空欄なら設定値から自動計算）
Private Const COL_ITEM1        As Long = 5   ' E: 品目1
Private Const COL_QTY1         As Long = 6   ' F: 数量1
Private Const COL_UPRICE1      As Long = 7   ' G: 単価1
Private Const COL_ITEM2        As Long = 8   ' H: 品目2
Private Const COL_QTY2         As Long = 9   ' I: 数量2
Private Const COL_UPRICE2      As Long = 10  ' J: 単価2
Private Const COL_ITEM3        As Long = 11  ' K: 品目3
Private Const COL_QTY3         As Long = 12  ' L: 数量3
Private Const COL_UPRICE3      As Long = 13  ' M: 単価3
Private Const COL_ITEM4        As Long = 14  ' N: 品目4
Private Const COL_QTY4         As Long = 15  ' O: 数量4
Private Const COL_UPRICE4      As Long = 16  ' P: 単価4
Private Const COL_ITEM5        As Long = 17  ' Q: 品目5
Private Const COL_QTY5         As Long = 18  ' R: 数量5
Private Const COL_UPRICE5      As Long = 19  ' S: 単価5
Private Const COL_TAX_RATE     As Long = 20  ' T: 消費税率（%）
Private Const COL_NOTE         As Long = 21  ' U: 備考

Private Const LIST_DATA_START  As Long = 3   ' データ開始行（1行=タイトル, 2行=ヘッダー）

' ===== テンプレートシートのセル位置 =====
Private Const TPL_COMPANY_NAME    As String = "B2"
Private Const TPL_COMPANY_ADDRESS As String = "B3"
Private Const TPL_COMPANY_TEL     As String = "B4"
Private Const TPL_INV_NUMBER      As String = "H2"
Private Const TPL_INV_DATE        As String = "H3"
Private Const TPL_DUE_DATE        As String = "H4"
Private Const TPL_COUNTERPARTY    As String = "B6"
Private Const TPL_TOTAL_DISPLAY   As String = "H6"
Private Const TPL_ITEM_START_ROW  As Long = 10
Private Const TPL_ITEM_MAX        As Long = 5
Private Const TPL_COL_ITEM        As Long = 2  ' B列
Private Const TPL_COL_QTY         As Long = 5  ' E列
Private Const TPL_COL_UPRICE      As Long = 6  ' F列
Private Const TPL_COL_AMOUNT      As Long = 7  ' G列
Private Const TPL_SUBTOTAL        As String = "G16"
Private Const TPL_TAX_AMT         As String = "G17"
Private Const TPL_TOTAL           As String = "G18"
Private Const TPL_BANK_INFO       As String = "B21"
Private Const TPL_NOTE            As String = "B24"


'==============================================================
' 一括請求書作成（メイン）
'==============================================================
Public Sub 一括請求書作成()
    Dim wsList      As Worksheet
    Dim wsTemplate  As Worksheet
    Dim wsSetting   As Worksheet
    Dim lastRow     As Long
    Dim i           As Long
    Dim created     As Long
    Dim skipped     As Long

    On Error GoTo ErrHandler

    Application.ScreenUpdating = False
    Application.DisplayAlerts  = False
    Application.Calculation    = xlCalculationManual

    ' シート存在確認
    If Not SheetExists(SHEET_LIST) Then
        MsgBox "「" & SHEET_LIST & "」シートが見つかりません。", vbExclamation
        GoTo Cleanup
    End If
    If Not SheetExists(SHEET_TEMPLATE) Then
        MsgBox "「" & SHEET_TEMPLATE & "」シートが見つかりません。", vbExclamation
        GoTo Cleanup
    End If
    If Not SheetExists(SHEET_SETTING) Then
        MsgBox "「" & SHEET_SETTING & "」シートが見つかりません。", vbExclamation
        GoTo Cleanup
    End If

    Set wsList     = ThisWorkbook.Worksheets(SHEET_LIST)
    Set wsTemplate = ThisWorkbook.Worksheets(SHEET_TEMPLATE)
    Set wsSetting  = ThisWorkbook.Worksheets(SHEET_SETTING)

    ' 最終行を取得
    lastRow = wsList.Cells(wsList.Rows.Count, COL_COUNTERPARTY).End(xlUp).Row

    If lastRow < LIST_DATA_START Then
        MsgBox "請求先リストにデータがありません。", vbInformation
        GoTo Cleanup
    End If

    created = 0
    skipped = 0

    For i = LIST_DATA_START To lastRow
        Dim counterparty As String
        counterparty = Trim(CStr(wsList.Cells(i, COL_COUNTERPARTY).Value))

        ' 取引先が空の行はスキップ
        If counterparty = "" Then
            skipped = skipped + 1
            GoTo NextRow
        End If

        ' 請求書番号を生成
        Dim invNo As Long
        invNo = wsList.Cells(i, COL_NO).Value
        If invNo = 0 Then invNo = i - LIST_DATA_START + 1

        Dim prefix As String
        prefix = Trim(CStr(wsSetting.Range(SET_INV_PREFIX).Value))
        If prefix = "" Then prefix = "INV"

        Dim sheetName As String
        sheetName = Left(prefix & "-" & Format(invNo, "0000"), 31)

        ' 既存シートを上書き
        If SheetExists(sheetName) Then
            ThisWorkbook.Worksheets(sheetName).Delete
        End If

        ' テンプレートをコピーして新シート作成
        wsTemplate.Copy After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count)
        Dim wsNew As Worksheet
        Set wsNew = ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count)
        wsNew.Name = sheetName

        ' 請求書データを書き込む
        WriteInvoiceData wsNew, wsSetting, wsList, i, prefix & "-" & Format(invNo, "0000")

        ' リストに生成済みシート名を記録（AA列）
        wsList.Cells(i, 27).Value = sheetName

        created = created + 1
NextRow:
    Next i

    MsgBox created & " 件の請求書を作成しました。" & _
           IIf(skipped > 0, vbCrLf & skipped & " 行をスキップしました。", ""), _
           vbInformation, "一括請求書作成 完了"

Cleanup:
    Application.Calculation    = xlCalculationAutomatic
    Application.DisplayAlerts  = True
    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.Calculation    = xlCalculationAutomatic
    Application.DisplayAlerts  = True
    Application.ScreenUpdating = True
    MsgBox "エラーが発生しました（行 " & i & "）:" & vbCrLf & Err.Description, _
           vbCritical, "エラー"
End Sub


'==============================================================
' 請求書シートへのデータ書き込み
'==============================================================
Private Sub WriteInvoiceData(wsNew As Worksheet, wsSetting As Worksheet, _
                              wsList As Worksheet, dataRow As Long, invNumber As String)
    ' --- 自社情報 ---
    wsNew.Range(TPL_COMPANY_NAME).Value    = wsSetting.Range(SET_COMPANY_NAME).Value
    wsNew.Range(TPL_COMPANY_ADDRESS).Value = wsSetting.Range(SET_COMPANY_ADDRESS).Value
    wsNew.Range(TPL_COMPANY_TEL).Value     = wsSetting.Range(SET_COMPANY_TEL).Value

    ' --- 請求書ヘッダー ---
    wsNew.Range(TPL_INV_NUMBER).Value = invNumber

    Dim invDate As Date
    If IsDate(wsList.Cells(dataRow, COL_INV_DATE).Value) Then
        invDate = CDate(wsList.Cells(dataRow, COL_INV_DATE).Value)
    Else
        invDate = Date
    End If
    wsNew.Range(TPL_INV_DATE).Value = Format(invDate, "yyyy年m月d日")

    ' 支払期限
    Dim dueDate As Date
    If IsDate(wsList.Cells(dataRow, COL_DUE_DATE).Value) Then
        dueDate = CDate(wsList.Cells(dataRow, COL_DUE_DATE).Value)
    Else
        Dim payDays As Long
        payDays = wsSetting.Range(SET_PAYMENT_DAYS).Value
        If payDays = 0 Then payDays = 30
        dueDate = invDate + payDays
        ' 月末締めに補正（月末日を超えないようにする）
        dueDate = EndOfMonth(Year(dueDate), Month(dueDate))
    End If
    wsNew.Range(TPL_DUE_DATE).Value = Format(dueDate, "yyyy年m月d日")

    ' --- 取引先 ---
    wsNew.Range(TPL_COUNTERPARTY).Value = wsList.Cells(dataRow, COL_COUNTERPARTY).Value & " 御中"

    ' --- 振込先・備考 ---
    wsNew.Range(TPL_BANK_INFO).Value = wsSetting.Range(SET_BANK_INFO).Value
    Dim noteVal As String
    noteVal = Trim(CStr(wsList.Cells(dataRow, COL_NOTE).Value))
    If noteVal <> "" Then
        wsNew.Range(TPL_NOTE).Value = noteVal
    End If

    ' --- 品目データ ---
    Dim itemCols(1 To 5, 1 To 3) As Variant  ' (品目, 数量, 単価)
    itemCols(1, 1) = wsList.Cells(dataRow, COL_ITEM1).Value
    itemCols(1, 2) = wsList.Cells(dataRow, COL_QTY1).Value
    itemCols(1, 3) = wsList.Cells(dataRow, COL_UPRICE1).Value
    itemCols(2, 1) = wsList.Cells(dataRow, COL_ITEM2).Value
    itemCols(2, 2) = wsList.Cells(dataRow, COL_QTY2).Value
    itemCols(2, 3) = wsList.Cells(dataRow, COL_UPRICE2).Value
    itemCols(3, 1) = wsList.Cells(dataRow, COL_ITEM3).Value
    itemCols(3, 2) = wsList.Cells(dataRow, COL_QTY3).Value
    itemCols(3, 3) = wsList.Cells(dataRow, COL_UPRICE3).Value
    itemCols(4, 1) = wsList.Cells(dataRow, COL_ITEM4).Value
    itemCols(4, 2) = wsList.Cells(dataRow, COL_QTY4).Value
    itemCols(4, 3) = wsList.Cells(dataRow, COL_UPRICE4).Value
    itemCols(5, 1) = wsList.Cells(dataRow, COL_ITEM5).Value
    itemCols(5, 2) = wsList.Cells(dataRow, COL_QTY5).Value
    itemCols(5, 3) = wsList.Cells(dataRow, COL_UPRICE5).Value

    Dim subtotal As Double
    subtotal = 0

    Dim j As Long
    For j = 1 To TPL_ITEM_MAX
        Dim itemName As String
        itemName = Trim(CStr(itemCols(j, 1)))
        If itemName = "" Then GoTo NextItem

        Dim qty      As Double
        Dim uprice   As Double
        Dim amount   As Double
        qty    = IIf(IsNumeric(itemCols(j, 2)), CDbl(itemCols(j, 2)), 1)
        uprice = IIf(IsNumeric(itemCols(j, 3)), CDbl(itemCols(j, 3)), 0)
        amount = qty * uprice

        Dim rowIdx As Long
        rowIdx = TPL_ITEM_START_ROW + j - 1

        wsNew.Cells(rowIdx, TPL_COL_ITEM).Value   = itemName
        wsNew.Cells(rowIdx, TPL_COL_QTY).Value    = qty
        wsNew.Cells(rowIdx, TPL_COL_UPRICE).Value = uprice
        wsNew.Cells(rowIdx, TPL_COL_AMOUNT).Value = amount

        subtotal = subtotal + amount
NextItem:
    Next j

    ' --- 集計 ---
    Dim taxRate As Double
    taxRate = wsList.Cells(dataRow, COL_TAX_RATE).Value
    If taxRate = 0 Then taxRate = 10

    Dim taxAmt As Double
    Dim totalAmt As Double
    taxAmt   = Int(subtotal * (taxRate / 100))  ' 切り捨て
    totalAmt = subtotal + taxAmt

    wsNew.Range(TPL_SUBTOTAL).Value = subtotal
    wsNew.Range(TPL_TAX_AMT).Value  = taxAmt
    wsNew.Range(TPL_TOTAL).Value    = totalAmt

    ' ヘッダー部の合計金額表示
    wsNew.Range(TPL_TOTAL_DISPLAY).Value = totalAmt
End Sub


'==============================================================
' PDF 一括出力
'==============================================================
Public Sub PDF一括出力()
    Dim ws        As Worksheet
    Dim savePath  As String
    Dim count     As Long
    Dim prefix    As String

    If Not SheetExists(SHEET_SETTING) Then
        MsgBox "「" & SHEET_SETTING & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If

    prefix = Trim(CStr(ThisWorkbook.Worksheets(SHEET_SETTING).Range(SET_INV_PREFIX).Value))
    If prefix = "" Then prefix = "INV"

    savePath = ThisWorkbook.Path & "\PDF出力\"
    If Dir(savePath, vbDirectory) = "" Then MkDir savePath

    Application.ScreenUpdating = False
    count = 0

    For Each ws In ThisWorkbook.Worksheets
        If Left(ws.Name, Len(prefix) + 1) = prefix & "-" Then
            Dim pdfPath As String
            pdfPath = savePath & ws.Name & ".pdf"
            ws.ExportAsFixedFormat _
                Type:=xlTypePDF, _
                Filename:=pdfPath, _
                Quality:=xlQualityStandard, _
                IncludeDocProperties:=True, _
                IgnorePrintAreas:=False, _
                OpenAfterPublish:=False
            count = count + 1
        End If
    Next ws

    Application.ScreenUpdating = True

    If count > 0 Then
        MsgBox count & " 件のPDFを出力しました。" & vbCrLf & savePath, _
               vbInformation, "PDF出力完了"
        Shell "explorer.exe """ & savePath & """", vbNormalFocus
    Else
        MsgBox "出力対象の請求書シートが見つかりませんでした。", vbInformation
    End If
End Sub


'==============================================================
' 生成した請求書シートを全削除
'==============================================================
Public Sub 請求書シートを全削除()
    If MsgBox("生成された請求書シートをすべて削除しますか？" & vbCrLf & _
              "この操作は元に戻せません。", _
              vbQuestion + vbYesNo, "確認") = vbNo Then Exit Sub

    Dim prefix As String
    If SheetExists(SHEET_SETTING) Then
        prefix = Trim(CStr(ThisWorkbook.Worksheets(SHEET_SETTING).Range(SET_INV_PREFIX).Value))
    End If
    If prefix = "" Then prefix = "INV"

    Application.DisplayAlerts  = False
    Application.ScreenUpdating = False

    Dim ws      As Worksheet
    Dim names() As String
    Dim count   As Long
    count = 0

    ' 先にシート名を収集（削除しながらループできないため）
    ReDim names(0)
    For Each ws In ThisWorkbook.Worksheets
        If Left(ws.Name, Len(prefix) + 1) = prefix & "-" Then
            ReDim Preserve names(count)
            names(count) = ws.Name
            count = count + 1
        End If
    Next ws

    Dim i As Long
    For i = 0 To count - 1
        ThisWorkbook.Worksheets(names(i)).Delete
    Next i

    ' リストの生成済みシート名列をクリア
    If SheetExists(SHEET_LIST) Then
        Dim wsList As Worksheet
        Set wsList = ThisWorkbook.Worksheets(SHEET_LIST)
        Dim lastRow As Long
        lastRow = wsList.Cells(wsList.Rows.Count, COL_COUNTERPARTY).End(xlUp).Row
        If lastRow >= LIST_DATA_START Then
            wsList.Range(wsList.Cells(LIST_DATA_START, 27), _
                         wsList.Cells(lastRow, 27)).ClearContents
        End If
    End If

    Application.DisplayAlerts  = True
    Application.ScreenUpdating = True

    MsgBox count & " 件のシートを削除しました。", vbInformation
End Sub


'==============================================================
' 請求先リストに連番を自動入力
'==============================================================
Public Sub 連番を自動入力()
    If Not SheetExists(SHEET_LIST) Then
        MsgBox "「" & SHEET_LIST & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If

    Dim wsList  As Worksheet
    Dim lastRow As Long
    Set wsList = ThisWorkbook.Worksheets(SHEET_LIST)
    lastRow = wsList.Cells(wsList.Rows.Count, COL_COUNTERPARTY).End(xlUp).Row

    If lastRow < LIST_DATA_START Then
        MsgBox "請求先リストにデータがありません。", vbInformation
        Exit Sub
    End If

    Dim i As Long
    For i = LIST_DATA_START To lastRow
        If Trim(CStr(wsList.Cells(i, COL_COUNTERPARTY).Value)) <> "" Then
            wsList.Cells(i, COL_NO).Value = i - LIST_DATA_START + 1
        End If
    Next i

    MsgBox "連番を入力しました。", vbInformation
End Sub


'==============================================================
' ユーティリティ
'==============================================================
Private Function SheetExists(sheetName As String) As Boolean
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(sheetName)
    SheetExists = Not ws Is Nothing
    On Error GoTo 0
End Function

Private Function EndOfMonth(y As Long, m As Long) As Date
    ' 指定年月の月末日を返す
    EndOfMonth = DateSerial(y, m + 1, 0)
End Function
