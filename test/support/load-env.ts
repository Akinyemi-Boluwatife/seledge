import { existsSync } from 'node:fs';
import { config } from 'dotenv';

// CI supplies these directly; locally they come from .env.test.
if (existsSync('.env.test')) {
  config({ path: '.env.test', override: true, quiet: true });
}
