-- Schema cho Cloudflare D1 (clowo-db) — thay thế collection "worker" và "data" của Firestore.
--
-- WITHOUT ROWID: bảng key-value gọn, khoá chính chính là thân dòng.
-- Nhờ vậy truy vấn theo khoảng (WHERE k >= 'cfg:' AND k < 'cfg;') đi thẳng
-- trên khoá chính và chỉ đọc đúng số dòng khớp — quan trọng vì D1 tính "rows read".

-- Khoá/lưu chung: cấu hình guild (cfg:<gid>), meta guild (gmeta:<gid>), trạng thái bot (bot:guilds).
CREATE TABLE IF NOT EXISTS worker (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Các tệp trong thư mục data/ của bot (guildConfigs.json, userTickets.json...).
CREATE TABLE IF NOT EXISTS data (
  name       TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  encoding   TEXT NOT NULL DEFAULT 'utf8',
  bytes      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
