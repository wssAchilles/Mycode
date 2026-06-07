#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { spawn } from 'node:child_process';

const nowIso = new Date().toISOString();
const redisUrl = process.env.PERF_INFRA_REDIS_URL || process.env.REDIS_URL || '';
const mongoUri = process.env.PERF_INFRA_MONGO_URI || process.env.MONGO_URI || process.env.MONGODB_URI || '';
const gatewayWsUrl = process.env.PERF_GATEWAY_WS_URL || '';
const recommendationUrl = process.env.PERF_RECOMMENDATION_URL || '';
const graphBenchJson = process.env.PERF_CPP_GRAPH_BENCH_JSON || '';
const graphRefreshCommand = process.env.PERF_CPP_GRAPH_REFRESH_COMMAND || '';
const mongoCommand = process.env.PERF_MONGO_COMMAND || '';
const strict = readBool('PERF_INFRA_STRICT', true);
const redisIterations = readInt('PERF_INFRA_REDIS_MESSAGES', 2048);
const redisBatchSize = readInt('PERF_INFRA_REDIS_BATCH_SIZE', 128);
const httpIterations = readInt('PERF_INFRA_HTTP_REQUESTS', 200);
const wsConnections = readInt('PERF_INFRA_WS_CONNECTIONS', 100);

const results = [];
const failures = [];

class RedisClient {
  constructor(rawUrl) {
    this.url = new URL(rawUrl);
    this.buffer = Buffer.alloc(0);
    this.socket = null;
  }

  async connect() {
    const port = Number(this.url.port || (this.url.protocol === 'rediss:' ? 6380 : 6379));
    const host = this.url.hostname || '127.0.0.1';
    this.socket = this.url.protocol === 'rediss:'
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    this.socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
    });
    await onceConnect(this.socket);
    if (this.url.password) {
      if (this.url.username) {
        await this.command('AUTH', this.url.username, this.url.password);
      } else {
        await this.command('AUTH', this.url.password);
      }
    }
    const db = this.url.pathname.replace('/', '');
    if (db) {
      await this.command('SELECT', db);
    }
  }

  close() {
    this.socket?.destroy();
  }

  async command(...parts) {
    const encoded = `*${parts.length}\r\n${parts.map(part => {
      const value = String(part);
      return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
    }).join('')}`;
    this.socket.write(encoded);
    for (;;) {
      const parsed = parseResp(this.buffer, 0);
      if (parsed) {
        this.buffer = this.buffer.subarray(parsed.offset);
        if (parsed.value?.__redisError) {
          throw new Error(parsed.value.message);
        }
        return parsed.value;
      }
      await waitForData(this.socket);
    }
  }
}

function parseResp(buffer, offset) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf('\r\n', offset + 1, 'utf8');
  if (lineEnd < 0) return null;
  const line = buffer.subarray(offset + 1, lineEnd).toString();
  const next = lineEnd + 2;
  if (type === '+') return { value: line, offset: next };
  if (type === '-') return { value: { __redisError: true, message: line }, offset: next };
  if (type === ':') return { value: Number(line), offset: next };
  if (type === '$') {
    const length = Number(line);
    if (length < 0) return { value: null, offset: next };
    const end = next + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.subarray(next, end).toString(), offset: end + 2 };
  }
  if (type === '*') {
    const length = Number(line);
    if (length < 0) return { value: null, offset: next };
    const values = [];
    let cursor = next;
    for (let index = 0; index < length; index += 1) {
      const parsed = parseResp(buffer, cursor);
      if (!parsed) return null;
      values.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: values, offset: cursor };
  }
  throw new Error(`unsupported RESP type ${type}`);
}

