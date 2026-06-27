using ElectronicLedger.Components;
using ElectronicLedger.Data;
using ElectronicLedger.Services;
using Microsoft.EntityFrameworkCore;
using MudBlazor.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddMudServices();

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddScoped<LedgerFileService>();
builder.Services.AddScoped<EmailService>();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseAntiforgery();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

// DB初期化
// Database:AutoCreate = true  → アプリが自動でDBとテーブルを作成（開発向け）
// Database:AutoCreate = false → database/setup.bat でDBを手動作成済みの場合
using (var scope = app.Services.CreateScope())
{
    var db  = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
    if (cfg.GetValue<bool>("Database:AutoCreate", true))
        db.Database.EnsureCreated();
    await SeedData.InitializeAsync(db);
}

app.Run();
