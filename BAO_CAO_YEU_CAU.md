# BẢN NHU CẦU HOÀN THIỆN — DISCORD BOT

## I. CONFIG
```json
{
  "token": "MTUwNzk3ODkwODIyNDQ1NDc0Nw.GenOIU.LXePZhmr756g1mvmId2YArdYgQ0PGn0aIsm5Ko",
  "ownerId": "1464884102238048307",
  "clientId": "1507978908224454747",
  "guildId": "1451217022523277503",
  "welcomeChannelId": "1491804692051660971",
  "logChannelId": "1511212051278725180",
  "ticketCategoryId": "1502609689983320154",
  "gameCategoryId": "1502612789401751582",
  "memberRoleId": "1451222592680886292",
  "setupCategoryId": "1512786902963589261",
  "hfToken": "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",
  "dmRelayChannelId": "1513050183754318007",
  "aiProvider": "ollama",
  "ollamaModel": "qwen2.5:1.5b"
}
```

## II. FILE & VAI TRÒ
| File | Vai trò |
|---|---|---|
| `index.js` | Cổng vào — sự kiện Discord, điều phối |
| `commands.js` | Slash command handler (owner-only trừ `/help`) |
| `deploy-commands.js` | Đăng ký slash command lên Discord API |
| `gameplay.js` | Tạo kênh game, ticket, route button/modal → game modules |
| `jsonCache.js` | Cache JSON tập trung (RAM + write coalescing + buildIndex/getIndexed) |
| `configHelper.js` | Per-guild config lookup, owner check, extra owner CRUD |
| `settingsHelper.js` | 20 toggle settings per guild, lưu guildSettings.json |
| `aiEngine.js` | Ollama API wrapper (qwen2.5:1.5b) + heuristic fallback |
| `noituChannel.js` | Public nối từ cộng đồng trong channel |
| `automod/wordFilter.js` | Text filter — pre-compute cleaned banned words, leet map, dấu, full-width |
| `automod/imageFilter.js` | Image/Video/Audio filter — dHash + OCR (HF API → Tesseract), FFmpeg frame, Whisper STT |
| `automod/antiSpam.js` | Rate limit + fallback violation tracking, interval prune |
| `handlers/memberHandler.js` | Welcome Canvas + auto role + auto nickname |
| `handlers/messageHandler.js` | Xử lý message: noitu channel, automod, spam, music, RPS |
| `handlers/interactionHandler.js` | Route interaction → commands/gameplay/settings/music |
| `handlers/roleHandler.js` | Role update → emoji update |
| `handlers/userHandler.js` | User update → emoji update |
| `handlers/channelHandler.js` | Dọn dẹp tracking khi channel bị xoá |
| `games/ttt.js` | Caro 5×5 AI Minimax depth 12, move ordering, line-scoring |
| `games/noitu.js` | Nối từ 2 từ (Ollama AI) — bot luôn thắng, học từ mới |
| `games/keobuabao.js` | Oẳn tù tì 70% bot thắng, UI màu + emoji |
| `roleEmoji.js` | Tự động thêm emoji từ role cao nhất vào nickname |
| `music.js` | yt-dlp pipe audio, queue, loop, volume |
| `data/*.json` | 16 file dữ liệu (RAM cache + write coalescing) |

## III. 16 LỆNH SLASH (OWNER-ONLY)
Check `configHelper.isOwner()` (main owner + extra owners).

