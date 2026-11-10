import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const api = await readFile(new URL('../netlify/functions/api.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');

test('Netlify API function parses successfully', () => {
  const result = spawnSync(process.execPath, ['--check', 'netlify/functions/api.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('main inline browser script parses successfully', () => {
  const scripts = [...app.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
  assert.ok(scripts.length, 'Expected an inline application script');
  assert.doesNotThrow(() => new vm.Script(scripts.at(-1)[1]));
});

test('message sync has a matching unique conflict target', () => {
  assert.match(api, /create unique index if not exists messages_id_user_unique on messages\\(id,user_id\\)/);
  assert.match(api, /on conflict\\(id,user_id\\) do nothing/);
});

test('local sync only clears dirty state when the uploaded revision is unchanged', () => {
  assert.match(app, /Number\\(saved\\._rev\\)\\|\\|0\\)===sent\\._rev/);
  assert.match(app, /saved\\.pendingSync=false/);
  assert.match(app, /else if\\(saved\\)\\{LOCAL\\.dirty\\.add\\(sent\\.id\\)\\}/);
});

test('delete-all blocks sync and clears the local conversation store after server success', () => {
  assert.match(app, /LOCAL\\.blockSync=true;try\\{while\\(LOCAL\\.syncing\\)/);
  assert.match(app, /objectStore\\('conversations'\\)\\.clear\\(\\)/);
  assert.match(app, /LOCAL\\.dirty\\.clear\\(\\)/);
});
