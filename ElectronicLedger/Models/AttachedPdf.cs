using System.ComponentModel.DataAnnotations;

namespace ElectronicLedger.Models;

public class AttachedPdf
{
    public int Id { get; set; }

    [Required, MaxLength(500)]
    public string FileName { get; set; } = "";

    [Required, MaxLength(1000)]
    public string StoredPath { get; set; } = "";

    public long FileSize { get; set; }

    public DateTime SavedAt { get; set; } = DateTime.Now;

    public int LedgerFileId { get; set; }
    public LedgerFile LedgerFile { get; set; } = null!;
}