async function withRedis(fn) {
  const client = new RedisClient(redisUrl);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function runRedisStreamMetric(name, streamPrefix) {
  if (!redisUrl) return skip(name, 'PERF_INFRA_REDIS_URL or REDIS_URL is not set');
  await withRedis(async redis => {
    const suffix = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
    const stream = `${streamPrefix}:${suffix}`;
    const group = `${streamPrefix}:group`;
    const consumer = `${streamPrefix}:consumer`;
    const samples = [];
    let maxPelSize = 0;
    await redis.command('DEL', stream);
    await redis.command('XGROUP', 'CREATE', stream, group, '0', 'MKSTREAM');
    for (let index = 0; index < redisIterations; index += 1) {
      const started = performance.now();
      await redis.command('XADD', stream, '*', 'key', `chat-${index % 256}`, 'payload', `message-${index}`);
      samples.push(elapsedUs(started));
    }
    let processed = 0;
    const ackSamples = [];
    while (processed < redisIterations) {
      const started = performance.now();
      const response = await redis.command(
        'XREADGROUP', 'GROUP', group, consumer, 'COUNT', redisBatchSize, 'STREAMS', stream, '>'
      );
      const messages = extractStreamMessages(response);
      if (messages.length === 0) break;
      const pending = await redis.command('XPENDING', stream, group);
      maxPelSize = Math.max(maxPelSize, Number(Array.isArray(pending) ? pending[0] : 0));
      await redis.command('XACK', stream, group, ...messages.map(message => message.id));
      processed += messages.length;
      ackSamples.push(elapsedUs(started));
    }
    const xlen = Number(await redis.command('XLEN', stream));
    await redis.command('DEL', stream);
    addResult({
      service: name.startsWith('go_') ? 'go_delivery' : 'rust_gateway',
      name,
      status: processed === redisIterations ? 'pass' : 'fail',
      requestCount: redisIterations,
      batchSize: redisBatchSize,
      queueDepth: maxPelSize,
      samples: ackSamples.length > 0 ? ackSamples : samples,
      timeouts: 0,
      fallback: false,
      budgetExhausted: false,
      cacheHit: null,
      cacheMiss: null,
      extra: {
        redisStream: streamPrefix,
        redisXlenAfterAck: xlen,
        processedCount: processed,
        pelMaxSize: maxPelSize,
        ackRttP95Us: percentile(ackSamples, 95),
        streamLag: Math.max(0, xlen - processed)
      }
    });
  });
}

async function runRedisPublishMetric() {
  const name = 'go_wake_publish_redis';
  if (!redisUrl) return skip(name, 'PERF_INFRA_REDIS_URL or REDIS_URL is not set');
  await withRedis(async redis => {
    const channel = `perf:wake:${Date.now()}`;
    const samples = [];
    for (let index = 0; index < redisIterations; index += 1) {
      const started = performance.now();
      await redis.command('PUBLISH', channel, JSON.stringify({ userId: `user-${index}`, updateId: index }));
      samples.push(elapsedUs(started));
    }
    addResult({
      service: 'go_delivery',
      name,
      status: 'pass',
      requestCount: redisIterations,
      batchSize: redisBatchSize,
      queueDepth: 0,
      samples,
      timeouts: 0,
      fallback: false,
      budgetExhausted: false,
      cacheHit: null,
      cacheMiss: null,
      extra: { wakeChannel: channel }
    });
  });
}

async function runHttpMetric() {
  const name = 'rust_recommendation_http_cache_miss_hit';
  if (!recommendationUrl) return skip(name, 'PERF_RECOMMENDATION_URL is not set');
  const url = new URL(process.env.PERF_RECOMMENDATION_REQUEST_PATH || '/', recommendationUrl);
  const method = process.env.PERF_RECOMMENDATION_METHOD || 'GET';
  const body = process.env.PERF_RECOMMENDATION_BODY || undefined;
  const headers = process.env.PERF_RECOMMENDATION_HEADERS
    ? JSON.parse(process.env.PERF_RECOMMENDATION_HEADERS)
    : {};
  const samples = [];
  let fallback = 0;
  for (let index = 0; index < httpIterations; index += 1) {
    const started = performance.now();
    const response = await fetch(url, { method, headers, body });
    samples.push(elapsedUs(started));
    if (!response.ok) fallback += 1;
    await response.arrayBuffer();
  }
  addResult({
    service: 'rust_recommendation',
    name,
    status: fallback === 0 ? 'pass' : 'fail',
    requestCount: httpIterations,
    batchSize: null,
    queueDepth: null,
    samples,
    timeouts: 0,
    fallback: fallback > 0,
    budgetExhausted: false,
    cacheHit: null,
    cacheMiss: null,
    extra: { url: url.toString(), nonOkResponses: fallback }
  });
}

async function runWebSocketMetric() {
  const name = 'rust_gateway_websocket_connect';
  if (!gatewayWsUrl) return skip(name, 'PERF_GATEWAY_WS_URL is not set');
  const samples = [];
  let timeouts = 0;
  for (let index = 0; index < wsConnections; index += 1) {
    const started = performance.now();
    try {
      await websocketHandshake(gatewayWsUrl);
      samples.push(elapsedUs(started));
    } catch {
      timeouts += 1;
    }
  }
  addResult({
    service: 'rust_gateway',
    name,
    status: timeouts === 0 ? 'pass' : 'fail',
    requestCount: wsConnections,
    batchSize: null,
    queueDepth: null,
    samples,
    timeouts,
    fallback: false,
    budgetExhausted: false,
    cacheHit: null,
    cacheMiss: null,
    extra: { url: gatewayWsUrl }
  });
}

async function runMongoMetric() {
  const name = 'go_mongo_reservation_outbox_bulk';
  if (mongoCommand) return runCommandMetric(name, 'go_delivery', mongoCommand);
  if (!mongoUri) return skip(name, 'PERF_INFRA_MONGO_URI, MONGO_URI, MONGODB_URI, or PERF_MONGO_COMMAND is not set');
  const code = `
const run = "perf-" + Date.now();
const started = Date.now();
const ops = [];
for (let i = 0; i < ${redisIterations}; i++) {
  ops.push({ updateOne: {
    filter: { run, chunk: Math.floor(i / ${redisBatchSize}) },
    update: { $inc: { reserved: 1 }, $set: { updatedAt: new Date() } },
    upsert: true
  }});
}
db.perf_outbox_reservation.bulkWrite(ops, { ordered: false });
const count = db.perf_outbox_reservation.countDocuments({ run });
db.perf_outbox_reservation.deleteMany({ run });
print(JSON.stringify({ elapsedMs: Date.now() - started, count }));
`;
  await runCommandMetric(name, 'go_delivery', `mongosh --quiet "${mongoUri}" --eval ${JSON.stringify(code)}`);
}

async function runGraphMetric() {
  const name = 'cpp_graph_snapshot_publish_refresh_read';
  if (graphRefreshCommand) return runCommandMetric(name, 'cpp_graph', graphRefreshCommand);
  if (!graphBenchJson) return skip(name, 'PERF_CPP_GRAPH_REFRESH_COMMAND or PERF_CPP_GRAPH_BENCH_JSON is not set');
  const parsed = JSON.parse(fs.readFileSync(graphBenchJson, 'utf8'));
  const rows = (parsed.results || []).filter(row => String(row.name || '').includes('snapshot'));
  if (rows.length === 0) return skip(name, 'provided C++ graph bench JSON has no snapshot rows');
  for (const row of rows) {
    addResult({
      service: 'cpp_graph',
      name: `cpp_graph_${row.name}`,
      status: 'pass',
      requestCount: row.request_count ?? row.requestCount ?? 1,
      batchSize: row.batch_size ?? row.batchSize ?? null,
      queueDepth: row.queue_depth ?? row.queueDepth ?? null,
      samples: [Number(row.p50_us ?? row.p50Us ?? 0), Number(row.p95_us ?? row.p95Us ?? 0), Number(row.p99_us ?? row.p99Us ?? 0)],
      timeouts: row.timeouts ?? 0,
      fallback: row.fallback ?? false,
      budgetExhausted: row.budget_exhausted ?? row.budgetExhausted ?? false,
      cacheHit: row.cache_hit ?? row.cacheHit ?? null,
      cacheMiss: row.cache_miss ?? row.cacheMiss ?? null,
      extra: {
        snapshotRepresentation: row.snapshot_representation ?? row.snapshotRepresentation ?? null,
        snapshotRssBytes: row.snapshot_rss_bytes ?? row.snapshotRssBytes ?? null,
        snapshotBuildPhaseDurations: row.snapshot_build_phase_durations ?? row.snapshotBuildPhaseDurations ?? null
      }
    });
  }
}

async function runCommandMetric(name, service, command) {
  const started = performance.now();
  const { code, stdout, stderr } = await runShell(command);
  const samples = [elapsedUs(started)];
  addResult({
    service,
    name,
    status: code === 0 ? 'pass' : 'fail',
    requestCount: 1,
    batchSize: null,
    queueDepth: null,
    samples,
    timeouts: code === 0 ? 0 : 1,
    fallback: false,
    budgetExhausted: false,
    cacheHit: null,
    cacheMiss: null,
    extra: { command, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }
  });
}

function extractStreamMessages(response) {
  if (!Array.isArray(response)) return [];
  const streamRows = response[0];
  if (!Array.isArray(streamRows)) return [];
  const messages = streamRows[1];
  if (!Array.isArray(messages)) return [];
  return messages.map(message => ({ id: message[0], fields: message[1] }));
}

async function websocketHandshake(rawUrl) {
  const url = new URL(rawUrl);
  const secure = url.protocol === 'wss:';
  const port = Number(url.port || (secure ? 443 : 80));
  const socket = secure
    ? tls.connect({ host: url.hostname, port, servername: url.hostname })
    : net.connect({ host: url.hostname, port });
  await onceConnect(socket);
  const key = crypto.randomBytes(16).toString('base64');
  const path = `${url.pathname || '/'}${url.search || ''}`;
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: ${url.host}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    `Sec-WebSocket-Key: ${key}`,
    '',
    ''
  ].join('\r\n'));
  const response = await readUntil(socket, '\r\n\r\n', 5000);
  socket.destroy();
  if (!response.includes(' 101 ')) {
    throw new Error('websocket upgrade did not return HTTP 101');
  }
}

