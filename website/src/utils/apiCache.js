import apiv2 from './apiv2';

const DEFAULT_GET_CACHE_TTL_MS = 60000;
const getCache = new Map();

function getNow() {
  return Date.now();
}

function makeCacheKey(path, config = {}) {
  const authToken = localStorage.getItem('token') || '';
  const authKey = authToken ? authToken.slice(-16) : 'anonymous';
  return `${authKey}:${config.method || 'GET'}:${path}`;
}

export function clearApiGetCache(matcher) {
  if (!matcher) {
    getCache.clear();
    return;
  }

  for (const key of getCache.keys()) {
    if (typeof matcher === 'string' && key.includes(matcher)) {
      getCache.delete(key);
    } else if (matcher instanceof RegExp && matcher.test(key)) {
      getCache.delete(key);
    } else if (typeof matcher === 'function' && matcher(key)) {
      getCache.delete(key);
    }
  }
}

export async function cachedApiGet(path, options = {}) {
  const {
    ttlMs = DEFAULT_GET_CACHE_TTL_MS,
    cacheKey = makeCacheKey(path, options.config),
    config = {},
  } = options;
  const now = getNow();
  const cached = getCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    if (Object.prototype.hasOwnProperty.call(cached, 'value')) {
      return { data: cached.value, fromCache: true };
    }
    if (cached.promise && !config.signal) {
      return cached.promise;
    }
  }

  const request = apiv2.get(path, config)
    .then((res) => {
      getCache.set(cacheKey, {
        expiresAt: getNow() + ttlMs,
        value: res.data,
      });
      return res;
    })
    .catch((err) => {
      getCache.delete(cacheKey);
      throw err;
    });

  if (!config.signal) {
    getCache.set(cacheKey, {
      expiresAt: now + ttlMs,
      promise: request,
    });
  }

  return request;
}
