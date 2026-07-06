using System.ComponentModel.DataAnnotations;

namespace ElectronicLedger.Models;

public class LedgerFile
{
    public int Id { get; set; }

    [Required, MaxLength(10)]
    public string Category { get; set; } = "";      // 販売 | 仕入れ

    [Required, MaxLength(20)]
    public string Type { get; set; } = "";           // 見積書 | 注文書 etc.

    [Required, MaxLength(500)]
    public string Name { get; set; } = "";           // ファイル名

    [MaxLength(200)]
    public string Counterparty { get; set; } = "";   // 取引先

    public DateOnly Date { get; set; }

    public decimal? Amount { get; set; }             // 金額（税込）

    [MaxLength(10)]
    public string Status { get; set; } = "未保存";  // 未保存 | 保存済み

    public DateTime? SavedAt { get; set; }           // 最初の保存日時

    [MaxLength(200)]
    public string? Source { get; set; }              // フォルダースキャン元

    public bool Deleted { get; set; }                // 論理削除フラグ

    public DateTime CreatedAt { get; set; } = DateTime.Now;

    public ICollection<AttachedPdf> Pdfs { get; set; } = new List<AttachedPdf>();
}
