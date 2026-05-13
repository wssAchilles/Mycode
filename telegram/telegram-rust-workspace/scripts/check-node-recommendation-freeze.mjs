#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '../..');
const recommendationDir = path.join(projectDir, 'telegram-clone-backend/src/services/recommendation');

const ownershipPath = path.join(recommendationDir, 'contracts/runtimeOwnership.ts');
const catalogPath = path.join(recommendationDir, 'internal/componentCatalog.ts');
const mixerPath = path.join(recommendationDir, 'SpaceFeedMixer.ts');

function fail(message, detail = '') {
  console.error(`node recommendation freeze check failed: ${message}`);
  if (detail) {
    console.error(detail);
  }
  process.exit(1);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function exportedStringArray(source, name) {
  const match = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) {
    fail(`missing ownership array ${name}`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function functionBody(source, name) {
  const functionIndex = source.indexOf(`export function ${name}`);
  if (functionIndex < 0) {
    fail(`missing catalog function ${name}`);
  }
  const openIndex = source.indexOf('{', functionIndex);
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }
  }
  fail(`unterminated catalog function ${name}`);
}

function returnedNewClassNames(source, name) {
  const body = functionBody(source, name);
  const returnIndex = body.indexOf('return [');
  if (returnIndex < 0) {
    const directReturn = body.match(/return\s+new\s+([A-Za-z0-9_]+)\s*\(/);
    if (directReturn) {
      return [directReturn[1]];
    }
    fail(`catalog function ${name} must return a literal component array or component instance`);
  }
  const openIndex = body.indexOf('[', returnIndex);
  let depth = 0;
  for (let index = openIndex; index < body.length; index += 1) {
    const char = body[index];
    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        const arrayBody = body.slice(openIndex + 1, index);
        return [...arrayBody.matchAll(/new\s+([A-Za-z0-9_]+)\s*\(/g)].map((item) => item[1]);
      }
    }
  }
  fail(`unterminated return array in ${name}`);
}

function assertSame(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `${label} drifted from runtimeOwnership.ts`,
      `expected=${JSON.stringify(expected)}\nactual=${JSON.stringify(actual)}`,
    );
  }
}

if (!fs.existsSync(recommendationDir)) {
  console.log('node recommendation freeze check skipped: recommendation service not present');
  process.exit(0);
}

const ownership = read(ownershipPath);
const catalog = read(catalogPath);
const mixer = read(mixerPath);

assertSame(
  'source catalog',
  returnedNewClassNames(catalog, 'buildRecommendationSources'),
  exportedStringArray(ownership, 'NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES'),
);
assertSame(
  'filter catalog',
  returnedNewClassNames(catalog, 'buildRecommendationFilters'),
  exportedStringArray(ownership, 'NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS'),
);
assertSame(
  'scorer catalog',
  returnedNewClassNames(catalog, 'buildRecommendationScorers'),
  exportedStringArray(ownership, 'NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS'),
);
assertSame(
  'post-selection filter catalog',
  returnedNewClassNames(catalog, 'buildRecommendationPostSelectionFilters'),
  exportedStringArray(ownership, 'NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS'),
);

const selector = returnedNewClassNames(catalog, 'buildRecommendationSelector');
assertSame(
  'selector catalog',
  selector,
  [ownership.match(/NODE_RECOMMENDATION_LEGACY_SELECTOR = '([^']+)' as const;/)?.[1]].filter(Boolean),
);

const directAlgorithmConstruction = mixer.match(/\bnew\s+([A-Za-z0-9_]*(?:Source|Filter|Scorer)|TopKSelector)\s*\(/g);
if (directAlgorithmConstruction) {
  fail(
    'SpaceFeedMixer must consume componentCatalog instead of constructing algorithm components directly',
    directAlgorithmConstruction.join('\n'),
  );
}

console.log('node recommendation freeze check passed');
