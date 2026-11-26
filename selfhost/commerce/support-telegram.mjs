import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function createSupportNotifier(config, fetcher = fetch) {
  let verified;
  async function settings() {
    if (config.supportTelegram) return config.supportTelegram;
    if (!config.siteOrderQueueDirectory) return null;
    const file = resolve(config.siteOrderQueueDirectory, '../../runtime-config.json');
    const bot = JSON.parse(await readFile(file, 'utf8'));
    return { token: bot.telegramBotToken, chatId: bot.notifyChatId };
  }

  async function telegram(token, method, payload) {
    const response = await fetcher('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error('Telegram notification unavailable');
    return data.result;
  }

  return async (ticket) => {
    const options = await settings();
    const token = options?.token;
    const chatId = String(options?.chatId || '');
    const username = (options?.username || 'YorkeYue').toLowerCase();
    if (!token || !/^[1-9]\d*$/.test(chatId)) throw new Error('Private Telegram destination required');
    const key = chatId + ':' + username;
    if (verified?.key !== key || verified.token !== token || verified.until < Date.now()) {
      const chat = await telegram(token, 'getChat', { chat_id: chatId });
      if (chat?.type !== 'private' || chat.username?.toLowerCase() !== username) {
        throw new Error('Telegram destination could not be verified');
      }
      verified = { key, token, until: Date.now() + 60 * 60 * 1000 };
    }
    const inbox = new URL('/__host/support', config.origin);
    inbox.searchParams.set('ticket', ticket.id);
    await telegram(token, 'sendMessage', {
      chat_id: chatId,
      text: ['Yorke AI · ' + (ticket.kind === 'message' ? '新客服消息' : '新工单'), '编号 ' + ticket.id.slice(0, 8).toUpperCase(), inbox.href].join('\n'),
      link_preview_options: { is_disabled: true },
    });
  };
}
