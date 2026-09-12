/**
 * Опции «ответить на сообщение». Пересказ и статья приезжают через десятки секунд (у
 * длинного видео — минуты), за это время в чате успевают накопиться другие сообщения —
 * без привязки непонятно, к какой ссылке относится ответ.
 *
 * Принимает id, а не контекст: многочастный пересказ выстраивается цепочкой (часть 2
 * отвечает на часть 1), и там id берётся у предыдущего отправленного сообщения.
 *
 * `allow_sending_without_reply` обязателен: если сообщение, на которое отвечаем, к моменту
 * отправки удалили, Telegram иначе отобьёт отправку целиком, и результат пропадёт с ним.
 */
export function replyTo(messageId: number | undefined): {
  reply_parameters?: { message_id: number; allow_sending_without_reply: true };
} {
  if (!messageId) return {};
  return {
    reply_parameters: {
      message_id: messageId,
      allow_sending_without_reply: true,
    },
  };
}
