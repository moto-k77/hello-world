Attribute VB_Name = "BulkInvoiceMacro"
Option Explicit

'==============================================================
' 一括請求書作成マクロ（ファイル出力版）
'
' 【使い方】
'   1. create_template.py を実行してファイル群を生成
'   2. BulkInvoiceTemplate.xlsx を Excel で開く
'   3. Alt+F11 → ファイル → ファイルのインポート で
'      このファイル（BulkInvoiceMacro.bas）をインポート
'   4. 「設定」シートに自社情報・パスを入力
'      B8: 請求書テンプレートファイルのパス
'      B9: 出力フォルダーのパス
'   5. 「請求先リスト」シートに請求データを入力
'   6. Alt+F8 → 一括請求書作成 → 実行
'==============================================================

' ===== シート名 =====
Private Const SHEET_LIST     As String = "請求先リスト"
Private Const SHEET_SETTING  As String = "設定"

' ===== 設定シートのセル位置 =====
Private Const SET_COMPANY_NAME    As String = "B2"
Private Const SET_COMPANY_ADDRESS As String = "B3"
Private Const SET_COMPANY_TEL     As String = "B4"
Private Const SET_BANK_INFO       As String = "B5"
Private Const SET_PAYMENT_DAYS    As String = "B6"   ' 支払期限（日数）
Private Const SET_INV_PREFIX      As String = "B7"   ' 請求書番号プレフィックス
Private Const SET_TEMPLATE_PATH   As String = "B8"   ' テンプレートファイルのパス
Private Const SET_OUTPUT_FOLDER   As String = "B9"   ' 出力フォルダーのパス

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

'==============================================================
' テンプレートファイル内のセル位置
' ※ 実際のテンプレートのレイアウトに合わせてここを変更してください
'==============================================================
Private Const TPL_COMPANY_NAME    As String = "B2"
Private Const TPL_COMPANY_ADDRESS As String = "B3"
Private Const TPL_COMPANY_TEL     As String = "B4"
Private Const TPL_INV_NUMBER      As String = "H2"
Private Const TPL_INV_DATE        As String = "H3"
Private Const TPL_DUE_DATE        As String = "H4"
Private Const TPL_COUNTERPARTY    As String = "B6"
Private Const TPL_TOTAL_DISPLAY   As String = "H6"   ' ヘッダー部の合計金額表示
Private Const TPL_ITEM_START_ROW  As Long = 10       ' 品目入力の開始行
Private Const TPL_ITEM_MAX        As Long = 5        ' 品目の最大行数
Private Const TPL_COL_ITEM        As Long = 2        ' 品目列（B列）
Private Const TPL_COL_QTY         As Long = 5        ' 数量列（E列）
Private Const TPL_COL_UPRICE      As Long = 6        ' 単価列（F列）
Private Const TPL_COL_AMOUNT      As Long = 7        ' 金額列（G列）※テンプレートに数式がある場合は書き込みをスキップ
Private Const TPL_SUBTOTAL        As String = "G16"  ' 小計セル
Private Const TPL_TAX_AMT         As String = "G17"  ' 消費税額セル
Private Const TPL_TOTAL           As String = "G18"  ' 合計セル
Private Const TPL_BANK_INFO       As String = "B21"  ' 振込先セル
Private Const TPL_NOTE            As String = "B24"  ' 備考セル

' テンプレート内の品目金額列に数式がある場合は True に設定
' True = 金額列には書き込まず、テンプレートの数式で計算させる
Private Const TPL_AMOUNT_HAS_FORMULA As Boolean = False


