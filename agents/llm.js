/**
 * 共享 LLM 客户端 —— 所有智能体共用的 API 网关
 * 配置在运行时可通过 configure() 热更新（应用内粘贴配置后即时生效）
 */
let state = {
  baseUrl: '',
  apiKey: '',
  model: '',
  sttModel: 'whisper-1',
};

function configure(patch = {}) {
  if (patch.baseUrl !== undefined) state.baseUrl = String(patch.baseUrl || '').trim().replace(/\/+$/, '');
  if (patch.apiKey !== undefined) state.apiKey = String(patch.apiKey || '').trim();
  if (patch.model !== undefined) state.model = String(patch.model || '').trim();
  if (patch.sttModel !== undefined) state.sttModel = String(patch.sttModel || 'whisper-1').trim();
}

function isConfigured() {
  return Boolean(state.baseUrl && state.apiKey && state.model);
}
function isKeyValid() {
  return isConfigured() && /^[\x21-\x7e]+$/.test(state.apiKey);
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
    apiKeyMasked: maskKey(state.apiKey),
    configured: isConfigured(),
    keyValid: isKeyValid(),
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
  assertReady();
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
    const r = await fetch(`${state.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${state.apiKey}` },
      body: form,
    });
    if (!r.ok) {
      const b = await r.text().catch(() => '');
      const err = new Error(`转写接口失败 (${r.status})：该服务可能不支持音频转写，可改用浏览器实时转写或粘贴文本。${b.slice(0, 200)}`);
      err.status = 502; throw err;
    }
    const data = await r.json();
    return data.text || '';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { configure, snapshot, chat, transcribeAudio, isConfigured, isKeyValid };
