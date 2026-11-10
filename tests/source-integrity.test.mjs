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

test('Phase 2 advanced chat controls are present', () => {
  assert.ok(app.includes('id="autoRoute"'));
  assert.ok(app.includes('async function branchAt(index)'));
  assert.ok(app.includes('async function regenAs(model)'));
  assert.ok(app.includes("textContent='Branch here'"));
});

test('conversation folders are persisted and memory inserts are deduplicated', () => {
  assert.ok(api.includes('add column if not exists folder text not null default'));
  assert.ok(api.includes('folder=excluded.folder'));
  assert.ok(api.includes('lower(trim(text))=lower(trim('));
  assert.ok(app.includes("title=\"Folder\""));
});

test('Multi-model Arena is removed to avoid duplicate model requests', () => {
  assert.ok(!app.includes('id="arena"'));
  assert.ok(!app.includes('runArena('));
  assert.ok(!app.includes('⚔ Arena'));
});
