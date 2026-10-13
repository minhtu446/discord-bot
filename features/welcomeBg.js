const fs = require('fs');
const path = require('path');
const os = require('os');
const webConfig = require('../webConfig');

const CACHE_DIR = path.join(os.tmpdir(), 'clowo-bg');
const lastVer = {};

function fileFor(gid) { return path.join(CACHE_DIR, gid + '.png'); }

async function load(gid, version) {
  const fp = fileFor(gid);
  try {
    if (version && lastVer[gid] === version && fs.existsSync(fp)) {
      return fs.readFileSync(fp);
    }
    if (!version) { clear(gid); return null; }
    const r = await fetch(webConfig.WORKER + '/bot/asset?gid=' + encodeURIComponent(gid), {
      headers: { 'x-bot-key': webConfig.botKey() }
    });
    if (!r.ok) { clear(gid); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) { clear(gid); return null; }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(fp, buf);
    lastVer[gid] = version;
    return buf;
  } catch (e) {
    return null;
  }
}

function clear(gid) {
  lastVer[gid] = null;
  try { fs.unlinkSync(fileFor(gid)); } catch {}
}

module.exports = { load, clear };