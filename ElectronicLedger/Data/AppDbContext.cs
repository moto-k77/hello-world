using ElectronicLedger.Models;
using Microsoft.EntityFrameworkCore;

namespace ElectronicLedger.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<LedgerFile> LedgerFiles => Set<LedgerFile>();
    public DbSet<AttachedPdf> AttachedPdfs => Set<AttachedPdf>();
    public DbSet<FolderSetting> FolderSettings => Set<FolderSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<LedgerFile>(e =>
        {
            e.Property(x => x.Amount).HasColumnType("decimal(15,0)");
            e.HasIndex(x => new { x.Category, x.Deleted });
            e.HasIndex(x => x.Status);
        });

        modelBuilder.Entity<AttachedPdf>(e =>
        {
            e.HasOne(x => x.LedgerFile)
             .WithMany(x => x.Pdfs)
             .HasForeignKey(x => x.LedgerFileId)
             .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
