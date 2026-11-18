import { AsyncLocalStorage } from 'node:async_hooks';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import {
  EnvHttpProxyAgent,
  setGlobalDispatcher,
  type Dispatcher,
} from 'undici';

// Без config и logger: модуль нужен и smoke-скрипту, и тестам без .env.

export const proxyUrlSchema = z
  .string()
  .optional()
  .transform((s) => s?.trim() || undefined)
  .refine(
    (s) => {
      if (s === undefined) return true;
      try {
        return ['http:', 'https:'].includes(new URL(s).protocol);
      } catch {
        return false;
      }
    },
    {
      message:
        'поддерживаются только http/https-прокси: http://host:port или https://user:pass@host:port',
    },
  );

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** Адрес, куда по ссылке пользователя ходить нельзя (локальные сети, loopback и т.п.). */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const family = isIP(addr);
  if (family === 4) return blocked.check(addr, 'ipv4');
  if (family !== 6) return true;
  const mapped = mappedIpv4(addr);
  if (mapped) return blocked.check(mapped, 'ipv4');
  return blocked.check(addr, 'ipv6');
}

// ::ffff:a.b.c.d и ::ffff:7f00:1 — это IPv4 под видом IPv6.
function mappedIpv4(addr: string): string | undefined {
  const dotted = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return undefined;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export class SsrfError extends Error {
  constructor(host: string) {
    super(`адрес ${host} ведёт в локальную сеть`);
    this.name = 'SsrfError';
  }
}

/** Отказ по приватному адресу — наш (ssrfGuard) или rdrr — где-то в цепочке cause. */
export function isSsrfError(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 10; depth++) {
    if (e instanceof SsrfError) return true;
    if ((e as Error).name === 'PrivateNetworkError') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export type Lookup = (host: string) => Promise<string[]>;

const systemLookup: Lookup = async (host) =>
  (await dnsLookup(host, { all: true })).map((a) => a.address);

/** Бросает SsrfError, если хост — или любой его адрес по DNS — приватный. */
export async function assertPublicHost(
  hostname: string,
  lookup: Lookup = systemLookup,
): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : await lookup(host);
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) {
    throw new SsrfError(hostname);
  }
}

const untrusted = new AsyncLocalStorage<boolean>();

/** Запросы внутри fn ведут по ссылке пользователя: guard проверит их адреса. */
export function withUntrustedFetch<T>(fn: () => Promise<T>): Promise<T> {
  return untrusted.run(true, fn);
}

type Handler = Dispatcher.DispatchHandler & {
  onError?: (err: Error) => void;
};

/** Interceptor undici: в зоне withUntrustedFetch не пускает на приватные адреса. */
export function ssrfGuard(lookup: Lookup = systemLookup) {
  return (dispatch: Dispatcher['dispatch']): Dispatcher['dispatch'] =>
    (opts, handler) => {
      if (!untrusted.getStore()) return dispatch(opts, handler);
      const origin = new URL(String(opts.origin));
      assertPublicHost(origin.hostname, lookup).then(
        () => dispatch(opts, handler),
        (err: Error) => {
          const h = handler as Handler;
          if (h.onResponseError) h.onResponseError(null as never, err);
          else h.onError?.(err);
        },
      );
      return true;
    };
}

export interface ProxyOptions {
  url: string;
  noProxy?: string;
  lookup?: Lookup;
}

/** Dispatcher: всё через прокси (кроме noProxy) + проверка адресов недоверенных запросов. */
export function createProxyDispatcher(opts: ProxyOptions): Dispatcher {
  return new EnvHttpProxyAgent({
    httpProxy: opts.url,
    httpsProxy: opts.url,
    noProxy: opts.noProxy ?? '',
  }).compose(ssrfGuard(opts.lookup));
}

/** Хост и порт прокси без логина и пароля — для лога. */
export function proxyLabel(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/**
 * Ставит прокси глобальным dispatcher'ом (его берут встроенный fetch и openai SDK),
 * перехватывает fetch rdrr и возвращает fetch для grammY.
 */
export function installProxy(opts: ProxyOptions): typeof fetch {
  setGlobalDispatcher(createProxyDispatcher(opts));
  if (!originalFetch) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = untrustedViaProxy(originalFetch);
  }
  return nativeSignalFetch;
}

let originalFetch: typeof fetch | undefined;

// rdrr передаёт в fetch свой Agent (прямое соединение — мимо прокси), а в YouTube-запросы
// ещё и без allowPrivateNetworks. В зоне withUntrustedFetch его dispatcher выкидываем:
// запрос идёт глобальным, через прокси и ssrfGuard.
function untrustedViaProxy(base: typeof fetch): typeof fetch {
  return (input, init) => {
    if (!untrusted.getStore() || !init || !('dispatcher' in init)) {
      return base(input, init);
    }
    const { dispatcher: _ignored, ...rest } = init as RequestInit & {
      dispatcher?: unknown;
    };
    return base(input, rest);
  };
}

// grammY на Node создаёт сигнал полифиллом abort-controller, встроенный fetch его отвергает.
export const nativeSignalFetch: typeof fetch = (input, init) => {
  const signal = init?.signal;
  if (!signal || signal instanceof AbortSignal) return fetch(input, init);
  const controller = new AbortController();
  const foreign = signal as unknown as EventTarget & { aborted: boolean };
  if (foreign.aborted) controller.abort();
  else
    foreign.addEventListener('abort', () => controller.abort(), { once: true });
  return fetch(input, { ...init, signal: controller.signal });
};
