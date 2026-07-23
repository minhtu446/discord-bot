# Danh sach file da xoa - Cleanup 23/07/2026

## Ly do: Loai bo tinh nang Music, Noitu, Flappybird; chuyen tu Tesseract sang EasyOCR

### 1. Music remnant (da xoa tinh nang nhac)
- `audio_processor.py` - Xu ly am thanh demucs/whisper, khong code nao goi
- `test-pipeline.js` - Test yt-dlp + prism-media pipeline
- `yt-dlp.log` - Log debug tu yt-dlp
- `yt-url.txt` - Stream URL het han tu yt-dlp
- `yt-url-err.txt` - Log loi trong tu yt-dlp
- `data/voiceSessions.json` - `{"}`, khong code nao doc/ghi

### 2. Tesseract OCR (da chuyen sang EasyOCR)
- `eng.traineddata` (5.2 MB) - Model OCR tieng Anh
- `vie.traineddata` (1.7 MB) - Model OCR tieng Viet
- `tesseract.js` trong package.json (~200 MB node_modules)

### 3. Flappybird orphan
- `games/Flappybird/` (13.2 MB) - Chi con node_modules, game da bi xoa

### 4. Noitu game remnant (tu vu tieng Viet)
- `data/danh_tu.txt` (180 KB) - Danh tu (14,185 tu)
- `data/dong_tu.txt` (85 KB) - Dong tu (7,502 tu)
- `data/tinh_tu.txt` (69 KB) - Tinh tu (5,822 tu)
- `data/trang_tu.txt` (12 KB) - Cau truc (1,031 entry)

### 5. SQLite unused
- `data/store.db` (12 KB) - Database SQLite khong code nao su dung
- `data/store.db-shm` (32 KB)
- `data/store.db-wal` (247 KB)

### 6. Dead code
- `list.js` - Khong code nao require, showList/createWelcomeEmbed
- `antiaddbad.js` - Da thay boi automod system

### 7. Log/temp/rac
- `bot.log` - Log 1 dong
- `bot-output.log`, `bot-err.log` - Log trong
- `data/stdout.log`, `data/stderr.log` - Log cu dich vu
- `data/init.txt` - Log khoi dong cu
- `data/unoChannels.json` - UNO game chua bao gio lam
- `capnhatroine` - File test auto-sync
- `gemini-keys-backup.txt` - **API keys plaintext - RUI RO BAO MAT**

### 8. Code cleanup
- `auto-sync.js`: Xoa `'music'` khoi IGNORE_DIRS
- `config.js`: Xoa `geminiKeys` (khong code nao dung)
- `jsonCache.js`: Xoa `voiceSessions.json` khoi preload list
- `replyHandler.js`: Xoa broken file reference `Screenshot 2026-06-29 174619.png`

### Tong so luong: ~30 files, tiet kiem ~220 MB