'==============================================================
' 一括請求書作成（メイン）
'==============================================================
Public Sub 一括請求書作成()
    Dim wsList     As Worksheet
    Dim wsSetting  As Worksheet
    Dim lastRow    As Long
    Dim i          As Long
    Dim created    As Long
    Dim skipped    As Long
    Dim templatePath As String
    Dim outputFolder As String

    On Error GoTo ErrHandler

    ' シート確認
    If Not SheetExists(SHEET_SETTING) Then
        MsgBox "「" & SHEET_SETTING & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If
    If Not SheetExists(SHEET_LIST) Then
        MsgBox "「" & SHEET_LIST & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If

    Set wsSetting = ThisWorkbook.Worksheets(SHEET_SETTING)
    Set wsList    = ThisWorkbook.Worksheets(SHEET_LIST)

    ' テンプレートファイルのパスを取得・検証
    templatePath = ResolvePath(CStr(wsSetting.Range(SET_TEMPLATE_PATH).Value))
    If templatePath = "" Then
        MsgBox "設定シートの「テンプレートファイルパス」（B8）が入力されていません。", vbExclamation
        Exit Sub
    End If
    If Dir(templatePath) = "" Then
        MsgBox "テンプレートファイルが見つかりません:" & vbCrLf & templatePath, vbExclamation
        Exit Sub
    End If

    ' 出力フォルダーの取得・作成
    outputFolder = ResolvePath(CStr(wsSetting.Range(SET_OUTPUT_FOLDER).Value))
    If outputFolder = "" Then outputFolder = ThisWorkbook.Path & "\請求書出力"
    EnsureFolder outputFolder

    ' 最終行を取得
    lastRow = wsList.Cells(wsList.Rows.Count, COL_COUNTERPARTY).End(xlUp).Row
    If lastRow < LIST_DATA_START Then
        MsgBox "請求先リストにデータがありません。", vbInformation
        Exit Sub
    End If

    Application.ScreenUpdating = False
    Application.Calculation    = xlCalculationManual

    created = 0
    skipped = 0

    Dim prefix As String
    prefix = Trim(CStr(wsSetting.Range(SET_INV_PREFIX).Value))
    If prefix = "" Then prefix = "INV"

    For i = LIST_DATA_START To lastRow
        Dim counterparty As String
        counterparty = Trim(CStr(wsList.Cells(i, COL_COUNTERPARTY).Value))

        If counterparty = "" Then
            skipped = skipped + 1
            GoTo NextRow
        End If

        ' 請求書番号
        Dim invNo As Long
        invNo = wsList.Cells(i, COL_NO).Value
        If invNo = 0 Then invNo = i - LIST_DATA_START + 1

        Dim invNumber As String
        invNumber = prefix & "-" & Format(invNo, "0000")

        ' 出力ファイルパス（取引先名を含めてわかりやすいファイル名に）
        Dim safeCounterparty As String
        safeCounterparty = SanitizeFileName(counterparty)
        Dim outputPath As String
        outputPath = outputFolder & "\" & invNumber & "_" & safeCounterparty & ".xlsx"

        ' テンプレートファイルをコピー
        FileCopy templatePath, outputPath

        ' コピーしたファイルを開いてデータを書き込む
        Dim wbNew As Workbook
        Set wbNew = Workbooks.Open(Filename:=outputPath, UpdateLinks:=False)

        WriteInvoiceData wbNew.Sheets(1), wsSetting, wsList, i, invNumber

        wbNew.Save
        wbNew.Close SaveChanges:=False

        ' リストに出力ファイルパスを記録（AA列）
        wsList.Cells(i, 27).Value = outputPath

        created = created + 1
