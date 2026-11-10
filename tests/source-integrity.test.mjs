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
  const open = app.indexOf('<script>\nconst $=');
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

test('usage dashboard includes video model activity', () => {
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
  assert.ok(app.includes("$('#in').value=($('#in').value.trim()+' '+VOICE.finalTranscript.trim()).trim()"));
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
  const scriptOpen = app.indexOf('<script>\nconst $=');
  const scriptClose = app.indexOf('</script>', scriptOpen);
  assert.doesNotThrow(() => new vm.Script(app.slice(scriptOpen + 8, scriptClose)));
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

test('Phase 5 reconciles a sync batch with one set-based message deletion', () => {
  assert.ok(api.includes('const keepByConversation = new Map(convs.map(c => [c.id, []]))'));
  assert.ok(api.includes('jsonb_to_recordset(${JSON.stringify(keepRows)}::jsonb) as x(id uuid, keep uuid[])'));
  assert.ok(!api.includes('for (const c of convs) {\n        const keep = messages.filter'));
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
  assert.ok(app.includes("indexedDB.open('lumo-local-v1',2)"));
  assert.ok(app.includes("createIndex('pendingSync','pendingSync'"));
  assert.ok(app.includes("function localDirtyAll()"));
  assert.ok(!app.includes('function localAll()'));
  assert.ok(app.includes("index('pendingSync').getAll(true)"));
});
