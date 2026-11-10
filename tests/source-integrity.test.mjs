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
  const open = app.lastIndexOf('<script>');
  const close = app.indexOf('</script>', open);
  assert.ok(open >= 0 && close > open, 'Expected an inline application script');
  assert.doesNotThrow(() => new vm.Script(app.slice(open + 8, close)));
});

test('message sync has a matching unique conflict target', () => {
  assert.ok(api.includes('create unique index if not exists messages_id_user_unique on messages(id,user_id)'));
  assert.ok(api.includes('on conflict(id,user_id) do nothing'));
});

test('local sync only clears dirty state when the uploaded revision is unchanged', () => {
  assert.ok(app.includes('(Number(saved._rev)||0)===sent._rev'));
  assert.ok(app.includes('saved.pendingSync=false'));
  assert.ok(app.includes('else if(saved){LOCAL.dirty.add(sent.id)}'));
});

test('delete-all blocks sync and clears the local conversation store after server success', () => {
  assert.ok(app.includes('LOCAL.blockSync=true;try{while(LOCAL.syncing)'));
  assert.ok(app.includes("objectStore('conversations').clear()"));
  assert.ok(app.includes('LOCAL.dirty.clear()'));
});
