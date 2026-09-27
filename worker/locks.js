// Cloudflare Worker — Clowo lock server + bot control (thay ô PAT)
// Env secrets: GH_PAT (GitHub PAT, can truy cap repo + workflow)
// KV binding: LOCKS
const GH = 'https://api.github.com/repos/minhtu446/discord-bot';
const ADMIN_ID = '1464884102238048307';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS }
  });
}

async function discordUid(token) {
  if (!token) return null;
  try {
    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  } catch { return null; }
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

async function allLocks(env) {
  const out = {};
  try {
    const list = await env.LOCKS.list({ prefix: 'lock:' });
    for (const k of list.keys) {
      const v = await env.LOCKS.get(k.name);
      if (v) out[k.name.slice(5)] = JSON.parse(v);
    }
  } catch {}
  return out;
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
  const secret = await getVar(env, 'BOT_SECRET');
  if (!secret) return { ok: false, error: 'Thiếu biến BOT_SECRET trong repo (Settings → Secrets and variables → Variables)!' };
  const st = await botStatus(env);
  if (action === 'restart' && st.runId) {
    await ghFetch(env, '/actions/runs/' + st.runId + '/cancel', { method: 'POST' });
    await new Promise(r => setTimeout(r, 5000));
  }
  const disp = await ghFetch(env, '/actions/workflows/bot-runner.yml/dispatches', {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { action: 'start', secret } })
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
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (path === '/locks' && request.method === 'GET') {
      return json({ locks: await allLocks(env) });
    }

    if (path === '/lock' && request.method === 'POST') {
      try {
        const body = await request.json();
        const uid = await discordUid(body.discordToken);
        if (!uid) return json({ error: 'Không xác thực được tài khoản Discord.' }, 401);
        const gid = String(body.guildId || '');
        if (!gid) return json({ error: 'Thiếu guildId.' }, 400);
        const existing = await env.LOCKS.get('lock:' + gid);
        if (existing) {
          const e = JSON.parse(existing);
          if (e.uid === uid) return json({ ok: true, lockedBy: uid });
          return json({ error: 'Server này đang được người khác quản lý (' + e.uid + ').' }, 409);
        }
        await env.LOCKS.put('lock:' + gid, JSON.stringify({ uid, at: Date.now() }));
        return json({ ok: true, lockedBy: uid });
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400);
      }
    }

    if (path === '/unlock' && request.method === 'POST') {
      try {
        const body = await request.json();
        const uid = await discordUid(body.discordToken);
        if (!uid) return json({ error: 'Không xác thực được tài khoản Discord.' }, 401);
        const gid = String(body.guildId || '');
        const existing = await env.LOCKS.get('lock:' + gid);
        if (!existing) return json({ ok: true });
        const e = JSON.parse(existing);
        if (e.uid !== uid) return json({ error: 'Chỉ người đã khóa server này mới mở khóa được.' }, 403);
        await env.LOCKS.delete('lock:' + gid);
        return json({ ok: true });
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400);
      }
    }

    if (path === '/status' && request.method === 'GET') {
      const uid = await discordUid(request.headers.get('authorization'));
      if (uid !== (env.ADMIN_ID || ADMIN_ID)) return json({ error: 'Forbidden' }, 403);
      return json(await botStatus(env));
    }

    if (path === '/control' && request.method === 'POST') {
      try {
        const body = await request.json();
        const uid = await discordUid(body.discordToken);
        if (!uid) return json({ error: 'Không xác thực được tài khoản Discord.' }, 401);
        if (uid !== (env.ADMIN_ID || ADMIN_ID)) return json({ error: 'Chỉ admin được điều khiển bot.' }, 403);
        const gid = String(body.guildId || '');
        const existing = await env.LOCKS.get('lock:' + gid);
        if (!existing) return json({ error: 'Bạn chưa quản lý server này — hãy khóa server trước.' }, 403);
        const e = JSON.parse(existing);
        if (e.uid !== uid) return json({ error: 'Chỉ người đang khóa server này mới điều khiển được bot.' }, 403);
        const res = await doControl(env, String(body.action || ''));
        return json(res, res.ok ? 200 : 500);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400);
      }
    }

    return json({ error: 'Not found' }, 404);
  }
};