-- ============================================================
-- 電子帳簿保存管理システム - データベース作成スクリプト
-- 実行方法: setup.bat または setup.ps1 を使用してください
-- ============================================================

USE master;
GO

-- データベース作成（存在しない場合のみ）
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'ElectronicLedger')
BEGIN
    CREATE DATABASE ElectronicLedger;
    PRINT 'データベース ElectronicLedger を作成しました。';
END
ELSE
BEGIN
    PRINT 'データベース ElectronicLedger は既に存在します。';
END
GO

USE ElectronicLedger;
GO

-- ============================================================
-- テーブル: LedgerFiles（電子帳簿ファイル一覧）
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'LedgerFiles' AND xtype = 'U')
BEGIN
    CREATE TABLE LedgerFiles (
        Id           INT           IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Category     NVARCHAR(10)  NOT NULL,                        -- 販売 | 仕入れ
        Type         NVARCHAR(20)  NOT NULL,                        -- 見積書 | 請求書 etc.
        Name         NVARCHAR(500) NOT NULL,                        -- ファイル名
        Counterparty NVARCHAR(200) NOT NULL DEFAULT '',             -- 取引先
        Date         DATE          NOT NULL,                        -- 書類日付
        Amount       DECIMAL(15,0) NULL,                            -- 金額（税込）
        Status       NVARCHAR(10)  NOT NULL DEFAULT '未保存',       -- 未保存 | 保存済み
        SavedAt      DATETIME2     NULL,                            -- 最初の保存日時
        Source       NVARCHAR(200) NULL,                            -- フォルダースキャン元
        Deleted      BIT           NOT NULL DEFAULT 0,              -- 論理削除フラグ
        CreatedAt    DATETIME2     NOT NULL DEFAULT GETDATE()
    );
    PRINT 'テーブル LedgerFiles を作成しました。';
END
ELSE
    PRINT 'テーブル LedgerFiles は既に存在します。';
GO

-- ============================================================
-- テーブル: AttachedPdfs（添付PDFファイル）
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'AttachedPdfs' AND xtype = 'U')
BEGIN
    CREATE TABLE AttachedPdfs (
        Id           INT            IDENTITY(1,1) NOT NULL PRIMARY KEY,
        FileName     NVARCHAR(500)  NOT NULL,    -- 元のファイル名
        StoredPath   NVARCHAR(1000) NOT NULL,    -- サーバー上の保存パス
        FileSize     BIGINT         NOT NULL DEFAULT 0,
        SavedAt      DATETIME2      NOT NULL DEFAULT GETDATE(),
        LedgerFileId INT            NOT NULL,
        CONSTRAINT FK_AttachedPdfs_LedgerFiles
            FOREIGN KEY (LedgerFileId)
            REFERENCES LedgerFiles(Id)
            ON DELETE CASCADE
    );
    PRINT 'テーブル AttachedPdfs を作成しました。';
END
ELSE
    PRINT 'テーブル AttachedPdfs は既に存在します。';
GO

-- ============================================================
-- テーブル: FolderSettings（フォルダー設定）
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'FolderSettings' AND xtype = 'U')
BEGIN
    CREATE TABLE FolderSettings (
        Id       INT            IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Label    NVARCHAR(200)  NOT NULL,    -- フォルダー名（表示用）
        Path     NVARCHAR(1000) NOT NULL,    -- フォルダーパス
        Category NVARCHAR(10)   NULL,        -- 既定の区分
        Type     NVARCHAR(20)   NULL,        -- 既定の種別
        LastScan DATETIME2      NULL         -- 最終スキャン日時
    );
    PRINT 'テーブル FolderSettings を作成しました。';
END
ELSE
    PRINT 'テーブル FolderSettings は既に存在します。';
GO

-- ============================================================
-- インデックス
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_LedgerFiles_Category_Deleted')
BEGIN
    CREATE INDEX IX_LedgerFiles_Category_Deleted ON LedgerFiles (Category, Deleted);
    PRINT 'インデックス IX_LedgerFiles_Category_Deleted を作成しました。';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_LedgerFiles_Status')
BEGIN
    CREATE INDEX IX_LedgerFiles_Status ON LedgerFiles (Status);
    PRINT 'インデックス IX_LedgerFiles_Status を作成しました。';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AttachedPdfs_LedgerFileId')
BEGIN
    CREATE INDEX IX_AttachedPdfs_LedgerFileId ON AttachedPdfs (LedgerFileId);
    PRINT 'インデックス IX_AttachedPdfs_LedgerFileId を作成しました。';
END
GO

PRINT '';
PRINT '========================================';
PRINT 'データベース作成が完了しました。';
PRINT '========================================';
