// Cloudflare Worker — Clowo lock server + bot control
// Env secrets: GH_PAT (GitHub PAT, can truy cap repo + workflow), ADMIN_KEY (khoá dự phòng, tuỳ chọn)
// KV binding: LOCKS
const GH = 'https://api.github.com/repos/minhtu446/discord-bot';
const ADMIN_ID = '1464884102238048307';
const ALLOWED_ORIGINS = ['https://minhtu446.github.io'];
const CORS_BASE = {
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-admin-key',
  'access-control-max-age': '86400'
};

function corsHeaders(request) {
  const h = { ...CORS_BASE };
  const o = request.headers.get('origin') || '';
  if (ALLOWED_ORIGINS.includes(o)) {
    h['access-control-allow-origin'] = o;
    h['vary'] = 'Origin';
  }
  return h;
}

// Chặn request đến từ website khác (kể cả khi trình duyệt không chặn CORS)
function originBlocked(request) {
  const o = request.headers.get('origin');
  return !!o && !ALLOWED_ORIGINS.includes(o);
}

function json(data, status = 200, request) {
  const headers = { 'content-type': 'application/json' };
  if (request) Object.assign(headers, corsHeaders(request));
  return new Response(JSON.stringify(data), { status, headers });
}

async function discordUid(token) {
  if (!token) return null;
  const t = String(token).replace(/^Bearer\s+/i, '').trim();
  if (!t) return null;
  try {
    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': 'Bearer ' + t }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  } catch { return null; }
}

async function getUser(env, uid) {
  try {
    const raw = await env.LOCKS.get('user:' + uid);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

async function isBanned(env, uid) {
  const u = await getUser(env, uid);
  return !!(u && u.banned);
}

async function isAdminPerson(env, uid) {
  const u = await getUser(env, uid);
  if (u && u.banned) return false;
  if (u && u.rank === 'admin') return true;
  return uid === (env.ADMIN_ID || ADMIN_ID);
}

function ownerUid(env) { return env.ADMIN_ID || ADMIN_ID; }

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) {
    diff |= (ea[i % ea.length] || 0) ^ (eb[i % eb.length] || 0);
  }
  return diff === 0;
}

function adminKeyOk(request, env) {
  if (!env.ADMIN_KEY) return false;
  return timingSafeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_KEY);
}

// Quyền quản lý quyền: khoá dự phòng HOẶC token admin
async function canManagePerms(request, env) {
  const keyOk = adminKeyOk(request, env);
  if (keyOk) return { keyOk, uid: null, isRoot: true };
  const uid = await discordUid(request.headers.get('authorization'));
  if (!uid) return { keyOk: false, uid: null, isRoot: false, noToken: true };
  if (!(await isAdminPerson(env, uid))) return { keyOk: false, uid, isRoot: false, notAdmin: true };
  return { keyOk: false, uid, isRoot: uid === ownerUid(env) };
}

const MAX_BODY = 2048;
const RATE = new Map();

function rateLimited(key, max, win) {
  const now = Date.now();
  let arr = RATE.get(key);
  if (!arr) { arr = []; RATE.set(key, arr); }
  while (arr.length && now - arr[0] > win) arr.shift();
  if (arr.length >= max) return true;
  arr.push(now);
  return false;
}

function clientIp(request) {
  const raw = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '';
  return (raw || 'unknown').split(',')[0].trim() || 'unknown';
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new Error('LARGE');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('LARGE');
  return JSON.parse(text);
}

async function ghFetch(env, path, opts = {}) {
  return fetch(GH + path, {
    ...opts,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + env.GH_PAT,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {})
    }
  });
}

// Nhật ký thay đổi quyền (giữ 50 dòng mới) để phát hiện lạm dụng
async function audit(env, entry) {
  try {
    const e = { at: Date.now(), ...entry };
    const key = 'audit:' + String(e.at).padStart(14, '0') + ':' + Math.random().toString(36).slice(2, 8);
    await env.LOCKS.put(key, JSON.stringify(e));
    const r = await env.LOCKS.list({ prefix: 'audit:', limit: 60 });
    const keys = (r.keys || []).map(k => k.name);
    for (const k of keys.slice(50)) await env.LOCKS.delete(k);
  } catch {}
}

async function allLocks(env) {
  try {
    const v = await env.LOCKS.get('locks_index');
    return v ? JSON.parse(v) : {};
  } catch { return {}; }
}

async function locksRead(env) {
  try {
    const v = await env.LOCKS.get('locks_index');
    return v ? JSON.parse(v) : {};
  } catch { return {}; }
}

async function locksWrite(env, fn) {
  const idx = await locksRead(env);
  const next = fn(idx);
  await env.LOCKS.put('locks_index', JSON.stringify(next || {}));
}

async function getVar(env, name) {
  const r = await ghFetch(env, '/actions/variables/' + name);
  if (!r.ok) return null;
  const d = await r.json();
  return d.value;
}

async function setVar(env, name, value) {
  let r = await ghFetch(env, '/actions/variables/' + name, {
    method: 'PATCH',
    body: JSON.stringify({ name, value })
  });
  if (r.status === 404) {
    r = await ghFetch(env, '/actions/variables', {
      method: 'POST',
      body: JSON.stringify({ name, value })
    });
  }
  return r.status === 200 || r.status === 201 || r.status === 204;
}

