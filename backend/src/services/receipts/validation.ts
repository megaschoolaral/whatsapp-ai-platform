/** Returns an error message (shown to the admin) when the receipt check cannot be enabled, else `null`. */
export function validateEnable(input: {
  sellerIin?: string | null;
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
}): string | null {
  if (!input.sellerIin || !/^\d{12}$/.test(input.sellerIin)) {
    return 'Сатушының ИИН-і 12 саннан тұруы керек';
  }
  if (!input.telegramBotToken || !/^\d+:[A-Za-z0-9_-]+$/.test(input.telegramBotToken)) {
    return 'Telegram бот токені қате немесе бос';
  }
  if (!input.telegramChatId?.trim()) {
    return 'Telegram арна ID-і бос';
  }
  return null;
}