| # | Lệnh | Options | Mô tả |
|---|---|---|---|
| 1 | `/xoa` | `số_lượng`(1-1000), `người_dùng` | Bulk delete, kể cả tin >14 ngày (individual delete) |
| 2 | `/camchat` | `người_dùng` | Gán role Muted (tự tạo nếu chưa có) |
| 3 | `/htcamchat` | `người_dùng` | Gỡ role Muted |
| 4 | `/lock` | — | Khóa kênh |
| 5 | `/unlock` | — | Mở kênh |
| 6 | `/msg` | `loại`(dm\|bot), `nội_dung`, `id`, `tệp` | Gửi DM/bot message + file |
| 7 | `/setup` | `loại`(ticket,channelandgame,noitucc,ui,config,info) + options | Tạo UI/config/info |
| 8 | `/setslowmode` | `giây` | Set slowmode |
| 9 | `/update` | — | Embed cập nhật |
| 10 | `/botucam` | `số_lượng`, `người_dùng` | Quét + xoá tin cũ chứa từ cấm |
| 11 | `/list` | `loại`(anti,noemojirole,owner) | Xem danh sách |
| 12 | `/add` | `loại`(anhbay,camdunggame,owner,noemojirole,tucam,tudongxoa) + options | Thêm vào danh sách |
| 13 | `/removefromlist` | `loại`(camdunggame,tudongxoa,owner,noemojirole,tucam) + options | Xoá khỏi danh sách |
| 14 | `/test` | `ảnh`, `video`, `từ` | Test vi phạm |
| 15 | `/dm` | `người_dùng`, `nội_dung` | Gửi DM |
| 16 | `/emojiup` | — | Cập nhật emoji từ role cho all member |
| 17 | `/settile` | `nội_dung` | Đổi trạng thái bot (Watching) |
| 18 | `/setting` | — | UI toggle 20 tính năng per guild |
| 19 | `/help` | — | Hướng dẫn (PUBLIC — không check owner) |

## IV. CƠ CHẾ GAME

### A. Kênh Game (1 kênh/user)
- **UI:** 3 nút → **❌ Caro** | **🔤 Nối từ** | **🗑️ Xoá kênh**
- **Guide embed:** hướng dẫn chi tiết 3 game
- Tracking: `userChannels.json` (`{userId: channelId}`)
- Permission: chỉ user + bot thấy

### B. TTT — Caro 5×5 AI Minimax
1. Button → `startGame()`, random 50/50 ai đi trước
2. Board `[5][5]`: `⬜` / `❌` (người) / `⭕` (bot)
3. 25 button (5 rows × 5) + nút Hủy
4. **AI:** depth 6 tối đa, line-scoring (4 liên tiếp = thắng), neighbor pruning
5. Score: O thắng = `100 - depth`, X thắng = `-100 + depth`, hoà = 0

### C. NOITU — Nối từ 2 từ (Ollama AI)
- Data: `noituWords.json` (**52,035** cụm từ Viet74K + kaikki)
- Validation: `validWords.json` (73,588 từ có nghĩa Set O(1))
- Definitions: `dict.json` (25,237 từ có giải nghĩa từ Wiktionary)
- **Bot luôn thắng:** nếu không tìm được match → tự sinh `[lastWord + randomFirstWord]`, thêm vào data
- **Ollama AI (`qwen2.5:1.5b`):** chọn từ thông minh dựa trên context, trả về JSON word + meaning
- **Fallback:** Smart Engine heuristic (scoring theo continuations) nếu Ollama offline/fail
- **UI:** Modal nhập 2 từ, typing indicator 1.5s "đang suy nghĩ"
- **Công nghệ:** `aiEngine.js` wrapper Ollama API `/api/generate` + Map index O(1) thay `Array.filter` O(n)

### D. NOITU CHANNEL — Nối từ cộng đồng
- `/setup noitucc` → gửi embed từ bắt đầu trong channel hiện tại
- **AI CŨNG CÓ THỂ CHƠI:** bất kỳ ai nhắn tin 2 từ trong channel
- Đúng → ✅ reaction + từ đó thành từ hiện tại
- Sai → xoá tin nhắn + gửi error auto-delete 4s (chỉ người đó thấy)
- Luật: từ đầu = từ cuối từ trước, chưa dùng, phải có nghĩa