NextRow:
    Next i

    Application.Calculation    = xlCalculationAutomatic
    Application.ScreenUpdating = True

    Dim msg As String
    msg = created & " 件の請求書ファイルを作成しました。" & vbCrLf & _
          "出力先: " & outputFolder
    If skipped > 0 Then msg = msg & vbCrLf & skipped & " 行をスキップしました。"
    MsgBox msg, vbInformation, "一括請求書作成 完了"

    ' 出力フォルダーをエクスプローラーで開く
    Shell "explorer.exe """ & outputFolder & """", vbNormalFocus
    Exit Sub

ErrHandler:
    Application.Calculation    = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "エラーが発生しました（行 " & i & "）:" & vbCrLf & Err.Description, _
           vbCritical, "エラー"
End Sub


'==============================================================
' 請求書ファイルへのデータ書き込み
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
        dueDate = EndOfMonth(Year(invDate + payDays), Month(invDate + payDays))
    End If
    wsNew.Range(TPL_DUE_DATE).Value = Format(dueDate, "yyyy年m月d日")

    ' --- 取引先 ---
    wsNew.Range(TPL_COUNTERPARTY).Value = wsList.Cells(dataRow, COL_COUNTERPARTY).Value & " 御中"

    ' --- 振込先・備考 ---
    wsNew.Range(TPL_BANK_INFO).Value = wsSetting.Range(SET_BANK_INFO).Value
    Dim noteVal As String
    noteVal = Trim(CStr(wsList.Cells(dataRow, COL_NOTE).Value))
    If noteVal <> "" Then wsNew.Range(TPL_NOTE).Value = noteVal

    ' --- 品目データ ---
    Dim itemData(1 To 5, 1 To 3) As Variant  ' (品目名, 数量, 単価)
    itemData(1, 1) = wsList.Cells(dataRow, COL_ITEM1).Value
    itemData(1, 2) = wsList.Cells(dataRow, COL_QTY1).Value
    itemData(1, 3) = wsList.Cells(dataRow, COL_UPRICE1).Value
    itemData(2, 1) = wsList.Cells(dataRow, COL_ITEM2).Value
    itemData(2, 2) = wsList.Cells(dataRow, COL_QTY2).Value
    itemData(2, 3) = wsList.Cells(dataRow, COL_UPRICE2).Value
    itemData(3, 1) = wsList.Cells(dataRow, COL_ITEM3).Value
    itemData(3, 2) = wsList.Cells(dataRow, COL_QTY3).Value
    itemData(3, 3) = wsList.Cells(dataRow, COL_UPRICE3).Value
    itemData(4, 1) = wsList.Cells(dataRow, COL_ITEM4).Value
    itemData(4, 2) = wsList.Cells(dataRow, COL_QTY4).Value
    itemData(4, 3) = wsList.Cells(dataRow, COL_UPRICE4).Value
    itemData(5, 1) = wsList.Cells(dataRow, COL_ITEM5).Value
    itemData(5, 2) = wsList.Cells(dataRow, COL_QTY5).Value
    itemData(5, 3) = wsList.Cells(dataRow, COL_UPRICE5).Value

    Dim subtotal As Double
    subtotal = 0

    Dim j As Long
    For j = 1 To TPL_ITEM_MAX
        Dim itemName As String
        itemName = Trim(CStr(itemData(j, 1)))
        If itemName = "" Then GoTo NextItem

        Dim qty    As Double
        Dim uprice As Double
        qty    = IIf(IsNumeric(itemData(j, 2)), CDbl(itemData(j, 2)), 1)
        uprice = IIf(IsNumeric(itemData(j, 3)), CDbl(itemData(j, 3)), 0)

        Dim rowIdx As Long
        rowIdx = TPL_ITEM_START_ROW + j - 1

        wsNew.Cells(rowIdx, TPL_COL_ITEM).Value   = itemName
        wsNew.Cells(rowIdx, TPL_COL_QTY).Value    = qty
        wsNew.Cells(rowIdx, TPL_COL_UPRICE).Value = uprice

        ' テンプレートに数式がない場合のみ金額を直接書き込む
        If Not TPL_AMOUNT_HAS_FORMULA Then
            wsNew.Cells(rowIdx, TPL_COL_AMOUNT).Value = qty * uprice
        End If

        subtotal = subtotal + qty * uprice
NextItem:
    Next j

    ' --- 集計（テンプレートに数式がない場合のみ書き込む）---
    If Not TPL_AMOUNT_HAS_FORMULA Then
        Dim taxRate As Double
        taxRate = wsList.Cells(dataRow, COL_TAX_RATE).Value
        If taxRate = 0 Then taxRate = 10

        Dim taxAmt   As Double
        Dim totalAmt As Double
        taxAmt   = Int(subtotal * (taxRate / 100))  ' 切り捨て
        totalAmt = subtotal + taxAmt

        wsNew.Range(TPL_SUBTOTAL).Value      = subtotal
        wsNew.Range(TPL_TAX_AMT).Value       = taxAmt
        wsNew.Range(TPL_TOTAL).Value         = totalAmt
        wsNew.Range(TPL_TOTAL_DISPLAY).Value = totalAmt
    End If
End Sub


'==============================================================
' 出力済み請求書ファイルを PDF に一括変換
'==============================================================
Public Sub PDF一括出力()
    Dim wsSetting As Worksheet
    If Not SheetExists(SHEET_SETTING) Then
        MsgBox "「" & SHEET_SETTING & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If
    Set wsSetting = ThisWorkbook.Worksheets(SHEET_SETTING)

    Dim outputFolder As String
    outputFolder = ResolvePath(CStr(wsSetting.Range(SET_OUTPUT_FOLDER).Value))
    If outputFolder = "" Then outputFolder = ThisWorkbook.Path & "\請求書出力"

    If Dir(outputFolder, vbDirectory) = "" Then
        MsgBox "出力フォルダーが見つかりません:" & vbCrLf & outputFolder, vbExclamation
        Exit Sub
    End If

    Dim pdfFolder As String
    pdfFolder = outputFolder & "\PDF"
    EnsureFolder pdfFolder

    Application.ScreenUpdating = False

    Dim fileName As String
    Dim count    As Long
    count = 0
    fileName = Dir(outputFolder & "\*.xlsx")

    Do While fileName <> ""
        Dim wbPdf As Workbook
        Set wbPdf = Workbooks.Open(Filename:=outputFolder & "\" & fileName, _
                                   UpdateLinks:=False, ReadOnly:=True)

        Dim pdfPath As String
        pdfPath = pdfFolder & "\" & Left(fileName, Len(fileName) - 5) & ".pdf"

        wbPdf.Sheets(1).ExportAsFixedFormat _
            Type:=xlTypePDF, _
            Filename:=pdfPath, _
            Quality:=xlQualityStandard, _
            IncludeDocProperties:=True, _
            IgnorePrintAreas:=False, _
            OpenAfterPublish:=False

        wbPdf.Close SaveChanges:=False
        count = count + 1
        fileName = Dir()
    Loop

    Application.ScreenUpdating = True

    If count > 0 Then
        MsgBox count & " 件のPDFを出力しました。" & vbCrLf & pdfFolder, _
               vbInformation, "PDF出力完了"
        Shell "explorer.exe """ & pdfFolder & """", vbNormalFocus
    Else
        MsgBox "出力フォルダーに .xlsx ファイルが見つかりませんでした。", vbInformation
    End If
End Sub


'==============================================================
' 出力済み請求書ファイルを全削除
'==============================================================
Public Sub 出力ファイルを全削除()
    Dim wsSetting As Worksheet
    If Not SheetExists(SHEET_SETTING) Then
        MsgBox "「" & SHEET_SETTING & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If
    Set wsSetting = ThisWorkbook.Worksheets(SHEET_SETTING)

    Dim outputFolder As String
    outputFolder = ResolvePath(CStr(wsSetting.Range(SET_OUTPUT_FOLDER).Value))
    If outputFolder = "" Then outputFolder = ThisWorkbook.Path & "\請求書出力"

    If Dir(outputFolder, vbDirectory) = "" Then
        MsgBox "出力フォルダーが見つかりません:" & vbCrLf & outputFolder, vbExclamation
        Exit Sub
    End If

    If MsgBox("出力フォルダー内の請求書ファイル（.xlsx）をすべて削除しますか？" & vbCrLf & _
              outputFolder & vbCrLf & "この操作は元に戻せません。", _
              vbQuestion + vbYesNo, "確認") = vbNo Then Exit Sub

    Dim fileName As String
    Dim count    As Long
    count = 0
    fileName = Dir(outputFolder & "\*.xlsx")

    Do While fileName <> ""
        Kill outputFolder & "\" & fileName
        count = count + 1
        fileName = Dir()
    Loop

    ' リストの出力パス列をクリア（AA列）
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

    MsgBox count & " 件のファイルを削除しました。", vbInformation
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
    EndOfMonth = DateSerial(y, m + 1, 0)
End Function

Private Function ResolvePath(pathValue As String) As String
    pathValue = Trim(pathValue)
    If pathValue = "" Then
        ResolvePath = ""
        Exit Function
    End If
    ' 絶対パス（ドライブレター or UNC）はそのまま使う
    If Mid(pathValue, 2, 1) = ":" Or Left(pathValue, 2) = "\\" Then
        ResolvePath = pathValue
    Else
        ' 相対パスはブックの場所を基準に解決
        ResolvePath = ThisWorkbook.Path & "\" & pathValue
    End If
End Function

Private Sub EnsureFolder(folderPath As String)
    If folderPath <> "" And Dir(folderPath, vbDirectory) = "" Then
        MkDir folderPath
    End If
End Sub

Private Function SanitizeFileName(name As String) As String
    ' Windowsのファイル名に使えない文字を除去
    Dim result As String
    result = name
    Dim invalid As Variant
    invalid = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    Dim ch As Variant
    For Each ch In invalid
        result = Join(Split(result, ch), "")
    Next ch
    ' 長すぎる場合は切り詰める（ファイル名全体を240文字以内に収めるため）
    If Len(result) > 30 Then result = Left(result, 30)
    SanitizeFileName = result
End Function
