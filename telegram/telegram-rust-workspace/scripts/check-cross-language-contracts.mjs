#!/usr/bin/env node

/**
 * 跨语言契约防漂移静态校验工具 (Cross-Language Contract Drift Gate)
 * 严格校验 Rust、TypeScript (Node) 与 Go 之间的 Wire 契约字段一致性。
 * 遵循 Single Source of Truth (SSOT) 规范与 AGENTS.md 铁律。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

// 文件路径映射
const PATHS = {
  rustCandidate: path.join(repoRoot, 'telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/candidate'),
  rustQuery: path.join(repoRoot, 'telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/query'),
  rustPipeline: path.join(repoRoot, 'telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/pipeline'),
  nodeContracts: path.join(repoRoot, 'telegram-clone-backend/src/services/recommendation/rust/contracts.ts'),
  nodeFeedCandidate: path.join(repoRoot, 'telegram-clone-backend/src/services/recommendation/types/FeedCandidate.ts'),
  nodeAlgorithmContract: path.join(repoRoot, 'telegram-clone-backend/src/services/recommendation/contracts/algorithmContract.ts'),
  nodeBusContracts: path.join(repoRoot, 'telegram-clone-backend/src/services/chatDelivery/busContracts.ts'),
  goDeliveryPayloads: path.join(repoRoot, 'telegram-go-delivery-consumer/internal/contracts/delivery_payloads.go'),
};

function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[契约门禁错误] 路径不存在: ${p}`);
    process.exit(1);
  }
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    // 递归按文件名序拼合拆分后的领域子模块文件，支撑 Anti-Flat 模块化校验
    const files = fs
      .readdirSync(p)
      .filter(name => name.endsWith('.rs'))
      .sort()
      .map(name => fs.readFileSync(path.join(p, name), 'utf8'));
    return files.join('\n');
  }
  return fs.readFileSync(p, 'utf8');
}

// 命名转换：snake_case -> camelCase
function snakeToCamel(str) {
  if (str.startsWith('_')) {
    // 处理 _scoreBreakdown, _pipelineScore 等私有调试字段
    return '_' + snakeToCamel(str.slice(1));
  }
  return str.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

// 提取大括号块内容
function extractBlockAfter(source, marker) {
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) return null;
  const openIdx = source.indexOf('{', markerIdx);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  return null;
}

// 提取 Rust 结构体 Wire 字段名（优先采用 #[serde(rename = "...")]）
function extractRustWireFields(source, structName) {
  const block = extractBlockAfter(source, `pub struct ${structName}`);
  if (!block) return [];
  const fields = [];
  const lines = block.split('\n');
  let pendingRename = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    const renameMatch = trimmed.match(/rename\s*=\s*"([^"]+)"/);
    if (renameMatch) {
      pendingRename = renameMatch[1];
    }
    const match = trimmed.match(/^pub\s+([a-zA-Z0-9_]+)\s*:/);
    if (match) {
      if (pendingRename) {
        fields.push(pendingRename);
        pendingRename = null;
      } else {
        fields.push(snakeToCamel(match[1]));
      }
    } else if (!trimmed.startsWith('#')) {
      pendingRename = null;
    }
  }
  return fields;
}

// 提取 TypeScript 接口字段名
function extractTsFields(source, ifaceName) {
  const block = extractBlockAfter(source, `export interface ${ifaceName}`) ||
                extractBlockAfter(source, `interface ${ifaceName}`);
  if (!block) return [];
  const fields = [];
  const lines = block.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const match = trimmed.match(/^([_a-zA-Z0-9]+)\??\s*:/);
    if (match) {
      fields.push(match[1]);
    }
  }
  return fields;
}

// 提取 Zod Schema 字段名
function extractZodFields(source, schemaName) {
  const markerIdx = source.indexOf(schemaName);
  if (markerIdx === -1) return [];
  const objectMarker = 'z.object({';
  const openIdx = source.indexOf(objectMarker, markerIdx);
  if (openIdx === -1) return [];
  const block = extractBlockAfter(source.slice(openIdx + objectMarker.length - 1), '');
  if (!block) return [];
  const fields = [];
  const lines = block.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    const match = trimmed.match(/^([_a-zA-Z0-9]+)\s*:/);
    if (match) {
      fields.push(match[1]);
    }
  }
  return fields;
}

// 提取 Go 结构体 json 标签字段名
function extractGoJsonFields(source, structName) {
  const block = extractBlockAfter(source, `type ${structName} struct`);
  if (!block) return [];
  const fields = [];
  const regex = /`json:"([^",]+)[^`]*"`/g;
  let match;
  while ((match = regex.exec(block)) !== null) {
    fields.push(match[1]);
  }
  return fields;
}

console.log('🔍 开始执行全仓跨语言 Wire 契约防漂移静态门禁检查...\n');

let hasError = false;

// 检查 1: RecommendationCandidatePayload (Rust vs Node Interface vs Node Zod)
{
  const rustSrc = read(PATHS.rustCandidate);
  const nodeSrc = read(PATHS.nodeContracts);

  const rustFields = extractRustWireFields(rustSrc, 'RecommendationCandidatePayload');
  const nodeFields = extractTsFields(nodeSrc, 'RecommendationCandidatePayload');
  const zodFields = extractZodFields(nodeSrc, 'recommendationCandidatePayloadSchema');

  const rustSet = new Set(rustFields);
  const nodeSet = new Set(nodeFields);
  const zodSet = new Set(zodFields);

  // 检查 Rust 字段是否全部在 Node Interface 中
  const missingInNodeInterface = [...rustSet].filter(f => !nodeSet.has(f));
  // 检查 Rust 字段是否全部在 Node Zod Schema 中
  const missingInNodeZod = [...rustSet].filter(f => !zodSet.has(f));

  if (missingInNodeInterface.length > 0 || missingInNodeZod.length > 0) {
    console.error('❌ [漂移检测] RecommendationCandidatePayload 字段不一致:');
    if (missingInNodeInterface.length > 0) {
      console.error(`   - Node Interface 缺失字段: ${missingInNodeInterface.join(', ')}`);
    }
    if (missingInNodeZod.length > 0) {
      console.error(`   - Node Zod Schema 缺失字段: ${missingInNodeZod.join(', ')}`);
    }
    hasError = true;
  } else {
    console.log(`✅ [对齐] RecommendationCandidatePayload: ${rustFields.length} 个字段在 Rust/TS/Zod 间完全一致`);
  }
}

// 检查 2: RankingSignals (Rust RankingSignalsPayload vs Node FeedCandidate RankingSignals)
{
  const rustSrc = read(PATHS.rustCandidate);
  const nodeFeedSrc = read(PATHS.nodeFeedCandidate);

  const rustFields = extractRustWireFields(rustSrc, 'RankingSignalsPayload');
  const nodeFields = extractTsFields(nodeFeedSrc, 'RankingSignals');

  const rustSet = new Set(rustFields);
  const nodeSet = new Set(nodeFields);

  const missingInNode = [...rustSet].filter(f => !nodeSet.has(f));
  if (missingInNode.length > 0) {
    console.error(`❌ [漂移检测] RankingSignals 字段不一致: Node 缺失 ${missingInNode.join(', ')}`);
    hasError = true;
  } else {
    console.log(`✅ [对齐] RankingSignals: ${rustFields.length} 个排名信号在 Rust/Node 间完全一致`);
  }
}

// 检查 3: RecommendationGraphRetrievalPayload (Rust vs Node Interface vs Node Zod)
{
  const rustSrc = read(PATHS.rustPipeline);
  const nodeSrc = read(PATHS.nodeContracts);

  const rustFields = extractRustWireFields(rustSrc, 'RecommendationGraphRetrievalPayload');
  const nodeFields = extractTsFields(nodeSrc, 'RecommendationGraphRetrievalPayload');
  const zodFields = extractZodFields(nodeSrc, 'recommendationRetrievalSummaryPayloadSchema');

  const rustSet = new Set(rustFields);
  const nodeSet = new Set(nodeFields);
  const zodSet = new Set(zodFields);

  const missingInNode = [...rustSet].filter(f => !nodeSet.has(f));
  const missingInZod = [...rustSet].filter(f => !zodSet.has(f));
  if (missingInNode.length > 0 || missingInZod.length > 0) {
    console.error(`❌ [漂移检测] RecommendationGraphRetrievalPayload 字段不一致: Node Interface 缺失 ${missingInNode.join(', ')}, Zod 缺失 ${missingInZod.join(', ')}`);
    hasError = true;
  } else {
    console.log(`✅ [对齐] RecommendationGraphRetrievalPayload: ${rustFields.length} 个图计算字段完全对齐`);
  }
}

// 检查 4: FanoutRequestedPayload (Node ChatDeliveryFanoutRequestedPayload vs Go FanoutRequestedPayload)
{
  const nodeSrc = read(PATHS.nodeBusContracts);
  const goSrc = read(PATHS.goDeliveryPayloads);

  const nodeFields = extractTsFields(nodeSrc, 'ChatDeliveryFanoutRequestedPayload');
  const goFields = extractGoJsonFields(goSrc, 'FanoutRequestedPayload');

  const nodeSet = new Set(nodeFields);
  const goSet = new Set(goFields);

  const missingInGo = [...nodeSet].filter(f => !goSet.has(f));
  if (missingInGo.length > 0) {
    console.error(`❌ [漂移检测] FanoutRequestedPayload: Go 结构体缺少 JSON 字段: ${missingInGo.join(', ')}`);
    hasError = true;
  } else {
    console.log(`✅ [对齐] FanoutRequestedPayload: ${goFields.length} 个字段在 Node 与 Go 间完全一致`);
  }
}

// 检查 5: ProjectionPayload (Node ChatDeliveryProjectionPayload vs Go ProjectionPayload)
{
  const nodeSrc = read(PATHS.nodeBusContracts);
  const goSrc = read(PATHS.goDeliveryPayloads);

  const nodeFields = extractTsFields(nodeSrc, 'ChatDeliveryProjectionPayload');
  const goFields = extractGoJsonFields(goSrc, 'ProjectionPayload');

  const nodeSet = new Set(nodeFields);
  const goSet = new Set(goFields);

  const missingInGo = [...nodeSet].filter(f => !goSet.has(f));
  if (missingInGo.length > 0) {
    console.error(`❌ [漂移检测] ProjectionPayload: Go 结构体缺少 JSON 字段: ${missingInGo.join(', ')}`);
    hasError = true;
  } else {
    console.log(`✅ [对齐] ProjectionPayload: ${goFields.length} 个字段在 Node 与 Go 间完全一致`);
  }
}

// 检查 6: PhoenixScoresPayload (Rust PhoenixScoresPayload vs Node FeedCandidate::PhoenixScores vs algorithmContract::phoenixScoresSchema)
{
  const rustSrc = read(PATHS.rustCandidate);
  const nodeFeedSrc = read(PATHS.nodeFeedCandidate);
  const nodeAlgoSrc = read(PATHS.nodeAlgorithmContract);

  const rustFields = extractRustWireFields(rustSrc, 'PhoenixScoresPayload');
  const nodeFields = extractTsFields(nodeFeedSrc, 'PhoenixScores');
  const zodFields = extractZodFields(nodeAlgoSrc, 'phoenixScoresSchema');

  const rustSet = new Set(rustFields);
  const nodeSet = new Set(nodeFields);
  const zodSet = new Set(zodFields);

  const missingInNode = [...rustSet].filter(f => !nodeSet.has(f));
  const missingInZod = [...rustSet].filter(f => !zodSet.has(f));
  if (missingInNode.length > 0 || missingInZod.length > 0) {
    console.error('❌ [漂移检测] PhoenixScoresPayload 字段不一致:');
    if (missingInNode.length > 0) {
      console.error(`   - FeedCandidate.ts::PhoenixScores 缺失字段: ${missingInNode.join(', ')}`);
    }
    if (missingInZod.length > 0) {
      console.error(`   - algorithmContract.ts::phoenixScoresSchema 缺失字段: ${missingInZod.join(', ')}`);
    }
    hasError = true;
  } else {
    console.log(`✅ [对齐] PhoenixScoresPayload: ${rustFields.length} 个打分/CREAD-30字段在 Rust/TS/Zod 间完全对齐`);
  }
}

// 检查 7: RecommendationQueryPayload (Rust vs Node Interface vs Node Zod)
{
  const rustSrc = read(PATHS.rustQuery);
  const nodeSrc = read(PATHS.nodeContracts);

  const rustFields = extractRustWireFields(rustSrc, 'RecommendationQueryPayload');
  const nodeFields = extractTsFields(nodeSrc, 'RecommendationQueryPayload');
  const zodFields = extractZodFields(nodeSrc, 'recommendationQueryPayloadSchema');

  const rustSet = new Set(rustFields);
  const nodeSet = new Set(nodeFields);
  const zodSet = new Set(zodFields);

  const missingInNode = [...rustSet].filter(f => !nodeSet.has(f));
  const missingInZod = [...rustSet].filter(f => !zodSet.has(f));
  if (missingInNode.length > 0 || missingInZod.length > 0) {
    console.error('❌ [漂移检测] RecommendationQueryPayload 字段不一致:');
    if (missingInNode.length > 0) {
      console.error(`   - Node Interface 缺失字段: ${missingInNode.join(', ')}`);
    }
    if (missingInZod.length > 0) {
      console.error(`   - Node Zod Schema 缺失字段: ${missingInZod.join(', ')}`);
    }
    hasError = true;
  } else {
    console.log(`✅ [对齐] RecommendationQueryPayload: ${rustFields.length} 个字段在 Rust/TS/Zod 间完全一致`);
  }
}

if (hasError) {
  console.error('\n🚨 跨语言契约静态校验失败！检测到未同步的 Wire 契约漂移，已阻断构建。');
  process.exit(1);
} else {
  console.log('\n🎉 所有跨语言 Wire 契约静态校验全部通过！多端协议同构完备，无任何静默漂移。');
  process.exit(0);
}
