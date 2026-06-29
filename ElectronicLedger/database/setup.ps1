# ============================================================
# 電子帳簿保存管理システム - データベースセットアップ (PowerShell)
# 実行方法: PowerShell で右クリック → 「PowerShellで実行」
#           または: .\setup.ps1
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 電子帳簿保存管理システム - データベースセットアップ" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# SQL Server インスタンス名（必要に応じて変更してください）
$server = ".\SQLEXPRESS"

# スクリプトのディレクトリ
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# sqlcmd の確認
$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if (-not $sqlcmd) {
    Write-Host "[エラー] sqlcmd が見つかりません。" -ForegroundColor Red
    Write-Host "SQL Server Express がインストールされているか確認してください。" -ForegroundColor Red
    Read-Host "Enterキーで終了"
    exit 1
}

Write-Host "接続先サーバー: $server" -ForegroundColor Gray
Write-Host ""

function Run-SqlScript {
    param(
        [string]$Step,
        [string]$Description,
        [string]$ScriptFile
    )
    Write-Host "[$Step] $Description..." -ForegroundColor Yellow
    $fullPath = Join-Path $scriptDir $ScriptFile

    try {
        $output = & sqlcmd -S $server -E -i $fullPath -f 65001 2>&1
        foreach ($line in $output) {
            if ($line -match "エラー|Error" -or $LASTEXITCODE -ne 0) {
                Write-Host "  $line" -ForegroundColor Red
            } elseif ($line -match "作成|完了|投入") {
                Write-Host "  $line" -ForegroundColor Green
            } elseif ($line.Trim() -ne "") {
                Write-Host "  $line" -ForegroundColor Gray
            }
        }
        if ($LASTEXITCODE -ne 0) {
            throw "sqlcmd がエラーコード $LASTEXITCODE で終了しました。"
        }
    } catch {
        Write-Host "[エラー] $Description に失敗しました: $_" -ForegroundColor Red
        Write-Host "- SQL Server ($server) が起動しているか確認してください" -ForegroundColor Yellow
        Write-Host "- Windowsサービス「SQL Server (SQLEXPRESS)」を確認してください" -ForegroundColor Yellow
        Read-Host "Enterキーで終了"
        exit 1
    }
    Write-Host ""
}

# ステップ1: データベース・テーブル作成
Run-SqlScript -Step "1/2" -Description "データベースとテーブルを作成中" -ScriptFile "01_create_database.sql"

# ステップ2: 初期データ投入
Run-SqlScript -Step "2/2" -Description "初期データを投入中" -ScriptFile "02_seed_data.sql"

Write-Host "============================================================" -ForegroundColor Green
Write-Host " セットアップが完了しました！" -ForegroundColor Green
Write-Host " アプリケーションを起動してください:" -ForegroundColor Green
Write-Host "   cd ElectronicLedger" -ForegroundColor White
Write-Host "   dotnet run" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Enterキーで終了"