async function botStatus(env) {
  const ran = await ghFetch(env, '/actions/workflows/bot-runner.yml/runs?per_page=5');
  let running = false, runId = null;
  if (ran.ok) {
    const d = await ran.json();
    const latest = (d.workflow_runs || [])[0];
    running = !!(latest && latest.status === 'in_progress');
    runId = running ? latest.id : null;
  }
  const stopped = (await getVar(env, 'BOT_STOP')) === '1';
  return { running, runId, stopped };
}

async function doControl(env, action) {
  if (action === 'stop') {
    await setVar(env, 'BOT_STOP', '1');
    const st = await botStatus(env);
    if (st.runId) {
      const cr = await ghFetch(env, '/actions/runs/' + st.runId + '/cancel', { method: 'POST' });
      if (cr.ok || cr.status === 409) return { ok: true, message: 'Đã khóa + tắt bot!' };
      return { ok: true, message: 'Đã khóa — run hiện tại sẽ tự dừng.' };
    }
    return { ok: true, message: 'Bot đang tắt — đã kích hoạt khóa (cron sẽ không tự bật).' };
  }
  await setVar(env, 'BOT_STOP', '0');
  const st = await botStatus(env);
  if (action === 'restart' && st.runId) {
    await ghFetch(env, '/actions/runs/' + st.runId + '/cancel', { method: 'POST' });
    await new Promise(r => setTimeout(r, 5000));
  }
  const disp = await ghFetch(env, '/actions/workflows/bot-runner.yml/dispatches', {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { action: 'start' } })
  });
  if (disp.ok || disp.status === 204) {
    return { ok: true, message: action === 'restart' ? 'Đã restart! Đang khởi động...' : 'Đã gửi lệnh bật bot! Đang khởi động...' };
  }
  return { ok: false, error: 'Lỗi khi gửi lệnh bật bot (HTTP ' + disp.status + ')' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (originBlocked(request)) return json({ error: 'Origin không được phép.' }, 403, request);

    const ip = clientIp(request);

    if (path === '/locks' && request.method === 'GET') {
      if (rateLimited('g:'+ip, 120, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const uid = await discordUid(request.headers.get('authorization'));
      if (!uid) return json({ error: 'Cần đăng nhập Discord để xem danh sách khóa server.' }, 401, request);
      if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
      const all = await allLocks(env);
      const locks = {};
      for (const gid in all) {
        const e = all[gid];
        if (!e) continue;
        // Chỉ trả uid của chính người gọi — không lộ ai đang giữ khoá
        locks[gid] = { uid: e.uid === uid ? uid : '', at: e.at || 0 };
      }
      return json({ locks }, 200, request);
    }

    if (path === '/lock' && request.method === 'POST') {
      if (rateLimited('p:' + ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJson(request);
        const uid = await discordUid(body.discordToken);
        if (!uid) return json({ error: 'Token Discord hết hạn hoặc sai - đăng nhập lại tài khoản này.' }, 401, request);
        if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
        const gid = String(body.guildId || '');
        if (!gid) return json({ error: 'Thiếu guildId.' }, 400, request);
        const existing = await env.LOCKS.get('lock:' + gid);
        if (existing) {
          const e = JSON.parse(existing);
          if (e.uid === uid) {
            await locksWrite(env, idx => { if (!idx[gid]) idx[gid] = { uid, at: Date.now() }; return idx; });
            return json({ ok: true, lockedBy: uid }, 200, request);
          }
          return json({ error: 'Server này đang được người khác quản lý.' }, 409, request);
        }
        await env.LOCKS.put('lock:' + gid, JSON.stringify({ uid, at: Date.now() }));
        await locksWrite(env, idx => { idx[gid] = idx[gid] ? idx[gid] : { uid, at: Date.now() }; return idx; });
        return json({ ok: true, lockedBy: uid }, 200, request);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/unlock' && request.method === 'POST') {
      if (rateLimited('p:' + ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJson(request);
        const uid = await discordUid(body.discordToken);
        if (!uid) return json({ error: 'Token Discord hết hạn hoặc sai - đăng nhập lại tài khoản này.' }, 401, request);
        if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
        const gid = String(body.guildId || '');
        const existing = await env.LOCKS.get('lock:' + gid);
        if (!existing) return json({ ok: true }, 200, request);
        const e = JSON.parse(existing);
        if (e.uid !== uid) return json({ error: 'Chỉ người đã khóa server này mới mở khóa được.' }, 403, request);
        await env.LOCKS.delete('lock:' + gid);
        await locksWrite(env, idx => { delete idx[gid]; return idx; });
        return json({ ok: true }, 200, request);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/status' && request.method === 'GET') {
      const uid = await discordUid(request.headers.get('authorization'));
      if (!(await isAdminPerson(env, uid))) return json({ error: 'Forbidden' }, 403, request);
      return json(await botStatus(env), 200, request);
    }

    if (path === '/admin/whoami' && request.method === 'GET') {
      if (rateLimited('g:'+ip, 120, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const uid = await discordUid(request.headers.get('authorization'));
      if (!uid) return json({ uid: null, isAdmin: false, banned: false }, 200, request);
      return json({ uid, isAdmin: await isAdminPerson(env, uid), banned: await isBanned(env, uid) }, 200, request);
    }

    if (path === '/admin/ranks' && request.method === 'GET') {
      if (rateLimited('g:' + ip, 60, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const gate = await canManagePerms(request, env);
      if (gate.noToken) return json({ error: 'Token Discord hết hạn hoặc sai — hoặc dán khoá dự phòng (ADMIN_KEY).' }, 401, request);
      if (gate.notAdmin) return json({ error: 'Chỉ admin.' }, 403, request);
      if (rateLimited('r:' + (gate.uid || 'key') + ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const users = [];
      let cursor;
      do {
        const r = await env.LOCKS.list({ prefix: 'user:', cursor });
        for (const k of (r.keys || [])) {
          const raw = await env.LOCKS.get(k.name);
          if (!raw) continue;
          let d;
          try { d = JSON.parse(raw); } catch { continue; }
          if (!d.rank) continue;
          users.push({
            uid: k.name.slice(5),
            rank: d.rank || 'member',
            banned: !!d.banned,
            at: d.at || 0,
            by: d.by || ''
          });
        }
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      users.sort((a, b) => (b.at || 0) - (a.at || 0));
      return json({ ownerUid: ownerUid(env), users, viaKey: !!gate.keyOk }, 200, request);
    }

    if (path === '/admin/rank' && request.method === 'POST') {
      if (rateLimited('p:' + ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJson(request);
        const gate = await canManagePerms(request, env);
        if (gate.noToken) return json({ error: 'Token Discord hết hạn hoặc sai — hoặc dán khoá dự phòng (ADMIN_KEY).' }, 401, request);
        if (gate.notAdmin) return json({ error: 'Chỉ admin.' }, 403, request);
        const actor = gate.uid || 'key';
        const target = String(body.target || '');
        if (!/^\d{15,20}$/.test(target)) return json({ error: 'Sai User ID.' }, 400, request);
        const root = ownerUid(env);
        const wantsBan = body.rank === 'danger' || body.banned === true;
        if (wantsBan && target === root) return json({ error: 'Không thể khóa tài khoản ADMIN gốc.' }, 400, request);
        if (wantsBan && gate.uid && target === gate.uid) return json({ error: 'Không thể tự khóa chính mình.' }, 400, request);
        // Không khoá được tài khoản đang là ADMIN (trừ ADMIN gốc và khoá dự phòng) — hạ quyền thay vì khoá
        if (wantsBan && target !== root && !gate.isRoot && (await isAdminPerson(env, target))) {
          return json({ error: 'Tài khoản này đang là ADMIN — hạ về Member thay vì khoá.' }, 400, request);
        }
        if (body.rank === 'none') {
          await env.LOCKS.delete('user:' + target);
          await audit(env, { act: 'revoke', target, by: actor, via: gate.keyOk ? 'key' : 'token' });
          return json({ ok: true, user: null, removed: true }, 200, request);
        }
        const cur = (await getUser(env, target)) || {};
        if (body.rank === 'admin') { cur.rank = 'admin'; cur.banned = false; }
        else if (body.rank === 'member') { cur.rank = 'member'; cur.banned = false; }
        else if (body.rank === 'danger') { cur.rank = 'danger'; cur.banned = true; }
        else if (body.rank != null) return json({ error: 'Rank không hợp lệ.' }, 400, request);
        if (typeof body.banned === 'boolean') cur.banned = body.banned;
        cur.at = Date.now();
        cur.by = actor;
        await env.LOCKS.put('user:' + target, JSON.stringify(cur));
        await audit(env, { act: 'rank:' + (cur.rank || 'member') + (cur.banned ? '+ban' : ''), target, by: actor, via: gate.keyOk ? 'key' : 'token' });
        return json({ ok: true, user: cur }, 200, request);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/control' && request.method === 'POST') {
      if (rateLimited('p:'+ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJson(request);
        // Khoá dự phòng KHÔNG được phép điều khiển bot — chỉ token Discord admin
        const uid = await discordUid(body.discordToken);
        if (!uid) return json({ error: 'Khoá dự phòng không điều khiển được bot — cần token Discord ADMIN.' }, 401, request);
        if (!(await isAdminPerson(env, uid))) return json({ error: 'Chỉ admin được điều khiển bot.' }, 403, request);
        const gid = String(body.guildId || '');
        const existing = await env.LOCKS.get('lock:' + gid);
        if (!existing) return json({ error: 'Bạn chưa quản lý server này — hãy khóa server trước.' }, 403, request);
        const e = JSON.parse(existing);
        if (e.uid !== uid) return json({ error: 'Chỉ người đang khóa server này mới điều khiển được bot.' }, 403, request);
        const res = await doControl(env, String(body.action || ''));
        return json(res, res.ok ? 200 : 500, request);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    return json({ error: 'Not found' }, 404, request);
  }
};
