using ElectronicLedger.Models;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace ElectronicLedger.Services;

public class EmailService
{
    private readonly IConfiguration _config;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IConfiguration config, ILogger<EmailService> logger)
    {
        _config = config;
        _logger = logger;
    }

    public async Task SendSavedNotificationAsync(LedgerFile file)
    {
        var template = FindTemplate(file.Category, file.Type);
        var to       = template?.To ?? _config["Email:DefaultTo"] ?? "keiri@example.co.jp";
        var subject  = ApplyPlaceholders(
            template?.Subject ?? _config["Email:DefaultSubject"] ?? "【電子帳簿保存完了】{区分} {種別} - {取引先}",
            file);
        var body     = ApplyPlaceholders(
            template?.Body ?? _config["Email:DefaultBody"] ?? "電子帳簿保存が完了しました。\n\nファイル名: {ファイル名}",
            file);

        var host = _config["Email:SmtpHost"];
        if (string.IsNullOrEmpty(host))
        {
            _logger.LogInformation(
                "[メール通知（開発）] To:{To} / Subject:{Subject}", to, subject);
            return;
        }

        try
        {
            var port     = int.Parse(_config["Email:SmtpPort"] ?? "587");
            var user     = _config["Email:UserName"] ?? "";
            var password = _config["Email:Password"] ?? "";
            var from     = _config["Email:From"] ?? "system@example.co.jp";

            var message = new MimeMessage();
            message.From.Add(MailboxAddress.Parse(from));
            // 複数宛先（カンマ区切り対応）
            foreach (var addr in to.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                message.To.Add(MailboxAddress.Parse(addr));
            message.Subject = subject;
            message.Body    = new TextPart("plain") { Text = body };

            using var client = new SmtpClient();
            await client.ConnectAsync(host, port, SecureSocketOptions.StartTls);
            if (!string.IsNullOrEmpty(user))
                await client.AuthenticateAsync(user, password);
            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            _logger.LogInformation("メール送信完了: {To} / {Subject}", to, subject);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "メール送信失敗");
            throw;
        }
    }

    // 区分・種別に対応するテンプレートを検索（完全一致 → 区分のみ → デフォルト）
    private EmailTemplate? FindTemplate(string category, string type)
    {
        var templates = _config
            .GetSection("Email:Templates")
            .Get<List<EmailTemplate>>() ?? [];

        return templates.FirstOrDefault(t => t.Category == category && t.Type == type)
            ?? templates.FirstOrDefault(t => t.Category == category && string.IsNullOrEmpty(t.Type));
    }

    // プレースホルダーを実データで置換
    private static string ApplyPlaceholders(string template, LedgerFile file)
    {
        var amount = file.Amount != null ? "¥" + file.Amount.Value.ToString("N0") : "—";
        return template
            .Replace("{ファイル名}", file.Name)
            .Replace("{区分}",     file.Category)
            .Replace("{種別}",     file.Type)
            .Replace("{取引先}",   file.Counterparty)
            .Replace("{日付}",     file.Date.ToString("yyyy/MM/dd"))
            .Replace("{金額}",     amount)
            .Replace("{保存日時}", DateTime.Now.ToString("yyyy/MM/dd HH:mm"))
            .Replace("\\n",        "\n");  // JSON内の \n を改行に変換
    }
}

public class EmailTemplate
{
    public string? Category { get; set; }
    public string? Type     { get; set; }
    public string? To       { get; set; }
    public string? Subject  { get; set; }
    public string? Body     { get; set; }
}
