/* ==========================================================================
 * LocalASR —— 本地转写组件
 * --------------------------------------------------------------------------
 * 基于 Transformers.js 在浏览器 / Electron 内本地运行 OpenAI Whisper 大模型，
 * 不调用任何语音转写 API，音频不出本机。
 *
 * 工作原理：
 *   1. 首次使用时下载模型权重：优先走应用自己的后端代理 /api/asr-model（服务端
 *      网络与浏览器相互独立，浏览器直连失败时代理兜底），再尝试 hf-mirror /
 *      huggingface.co 直连；权重缓存到本地后离线可用；
 *   2. 录音/上传的音频在本地重采样为 16kHz 单声道，交给本地模型推理出文字；
 *   3. 模型大小三档可选：tiny（最快）/ base（推荐）/ small（最准）。
 * ========================================================================== */
const LocalASR = (() => {
  const LIB_LOCAL = '/vendor/transformers.min.js';   // 随程序自带的推理库（离线可用）
  const LIB_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
  /* 模型权重来源：优先走应用自己的后端代理（浏览器直连失败的救星），再直连镜像 */
  const MODEL_SOURCES = [
    () => window.location.origin + '/api/asr-model',
    'https://hf-mirror.com',
    'https://huggingface.co',
  ];

  const MODELS = {
    'Xenova/whisper-tiny':  { label: 'tiny（最快，中文一般）',   size: '约 39 MB' },
    'Xenova/whisper-base':  { label: 'base（推荐，均衡）',       size: '约 74 MB' },
    'Xenova/whisper-small': { label: 'small（最准，较慢）',     size: '约 244 MB' },
  };

  let transcriber = null;      // 当前已加载的 pipeline 实例
  let loadedModel = '';        // 实例对应的模型 id
  let loading = null;          // 进行中的加载 Promise（避免重复下载）

  /* 状态广播：app.js 监听 'local-asr-status' 事件展示进度 */
  function status(msg) {
    window.dispatchEvent(new CustomEvent('local-asr-status', { detail: msg }));
  }

  /* 懒加载 Transformers.js 库：优先程序自带的本地文件，失败回退 CDN */
  async function loadLibrary() {
    if (window.__transformers) return window.__transformers;
    let mod = null;
    try {
      mod = await import(LIB_LOCAL);
    } catch (e) {
      console.warn('[LocalASR] 本地推理库不可用，回退 CDN:', e.message || e);
      mod = await import(LIB_CDN);
    }
    // 关闭本地模型路径探测，仅使用远程权重
    mod.env.allowLocalModels = false;
    window.__transformers = mod;
    return mod;
  }

  /* 按顺序尝试多个模型源（后端代理优先，镜像直连兜底） */
  async function tryHosts(fn) {
    let lastErr = null;
    for (const src of MODEL_SOURCES) {
      try {
        const lib = await loadLibrary();
        lib.env.remoteHost = typeof src === 'function' ? src() : src;
        return await fn(lib);
      } catch (e) {
        lastErr = e;
        console.warn('[LocalASR] 模型源失败:', src, e.message || e);
      }
    }
    throw lastErr || new Error('所有模型源均不可用');
  }

  /** 加载（或复用）指定模型的转写 pipeline */
  async function ensure(modelId) {
    if (!MODELS[modelId]) modelId = 'Xenova/whisper-base';
    if (transcriber && loadedModel === modelId) return transcriber;
    if (loading) return loading;

    loading = (async () => {
      status(`正在准备本地转写模型（${MODELS[modelId].label.split('（')[0]}，${MODELS[modelId].size}），首次使用需下载…`);
      const instance = await tryHosts(async (lib) => {
        const { pipeline } = lib;
        return await pipeline('automatic-speech-recognition', modelId, {
          progress_callback: (p) => {
            if (p.status === 'progress' && typeof p.progress === 'number') {
              status(`下载模型权重 ${Math.round(p.progress)}%（${(p.loaded / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB）`);
            } else if (p.status === 'ready') {
              status('本地转写模型已就绪');
            }
          },
        });
      });
      transcriber = instance;
      loadedModel = modelId;
      status('本地转写模型已就绪（后续离线可用）');
      return instance;
    })();

    try {
      return await loading;
    } finally {
      loading = null;
    }
  }

  /* 任意音频 Blob → 16kHz 单声道 Float32Array（Whisper 标准输入） */
  async function decodeTo16kMono(blob) {
    const ab = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    try {
      const buf = await ctx.decodeAudioData(ab);
      const src = buf.getChannelData(0);
      if (buf.sampleRate === 16000) return src;
      const ratio = buf.sampleRate / 16000;
      const out = new Float32Array(Math.floor(src.length / ratio));
      for (let i = 0; i < out.length; i++) out[i] = src[Math.floor(i * ratio)];
      return out;
    } finally {
      ctx.close();
    }
  }

  /**
   * 转写一段音频
   * @param {Blob} blob  录音分片或音频文件
   * @param {string} modelId  见 MODELS 键名
   * @returns {Promise<string>} 识别出的文字（可能为空串）
   */
  async function transcribe(blob, modelId) {
    const t = await ensure(modelId);
    const audio = await decodeTo16kMono(blob);
    if (!audio.length) return '';
    const out = await t(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    return (out && out.text ? out.text : '').trim();
  }

  /** 主动释放显存/内存（切换模型时调用） */
  async function dispose() {
    if (transcriber && transcriber.model) {
      try { await transcriber.model.dispose(); } catch { /* 忽略 */ }
    }
    transcriber = null;
    loadedModel = '';
  }

  return { ensure, transcribe, dispose, MODELS, get loadedModel() { return loadedModel; } };
})();
