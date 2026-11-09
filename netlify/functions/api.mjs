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

// Auth is delegated to Netlify Identity (sessions are its nf_jwt / nf_refresh cookies).
async function auth(act, m, b, ip) {
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
    try { await signup(email, pw); } catch { return E('Could not create account with these details'); }
    try { return J({ user: await pub(await login(email, pw)) }); } catch { return J({ confirm: true }); } // login fails until the email is confirmed
  }
  if (act === 'login') { try { return J({ user: await pub(await login(email, pw)) }); } catch { return E('Incorrect email or password', 401); } }
  return E('Not found', 404);
}

export default async (req) => {
  const m = req.method, url = new URL(req.url);
  const [a, b, c] = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  if (m !== 'GET') { if (req.headers.get('x-requested-with') !== 'app') return E('Forbidden', 403); try { verifyRequestOrigin(req); } catch { return E('Forbidden', 403); } }
  let body = {};
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') { try { body = await req.json(); } catch { return E('Invalid JSON'); } }
  try {
    await init();
    if (a === 'auth') return await auth(b, m, body, req.headers.get('x-nf-client-connection-ip') || 'x');
    const iu = await getUser();
    if (!iu) return E('Unauthorized', 401);
    const uid = iu.id;
    if (!(await limit('u' + uid, 240))) return E('Too many requests', 429);
    if (b && !UUID.test(b)) return E('Bad id');

    if (a === 'settings' && m === 'PUT') {
      const s = {};
      if (['light', 'dark'].includes(body.theme)) s.theme = body.theme;
      if (typeof body.instructions === 'string') s.instructions = clean(body.instructions, 2000);
      if (typeof body.autoMemory === 'boolean') s.autoMemory = body.autoMemory;
      if (['luna', 'pro', 'dalle'].includes(body.model)) s.model = body.model;
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
      if (!b && m === 'POST') { const [r] = await sql`insert into conversations(user_id,model,title) values(${uid},${['luna','pro','dalle'].includes(body.model) ? body.model : 'luna'},${clean(body.title || 'New chat', 80)}) returning id,title,model,pinned,updated_at`; return J({ conversation: r }); }
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
        const att = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 10).map(x => ({ name: clean(x.name, 200), type: clean(x.type, 100), size: +x.size || 0, text: x.text ? clean(x.text, 60000) : undefined, gen: x.gen ? true : undefined, dataUrl: x.gen && /^data:image\//.test(x.dataUrl || '') ? clean(x.dataUrl, 8e6) : undefined }));
        const [r] = await sql`insert into messages(conv_id,user_id,role,content,model,attachments) values(${b},${uid},${body.role},${clean(body.content, 200000)},${clean(body.model, 20) || null},${JSON.stringify(att)}::jsonb) returning id,role,content,model,attachments,created_at`;
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
