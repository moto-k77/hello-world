using System.ComponentModel.DataAnnotations;

namespace ElectronicLedger.Models;

public class FolderSetting
{
    public int Id { get; set; }

    [Required, MaxLength(200)]
    public string Label { get; set; } = "";

    [Required, MaxLength(1000)]
    public string Path { get; set; } = "";

    [MaxLength(10)]
    public string? Category { get; set; }

    [MaxLength(20)]
    public string? Type { get; set; }

    public DateTime? LastScan { get; set; }
}
