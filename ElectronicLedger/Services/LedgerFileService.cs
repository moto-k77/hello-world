using ElectronicLedger.Data;
using ElectronicLedger.Models;
using Microsoft.EntityFrameworkCore;

namespace ElectronicLedger.Services;

public class LedgerFileService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<LedgerFileService> _logger;

    public LedgerFileService(AppDbContext db, IConfiguration config, ILogger<LedgerFileService> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    public async Task<List<LedgerFile>> GetListAsync(
        string category,
        string? keyword = null,
        string? type = null,
        string? status = null,
        bool showDeleted = false)
    {
        var query = _db.LedgerFiles
            .Include(f => f.Pdfs)
            .Where(f => f.Category == category);

        if (!showDeleted)
            query = query.Where(f => !f.Deleted);

        if (!string.IsNullOrWhiteSpace(keyword))
            query = query.Where(f =>
                f.Name.Contains(keyword) || f.Counterparty.Contains(keyword));

        if (!string.IsNullOrWhiteSpace(type))
            query = query.Where(f => f.Type == type);

        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(f => f.Status == status);

        return await query.OrderByDescending(f => f.Date).ToListAsync();
    }

    public async Task<LedgerFile?> GetByIdAsync(int id)
        => await _db.LedgerFiles.Include(f => f.Pdfs).FirstOrDefaultAsync(f => f.Id == id);

    public async Task UpdateAsync(LedgerFile file)
    {
        _db.LedgerFiles.Update(file);
        await _db.SaveChangesAsync();
    }

    public async Task<AttachedPdf> AddPdfAsync(int fileId, string fileName, Stream stream)
    {
        var file = await _db.LedgerFiles.FindAsync(fileId)
            ?? throw new InvalidOperationException("ファイルが見つかりません");

        var storagePath = _config["PdfStorage:Path"] ?? "PDFs";
        Directory.CreateDirectory(storagePath);
        var storedName = $"{Guid.NewGuid():N}_{fileName}";
        var fullPath = Path.Combine(storagePath, storedName);

        await using (var fs = File.Create(fullPath))
            await stream.CopyToAsync(fs);

        var pdf = new AttachedPdf
        {
            LedgerFileId = fileId,
            FileName     = fileName,
            StoredPath   = fullPath,
            FileSize     = new FileInfo(fullPath).Length,
            SavedAt      = DateTime.Now,
        };
        _db.AttachedPdfs.Add(pdf);

        file.Status  = "保存済み";
        file.SavedAt ??= DateTime.Now;

        await _db.SaveChangesAsync();
        return pdf;
    }

    public async Task RemovePdfAsync(int pdfId)
    {
        var pdf = await _db.AttachedPdfs
            .Include(p => p.LedgerFile)
            .FirstOrDefaultAsync(p => p.Id == pdfId);
        if (pdf == null) return;

        if (File.Exists(pdf.StoredPath))
            File.Delete(pdf.StoredPath);

        _db.AttachedPdfs.Remove(pdf);
        await _db.SaveChangesAsync();

        // PDF が0件になったら未保存に戻す
        var remaining = await _db.AttachedPdfs.CountAsync(p => p.LedgerFileId == pdf.LedgerFileId);
        if (remaining == 0)
        {
            var lf = await _db.LedgerFiles.FindAsync(pdf.LedgerFileId);
            if (lf != null)
            {
                lf.Status  = "未保存";
                lf.SavedAt = null;
                await _db.SaveChangesAsync();
            }
        }
    }

    public async Task SoftDeleteAsync(int id)
    {
        var file = await _db.LedgerFiles.FindAsync(id);
        if (file == null) return;
        file.Deleted = true;
        await _db.SaveChangesAsync();
    }

    public async Task RestoreAsync(int id)
    {
        var file = await _db.LedgerFiles.FindAsync(id);
        if (file == null) return;
        file.Deleted = false;
        await _db.SaveChangesAsync();
    }

    public async Task<(int Total, int Saved, int Unsaved, int Deleted)> GetCountsAsync(string category)
    {
        var q = _db.LedgerFiles.Where(f => f.Category == category);
        return (
            Total:   await q.CountAsync(f => !f.Deleted),
            Saved:   await q.CountAsync(f => !f.Deleted && f.Status == "保存済み"),
            Unsaved: await q.CountAsync(f => !f.Deleted && f.Status != "保存済み"),
            Deleted: await q.CountAsync(f => f.Deleted)
        );
    }

    // ===== フォルダー設定 =====

    public async Task<List<FolderSetting>> GetFoldersAsync()
        => await _db.FolderSettings.OrderBy(f => f.Id).ToListAsync();

    public async Task AddFolderAsync(FolderSetting folder)
    {
        _db.FolderSettings.Add(folder);
        await _db.SaveChangesAsync();
    }

    public async Task DeleteFolderAsync(int id)
    {
        var f = await _db.FolderSettings.FindAsync(id);
        if (f != null) { _db.FolderSettings.Remove(f); await _db.SaveChangesAsync(); }
    }

    public async Task<int> ScanFolderAsync(int folderId)
    {
        var folder = await _db.FolderSettings.FindAsync(folderId);
        if (folder == null || !Directory.Exists(folder.Path)) return 0;

        var extensions = new[] { ".pdf", ".xlsx", ".docx", ".csv" };
        var filePaths = Directory.GetFiles(folder.Path)
            .Where(p => extensions.Contains(Path.GetExtension(p).ToLowerInvariant()))
            .ToList();

        int added = 0;
        foreach (var fp in filePaths)
        {
            var name = Path.GetFileName(fp);
            if (!await _db.LedgerFiles.AnyAsync(f => f.Name == name))
            {
                _db.LedgerFiles.Add(new LedgerFile
                {
                    Category     = folder.Category ?? "販売",
                    Type         = folder.Type ?? "その他",
                    Name         = name,
                    Counterparty = "",
                    Date         = DateOnly.FromDateTime(File.GetLastWriteTime(fp)),
                    Status       = "未保存",
                    Source       = folder.Label,
                });
                added++;
            }
        }

        folder.LastScan = DateTime.Now;
        await _db.SaveChangesAsync();
        _logger.LogInformation("フォルダースキャン完了: {Folder} {Added}件追加", folder.Label, added);
        return added;
    }

    public async Task<int> GetTabCountAsync(string category)
        => await _db.LedgerFiles.CountAsync(f => f.Category == category && !f.Deleted);
}
