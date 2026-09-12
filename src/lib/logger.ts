import pino from 'pino';
import { config } from '../config.js';
import { createRedactor } from './redact.js';

const redact = createRedactor([config.BOT_TOKEN, config.LLM_API_KEY]);

export const logger = pino(
  { level: config.LOG_LEVEL },
  { write: (line) => process.stdout.write(redact(line)) },
);