### E. KEOBUABAO — Oẳn tù tì
- Gõ "kéo", "búa", "bao" trong text channel bất kỳ
- `Math.random() < 0.7` → bot counter-pick (thắng), còn lại random
- Embed màu + emoji (✂️ 🪨 📄)

## V. AUTOMOD (4 tầng)

### Tầng 1: Text filter
- Pre-compute cleaned banned words, cache RAM
- Normalize: leet map + full-width → half-width + bỏ dấu + loại ký tự đặc biệt
- Kiểm tra cả text gốc (cho từ có dấu)
- Chạy trên message text + message edit

### Tầng 2: dHash + Video Frame
- Image: download 1 lần → sharp resize 9×8 grayscale → hash 64-bit → Hamming so sánh < 6
- Video: FFmpeg `-ss 1 -vframes 1` từ URL (User-Agent header) → PNG → dHash + OCR

### Tầng 3: OCR + STT
- **Image OCR:** HF API (`Qwen/Qwen3-VL-8B-Instruct`) → Tesseract.js fallback (vie+eng)
- Max 2 concurrent, cache key URL + `_video`/`_audio`, prune interval 30s, cache max 200
- **Audio STT:** HF Whisper API (`whisper-large-v3-turbo`), 2 concurrent, 10MB limit
- **Video audio:** FFmpeg extract audio 2s → pattern quick check → full audio → STT

### Tầng 4: Spam + Fallback
- >8 tin nhắn/5s → timeout 10s, 3 lần → cấm chat 1h
- >50% ký tự đặc biệt → xoá
- Định dạng đáng ngờ (lặp ký tự, uppercase chain ≥20, zero-width chars)
- `pruneMaps()` interval 60s dọn rateLimitMap + violationMap

