import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import {
  createServer as createNetServer,
  connect,
  type AddressInfo,
} from 'node:net';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import {
  assertPublicHost,
  installProxy,
  isPrivateAddress,
  isSsrfError,
  nativeSignalFetch,
  proxyLabel,
  proxyUrlSchema,
  SsrfError,
  withUntrustedFetch,
  type Lookup,
} from './proxy.js';

test('isPrivateAddress: локальные и служебные адреса', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a00:1',
    '64:ff9b::7f00:1',
    'не-адрес',
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('isPrivateAddress: публичные адреса', () => {
  for (const ip of [
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('assertPublicHost: хост с любым приватным адресом отбивается', async () => {
  const lookup: Lookup = async (h) =>
    h === 'mixed.test' ? ['8.8.8.8', '10.0.0.1'] : ['8.8.8.8'];
  await assertPublicHost('ok.test', lookup);
  await assert.rejects(assertPublicHost('mixed.test', lookup), SsrfError);
  await assert.rejects(assertPublicHost('[::1]', lookup), SsrfError);
  await assert.rejects(
    assertPublicHost('empty.test', async () => []),
    SsrfError,
  );
});

test('proxyUrlSchema: только http/https, пусто — без прокси', () => {
  assert.equal(proxyUrlSchema.parse(undefined), undefined);
  assert.equal(proxyUrlSchema.parse('  '), undefined);
  assert.equal(
    proxyUrlSchema.parse('http://127.0.0.1:10809'),
    'http://127.0.0.1:10809',
  );
  assert.equal(
    proxyUrlSchema.parse('https://u:p@proxy.example:443'),
    'https://u:p@proxy.example:443',
  );
  assert.equal(
    proxyUrlSchema.safeParse('socks5://127.0.0.1:1080').success,
    false,
  );
  assert.equal(proxyUrlSchema.safeParse('мусор').success, false);
});

test('proxyLabel: без логина и пароля', () => {
  assert.equal(
    proxyLabel('https://user:secret@proxy.example:8443'),
    'https://proxy.example:8443',
  );
});

// --- живые запросы через мини-прокси на 127.0.0.1 ---------------------------

let target: Server;
let proxy: ReturnType<typeof createNetServer>;
let targetPort = 0;
let proxyPort = 0;
let tunnels: string[] = [];
const saved = getGlobalDispatcher();

before(async () => {
  target = createServer((req, res) => {
    if (req.url === '/hang') return; // для теста отмены
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () =>
      res.end(`${req.method} ${req.url} ${Buffer.concat(chunks).length}`),
    );
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  targetPort = (target.address() as AddressInfo).port;

  // CONNECT-прокси: запоминает, куда просили, и всегда ведёт на target.
  proxy = createNetServer((client) => {
    client.once('data', (head) => {
      const line = head.toString().split('\r\n')[0];
      const m = line.match(/^CONNECT (\S+) /);
      if (!m) return client.end('HTTP/1.1 405 Only CONNECT\r\n\r\n');
      tunnels.push(m[1]);
      const upstream = connect(targetPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.pipe(client).pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  proxyPort = (proxy.address() as AddressInfo).port;
});

after(async () => {
  setGlobalDispatcher(saved);
  target.closeAllConnections();
  await new Promise((r) => target.close(r));
  await new Promise((r) => proxy.close(r));
});

const publicLookup: Lookup = async (h) =>
  h === 'evil.test' ? ['10.0.0.5'] : ['93.184.216.34'];

function install(noProxy = '') {
  tunnels = [];
  return installProxy({
    url: `http://127.0.0.1:${proxyPort}`,
    noProxy,
    lookup: publicLookup,
  });
}

test('глобальный fetch идёт через прокси', async () => {
  install();
  const res = await fetch(`http://site.test:${targetPort}/a`);
  assert.equal(await res.text(), 'GET /a 0');
  assert.deepEqual(tunnels, [`site.test:${targetPort}`]);
});

test('NO_PROXY ведёт напрямую', async () => {
  install('127.0.0.1');
  const res = await fetch(`http://127.0.0.1:${targetPort}/direct`);
  assert.equal(await res.text(), 'GET /direct 0');
  assert.deepEqual(tunnels, []);
});

test('withUntrustedFetch: приватные адреса отбиты, публичные идут через прокси', async () => {
  install();
  await assert.rejects(
    withUntrustedFetch(() => fetch(`http://127.0.0.1:${targetPort}/x`)),
    (err: Error) => err.cause instanceof SsrfError,
  );
  await assert.rejects(
    withUntrustedFetch(() => fetch(`http://evil.test:${targetPort}/x`)),
    (err: Error) => err.cause instanceof SsrfError,
  );
  // rdrr заворачивает ещё раз: ищем по всей цепочке cause.
  const wrapped = new TypeError('Could not fetch', {
    cause: new TypeError('fetch failed', { cause: new SsrfError('x') }),
  });
  assert.equal(isSsrfError(wrapped), true);
  assert.equal(isSsrfError(new TypeError('fetch failed')), false);
  const res = await withUntrustedFetch(() =>
    fetch(`http://good.test:${targetPort}/ok`),
  );
  assert.equal(await res.text(), 'GET /ok 0');
  assert.deepEqual(tunnels, [`good.test:${targetPort}`]);

  // Вне зоны недоверенных — без проверки (LLM на localhost и т.п.).
  install('127.0.0.1');
  const local = await fetch(`http://127.0.0.1:${targetPort}/llm`);
  assert.equal(await local.text(), 'GET /llm 0');
});

test('fetch для grammY: потоковое тело и сигнал-полифилл', async () => {
  const gramFetch = install();
  const body = Readable.from(
    (async function* () {
      yield Buffer.from('--b\r\n');
      yield Buffer.from('x'.repeat(1000));
    })(),
  );
  const res = await gramFetch(`http://api.test:${targetPort}/upload`, {
    method: 'POST',
    headers: { connection: 'keep-alive' },
    body: body as unknown as RequestInit['body'],
    duplex: 'half',
  } as RequestInit);
  assert.equal(await res.text(), 'POST /upload 1005');

  const require = createRequire(import.meta.url);
  const { AbortController: Polyfill } = require('abort-controller');
  const ctrl = new Polyfill();
  const pending = gramFetch(`http://api.test:${targetPort}/hang`, {
    signal: ctrl.signal,
  });
  setTimeout(() => ctrl.abort(), 50);
  await assert.rejects(pending, { name: 'AbortError' });
});

test('nativeSignalFetch: уже отменённый сигнал-полифилл', async () => {
  const require = createRequire(import.meta.url);
  const { AbortController: Polyfill } = require('abort-controller');
  const ctrl = new Polyfill();
  ctrl.abort();
  await assert.rejects(
    nativeSignalFetch(`http://127.0.0.1:${targetPort}/a`, {
      signal: ctrl.signal,
    }),
    { name: 'AbortError' },
  );
});
