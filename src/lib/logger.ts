import pino from 'pino';
import { config } from '../config.js';
import { createRedactor } from './redact.js';
import { serializeError } from './errorLog.js';

const redact = createRedactor([config.BOT_TOKEN, config.LLM_API_KEY]);

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    // Ошибки библиотек несут содержимое запроса (GrammyError.payload и т.п.) — вырезаем.
    serializers: { err: serializeError },
  },
  { write: (line) => process.stdout.write(redact(line)) },
);
