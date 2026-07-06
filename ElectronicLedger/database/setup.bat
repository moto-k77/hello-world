@echo off
chcp 65001 > nul
echo ============================================================
echo  電子帳簿保存管理システム - データベースセットアップ
echo ============================================================
echo.

:: SQL Server のインスタンス名（必要に応じて変更してください）
:: 例: .\SQLEXPRESS  .\MSSQLSERVER  localhost\SQLEXPRESS
set SERVER=.\SQLEXPRESS

:: sqlcmd のパスを確認
where sqlcmd > nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [エラー] sqlcmd が見つかりません。
    echo SQL Server Express がインストールされているか確認してください。
    echo インストール先: https://www.microsoft.com/ja-jp/sql-server/sql-server-downloads
    pause
    exit /b 1
)

echo 接続先サーバー: %SERVER%
echo.

:: ステップ1: データベース・テーブル作成
echo [1/2] データベースとテーブルを作成中...
sqlcmd -S %SERVER% -E -i "%~dp001_create_database.sql" -f 65001
if %ERRORLEVEL% neq 0 (
    echo.
    echo [エラー] データベース作成に失敗しました。
    echo - SQL Server Express が起動しているか確認してください
    echo - サービス名: SQL Server (SQLEXPRESS^)
    echo - 接続先サーバー名 (%SERVER%^) が正しいか確認してください
    pause
    exit /b 1
)

echo.

:: ステップ2: 初期データ投入
echo [2/2] 初期データを投入中...
sqlcmd -S %SERVER% -E -i "%~dp002_seed_data.sql" -f 65001
if %ERRORLEVEL% neq 0 (
    echo.
    echo [エラー] 初期データの投入に失敗しました。
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  セットアップが完了しました！
echo  アプリケーションを起動してください: dotnet run
echo ============================================================
echo.
pause
