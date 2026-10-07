/**
 * Проверка поиска /search на живом YouTube — без бота, без LLM и без .env:
 *
 *   npm run search:smoke -- "lofi hip hop radio"
 *   npm run search:smoke -- "lofi hip hop radio" --save response.json
 *
 * Печатает, что попало бы в список, и что отсеяно и почему. `--save` кладёт сырой
 * ответ InnerTube в файл — из него обновляют фикстуру в youtubeSearch.test.ts, если
 * YouTube поменял формат выдачи.
 */
import { writeFileSync } from 'node:fs';
import {
  fetchSearchJson,
  parseSearchResults,
  youtubeWatchUrl,
} from '../core/youtubeSearch.js';

const args = process.argv.slice(2);
const saveAt = args.indexOf('--save');
const savePath = saveAt >= 0 ? args[saveAt + 1] : undefined;
const queryArgs =
  saveAt >= 0 ? [...args.slice(0, saveAt), ...args.slice(saveAt + 2)] : args;
const query = queryArgs.join(' ').trim();

if (!query) {
  console.error(
    'Использование: npm run search:smoke -- "<запрос>" [--save file.json]',
  );
  process.exit(1);
}

const json = await fetchSearchJson(query).catch((err: unknown) => {
  console.error(`❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
if (savePath) {
  writeFileSync(savePath, JSON.stringify(json, null, 2));
  console.log(`сырой ответ сохранён в ${savePath}`);
}

// Без лимита: видно всю выдачу, а не только первые 5.
const { hits, skipped } = parseSearchResults(json, Infinity);
console.log(`\nпрошли фильтр (${hits.length}, в бот уйдут первые 5):`);
for (const h of hits) {
  console.log(`  ${h.duration.padStart(8)}  ${h.title} — ${h.channel ?? '?'}`);
  console.log(`            ${youtubeWatchUrl(h.id)}`);
}
console.log(`\nотсеяны (${skipped.length}):`);
for (const s of skipped) {
  console.log(`  [${s.reason}] ${s.title}  ${youtubeWatchUrl(s.id)}`);
}
if (hits.length + skipped.length === 0) {
  console.log(
    '\n⚠️ в ответе нет ни одного videoRenderer — похоже, формат выдачи поменялся',
  );
  process.exitCode = 1;
}
