/**
 * 共享 LLM 客户端 —— 所有智能体共用的 API 网关
 * 配置在运行时可通过 configure() 热更新（应用内粘贴配置后即时生效）
 * STT（音频转写）可独立配置：不填时跟随 LLM 的地址与 Key
 */
let state = {
  baseUrl: '',
  apiKey: '',
  model: '',
  sttModel: 'whisper-1',
  sttBaseUrl: '',
  sttApiKey: '',
};

function strip(v) { return String(v || '').trim(); }

function configure(patch = {}) {
  if (patch.baseUrl !== undefined) state.baseUrl = strip(patch.baseUrl).replace(/\/+$/, '');
  if (patch.apiKey !== undefined) state.apiKey = strip(patch.apiKey);
  if (patch.model !== undefined) state.model = strip(patch.model);
  if (patch.sttModel !== undefined) state.sttModel = strip(patch.sttModel) || 'whisper-1';
  if (patch.sttBaseUrl !== undefined) state.sttBaseUrl = strip(patch.sttBaseUrl).replace(/\/+$/, '');
  if (patch.sttApiKey !== undefined) state.sttApiKey = strip(patch.sttApiKey);
}

function isConfigured() {
  return Boolean(state.baseUrl && state.apiKey && state.model);
}
function isKeyValid() {
  return isConfigured() && /^[\x21-\x7e]+$/.test(state.apiKey);
}

/* ---- STT 独立配置（不填则跟随 LLM） ---- */
function sttEndpoint() { return state.sttBaseUrl || state.baseUrl; }
function sttKey() { return state.sttApiKey || state.apiKey; }
function isSttReady() {
  return Boolean(sttEndpoint() && sttKey() && state.sttModel) && /^[\x21-\x7e]+$/.test(sttKey());
}

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return k.slice(0, 2) + '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
}
function snapshot() {
  return {
    baseUrl: state.baseUrl,
    model: state.model,
    sttModel: state.sttModel,
    sttBaseUrl: state.sttBaseUrl,
    apiKeyMasked: maskKey(state.apiKey),
    sttApiKeyMasked: maskKey(state.sttApiKey),
    configured: isConfigured(),
    keyValid: isKeyValid(),
    sttConfigured: Boolean(sttEndpoint() && sttKey() && state.sttModel),
    sttReady: isSttReady(),
    sttUsesLlmKey: !state.sttBaseUrl && !state.sttApiKey,
  };
}

function assertReady() {
  if (!isConfigured()) {
    const err = new Error('LLM 未配置：请在右上角 ⚙️ 设置中配置 API，或编辑外部 .env 文件');
    err.status = 400; throw err;
  }
  if (!isKeyValid()) {
    const err = new Error('LLM_API_KEY 无效：请填入真实的 API Key（当前是占位内容）');
    err.status = 400; throw err;
  }
}

function assertSttReady() {
  if (!sttEndpoint() || !sttKey() || !state.sttModel) {
    const err = new Error('转写未配置：请在右上角 ⚙️ 设置中填写转写接口（支持 /audio/transcriptions 的服务，推荐 Groq 免费额度），或直接粘贴文字');
    err.status = 400; throw err;
  }
  if (!/^[\x21-\x7e]+$/.test(sttKey())) {
    const err = new Error('STT API Key 无效：请填入真实的 Key（当前是占位内容）');
    err.status = 400; throw err;
  }
}

async function chat(messages, { temperature = 0.3, maxTokens = 4096, timeoutMs = 90000 } = {}) {
  assertReady();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${state.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.apiKey}` },
      body: JSON.stringify({ model: state.model, messages, temperature, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`LLM 接口请求失败 (${res.status})：${body.slice(0, 300)}`);
      err.status = 502; throw err;
    }
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('LLM 请求超时，请检查网络或模型服务状态');
      err.status = 504; throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 音频转写（STT）—— 需要服务支持 OpenAI 兼容的 /audio/transcriptions */
async function transcribeAudio(buffer, ext = 'webm', timeoutMs = 120000) {
  assertSttReady();
  if (!buffer || !buffer.length) {
    const err = new Error('缺少音频数据'); err.status = 400; throw err;
  }
  const form = new FormData();
  form.append('file', new Blob([buffer]), `audio.${(ext || 'webm').replace(/[^\w]/g, '') || 'webm'}`);
  form.append('model', state.sttModel);
  form.append('response_format', 'json');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${sttEndpoint()}/audio/transcriptions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${sttKey()}` },
      body: form,
    });
    if (!r.ok) {
      const b = await r.text().catch(() => '');
      let msg;
      if (r.status === 404) {
        msg = '转写接口不存在 (404)：当前 API 不支持音频转写 /audio/transcriptions。请在 ⚙️ 设置中把「转写接口」改为支持转写的服务（推荐 Groq 免费：api.groq.com/openai/v1，模型 whisper-large-v3-turbo），或改用粘贴文字';
      } else if (r.status === 401 || r.status === 403) {
        msg = `转写接口鉴权失败 (${r.status})：请检查${state.sttApiKey ? '「转写 Key」' : 'API Key'}是否正确`;
      } else if (r.status === 400 && /model/i.test(b)) {
        msg = `转写模型不可用 (400)：模型「${state.sttModel}」不存在或无权限，请在 ⚙️ 设置中修改「转写模型」`;
      } else {
        msg = `转写接口失败 (${r.status})：${b.slice(0, 200)}`;
      }
      const err = new Error(msg);
      err.status = 502; throw err;
    }
    const data = await r.json();
    return data.text || '';
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('转写请求超时，请检查网络或服务状态');
      err.status = 504; throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 供 server 写回 .env 时取原始 Key（快照里是打码值） */
function rawKeys() { return { apiKey: state.apiKey, sttApiKey: state.sttApiKey }; }

module.exports = { configure, snapshot, chat, transcribeAudio, isConfigured, isKeyValid, isSttReady, rawKeys };
