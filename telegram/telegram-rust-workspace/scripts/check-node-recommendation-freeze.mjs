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

function walkTsFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  return items.flatMap((item) => {
    const itemPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      return walkTsFiles(itemPath);
    }
    if (!item.isFile() || !item.name.endsWith('.ts') || item.name === 'index.ts') {
      return [];
    }
    return [itemPath];
  });
}

function componentFileNames(relativeDir) {
  return walkTsFiles(path.join(recommendationDir, relativeDir))
    .map((filePath) => path.basename(filePath, '.ts'))
    .sort();
}

function assertNoUndeclaredComponentFiles(label, relativeDir, expected) {
  const actual = componentFileNames(relativeDir);
  const expectedSet = new Set(expected);
  const undeclared = actual.filter((name) => !expectedSet.has(name));
  if (undeclared.length > 0) {
    fail(
      `${label} component files are not declared in runtimeOwnership.ts`,
      `undeclared=${JSON.stringify(undeclared)}\nallowed=${JSON.stringify([...expectedSet].sort())}`,
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
const baselineSources = exportedStringArray(ownership, 'NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES');
const baselineFilters = exportedStringArray(ownership, 'NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS');
const baselineScorers = exportedStringArray(ownership, 'NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS');
const postSelectionFilters = exportedStringArray(
  ownership,
  'NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS',
);
const nonPipelineFiles = exportedStringArray(
  ownership,
  'NODE_RECOMMENDATION_LEGACY_NON_PIPELINE_COMPONENT_FILES',
);
const legacySelector = ownership.match(/NODE_RECOMMENDATION_LEGACY_SELECTOR = '([^']+)' as const;/)?.[1];

assertSame(
  'source catalog',
  returnedNewClassNames(catalog, 'buildRecommendationSources'),
  baselineSources,
);
assertSame(
  'filter catalog',
  returnedNewClassNames(catalog, 'buildRecommendationFilters'),
  baselineFilters,
);
assertSame(
  'scorer catalog',
  returnedNewClassNames(catalog, 'buildRecommendationScorers'),
  baselineScorers,
);
assertSame(
  'post-selection filter catalog',
  returnedNewClassNames(catalog, 'buildRecommendationPostSelectionFilters'),
  postSelectionFilters,
);

const selector = returnedNewClassNames(catalog, 'buildRecommendationSelector');
assertSame(
  'selector catalog',
  selector,
  [legacySelector].filter(Boolean),
);

assertNoUndeclaredComponentFiles('source', 'sources', [...baselineSources, ...nonPipelineFiles]);
assertNoUndeclaredComponentFiles('filter', 'filters', [
  ...baselineFilters,
  ...postSelectionFilters,
  ...nonPipelineFiles,
]);
assertNoUndeclaredComponentFiles('scorer', 'scorers', baselineScorers);
assertNoUndeclaredComponentFiles('selector', 'selectors', [legacySelector].filter(Boolean));

const directAlgorithmConstruction = mixer.match(/\bnew\s+([A-Za-z0-9_]*(?:Source|Filter|Scorer)|TopKSelector)\s*\(/g);
if (directAlgorithmConstruction) {
  fail(
    'SpaceFeedMixer must consume componentCatalog instead of constructing algorithm components directly',
    directAlgorithmConstruction.join('\n'),
  );
}

console.log('node recommendation freeze check passed');