function addResult({ service, name, status, requestCount, batchSize, queueDepth, samples, timeouts, fallback, budgetExhausted, cacheHit, cacheMiss, extra }) {
  const row = {
    service,
    name,
    status,
    requestCount,
    batchSize,
    queueDepth,
    p50Us: percentile(samples, 50),
    p95Us: percentile(samples, 95),
    p99Us: percentile(samples, 99),
    timeouts,
    fallback,
    budgetExhausted,
    cacheHit,
    cacheMiss,
    ...extra
  };
  results.push(row);
  if (status === 'fail') failures.push(name);
}

function skip(name, reason) {
  results.push({
    service: serviceForName(name),
    name,
    status: 'skipped',
    reason,
    requestCount: 0,
    batchSize: null,
    queueDepth: null,
    p50Us: null,
    p95Us: null,
    p99Us: null,
    timeouts: 0,
    fallback: false,
    budgetExhausted: false,
    cacheHit: null,
    cacheMiss: null
  });
}

function serviceForName(name) {
  if (name.startsWith('go_')) return 'go_delivery';
  if (name.startsWith('rust_gateway')) return 'rust_gateway';
  if (name.startsWith('rust_recommendation')) return 'rust_recommendation';
  if (name.startsWith('cpp_graph')) return 'cpp_graph';
  return 'infra';
}

