import { getDatabase } from '@netlify/database';
import { getUser, login, signup, logout, requestPasswordRecovery, recoverPassword, verifyRequestOrigin } from '@netlify/identity';

export const config = { path: '/api/*' };
const db = getDatabase(); // connection is provisioned/selected by Netlify
const sql = (...a) => db.sql(...a);
const J = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const E = (m, s = 400) => J({ error: m }, s);
const UUID = /^[0-9a-f-]{36}$/i;
const clean = (v, n) => String(v ?? '').slice(0, n);

// user_id = Netlify Identity user id. All data tables are keyed by it and every query filters on it.
let ready;
const init = () => ready ??= (async () => {
  await sql`create table if not exists profiles(user_id uuid primary key, settings jsonb not null default '{}')`;
  await sql`create table if not exists conversations(id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null default 'New chat', model text not null default 'luna', pinned boolean not null default false, updated_at timestamptz not null default now())`;
  await sql`create index if not exists conv_user on conversations(user_id, updated_at desc)`;
  await sql`create table if not exists messages(seq bigserial primary key, id uuid not null default gen_random_uuid(), conv_id uuid not null references conversations(id) on delete cascade, user_id uuid not null, role text not null check (role in ('user','assistant')), content text not null, model text, attachments jsonb not null default '[]', created_at timestamptz not null default now())`;
  await sql`create index if not exists msg_conv on messages(conv_id, seq)`;
  await sql`create table if not exists memories(id uuid primary key default gen_random_uuid(), user_id uuid not null, text text not null, created_at timestamptz not null default now())`;
  await sql`create table if not exists hits(k text not null, w bigint not null, n int not null default 0, primary key(k, w))`;
})();

async function limit(key, max) {
  const w = Math.floor(Date.now() / 60000);
  const [r] = await sql`insert into hits(k,w,n) values(${key},${w},1) on conflict(k,w) do update set n=hits.n+1 returning n`;
  if (Math.random() < 0.02) await sql`delete from hits where w < ${w - 10}`;
  return r.n <= max;
}
const pub = async u => { const [p] = await sql`select settings from profiles where user_id=${u.id}`; return { id: u.id, email: u.email, settings: p?.settings || {} }; };

// ---- Identity diagnostics: never guess why Identity failed, ask the Identity endpoint itself.
const idErr = e => ({ status: Number(e?.status ?? e?.statusCode) || 0, msg: String(e?.message ?? e).toLowerCase() });
const IDENTITY_DOWN = 'Netlify Identity is not enabled for this site (or is unreachable). Enable it in Project configuration → Identity, then redeploy. Check /api/health for details.';
async function identityInfo(origin) {
  try {
    const r = await fetch(origin + '/.netlify/identity/settings', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ok: false, status: r.status };
    const s = await r.json().catch(() => ({}));
    return { ok: true, status: r.status, autoconfirm: !!s.autoconfirm, signupDisabled: !!s.disable_signup };
  } catch { return { ok: false, status: 0 }; }
}
async function health(origin) {
  const out = { identity: await identityInfo(origin), database: { ok: false } };
  try { await sql`select 1`; out.database.ok = true; } catch (e) { console.error('health: database', e); }
  out.ok = out.identity.ok && out.database.ok && !out.identity.signupDisabled;
  return J(out, out.ok ? 200 : 503);
}