## VI. WELCOME & EMOJI
- `GuildMemberAdd`: gán role → Canvas 800×400 (gradient + avatar + tên + #N + ID) → gửi welcome channel
- Role emoji: role cao nhất → emoji đầu tên member, tự động cập nhật qua role/user update
- Skip list: `noemojiRoles.json`, quản lý qua `/add noemojirole`

## VII. DM RELAY
- DM đến bot → forward vào `dmRelayChannelId` (`1513050183754318007`)
- Format: `[username]: nội dung` + file
- `Partials.Channel` + `GatewayIntentBits.DirectMessages`

## VIII. CHANNEL SYSTEM

### Chat/Voice cá nhân
- `/setup channelandgame` → 3 nút: Kênh Game / Chat / Voice
- Game channel: 1 user, trong gameCategoryId
- Chat/Voice: 1 chat + 1 voice/user, trong setupCategoryId
- UI: đổi tên, thêm người, đuổi, xoá kênh

### Ticket
- Nút **🎫 Mở Ticket** → tạo kênh riêng trong ticketCategoryId
- Nút **🔒 Đóng ticket** → xoá kênh

## IX. MUSIC PLAYER
- Kích hoạt: gõ `PLAYMUSIC` trong text channel (phải trong voice)
- UI: **🎵 URL** | **⏸/▶️** | **⏹** | **🔁** | **🔊**
- yt-dlp pipe stdout → `createAudioResource(StreamType.Arbitrary)`
- Queue, pre-load next track, loop, volume 0-100
- Max 4 concurrent yt-dlp process

## X. HIỆU NĂNG (1000+ concurrent users)

### jsonCache — Cache tập trung
- **Write coalescing:** debounce 100ms, flush-on-exit, gộp nhiều write trong 1 tick
- **Index system:** `buildIndex()` + `getIndexed()` cho O(1) lookup
- **16 file pre-load:** tất cả JSON load vào RAM khi start
- **No fs.readFileSync trong handler** (trừ lần đầu load jsonCache.js)

### Tối ưu hoá
| Module | Cải thiện |
|---|---|
| `noitu.js`: Array.filter O(n) 52K → Map index O(1) | ~1000x |
| `jsonCache.js`: sync write → write coalescing debounce 100ms | ~50x |
| `antiSpam.js`: thêm pruneMaps() interval 60s | Giảm memory leak |
| `imageFilter.js`: OCR cache 500→200, prune interval 30s | ~2x memory |
| `index.js`: setMaxListeners(0) | Tránh warning |
| `aiEngine.js`: Ollama API (local, ~200-500ms) | AI thông minh, không tốn phí |

### Data files (13 file + 3 txt)
| File | Kích thước | Ghi chú |
|---|---|---|
| `validWords.json` | 73,588 từ | Từ điển tiếng Việt (kaikki + Viet74K + noitu) |
| `noituWords.json` | 52,035 cặp | 2-syllable pairs cho nối từ |
| `dict.json` | 25,237 từ | Định nghĩa từ Wiktionary |
| `danh_tu.txt` | 14,185 từ | Danh từ |
| `dong_tu.txt` | 7,502 từ | Động từ |
| `tinh_tu.txt` | 5,822 từ | Tính từ |
| `guildSettings.json` | — | 20 toggle per guild |
| `bannedWords.json` | — | Blacklist từ cấm |
| `bannedImages.json` | — | dHash ảnh cấm |
| `bannedGameUsers.json` | — | User cấm game |
| `autoDeleteUsers.json` | — | User auto-xoá |
| `userChannels.json` | — | Game channel ownership |
| `setupChannels.json` | — | Chat/voice ownership |
| `userTickets.json` | — | Ticket ownership |
| `noituChannels.json` | — | Public noitu channel tracking |
| `noemojiRoles.json` | — | Role skip emoji list |
| `extraOwners.json` | — | Extra owner IDs |
| `guildConfigs.json` | — | Per-guild config override |
| `botStatus.json` | — | Trạng thái bot |

## XI. CÔNG NGHỆ CHÍNH

- **Discord.js v14** — interaction handling, modals, buttons, embeds
- **Ollama + Qwen2.5:1.5b** — AI nối từ local, REST API 127.0.0.1:11434
- **FFmpeg** — frame extraction video, audio processing
- **Tesseract.js** — OCR fallback (vie + eng traineddata)
- **Hugging Face API** — Inference API (router.huggingface.co)
- **faster-whisper** — Python local STT (demucs + whisper)
- **sharp + canvas** — Image processing + welcome canvas
- **yt-dlp** — YouTube audio streaming pipe
- **@discordjs/voice** — Voice connection + audio player

## XII. TRẠNG THÁI

### Đã hoàn thành
| Tính năng | Ghi chú |
|---|---|
| 19 slash commands | Owner-only trừ `/help` |
| Noitu AI (Ollama) | 52K pairs, Map index O(1), bot always win, validate 73K words |
| Noitu public channel | `/setup noitucc`, multiplayer, ✅/❌ validation |
| TTT Caro AI | Minimax depth 12, line-scoring, 25 buttons |
| Oẳn tù tì | 70% bot thắng, emoji + màu |
| Settings system | 20 toggles per guild, UI buttons |
| jsonCache | Write coalescing + index system |
| Automod 4 tầng | Text + dHash + OCR/STT + spam |
| Welcome Canvas | Gradient + avatar + font custom |
| Music player | yt-dlp pipe, queue, loop, volume |
| Chat/Voice/Ticket | Tạo + quản lý kênh |
| Role emoji | Auto emoji từ role |
| DM relay | Forward + attachments |
| Channel cleanup | Tự động dọn tracking khi channel deleted |

### Còn lại
| Tính năng | Ghi chú |
|---|---|
| UNO game | Placeholder `unoChannels.json` |
| Horizontal scale | Nhiều worker (tương lai) |
| Gemini/Groq provider | Có thể thêm vào aiEngine.js |

---
**19 slash commands, 4 tầng automod, 4 game (TTT, noitu AI, noitu channel, RPS), 16 file dữ liệu, Ollama AI local. 20 settings toggle. Tối ưu 1000+ concurrent.**
