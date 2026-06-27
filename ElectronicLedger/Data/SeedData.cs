using ElectronicLedger.Models;

namespace ElectronicLedger.Data;

public static class SeedData
{
    public static async Task InitializeAsync(AppDbContext db)
    {
        if (db.LedgerFiles.Any()) return;

        var files = new[]
        {
            new LedgerFile { Category="販売",  Type="見積書", Name="EST-S-2024-0601.xlsx", Counterparty="株式会社アルファ",   Date=new DateOnly(2024,6,1),  Amount=385000, Status="保存済み", SavedAt=new DateTime(2024,6,2) },
            new LedgerFile { Category="販売",  Type="注文書", Name="ORD-2024-0605.pdf",    Counterparty="ベータ商事株式会社", Date=new DateOnly(2024,6,5),  Amount=220000, Status="未保存" },
            new LedgerFile { Category="販売",  Type="納品書", Name="DN-S-2024-0610.xlsx",  Counterparty="株式会社ガンマ",     Date=new DateOnly(2024,6,10), Amount=220000, Status="保存済み", SavedAt=new DateTime(2024,6,11) },
            new LedgerFile { Category="販売",  Type="請求書", Name="INV-S-2024-0615.pdf",  Counterparty="デルタ工業株式会社", Date=new DateOnly(2024,6,15), Amount=242000, Status="未保存" },
            new LedgerFile { Category="販売",  Type="その他", Name="CONTRACT-2024-0618.docx", Counterparty="イプシロン株式会社", Date=new DateOnly(2024,6,18), Status="未保存" },
            new LedgerFile { Category="仕入れ", Type="見積書", Name="EST-P-2024-0602.pdf",  Counterparty="ゼータ物産株式会社", Date=new DateOnly(2024,6,2),  Amount=148500, Status="保存済み", SavedAt=new DateTime(2024,6,3) },
            new LedgerFile { Category="仕入れ", Type="発注書", Name="PO-2024-0607.xlsx",    Counterparty="エータ商事",         Date=new DateOnly(2024,6,7),  Amount=162800, Status="未保存" },
            new LedgerFile { Category="仕入れ", Type="納品書", Name="DN-P-2024-0612.csv",   Counterparty="シータ工業株式会社", Date=new DateOnly(2024,6,12), Amount=162800, Status="保存済み", SavedAt=new DateTime(2024,6,13) },
            new LedgerFile { Category="仕入れ", Type="請求書", Name="INV-P-2024-0620.pdf",  Counterparty="イオタ株式会社",     Date=new DateOnly(2024,6,20), Amount=178200, Status="未保存" },
            new LedgerFile { Category="仕入れ", Type="その他", Name="AGREEMENT-2024-0622.docx", Counterparty="カッパ商店",    Date=new DateOnly(2024,6,22), Status="未保存" },
        };
        db.LedgerFiles.AddRange(files);

        // サンプルPDF（保存済みのファイルに添付）
        await db.SaveChangesAsync();

        var saved = db.LedgerFiles.Where(f => f.Status == "保存済み").ToList();
        foreach (var f in saved)
        {
            db.AttachedPdfs.Add(new AttachedPdf
            {
                LedgerFileId = f.Id,
                FileName     = Path.ChangeExtension(f.Name, ".pdf"),
                StoredPath   = Path.Combine("PDFs", Path.ChangeExtension(f.Name, ".pdf")),
                FileSize     = 0,
                SavedAt      = f.SavedAt ?? DateTime.Now,
            });
        }

        if (!db.FolderSettings.Any())
        {
            db.FolderSettings.AddRange(
                new FolderSetting { Label="販売 請求書フォルダー",   Path=@"C:\共有サーバー\販売\請求書",   Category="販売",  Type="請求書" },
                new FolderSetting { Label="仕入れ 発注書フォルダー", Path=@"C:\共有サーバー\仕入れ\発注書", Category="仕入れ", Type="発注書" }
            );
        }

        await db.SaveChangesAsync();
    }
}
