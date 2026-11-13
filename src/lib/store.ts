import { config } from '../config.js';
import { openDatabase, type Db } from '../db/database.js';

// Единственная база процесса. Открывается при старте бота (initStore), дальше берётся
// синхронно (getDb). Тесты сюда не ходят: репозитории принимают базу параметром.

let db: Db | undefined;
let opening: Promise<Db> | undefined;

export function initStore(): Promise<Db> {
  opening ??= openDatabase(config.DB_PATH).then((d) => (db = d));
  return opening;
}

export function getDb(): Db {
  if (!db) throw new Error('база не открыта: initStore() не вызывался');
  return db;
}
