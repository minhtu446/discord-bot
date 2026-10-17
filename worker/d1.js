/**
 * d1.js — đọc/ghi Cloudflare D1 (SQLite) từ Worker.
 *
 * D1 là nguồn chính duy nhất cho cấu hình guild (cfg:/gmeta:) và các tệp data/.
 * Binding: DB (xem wrangler.toml). D1 chạy cùng Cloudflare nên là lệnh gọi nội
 * bộ — không cần ký JWT như Firestore.
 *
 * Bảng worker(k, v, updated_at)                  — khoá → chuỗi JSON (giống giá trị KV cũ)
 * Bảng data(name, content, encoding, bytes, updated_at) — tệp trong data/
 *
 * D1 tính quota theo số dòng ĐỌC, nên mọi truy vấn theo khoá đều đi qua khoảng
 * (WHERE k >= ? AND k < ?) trên khoá chính để chỉ đọc đúng số dòng khớp.
 */

// Khoảng khoá theo tiền tố. 'cfg:' → { lo:'cfg:', hi:'cfg;' } — các khoá 'cfg:...'
// đều nằm trong khoảng này nên SQLite đi thẳng trên khoá chính.
// Không tăng được ký tự cuối (đã là U+FFFF) → không có biên trên, lọc lại ở JS.
function prefixBounds(prefix) {
  const p = String(prefix);
  if (!p) return { lo: '', hi: null };
  const last = p.charCodeAt(p.length - 1);
  if (last < 0xFFFF) return { lo: p, hi: p.slice(0, -1) + String.fromCharCode(last + 1) };
  return { lo: p, hi: null };
}

/** Thiếu binding D1? (deploy nhầm cấu hình sẽ báo rõ thay vì crash khó hiểu) */
export function dbOk(env) {
  return !!(env && env.DB);
}

/** Đọc 1 khoá → chuỗi, hoặc null nếu chưa có. */
export async function dbGet(env, k) {
  const row = await env.DB.prepare('SELECT v FROM worker WHERE k = ?').bind(String(k)).first();
  return row ? row.v : null;
}

/** Ghi 1 khoá (UPSERT). Ném lỗi nếu ghi thất bại. */
export async function dbSet(env, k, v) {
  await env.DB.prepare(
    'INSERT INTO worker (k, v, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at'
  ).bind(String(k), String(v), Date.now()).run();
  return true;
}

/** Xoá 1 khoá (bỏ qua nếu chưa có). */
export async function dbDel(env, k) {
  await env.DB.prepare('DELETE FROM worker WHERE k = ?').bind(String(k)).run();
  return true;
}

/** Liệt kê khoá theo tiền tố → [{ id, value }]. */
export async function dbList(env, prefix) {
  const { lo, hi } = prefixBounds(prefix);
  const stmt = hi === null
    ? env.DB.prepare('SELECT k, v FROM worker WHERE k >= ?').bind(lo)
    : env.DB.prepare('SELECT k, v FROM worker WHERE k >= ? AND k < ?').bind(lo, hi);
  const res = await stmt.all();
  const out = [];
  for (const row of (res.results || [])) {
    if (hi === null && !String(row.k).startsWith(prefix)) continue;
    out.push({ id: String(row.k), value: row.v });
  }
  return out;
}

/** Đọc toàn bộ thư mục data/ (dùng cho `pull`). */
export async function dbDataAll(env) {
  const res = await env.DB
    .prepare('SELECT name, content, encoding, bytes, updated_at FROM data ORDER BY name')
    .all();
  return (res.results || []).map(r => ({
    name: String(r.name),
    content: String(r.content),
    encoding: r.encoding === 'base64' ? 'base64' : 'utf8',
    bytes: Number(r.bytes) || 0,
    updatedAt: Number(r.updated_at) || 0
  }));
}

/** Số tệp data/ đang có — dùng để biết bảng đã được seed chưa. */
export async function dbDataCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM data').first();
  return row ? Number(row.n) || 0 : 0;
}

/** Ghi nhiều tệp data/ theo lô (UPSERT). Trả về số tệp đã ghi. */
export async function dbDataPut(env, files) {
  if (!files || !files.length) return 0;
  const SQL = 'INSERT INTO data (name, content, encoding, bytes, updated_at) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(name) DO UPDATE SET content = excluded.content, encoding = excluded.encoding, ' +
    'bytes = excluded.bytes, updated_at = excluded.updated_at';
  const now = Date.now();
  let n = 0;
  for (let i = 0; i < files.length; i += 100) {
    const stmts = files.slice(i, i + 100).map(f => env.DB.prepare(SQL).bind(
      String(f.name),
      String(f.content),
      f.encoding === 'base64' ? 'base64' : 'utf8',
      Number(f.bytes) || 0,
      now
    ));
    await env.DB.batch(stmts);   // batch = chạy trong 1 giao dịch, ít lượt qua mạng
    n += stmts.length;
  }
  return n;
}