// Auth is delegated to Netlify Identity (sessions are its nf_jwt / nf_refresh cookies).
async function auth(act, m, b, ip, origin) {
  if (act === 'me' && m === 'GET') { const u = await getUser(); return J({ user: u ? await pub(u) : null }); }
  if (m !== 'POST') return E('Not found', 404);
  if (act === 'logout') { await logout(); return J({ ok: true }); }
  if (!(await limit('a' + ip, 20))) return E('Too many attempts, try again in a minute', 429);
  const email = clean(b.email, 254).trim().toLowerCase(), pw = clean(b.password, 128);
  if (act === 'forgot') { if (email) await requestPasswordRecovery(email).catch(() => {}); return J({ ok: true }); } // Identity sends the email
  if (act === 'reset') {
    if (pw.length < 8) return E('Password must be at least 8 characters');
    try { const u = await recoverPassword(clean(b.token, 500), pw); return J({ user: await pub(u) }); } catch { return E('Reset link is invalid or expired'); }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return E('Enter a valid email');
  if (act === 'signup') {
    if (pw.length < 8) return E('Password must be at least 8 characters');
    try { await signup(email, pw); } catch (e) {
      const { status, msg } = idErr(e); console.error('identity signup failed', status, msg);
      const info = await identityInfo(origin);
      if (!info.ok) return E(IDENTITY_DOWN, 503);
      if (info.signupDisabled) return E('Sign-ups are closed. Set registration to Open in Identity settings.', 403);
      if (status === 422 || /already|registered|exists|taken/.test(msg)) return E('An account with this email already exists. Try logging in.', 409);
      return E('Could not create account: ' + clean(e?.message, 160), 400);
    }
    try { return J({ user: await pub(await login(email, pw)) }); }
    catch (e) {
      const { status, msg } = idErr(e); console.error('login after signup failed', status, msg);
      if (/confirm/.test(msg) || !(await identityInfo(origin)).autoconfirm) return J({ confirm: true }); // needs the email confirmation first
      return E('Account created, but signing in failed. Try logging in.', 500);
    }
  }
  if (act === 'login') {
    try { return J({ user: await pub(await login(email, pw)) }); }
    catch (e) {
      const { status, msg } = idErr(e); console.error('identity login failed', status, msg);
      if (/confirm/.test(msg)) return E('Please confirm your email first (check your inbox), or enable autoconfirm in Identity settings.', 403);
      if (status === 400 || status === 422 || /invalid|incorrect|no user/.test(msg)) return E('Incorrect email or password', 401);
      if (!(await identityInfo(origin)).ok) return E(IDENTITY_DOWN, 503);
      return E('Incorrect email or password', 401);
    }
  }
  return E('Not found', 404);
}

export default async (req) => {
  const m = req.method, url = new URL(req.url);
  const [a, b, c] = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  if (m !== 'GET') { if (req.headers.get('x-requested-with') !== 'app') return E('Forbidden', 403); try { verifyRequestOrigin(req); } catch { return E('Forbidden', 403); } }
  if (a === 'health' && m === 'GET') return health(url.origin);
  let body = {};
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') { try { body = await req.json(); } catch { return E('Invalid JSON'); } }
  try {
    await init();
    if (a === 'auth') return await auth(b, m, body, req.headers.get('x-nf-client-connection-ip') || 'x', url.origin);
    const iu = await getUser();
    if (!iu) return E('Unauthorized', 401);
    const uid = iu.id;
    if (!(await limit('u' + uid, 240))) return E('Too many requests', 429);

    if (a === 'sync' && m === 'POST') {
      const incoming = Array.isArray(body.conversations) ? body.conversations : [];
      if (!incoming.length || incoming.length > 50) return E('A sync batch must contain 1–50 conversations');
      let messageCount = 0, totalChars = 0;
      const convs = [], messages = [];
      for (const c of incoming) {
        if (!c || !UUID.test(c.id || '') || typeof c.title !== 'string' || !Array.isArray(c.messages) || c.messages.length > 100) return E('Invalid conversation in sync batch');
        convs.push({ id: c.id, title: clean(c.title, 80) || 'New chat', model: ['luna','pro','image'].includes(c.model) ? c.model : 'luna', pinned: !!c.pinned, updated_at: c.updated_at || new Date().toISOString() });
        for (const msg of c.messages) {
          messageCount++;
          if (!msg || !UUID.test(msg.id || '') || !['user','assistant'].includes(msg.role) || typeof msg.content !== 'string' || msg.content.length > 100000) return E('Invalid message in sync batch');
          totalChars += msg.content.length;
          if (totalChars > 1000000 || messageCount > 500) return E('Sync batch exceeds its size limit');
          const raw = Array.isArray(msg.attachments) ? msg.attachments : [];
          if (raw.length > 10) return E('A message can contain at most 10 attachments');
          let totalText = 0; const att = [];
          for (const x of raw) {
            if (!x || typeof x !== 'object') return E('Invalid attachment');
            const name = clean(x.name, 200), type = clean(x.type, 100), size = Number(x.size) || 0;
            if (!name || size < 0 || size > 10 * 1024 * 1024) return E('Invalid attachment name or size');
            const item = { name, type, size };
            if (typeof x.text === 'string') { if (x.text.length > 60000) return E('Attachment text too long'); totalText += x.text.length; if (totalText > 180000) return E('Combined attachment text too long'); item.text = x.text; }
            if (x.gen === true) { if (typeof x.dataUrl !== 'string' || x.dataUrl.length > 8 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,/i.test(x.dataUrl)) return E('Invalid generated image attachment'); item.gen = true; item.dataUrl = x.dataUrl; }
            att.push(item);
          }
          messages.push({ id: msg.id, conv_id: c.id, role: msg.role, content: msg.content, model: clean(msg.model, 20) || null, attachments: att, created_at: msg.created_at || new Date().toISOString() });
        }
      }
      await sql`insert into conversations(id,user_id,model,title,pinned,updated_at)
        select x.id,x.user_id,x.model,x.title,x.pinned,x.updated_at from jsonb_to_recordset(${JSON.stringify(convs.map(c => ({...c,user_id:uid})))}::jsonb) as x(id uuid,user_id uuid,model text,title text,pinned boolean,updated_at timestamptz)
        on conflict(id) do update set title=excluded.title,model=excluded.model,pinned=excluded.pinned,updated_at=greatest(conversations.updated_at,excluded.updated_at) where conversations.user_id=excluded.user_id`;
      for (const c of convs) {
        const keep = messages.filter(m => m.conv_id === c.id).map(m => m.id);
        if (keep.length) await sql`delete from messages where conv_id=${c.id} and user_id=${uid} and not (id = any(${keep}::uuid[]))`;
        else await sql`delete from messages where conv_id=${c.id} and user_id=${uid}`;
      }
      if (messages.length) await sql`insert into messages(id,conv_id,user_id,role,content,model,attachments,created_at)
        select x.id,x.conv_id,${uid},x.role,x.content,x.model,x.attachments,x.created_at
        from jsonb_to_recordset(${JSON.stringify(messages)}::jsonb) as x(id uuid,conv_id uuid,role text,content text,model text,attachments jsonb,created_at timestamptz)
        join conversations c on c.id=x.conv_id and c.user_id=${uid}
        on conflict(id) do nothing`;
      return J({ ok: true, conversations: convs.length, messages: messages.length });
    }
    if (a === 'stats' && m === 'GET') {
      const [s] = await sql`select (select count(*)::int from conversations where user_id=${uid}) chats, (select count(*)::int from messages where user_id=${uid}) messages, (select count(*)::int from memories where user_id=${uid}) memories`;
      return J({ stats: s });
    }
    if (a === 'export' && m === 'GET') {
      const conversations = await sql`select id,title,model,pinned,updated_at from conversations where user_id=${uid} order by updated_at desc`;
      const messages = await sql`select conv_id,role,content,model,created_at from messages where user_id=${uid} order by seq`;
      const memories = await sql`select text,created_at from memories where user_id=${uid} order by created_at`;
      const [p] = await sql`select settings from profiles where user_id=${uid}`;
      const out = conversations.map(c => ({ ...c, messages: messages.filter(x => x.conv_id === c.id).map(({ conv_id, ...r }) => r) }));
      return J({ exported_at: new Date().toISOString(), email: iu.email, settings: p?.settings || {}, memories, conversations: out }, 200, { 'content-disposition': 'attachment; filename="lumo-export.json"' });
    }
    if (a === 'data' && m === 'DELETE') { // wipes this user's chats, memories and settings (the Identity login itself stays)
      await sql`delete from conversations where user_id=${uid}`; await sql`delete from memories where user_id=${uid}`; await sql`delete from profiles where user_id=${uid}`;
      return J({ ok: true });
    }
    if (b && !UUID.test(b)) return E('Bad id');

    if (a === 'settings' && m === 'PUT') {
      const s = {};
      if (['light', 'dark'].includes(body.theme)) s.theme = body.theme;
      if (typeof body.instructions === 'string') s.instructions = clean(body.instructions, 2000);
      if (typeof body.autoMemory === 'boolean') s.autoMemory = body.autoMemory;
      if (['luna', 'pro', 'image'].includes(body.model)) s.model = body.model;
      if (['1K', '2K', '4K'].includes(body.imageQuality)) s.imageQuality = body.imageQuality;
      const [u] = await sql`insert into profiles(user_id,settings) values(${uid},${JSON.stringify(s)}::jsonb) on conflict(user_id) do update set settings = profiles.settings || ${JSON.stringify(s)}::jsonb returning settings`;
      return J({ settings: u.settings });
    }
    if (a === 'memories') {
      if (m === 'GET') return J({ memories: await sql`select id,text,created_at from memories where user_id=${uid} order by created_at desc` });
      if (m === 'POST') {
        const t = clean(body.text, 500).trim(); if (!t) return E('Empty memory');
        const [n] = await sql`select count(*)::int n from memories where user_id=${uid}`; if (n.n >= 200) return E('Memory limit reached (200)');
        const [r] = await sql`insert into memories(user_id,text) values(${uid},${t}) returning id,text,created_at`; return J({ memory: r });
      }
      if (m === 'DELETE') { b ? await sql`delete from memories where id=${b} and user_id=${uid}` : await sql`delete from memories where user_id=${uid}`; return J({ ok: true }); }
    }
    if (a === 'conversations') {
      if (!b && m === 'GET') {
        const q = '%' + clean(url.searchParams.get('q'), 100).replace(/[%_\\]/g, '\\$&') + '%';
        return J({ conversations: await sql`select id,title,model,pinned,updated_at from conversations c where user_id=${uid} and (title ilike ${q} or exists(select 1 from messages m where m.conv_id=c.id and m.content ilike ${q})) order by pinned desc, updated_at desc limit 200` });
      }
      if (!b && m === 'POST') { const [r] = await sql`insert into conversations(user_id,model,title) values(${uid},${['luna','pro','image'].includes(body.model) ? body.model : 'luna'},${clean(body.title || 'New chat', 80)}) returning id,title,model,pinned,updated_at`; return J({ conversation: r }); }
      const [own] = await sql`select id from conversations where id=${b} and user_id=${uid}`;
      if (!own) return E('Not found', 404);
      if (!c && m === 'GET') return J({ messages: await sql`select id,role,content,model,attachments,created_at from messages where conv_id=${b} and user_id=${uid} order by seq` });
      if (!c && m === 'PATCH') {
        if (typeof body.title === 'string') await sql`update conversations set title=${clean(body.title, 80).trim() || 'New chat'} where id=${b} and user_id=${uid}`;
        if (typeof body.pinned === 'boolean') await sql`update conversations set pinned=${body.pinned} where id=${b} and user_id=${uid}`;
        return J({ ok: true });
      }
      if (!c && m === 'DELETE') { await sql`delete from conversations where id=${b} and user_id=${uid}`; return J({ ok: true }); }
      if (c === 'messages' && m === 'POST') {
        if (!['user', 'assistant'].includes(body.role)) return E('Bad role');
        if (typeof body.content !== 'string' || body.content.length > 100000) return E('Message is too long (100,000 character limit)');
        const raw = Array.isArray(body.attachments) ? body.attachments : [];
        if (raw.length > 10) return E('A message can contain at most 10 attachments');
        let totalText = 0;
        const att = [];
        for (const x of raw) {
          if (!x || typeof x !== 'object') return E('Invalid attachment');
          const name = clean(x.name, 200), type = clean(x.type, 100), size = Number(x.size) || 0;
          if (!name || size < 0 || size > 10 * 1024 * 1024) return E('Invalid attachment name or size (10 MB maximum per file)');
          const item = { name, type, size };
          if (typeof x.text === 'string') {
            if (x.text.length > 60000) return E('Extracted attachment text exceeds 60,000 characters');
            totalText += x.text.length;
            if (totalText > 180000) return E('Combined attachment text exceeds 180,000 characters');
            item.text = x.text;
          }
          if (x.gen === true) {
            if (typeof x.dataUrl !== 'string' || x.dataUrl.length > 8 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,/i.test(x.dataUrl)) return E('Invalid generated image attachment');
            item.gen = true; item.dataUrl = x.dataUrl;
          }
          att.push(item);
        }
        const [r] = await sql`insert into messages(conv_id,user_id,role,content,model,attachments) values(${b},${uid},${body.role},${body.content},${clean(body.model, 20) || null},${JSON.stringify(att)}::jsonb) returning id,role,content,model,attachments,created_at`;
        await sql`update conversations set updated_at=now() where id=${b}`;
        return J({ message: r });
      }
      if (c === 'messages' && m === 'DELETE') {
        const f = url.searchParams.get('from'); if (!UUID.test(f || '')) return E('Bad id');
        await sql`delete from messages where conv_id=${b} and user_id=${uid} and seq >= (select seq from messages where id=${f} and conv_id=${b} and user_id=${uid})`;
        return J({ ok: true });
      }
    }
    return E('Not found', 404);
  } catch (e) { console.error(e); return E('Server error', 500); }
};
