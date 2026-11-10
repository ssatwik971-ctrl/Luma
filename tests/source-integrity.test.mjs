import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const api = await readFile(new URL('../netlify/functions/api.mjs', import.meta.url), 'utf8');
const pkgJson = await readFile(new URL('../package.json', import.meta.url), 'utf8');
const appHtml = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const appCss = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
const app = appHtml + '\n' + appJs + '\n' + appCss;

test('Netlify API function parses successfully', () => {
  const result = spawnSync(process.execPath, ['--check', 'netlify/functions/api.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('modular browser application script parses successfully', () => {
  assert.ok(appHtml.includes('href="/app.css"'));
  assert.ok(appHtml.includes('src="/app.js"'));
  assert.doesNotThrow(() => new vm.Script(appJs));
});

test('message sync has a matching unique conflict target', () => {
  assert.ok(api.includes('create unique index if not exists messages_id_user_unique on messages(id,user_id)'));
  assert.ok(api.includes('on conflict(id,user_id) do nothing'));
});

test('local sync only clears dirty state when the uploaded revision is unchanged', () => {
  assert.ok(app.includes('(Number(saved._rev)||0)===(Number(rec._rev)||0)'));
  assert.ok(app.includes('if(unchanged)saved.pendingSync=false'));
  assert.ok(app.includes('if(unchanged)LOCAL.dirty.delete(rec.id);else LOCAL.dirty.add(rec.id)'));
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

test('temporary chats do not persist messages or trigger automatic memory extraction', () => {
  assert.ok(app.includes('S.temporary=true'));
  assert.ok(app.includes('if(!S.temporary){const c=await localGet(S.cur)'));
  assert.ok(app.includes('if(!S.temporary&&!M.img&&S.user.settings?.autoMemory)'));
});

test('saved memories can be edited with duplicate protection', () => {
  assert.ok(api.includes("if (m === 'PATCH' && b)"));
  assert.ok(api.includes('and id<>${b} limit 1'));
  assert.ok(app.includes('title="Edit memory"'));
});

test('Phase 3 voice controls support selectable languages and stop playback', () => {
  assert.ok(app.includes('id="voiceLang"'));
  assert.ok(app.includes('id="stopSpeak"'));
  assert.ok(app.includes("function voiceLanguage()"));
  assert.ok(app.includes("rec.lang=voiceLanguage()"));
  assert.ok(app.includes("utter.lang=voiceLanguage()"));
  assert.ok(app.includes("speechSynthesis.cancel()"));
});

test('locally stored image inputs are restored when reopening a synced conversation', () => {
  assert.ok(app.includes('localById.get(m.id)'));
  assert.ok(app.includes('_imgs:local._imgs||[]'));
  assert.ok(app.includes('_localOnlyImages'));
  assert.ok(app.includes('Attached image preview (stored on this device)'));
});

test('audio transcription and explicit video model selection use supported Puter APIs', () => {
  assert.ok(app.includes('puter.ai.speech2txt(f.file'));
  assert.ok(app.includes("provider:'openai'"));
  assert.ok(app.includes("video:{id:'google/gemini-2.5-flash'"));
  assert.ok(app.includes("S.model!=='video'"));
  assert.ok(app.includes("No automatic model switch is made."));
  assert.ok(app.includes("puter.ai.chat(prompt,last._video,{model:M.id,stream:true})"));
  assert.ok(app.includes("if(!S.autoRoute||S.model==='image'||S.model==='video')"));
});

test('video model is accepted by conversation sync and user settings', () => {
  assert.ok(api.includes("['luna','pro','video','image']"));
  assert.ok(api.includes("['luna', 'pro', 'video', 'image']"));
});

test('Phase 3 audio and video attachment safety is enforced', () => {
  assert.ok(app.includes("Audio over 10 MiB (Puter Gemini transcription limit)"));
  assert.ok(app.includes("Video over 32 MiB."));
  assert.ok(app.includes("Attach one video per message."));
  assert.ok(app.includes("Image over 5 MB for inline model input."));
  assert.ok(app.includes("Use the Transcribe button before sending"));
});

test('video analysis requires an explicit video-capable model selection', () => {
  assert.ok(app.includes("S.model!=='video'"));
  assert.ok(app.includes("google/gemini-2.5-flash"));
  assert.ok(app.includes("No automatic model switch is made."));
});


test('audio and video attachment metadata survives cloud sync and direct message storage', () => {
  assert.ok(api.includes("if (x.audio === true && type.startsWith('audio/')) item.audio = true"));
  assert.ok(api.includes("if (x.video === true && type.startsWith('video/')) item.video = true"));
  assert.equal((api.match(/if \(x\.audio === true && type\.startsWith\('audio\/'\)\) item\.audio = true/g)||[]).length, 2);
  assert.equal((api.match(/if \(x\.video === true && type\.startsWith\('video\/'\)\) item\.video = true/g)||[]).length, 2);
});

test('Puter streaming errors are surfaced instead of being mistaken for empty model replies', () => {
  assert.ok(app.includes("p?.type==='error'"));
  assert.ok(app.includes("The selected model returned a streaming error."));
  assert.ok(app.includes('function responseText(r)'));
});
test('Artifact Studio normalizes model response content before validating HTML', () => {
  assert.ok(app.includes('{model:MODELS.pro.id,normalize:true}'));
  assert.ok(app.includes('let code=responseText(r)'));
});
test('usage dashboard includes video model activity and full Puter app API breakdown', () => {
  assert.ok(app.includes('getDetailedAppUsage(puter.appID)'));
  assert.ok(!app.includes('items.slice(0,12)'));
  assert.ok(app.includes("models=['luna','pro','video','image']"));
  assert.ok(app.includes("video:'Gemini 2.5 Flash (video)'"));
});


test('reopening a synced conversation restores same-device video File objects', () => {
  assert.ok(app.includes('_video:local._video||null'));
  assert.ok(app.includes('_localOnlyVideo:!!local._video'));
  assert.ok(app.includes('Video file is available on this device only.'));
});

test('audio transcription sends a base ISO language code to Puter', () => {
  assert.ok(app.includes("language:voiceLanguage().split('-')[0]"));
  assert.ok(app.includes("puter.ai.speech2txt(f.file"));
});

test('voice input only submits finalized speech and does not auto-send stale composer text', () => {
  assert.ok(app.includes('VOICE.finalTranscript'));
  assert.ok(app.includes('if(VOICE.mode&&VOICE.finalTranscript.trim()&&!S.busy)'));
  assert.ok(appJs.includes("$('#in').value=($('#in').value.trim()+' '+VOICE.finalTranscript.trim()).trim()"));
});


test('audio and video attachment limits match documented Puter input ceilings', () => {
  assert.ok(app.includes('Audio over 10 MiB (Puter Gemini transcription limit)'));
  assert.ok(app.includes('Video over 32 MiB.'));
});

test('Phase 4 retrieves relevant saved memories without extra model calls', () => {
  assert.ok(app.includes('function selectRelevantMemories(query)'));
  assert.ok(app.includes('S.user.settings?.useMemories===false'));
  assert.ok(app.includes('.slice(0,8)'));
  assert.ok(app.includes('useMemories:$(\'#useMemories\').checked'));
  assert.ok(app.includes('Relevant saved facts about the user'));
});

test('Phase 4 selects recent conversation context plus relevant older turns', () => {
  assert.ok(app.includes('function selectRelevantHistory(history,query)'));
  assert.ok(app.includes('const recentStart=history.length-20'));
  assert.ok(app.includes('.slice(0,6)'));
  assert.ok(app.includes('selectRelevantHistory(S.msgs.map'));
});

test('Phase 4 application and API scripts both parse after context integration', () => {
  assert.doesNotThrow(() => new vm.Script(appJs));
  const result = spawnSync(process.execPath, ['--check', 'netlify/functions/api.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Phase 4 memory retrieval requires meaningful overlap and respects opt-out', () => {
  assert.ok(app.includes('S.user.settings?.useMemories===false'));
  assert.ok(app.includes('if(terms.length<2)return'));
  assert.ok(app.includes('.filter(x=>x.score>=2)'));
  assert.ok(app.includes('.slice(0,8)'));
  assert.ok(app.includes('.slice(0,3000)'));
});

test('Phase 4 long-context retrieval preserves adjacent user and assistant turns', () => {
  assert.ok(app.includes('function selectRelevantHistory(history,query)'));
  assert.ok(app.includes('const recentStart=history.length-20'));
  assert.ok(app.includes('Keep a relevant turn\'s adjacent partner'));
  assert.ok(app.includes('picked.add(i-1)'));
  assert.ok(app.includes('picked.add(i+1)'));
});

test('Phase 4 memory-use preference is persisted by the API', () => {
  assert.ok(api.includes("if (typeof body.useMemories === 'boolean') s.useMemories = body.useMemories;"));
});

test('Phase 4 smart model routing is scored and user preference persists', () => {
  assert.ok(app.includes('function routeModel(text)'));
  assert.ok(app.includes('score>=3?\'pro\':\'luna\''));
  assert.ok(app.includes("api('settings','PUT',{autoRoute:S.autoRoute})"));
  assert.ok(api.includes("if (typeof body.autoRoute === 'boolean') s.autoRoute = body.autoRoute;"));
});

test('Phase 4 selected context is bounded by a character budget', () => {
  assert.ok(app.includes('function fitContextBudget(history,maxChars=28000)'));
  assert.ok(app.includes('fitContextBudget(selectRelevantHistory'));
});

test('Phase 5 only performs legacy duplicate cleanup when the unique sync index is absent', () => {
  assert.ok(api.includes("select 1 from pg_indexes where schemaname=current_schema() and indexname='messages_id_user_unique'"));
  assert.ok(api.includes('if (!syncIndex)'));
  assert.ok(api.includes('create index if not exists messages_user_conv_seq'));
  assert.ok(api.includes('create index if not exists messages_user_seq'));
  assert.ok(api.includes('create index if not exists memories_user_created'));
});

test('sync is additive: only explicitly removed message ids are deleted, never "everything not in the batch"', () => {
  assert.ok(api.includes('removedRows'));
  assert.ok(api.includes('m.id = any(x.removed)'));
  assert.ok(!api.includes('not (m.id = any(x.keep))'));
  assert.ok(api.includes("A conversation can appear only once per sync batch"));
});

test('client sync chunks long chats and batches so every request fits the server limits', async () => {
  const start = appJs.indexOf('const SYNC_LIMITS'), end = appJs.indexOf('async function flushSync');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(appJs.slice(start, end) + ';this.SYNC_LIMITS=SYNC_LIMITS;this.buildSyncRounds=buildSyncRounds', ctx);
  const uuid = () => crypto.randomUUID();
  const mk = (n, len, synced = 0) => { const messages = Array.from({ length: n }, (_, i) => ({ id: uuid(), role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(len), attachments: [] })); return { id: uuid(), messages, syncedIds: messages.slice(0, synced).map(m => m.id), title: 't', _rev: 1, updated_at: new Date().toISOString() }; };
  const check = batch => { let mc = 0, chars = 0; const seen = new Set(); assert.ok(batch.length >= 1 && batch.length <= 50);
    for (const c of batch) { assert.ok(!seen.has(c.id)); seen.add(c.id); assert.ok(c.messages.length <= 100); for (const m of c.messages) { mc++; chars += m.content.length; } }
    assert.ok(mc <= 500 && chars <= 1000000 && JSON.stringify({ conversations: batch }).length < 6e6); };
  const cases = [[mk(250, 2000)], Array.from({ length: 10 }, () => mk(60, 2000)), Array.from({ length: 25 }, () => mk(90, 5000))];
  for (const recs of cases) {
    const reqs = ctx.buildSyncRounds(recs, ctx.SYNC_LIMITS.normal); reqs.forEach(check);
    const sent = new Map(); reqs.flat().forEach(i => sent.set(i.id, (sent.get(i.id) || 0) + i.messages.length));
    for (const r of recs) assert.equal(sent.get(r.id), r.messages.length);
  }
});

test('client reports locally removed messages explicitly and never re-sends already synced ones', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(appJs.slice(appJs.indexOf('const SYNC_LIMITS'), appJs.indexOf('async function flushSync')) + ';this.SYNC_LIMITS=SYNC_LIMITS;this.buildSyncRounds=buildSyncRounds', ctx);
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID()), ghost = crypto.randomUUID();
  const rec = { id: crypto.randomUUID(), title: 't', _rev: 1, updated_at: new Date().toISOString(), syncedIds: [ids[0], ids[1], ghost], messages: ids.map((id, i) => ({ id, role: i % 2 ? 'assistant' : 'user', content: 'c' })) };
  const [req] = ctx.buildSyncRounds([rec], ctx.SYNC_LIMITS.normal), item = req[0];
  assert.deepEqual(JSON.parse(JSON.stringify(item.removed)), [ghost]);
  assert.deepEqual(JSON.parse(JSON.stringify(item.messages.map(m => m.id))), [ids[2], ids[3]]);
});

test('closing or hiding the page flushes pending sync once with keepalive, throttled to protect database wake-ups', () => {
  assert.ok(appJs.includes("keepalive:!!opts.keepalive"));
  assert.ok(appJs.includes("flushSync({keepalive:true})"));
  assert.ok(appJs.includes("Date.now()-(LOCAL.lastFlush||0)>60000"));
  assert.ok(appJs.includes("document.addEventListener('visibilitychange'"));
  assert.ok(appJs.includes('LOCAL.timer=setTimeout(flushSync,300000)'));
});

test('Phase 5 export groups messages in one pass rather than filtering per conversation', () => {
  assert.ok(api.includes('const grouped = new Map(conversations.map(c => [c.id, []]))'));
  assert.ok(api.includes('for (const message of messages)'));
  assert.ok(!api.includes('messages.filter(x => x.conv_id === c.id)'));
});

test('Phase 5 conversation history uses bounded keyset pagination', () => {
  assert.ok(api.includes("url.searchParams.get('limit')"));
  assert.ok(api.includes('Math.min(100'));
  assert.ok(api.includes('nextCursor, hasMore'));
  assert.ok(api.includes('order by pinned desc, updated_at desc, id desc'));
  assert.ok(api.includes('(c.pinned,c.updated_at,c.id) <'));
});

test('Phase 5 chat sidebar supports loading additional pages and cancels stale searches', () => {
  assert.ok(app.includes('id="loadMoreChats"'));
  assert.ok(app.includes('async function loadList(reset=true)'));
  assert.ok(app.includes("$('#loadMoreChats').onclick"));
  assert.ok(app.includes('const request=++S.listRequest'));
  assert.ok(app.includes('if(request!==S.listRequest)return'));
});

test('Phase 5 IndexedDB migration indexes pending local changes', () => {
  assert.ok(app.includes("indexedDB.open(name,3)"));
  assert.ok(app.includes("deleteIndex('pendingSync')"));
  assert.ok(app.includes("function localDirtyAll()"));
  assert.ok(!app.includes('function localAll()'));
  assert.ok(app.includes("objectStore('conversations').getAll()"));
  assert.ok(app.includes("filter(c=>c&&c.pendingSync===true)"));
  assert.ok(!app.includes("getAll(true)"));
});

test('Phase 5 strips binary image data from cloud sync and restores generated images locally', () => {
  assert.ok(app.includes('map(({_imgs,dataUrl,gen,imageId,...a})=>imageId?{...a,gen:true,imageId}:a)'));
  assert.ok(app.includes('local.attachments?.[i]?.dataUrl?{...a,dataUrl:local.attachments[i].dataUrl}:a'));
  assert.ok(app.includes('_imgs:local._imgs||[]'));
});

test('Phase 6 responsive layout and accessible mobile navigation are present', () => {
  assert.ok(app.includes('@media(max-width:760px)'));
  assert.ok(app.includes('@media(prefers-reduced-motion:reduce)'));
  assert.ok(app.includes('id="sidebarBackdrop"'));
  assert.ok(app.includes('aria-expanded="false"'));
  assert.ok(app.includes('function setSidebar(open)'));
  assert.ok(app.includes('aria-label="Close navigation menu"'));
});

test('Phase 6 final polish covers readable messages, touch controls and composer accessibility', () => {
  assert.ok(app.includes('Phase 6 final polish'));
  assert.ok(app.includes('aria-label="Choose AI model"'));
  assert.ok(app.includes('aria-label="Message Lumo"'));
  assert.ok(app.includes('aria-label', app.indexOf("function busy(b)")));
  assert.ok(app.includes('@media(prefers-contrast:more)'));
  assert.ok(app.includes('.m.assistant .b table'));
  assert.ok(app.includes('#box:focus-within') || app.includes('.box:focus-within'));
});

test('Phase 7: every non-GET API request requires the app marker and verified origin', () => {
  assert.ok(api.includes("if (m !== 'GET')"));
  assert.ok(api.includes("req.headers.get('x-requested-with') !== 'app'"));
  assert.ok(api.includes('verifyRequestOrigin(req)'));
  assert.ok(api.includes("return E('Forbidden', 403)"));
});

test('Phase 7: private API routes authenticate before resolving user-scoped data', () => {
  const authGate = api.indexOf('const iu = await getUser()');
  const uid = api.indexOf('const uid = iu.id', authGate);
  const route = api.indexOf("if (a === 'sync' && m === 'POST')", uid);
  assert.ok(authGate >= 0 && uid > authGate && route > uid);
  assert.ok(api.includes('where user_id=${uid}'));
  assert.ok(api.includes('where id=${b} and user_id=${uid}'));
  assert.ok(api.includes('join conversations c on c.id=x.conv_id and c.user_id=${uid}'));
});

test('Phase 7: authenticated mutations and authentication attempts are rate-limited', () => {
  assert.ok(api.includes("limit('u' + uid, 240)"));
  assert.ok(api.includes("limit('a' + ip, 20)"));
  assert.ok(api.includes("return E('Too many requests', 429)"));
  assert.ok(api.includes("return E('Too many attempts, try again in a minute', 429)"));
});

test('Phase 7: sync batches and message attachments enforce bounded input sizes', () => {
  assert.ok(api.includes('incoming.length > 50'));
  assert.ok(api.includes('c.messages.length > 100'));
  assert.ok(api.includes('messageCount > 500'));
  assert.ok(api.includes('totalChars > 1000000'));
  assert.ok(api.includes('raw.length > 10'));
  assert.ok(api.includes('attachmentLimit(type, x.gen === true)'));
  assert.ok(api.includes('totalText > 180000'));
});

test('Phase 7: pagination cursor is validated and result size is capped', () => {
  assert.ok(api.includes("return E('Invalid pagination cursor')"));
  assert.ok(api.includes('Math.min(100'));
  assert.ok(api.includes('limit ${limitValue + 1}'));
  assert.ok(api.includes('nextCursor, hasMore'));
});

test('Phase 7: Netlify deployment config includes baseline security headers and CI runs tests', async () => {
  const config = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(config.includes('X-Content-Type-Options = "nosniff"'));
  assert.ok(config.includes('X-Frame-Options = "DENY"'));
  assert.ok(config.includes('Referrer-Policy = "strict-origin-when-cross-origin"'));
  assert.ok(workflow.includes('node-version: 20'));
  assert.ok(workflow.includes('run: npm test'));
  assert.ok(workflow.includes('feature/deep-research-artifact-voice'));
});

test('Phase 7: health diagnostics expose service status without returning secrets', () => {
  const start = api.indexOf('async function health(origin)');
  const end = api.indexOf('// Auth is delegated', start);
  const health = api.slice(start, end);
  assert.ok(health.includes('identity: await identityInfo(origin)'));
  assert.ok(health.includes('database: { ok: false }'));
  assert.ok(!/process\.env|password|secret|token/i.test(health));
});

test('video attachment metadata accepts the frontend 32 MiB ceiling in both API paths', () => {
  assert.ok(api.includes("type.startsWith('video/') ? 32 * 1024 * 1024"));
  assert.equal(api.split('attachmentLimit(type, x.gen === true)').length - 1, 2);
  assert.ok(api.includes("type.startsWith('audio/') ? 10 * 1024 * 1024"));
  assert.ok(api.includes("type.startsWith('image/') ? 5 * 1024 * 1024"));
});

test('memory retrieval expands related concepts locally without another AI request', () => {
  assert.ok(appJs.includes('const MEMORY_CONCEPTS=['));
  assert.ok(appJs.includes('function memoryStem(word)'));
  assert.ok(appJs.includes('const related=MEMORY_CONCEPTS.filter'));
  assert.ok(appJs.includes('function selectRelevantMemories(query)'));
  assert.ok(appJs.includes('S.user.settings?.useMemories===false'));
});

test('application styling and behavior are split into dedicated assets', () => {
  assert.ok(appHtml.includes('href="/app.css"'));
  assert.ok(appHtml.includes('src="/app.js"'));
  assert.ok(appCss.length > 1000);
  assert.ok(appJs.length > 1000);
});

test('local chats are stored per account and removed from the device on logout', () => {
  assert.ok(appJs.includes("'lumo-local-v2-'+S.user.id"));
  assert.ok(appJs.includes('async function migrateLegacyLocalDB()'));
  assert.ok(appJs.includes('await removeLocalDB();location.replace'));
  assert.ok(appJs.includes('Logging out removes them from this device'));
});

test('Artifact Studio saves through the local-first store, never directly to the server', () => {
  const start = appJs.indexOf("$('#artifactGenerate').onclick"), end = appJs.indexOf("$('#artifactDownload')");
  const block = appJs.slice(start, end);
  assert.ok(!block.includes("api('conversations"));
  assert.ok(block.includes('saveLocal('));
  assert.ok(block.includes('S.temporary'));
  assert.ok(block.includes('code.length>60000'));
});

test('regenerate and edit work in temporary chats (no lookup with a null conversation id)', () => {
  assert.ok(appJs.includes('function localGet(id){if(id==null)return Promise.resolve(null);'));
});

test('generated images are stored in Netlify Blobs (not the database), per user, with limits, cleanup and a download button', () => {
  assert.ok(api.includes("import { getStore } from '@netlify/blobs'"));
  assert.ok(api.includes('`${uid}/${b}`'));
  assert.ok(api.includes('MAX_IMAGES_PER_USER = 300'));
  assert.ok(api.includes('deleteAllImages(uid)'));
  assert.ok(api.includes('await deleteImages(uid, imageIdsOf(gone))'));
  assert.ok(!/x\.dataUrl/.test(api), 'the database must never receive image data');
  assert.ok(JSON.parse(pkgJson).dependencies['@netlify/blobs']);
  assert.ok(appJs.includes("api('images/'+imageId,'PUT'"));
  assert.ok(appJs.includes("'/api/images/'+a.imageId"));
  assert.ok(appJs.includes('Download image'));
  assert.ok(appJs.includes('only available on the device that created it'));
});

test('memory retrieval matches Hindi text and joins memories with real newlines', () => {
  const start = appJs.indexOf('const CONTEXT_STOP'), end = appJs.indexOf('function fitContextBudget');
  const ctx = { S: { user: { settings: {} }, mem: [{ text: 'मुझे गणित पसंद है' }, { text: 'prefers Python for coding projects' }, { text: 'likes coding in python daily' }] } };
  vm.createContext(ctx);
  vm.runInContext(appJs.slice(start, end) + ';this.contextTerms=contextTerms;this.selectRelevantMemories=selectRelevantMemories', ctx);
  assert.ok(ctx.contextTerms('मुझे गणित').length >= 2);
  const out = ctx.selectRelevantMemories('help me with python coding');
  assert.ok(out.includes('\n- ') && !out.includes('\\n'));
  assert.ok(ctx.selectRelevantMemories('मुझे गणित पसंद').includes('गणित'));
});

test('search also filters unsynced local chats, document OCR signs in first, streaming repaint is throttled, voice mode retries silence', async () => {
  assert.ok(appJs.includes("const ql=query.toLowerCase()"));
  assert.ok(appJs.includes("await ensurePuter();toast('Extracting '"));
  assert.ok(appJs.includes('now-lastPaint>100'));
  assert.ok(appJs.includes('VOICE.misses<3'));
  assert.ok(!(await readFile(new URL('../public/login.html', import.meta.url), 'utf8')).includes('GPT Image 2'));
});

test('Deep Research shows a clear message instead of failing when the Gemini video model is selected', () => {
  assert.ok(appJs.includes("if(S.model==='video')throw Error('Deep Research needs GPT-6 Luna or GPT-6 Luna Pro"));
  assert.ok(appJs.includes('Deep Research is on, but it needs GPT-6 Luna or Luna Pro'));
});


test('GPT Image Flare selector exposes only the two requested models and supported controls', () => {
  assert.ok(appHtml.includes('id="imageModel"'));
  assert.ok(appHtml.includes('value="gpt-image-2.5-flare"'));
  assert.ok(appHtml.includes('value="gpt-image-2.6-flare"'));
  assert.ok(!appHtml.includes('Nano Banana'));
  assert.ok(!appHtml.includes('gpt-image-2.5-sunburst'));
  for (const quality of ['low', 'medium', 'high', 'xhigh', 'max', 'auto']) assert.ok(appHtml.includes('value="' + quality + '"'));
  for (const size of ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '1152x2048', '3840x2160', '2160x3840']) assert.ok(appHtml.includes('value="' + size + '"'));
  assert.ok(appJs.includes("provider:'openai',model:S.imageModel,quality:S.imageQuality,width,height"));
  assert.ok(api.includes("['gpt-image-2.5-flare', 'gpt-image-2.6-flare'].includes(body.imageModel)"));
  assert.ok(api.includes("['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(body.imageQuality)"));
  assert.ok(api.includes('body.imageResolution'));
});