function percentile(values, pct) {
  const numeric = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (numeric.length === 0) return null;
  const index = Math.floor(((numeric.length - 1) * Math.min(100, pct)) / 100);
  return Math.round(numeric[index]);
}

function elapsedUs(started) {
  return Math.round((performance.now() - started) * 1000);
}

function readInt(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readBool(key, fallback) {
  if (process.env[key] == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(process.env[key].toLowerCase());
}

function onceConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });
}

function waitForData(socket) {
  return new Promise((resolve, reject) => {
    socket.once('data', resolve);
    socket.once('error', reject);
  });
}

function readUntil(socket, marker, timeoutMs) {
  return new Promise((resolve, reject) => {
    let data = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('timeout'));
    }, timeoutMs);
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.includes(marker)) {
        clearTimeout(timeout);
        resolve(data);
      }
    });
    socket.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function runShell(command) {
  return new Promise(resolve => {
    const child = spawn(command, { shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function guarded(name, fn) {
  try {
    await fn();
  } catch (error) {
    failures.push(name);
    results.push({
      service: serviceForName(name),
      name,
      status: 'fail',
      error: error instanceof Error ? error.message : String(error),
      requestCount: 0,
      batchSize: null,
      queueDepth: null,
      p50Us: null,
      p95Us: null,
      p99Us: null,
      timeouts: 1,
      fallback: true,
      budgetExhausted: false,
      cacheHit: null,
      cacheMiss: null
    });
  }
}

await guarded('go_redis_stream_lag_pel', () => runRedisStreamMetric('go_redis_stream_lag_pel', 'perf:go:delivery'));
await guarded('go_wake_publish_redis', runRedisPublishMetric);
await guarded('go_mongo_reservation_outbox_bulk', runMongoMetric);
await guarded('rust_gateway_redis_fanout_stream', () => runRedisStreamMetric('rust_gateway_redis_fanout_stream', 'perf:rust:gateway'));
await guarded('rust_gateway_websocket_connect', runWebSocketMetric);
await guarded('rust_recommendation_http_cache_miss_hit', runHttpMetric);
await guarded('cpp_graph_snapshot_publish_refresh_read', runGraphMetric);

const runnable = results.filter(row => row.status !== 'skipped').length;
const payload = {
  schemaVersion: 'telegram_infra_perf_fixture_v1',
  generatedAtUtc: nowIso,
  status: failures.length > 0 ? 'fail' : runnable > 0 ? 'pass' : 'skipped',
  runnableScenarioCount: runnable,
  skippedScenarioCount: results.length - runnable,
  failureCount: failures.length,
  config: {
    redisEnabled: Boolean(redisUrl),
    mongoEnabled: Boolean(mongoUri || mongoCommand),
    gatewayWebsocketEnabled: Boolean(gatewayWsUrl),
    recommendationHttpEnabled: Boolean(recommendationUrl),
    graphRefreshEnabled: Boolean(graphRefreshCommand || graphBenchJson),
    redisIterations,
    redisBatchSize,
    httpIterations,
    wsConnections
  },
  results
};

console.log(JSON.stringify(payload, null, 2));
if (strict && failures.length > 0) process.exit(1);
