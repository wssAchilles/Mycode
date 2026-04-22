import path from 'node:path';

import dotenv from 'dotenv';

const backendRoot = process.cwd();

dotenv.config({
  path: path.resolve(backendRoot, '.env'),
  quiet: true,
});

dotenv.config({
  path: path.resolve(backendRoot, '../.env'),
  quiet: true,
  override: true,
});
