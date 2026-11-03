/**
 * MeetMind 会议智能体 —— 后端服务（多智能体架构）
 *
 * 架构：
 *   协调器 Orchestrator（agents/index.js）
 *     ├─ 语音转写员 sttAgent        —— 接入 API 的 /audio/transcriptions
 *     ├─ 纪要专员 summaryAgent      —— 文本 → 结构化 Markdown 纪要
 *     ├─ 导图专家 mindmapAgent      —— 文本 → Mermaid 思维导图
 *     └─ 信息图设计师 infographicAgent —— 文本 → 关键信息 JSON → SVG 总结图
 *   所有智能体共用 LLM 网关 agents/llm.js（OpenAI 兼容接口）
 *
 * .env 加载顺序（全部为"程序目录之外"的位置）：
 *   1. 环境变量 MEETMIND_ENV 指定的 .env 绝对路径
 *   2. 用户主目录 ~/.meetmind/.env
 *   3. 程序上级目录 <程序目录>/../.env
 * 应用内粘贴的配置会写回到当前生效的那个外部 .env 文件。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const dotenv = require('dotenv');
const llm = require('./agents/llm');
const orchestrator = require('./agents');

// ---------- 命令行 host / port ----------
function parseArgs(argv) {
  let host = '127.0.0.1';
  let port = 7100;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host' || a === '-H') host = argv[++i];
    else if (a === '--port' || a === '-p') port = parseInt(argv[++i], 10);
    else if (a.startsWith('--host=')) host = a.slice(7);
    else if (a.startsWith('--port=')) port = parseInt(a.slice(7), 10);
  }
  return { host, port };
}
const { host, port } = parseArgs(process.argv.slice(2));

// ---------- 外部 .env 定位与加载 ----------
const PROGRAM_DIR = __dirname;
const DEFAULT_ENV_PATH = path.join(os.homedir(), '.meetmind', '.env');
const envCandidates = [
  process.env.MEETMIND_ENV && path.resolve(process.env.MEETMIND_ENV),
  DEFAULT_ENV_PATH,
  path.resolve(PROGRAM_DIR, '..', '.env'),
].filter(Boolean);

function findEnvFile() {
  for (const p of envCandidates) if (fs.existsSync(p)) return p;
  return null;
}
let envFile = findEnvFile();

function applyEnvFile(file) {
  if (file && fs.existsSync(file)) {
    dotenv.config({ path: file, override: true });
    envFile = file;
  }
  llm.configure({
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    sttModel: process.env.STT_MODEL,
  });
}
applyEnvFile(envFile);
if (envFile) {
  console.log(`[MeetMind] 已加载外部配置文件: ${envFile}`);
} else {
  console.warn('[MeetMind] 未找到外部 .env，查找顺序:');
  envCandidates.forEach(p => console.warn('  - ' + p));
}

function logLlmState() {
  const s = llm.snapshot();
  console.log(`[MeetMind] LLM: ${s.configured && s.keyValid ? `已配置 (${s.model})`
    : s.configured ? 'Key 待填写（当前为占位内容）' : '未配置'}`);
}

// ---------- .env 解析 / 写回 ----------
function parseEnvText(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

function writeEnvFile(file, snap, apiKey) {
  const content = [
    '# ===== MeetMind 会议智能体外部配置（程序目录之外）=====',
    '# 本文件由应用内 ⚙️ 设置写入，也可手动编辑后重启服务',
    `# OpenAI 兼容接口地址（到 /v1 为止）`,
    `LLM_BASE_URL=${snap.baseUrl}`,
    `# API Key`,
    `LLM_API_KEY=${apiKey}`,
    `# 对话模型（总结 / 思维导图 / 总结图）`,
    `LLM_MODEL=${snap.model}`,
    `# 音频转写模型（可选，服务需支持 /audio/transcriptions）`,
    `STT_MODEL=${snap.sttModel}`,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

// ---------- HTTP 服务 ----------
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(PROGRAM_DIR, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ...llm.snapshot(), envFile });
});

// 读取当前配置（Key 打码）
app.get('/api/config', (req, res) => {
  res.json({ ...llm.snapshot(), envFile });
});

// 保存配置：支持字段或整段 .env 文本；写回外部 .env 并热生效
app.post('/api/config', (req, res, next) => {
  try {
    const { baseUrl, apiKey, model, sttModel, envText } = req.body || {};
    const current = llm.snapshot();
    // 已有真实 Key 时，表单未改动 Key（仍是打码值）则保留原 Key
    const keepOldKey = apiKey === undefined || apiKey === '' || apiKey === current.apiKeyMasked;
    // 空字符串视为"不修改"，避免空字段把已有配置覆盖掉
    const clean = v => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

    let patch = {};
    if (envText && envText.trim()) {
      const parsed = parseEnvText(envText);
      patch = {
        baseUrl: clean(parsed.LLM_BASE_URL) ?? clean(baseUrl),
        apiKey: parsed.LLM_API_KEY ?? apiKey,
        model: clean(parsed.LLM_MODEL) ?? clean(model),
        sttModel: clean(parsed.STT_MODEL) ?? clean(sttModel),
      };
      if (keepOldKey && !parsed.LLM_API_KEY) delete patch.apiKey;
    } else {
      patch = { baseUrl: clean(baseUrl), model: clean(model), sttModel: clean(sttModel) };
      if (!keepOldKey) patch.apiKey = apiKey;
    }

    llm.configure(patch);
    const snap = llm.snapshot();
    // 只有拿到真实 Key（非打码）时才落盘
    const keyToWrite = envText && parseEnvText(envText).LLM_API_KEY
      ? parseEnvText(envText).LLM_API_KEY
      : (patch.apiKey !== undefined ? patch.apiKey : null);
    if (keyToWrite && /^[\x21-\x7e]+$/.test(keyToWrite)) {
      const target = envFile || DEFAULT_ENV_PATH;
      writeEnvFile(target, snap, keyToWrite);
      envFile = target;
    } else if (!envFile && snap.configured) {
      // 字段方式且未提供 Key 时不写盘，提示用户
      return res.status(400).json({ error: '首次保存必须提供完整的 API Key（或在 .env 全文中包含 LLM_API_KEY）', ...snap, envFile });
    }
    res.json({ saved: true, ...llm.snapshot(), envFile });
  } catch (e) { next(e); }
});

// 测试连接：向接入的 API 发一个最小请求
app.post('/api/config/test', async (req, res, next) => {
  try {
    const started = Date.now();
    const reply = await llm.chat([
      { role: 'user', content: 'ping。请只回复两个字：正常' },
    ], { maxTokens: 10, timeoutMs: 20000 });
    res.json({ ok: true, latencyMs: Date.now() - started, reply, ...llm.snapshot() });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.message });
  }
});

// ---------- 智能体路由 ----------
app.post('/api/summarize', async (req, res, next) => {
  try { res.json(await orchestrator.summarize(req.body?.transcript)); }
  catch (e) { next(e); }
});

app.post('/api/mindmap', async (req, res, next) => {
  try { res.json(await orchestrator.mindmap(req.body?.transcript)); }
  catch (e) { next(e); }
});

app.post('/api/summary-image', async (req, res, next) => {
  try { res.json(await orchestrator.infographic(req.body?.transcript)); }
  catch (e) { next(e); }
});

// sharp 为可选依赖：桌面版打包不含它，仅小程序 PNG 端点需要
function getSharp() {
  try { return require('sharp'); } catch { return null; }
}

// 总结图 PNG 版（小程序 <image> 不支持 SVG，直接出 PNG base64 友好格式）
app.post('/api/summary-image/png', async (req, res, next) => {
  try {
    const sharp = getSharp();
    if (!sharp) return res.status(501).json({ error: 'PNG 导出不可用（桌面版请使用 SVG 下载）' });
    const { svg } = await orchestrator.infographic(req.body?.transcript);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (e) { next(e); }
});

// 一键全流程：并行调度多个智能体；png=true 时附带 base64 PNG 总结图（小程序用）
app.post('/api/run-all', async (req, res, next) => {
  try {
    const onProgress = name => console.log(`[MeetMind] 智能体协作中: ${name}`);
    const result = await orchestrator.runAll(req.body?.transcript, onProgress);
    if (req.body?.png && result.svg) {
      const sharp = getSharp();
      if (sharp) {
        const png = await sharp(Buffer.from(result.svg)).png().toBuffer();
        result.png = 'data:image/png;base64,' + png.toString('base64');
      }
    }
    res.json(result);
  } catch (e) { next(e); }
});

// 音频文件转写（STT 智能体，需服务支持 /audio/transcriptions）
app.post('/api/transcribe', express.raw({ type: ['audio/*'], limit: '50mb' }), async (req, res, next) => {
  try {
    const ext = (req.headers['x-audio-ext'] || 'webm').toString();
    const { text } = await orchestrator.transcribe(req.body, ext);
    if (!text) return res.status(502).json({ error: '转写结果为空' });
    res.json({ text });
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  console.error('[MeetMind] 错误:', err.message);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

const server = http.createServer(app);
server.listen(port, host, () => {
  console.log(`[MeetMind] 会议智能体已启动: http://${host}:${port}`);
  logLlmState();
});
