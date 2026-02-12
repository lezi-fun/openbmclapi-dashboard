const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const http = require('node:http');
const { URL } = require('node:url');

const PORT = Number(process.env.DASHBOARD_PORT || process.env.PORT || 4001);
const LOG_PATH = process.env.NGINX_LOG_PATH || '/www/wwwlogs/openbmclapi.log';
const GEO_MODE = process.env.GEO_MODE || 'node_geoip';
const TREND_STEP_MINUTES = 5;
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const COUNTRY_BY_CODE = new Intl.DisplayNames(['en'], { type: 'region' });

let parserState = {
  inode: null,
  offset: 0,
  totals: { requests: 0, bandwidth: 0 },
  dayBuckets: new Map(),
  geoRequests: new Map(),
  initialized: false,
  lastError: null
};

const ipCountryCache = new Map();

let geoipLib = null;

function getGeoipLite() {
  if (!geoipLib) {
    geoipLib = require('geoip-lite');
  }
  return geoipLib;
}


function parseNginxTime(raw) {
  const match = raw.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/);
  if (!match) return null;
  const [, dd, mmm, yyyy, hh, mm, ss, tz] = match;
  return new Date(`${dd} ${mmm} ${yyyy} ${hh}:${mm}:${ss} ${tz}`);
}

function utc8DateKey(date) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function utc8TimeKey5m(date) {
  const shiftedMs = date.getTime() + 8 * 3600 * 1000;
  const bucketMs = TREND_STEP_MINUTES * 60 * 1000;
  const floored = Math.floor(shiftedMs / bucketMs) * bucketMs;
  const shifted = new Date(floored);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeCountry(raw) {
  if (!raw || raw === '-' || raw === '"-"') return 'Unknown';
  const value = raw.replace(/^"|"$/g, '');
  if (value.length === 2 && /^[A-Z]{2}$/.test(value)) {
    return COUNTRY_BY_CODE.of(value) || 'Unknown';
  }
  return value;
}

function normalizeIp(raw) {
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

function resolveCountryFromNodeGeoIp(clientIp) {
  const normalizedIp = normalizeIp(clientIp);
  if (!normalizedIp) return 'Unknown';

  if (ipCountryCache.has(normalizedIp)) {
    return ipCountryCache.get(normalizedIp);
  }

  const lookup = getGeoipLite().lookup(normalizedIp);
  const country = normalizeCountry(lookup?.country);
  ipCountryCache.set(normalizedIp, country);
  return country;
}

function ensureDayBucket(dayKey) {
  if (!parserState.dayBuckets.has(dayKey)) {
    parserState.dayBuckets.set(dayKey, {
      requests: 0,
      bandwidth: 0,
      trend: new Map()
    });
  }
  return parserState.dayBuckets.get(dayKey);
}

function applyLogLine(line) {
  // 默认 combined: ip - - [time] "request" status body_bytes_sent "ref" "ua"
  // GeoIP 模式：建议在末尾追加 country code，例如 "CN"（通过 Nginx geoip2 写入）
  const match = line.match(/^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)]\s+"[^"]*"\s+(\d{3})\s+(\d+|-)(?:\s+"[^"]*"\s+"[^"]*"(?:\s+"([^"]+)")?)?/);
  if (!match) return;

  const [, clientIp, timeRaw, status, bytesRaw, countryRaw] = match;
  const statusCode = Number(status);
  if (!Number.isFinite(statusCode)) return;

  const time = parseNginxTime(timeRaw);
  if (!time || Number.isNaN(time.getTime())) return;

  const bytes = bytesRaw === '-' ? 0 : Number(bytesRaw);
  const safeBytes = Number.isFinite(bytes) ? bytes : 0;

  parserState.totals.requests += 1;
  parserState.totals.bandwidth += safeBytes;

  const dayKey = utc8DateKey(time);
  const day = ensureDayBucket(dayKey);
  day.requests += 1;
  day.bandwidth += safeBytes;

  const trendKey = utc8TimeKey5m(time);
  if (!day.trend.has(trendKey)) {
    day.trend.set(trendKey, { requests: 0, bandwidth: 0 });
  }
  const trend = day.trend.get(trendKey);
  trend.requests += 1;
  trend.bandwidth += safeBytes;

  const country = GEO_MODE === 'nginx_geoip' && countryRaw
    ? normalizeCountry(countryRaw)
    : resolveCountryFromNodeGeoIp(clientIp);
  parserState.geoRequests.set(country, (parserState.geoRequests.get(country) || 0) + 1);
}

async function parseRange(start, end) {
  return new Promise((resolve, reject) => {
    if (end <= start) return resolve();
    const stream = fs.createReadStream(LOG_PATH, { encoding: 'utf8', start, end: end - 1 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', applyLogLine);
    rl.on('close', resolve);
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

async function refreshFromLog() {
  try {
    const stat = await fs.promises.stat(LOG_PATH);
    const rotated = parserState.inode !== null && parserState.inode !== stat.ino;
    const truncated = parserState.offset > stat.size;

    if (!parserState.initialized || rotated || truncated) {
      parserState = {
        inode: stat.ino,
        offset: 0,
        totals: { requests: 0, bandwidth: 0 },
        dayBuckets: new Map(),
        geoRequests: new Map(),
        initialized: true,
        lastError: null
      };
      await parseRange(0, stat.size);
      parserState.offset = stat.size;
      return;
    }

    if (stat.size > parserState.offset) {
      await parseRange(parserState.offset, stat.size);
      parserState.offset = stat.size;
    }
    parserState.lastError = null;
  } catch (error) {
    parserState.lastError = error.message;
    if (!parserState.initialized) parserState.initialized = true;
  }
}

function buildStatsPayload() {
  const todayKey = utc8DateKey(new Date());
  const today = parserState.dayBuckets.get(todayKey) || { requests: 0, bandwidth: 0, trend: new Map() };

  const sortedTrendEntries = [...today.trend.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

  return {
    totals: parserState.totals,
    today: {
      requests: today.requests,
      bandwidth: today.bandwidth,
      dateBucket: todayKey
    },
    trend: {
      labels: sortedTrendEntries.map(([label]) => label),
      requests: sortedTrendEntries.map(([, value]) => value.requests),
      bandwidth: sortedTrendEntries.map(([, value]) => value.bandwidth)
    },
    geo: [...parserState.geoRequests.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 150)
      .map(([name, value]) => ({ name, value })),
    source: {
      logPath: LOG_PATH,
      geoMode: GEO_MODE,
      lastError: parserState.lastError
    }
  };
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res, pathname) {
  let target = pathname === '/' ? '/index.html' : pathname;
  if (target.includes('..')) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  const filePath = path.join(__dirname, target);
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/dashboard/stats') {
    await refreshFromLog();
    return sendJson(res, buildStatsPayload());
  }

  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, async () => {
  await refreshFromLog();
  console.log(`[dashboard] listening on ${HOST}:${PORT}`);
  console.log(`[dashboard] parsing log: ${LOG_PATH}`);
  console.log(`[dashboard] geo mode: ${GEO_MODE}`);
});
