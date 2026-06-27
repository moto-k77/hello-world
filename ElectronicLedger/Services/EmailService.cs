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

    public async Task SendSavedNotificationAsync(
        string fileName, string category, string type, string counterparty)
    {
        var host = _config["Email:SmtpHost"];

        // SMTP設定がない場合はログ出力のみ（開発環境）
        if (string.IsNullOrEmpty(host))
        {
            _logger.LogInformation(
                "[メール通知（開発）] 電子帳簿保存完了 - {Category} {Type} {File} {Counterparty}",
                category, type, fileName, counterparty);
            return;
        }

        try
        {
            var port     = int.Parse(_config["Email:SmtpPort"] ?? "587");
            var user     = _config["Email:UserName"] ?? "";
            var password = _config["Email:Password"] ?? "";
            var from     = _config["Email:From"] ?? "system@example.co.jp";
            var to       = _config["Email:To"] ?? "keiri@example.co.jp";

            var message = new MimeMessage();
            message.From.Add(MailboxAddress.Parse(from));
            message.To.Add(MailboxAddress.Parse(to));
            message.Subject = $"【電子帳簿保存完了】{category} {type} - {counterparty}";
            message.Body = new TextPart("plain")
            {
                Text = $"""
                    電子帳簿保存が完了しました。

                    ファイル名 : {fileName}
                    区分       : {category}
                    種別       : {type}
                    取引先     : {counterparty}
                    保存日時   : {DateTime.Now:yyyy/MM/dd HH:mm}
                    """
            };

            using var client = new SmtpClient();
            await client.ConnectAsync(host, port, SecureSocketOptions.StartTls);
            if (!string.IsNullOrEmpty(user))
                await client.AuthenticateAsync(user, password);
            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            _logger.LogInformation("メール送信完了: {To}", to);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "メール送信失敗");
            throw;
        }
    }
}
