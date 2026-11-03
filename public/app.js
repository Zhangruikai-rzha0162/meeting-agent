/* MeetMind 会议智能体 —— 前端逻辑 */
const $ = s => document.querySelector(s);

const transcriptEl = $('#transcript');
const toastEl = $('#toast');
let toastTimer = null;

function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

/* ---------- 状态检测 ---------- */
async function checkHealth() {
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    const pill = $('#statusPill');
    if (d.configured && d.keyValid) {
      pill.className = 'status ok';
      $('#statusText').textContent = `LLM 已连接 · ${d.model}`;
    } else {
      pill.className = 'status bad';
      $('#statusText').textContent = 'LLM 未配置';
      toast('未检测到外部 .env 配置，请在 ~/.meetmind/.env 或程序上级目录配置 LLM_API_KEY', 6000);
    }
    $('#envInfo').textContent = d.envFile
      ? `配置文件：${d.envFile}`
      : '未找到外部 .env 文件（查找顺序：MEETMIND_ENV → ~/.meetmind/.env → 程序上级目录/.env）';
  } catch {
    $('#statusPill').className = 'status bad';
    $('#statusText').textContent = '服务未连接';
  }
}

/* ---------- 字数统计 ---------- */
function updateCount() {
  const n = transcriptEl.value.length;
  $('#wordCount').textContent = `${n} 字`;
}
transcriptEl.addEventListener('input', updateCount);

/* ---------- 实时转写 ----------
 * 主引擎：MediaRecorder 每 6 秒切一片 → POST /api/transcribe（走 ⚙️ 中配置的 STT 接口）
 * 回退：浏览器内置 Web Speech（免费，但依赖 Google 服务，国内网络通常不可用）
 */
let recognition = null, recording = false, recSeconds = 0, recTimerId = null;
let finalBuffer = '';
let mediaStream = null, recorder = null;
let segQueue = [], segWorking = false, segCount = 0, segErrors = 0;

function speechSupported() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

function appendTranscript(text) {
  if (!text || !text.trim()) return;
  transcriptEl.value = (transcriptEl.value ? transcriptEl.value.replace(/\n?$/, '\n') : '') + text.trim() + '\n';
  updateCount();
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

/* 分片转写工作线程：串行消费队列，保证段落顺序 */
async function segmentWorker() {
  if (segWorking) return;
  segWorking = true;
  while (segQueue.length) {
    const blob = segQueue.shift();
    segCount++;
    if (recording) $('#interimText').textContent = `正在转写第 ${segCount} 段…`;
    try {
      const text = await transcribeSegment(blob);
      if (text) appendTranscript(text);
      segErrors = 0;
    } catch (err) {
      segErrors++;
      if (recording) $('#interimText').textContent = `第 ${segCount} 段转写失败，已跳过`;
      if (segErrors === 1) toast('转写出错：' + err.message, 5200);
      if (segErrors >= 3 && recording) {
        toast('连续 3 段转写失败，已停止。请在 ⚙️ 检查「转写接口」配置（推荐 Groq 免费额度）', 6500);
        stopRecording();
      }
    }
  }
  segWorking = false;
  if (recording) $('#interimText').textContent = '聆听中…（每 6 秒自动转写一段）';
}

function transcribeSegment(blob) {
  return (async () => {
    const r = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', 'x-audio-ext': 'webm' },
      body: blob,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '转写失败');
    return d.text || '';
  })();
}

/* 主引擎：MediaRecorder 定时切片 */
async function startApiRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  recorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = e => {
    if (e.data && e.data.size) { segQueue.push(e.data); segmentWorker(); }
  };
  recorder.onerror = e => {
    toast('录音出错：' + ((e.error && e.error.name) || e.error || '未知错误'), 4000);
    stopRecording();
  };
  recorder.start(6000);   // 每 6 秒产出一个分片
}

function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        finalBuffer += r[0].transcript.trim() + '\n';
        transcriptEl.value = (transcriptEl.value ? transcriptEl.value.replace(/\n?$/, '\n') : '') + r[0].transcript.trim() + '\n';
        updateCount();
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
      } else {
        interim += r[0].transcript;
      }
    }
    $('#interimText').textContent = interim ? '识别中：' + interim : '';
  };
  recognition.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      toast('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问', 4000);
      stopRecording();
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      toast('转写出错：' + e.error);
    }
  };
  recognition.onend = () => {
    // 连续模式下自动重启，直到用户手动停止
    if (recording) { try { recognition.start(); } catch {} }
  };
  recognition.start();
}

function fmtTime(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function resetRecUI() {
  $('#recInfo').hidden = true;
  $('#interimText').textContent = '';
  $('#btnRecord').textContent = '⏺ 开始实时转写';
  $('#btnRecord').classList.remove('recording');
}

async function startRecording() {
  const apiRecAvailable = Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
  if (!apiRecAvailable && !speechSupported()) {
    toast('当前环境不支持录音转写，可粘贴文本或上传音频文件', 4500);
    return;
  }
  recording = true;
  recSeconds = 0;
  segCount = 0; segErrors = 0; segQueue = [];
  $('#recTimer').textContent = '00:00';
  $('#recInfo').hidden = false;
  $('#btnRecord').textContent = '⏹ 停止转写';
  $('#btnRecord').classList.add('recording');
  recTimerId = setInterval(() => { recSeconds++; $('#recTimer').textContent = fmtTime(recSeconds); }, 1000);

  if (apiRecAvailable) {
    try {
      await startApiRecording();
      $('#interimText').textContent = '聆听中…（每 6 秒自动转写一段）';
      return;
    } catch (e) {
      if (!speechSupported()) {
        toast('无法打开麦克风：' + e.message + '（请在系统设置中允许麦克风访问）', 5000);
        stopRecording();
        return;
      }
      toast('麦克风录音不可用，改用浏览器内置识别（国内网络下可能不稳定）', 4200);
    }
  }
  // 回退：浏览器内置 Web Speech
  startRecognition();
}

function stopRecording() {
  recording = false;
  clearInterval(recTimerId);
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch {}   // stop 会触发最后一个分片的 dataavailable，由工作线程排空
    recorder = null;
  }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (recognition) { try { recognition.stop(); } catch {} recognition = null; }
  resetRecUI();
}
$('#btnRecord').addEventListener('click', () => (recording ? stopRecording() : startRecording()));

/* ---------- 音频文件转写 ---------- */
$('#btnUpload').addEventListener('click', () => $('#fileAudio').click());
$('#fileAudio').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const ext = (file.name.split('.').pop() || 'webm').toLowerCase();
  toast(`正在上传音频并由大模型转写：${file.name}…`, 4000);
  try {
    const r = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'audio/webm', 'x-audio-ext': ext },
      body: file,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '转写失败');
    if (!d.text) throw new Error('转写结果为空');
    transcriptEl.value = (transcriptEl.value ? transcriptEl.value + '\n' : '') + d.text;
    updateCount();
    toast('音频转写完成 ✔');
  } catch (err) {
    toast('音频转写失败：' + err.message, 5000);
  }
});

/* ---------- 导出 / 清空 ---------- */
function download(name, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
$('#btnExport').addEventListener('click', () => {
  if (!transcriptEl.value.trim()) return toast('转写内容为空');
  download(`会议转写_${Date.now()}.txt`, transcriptEl.value);
});
$('#btnClear').addEventListener('click', () => {
  if (!transcriptEl.value.trim() || confirm('确定清空全部转写内容？')) {
    transcriptEl.value = '';
    updateCount();
  }
});

/* ---------- 轻量 Markdown 渲染 ---------- */
function mdToHtml(md) {
  const lines = md.split('\n');
  let html = '', inTable = null, inList = null;
  const inline = t => t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  const closeList = () => { if (inList) { html += `</${inList}>`; inList = null; } };
  const closeTable = () => { if (inTable) { html += '</table>'; inTable = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue; // 分隔行
      if (!inTable) { html += '<table>'; inTable = true; }
      const tag = html.endsWith('<table>') ? 'th' : 'td';
      html += '<tr>' + cells.map(c => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>';
      continue;
    }
    closeTable();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    const ul = line.match(/^[-*]\s+(.*)/);
    if (ul) {
      if (inList !== 'ul') { closeList(); html += '<ul>'; inList = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`; continue;
    }
    const ol = line.match(/^\d+[.、]\s*(.*)/);
    if (ol) {
      if (inList !== 'ol') { closeList(); html += '<ol>'; inList = 'ol'; }
      html += `<li>${inline(ol[1])}</li>`; continue;
    }
    closeList();
    if (!line.trim()) { html += ''; continue; }
    html += `<p>${inline(line)}</p>`;
  }
  closeList(); closeTable();
  return html;
}

/* ---------- 标签页 ---------- */
const tabsEl = $('#tabs');
function showTab(name) {
  tabsEl.hidden = false;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['summary', 'mindmap', 'image'].forEach(n => $(`#page-${n}`).hidden = n !== name);
  $('#emptyState').style.display = 'none';
}
document.querySelectorAll('.tab').forEach(t =>
  t.addEventListener('click', () => showTab(t.dataset.tab)));

/* ---------- 生成请求 ---------- */
const genState = { summary: '', mindmap: '', imageSvg: '' };
let mermaidReady = false;
if (window.mermaid) {
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
  mermaidReady = true;
}

function getTranscript() {
  const t = transcriptEl.value.trim();
  if (!t) { toast('请先进行转写或粘贴会议文本'); return null; }
  if (t.length < 20) { toast('文本太短，请至少输入 20 个字'); return null; }
  return t;
}
function setLoading(on, text) {
  $('#loading').hidden = !on;
  if (text) $('#loadingText').textContent = text;
  document.querySelectorAll('[data-gen]').forEach(b => (b.disabled = on));
}

async function generate(kind) {
  const t = getTranscript();
  if (!t) return;

  if (kind === 'all') {
    setLoading(true, '多智能体协作中：纪要专员 + 导图专家 + 信息图设计师…');
    try {
      const r = await fetch('/api/run-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: t }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '生成失败');
      genState.summary = d.summary;
      $('#summaryResult').innerHTML = mdToHtml(d.summary);
      genState.mindmap = d.mindmap;
      await renderMindmap(d.mindmap);
      genState.imageSvg = d.svg;
      $('#imageResult').innerHTML = d.svg;
      showTab('summary');
      toast(`⚡ 已并行完成 ${d.agents.length} 个智能体的产出 ✔`);
    } catch (err) {
      toast('一键生成失败：' + err.message, 5000);
    } finally {
      setLoading(false);
    }
    return;
  }

  const cfg = {
    summary: ['/api/summarize', '纪要专员工作中…'],
    mindmap: ['/api/mindmap', '导图专家工作中…'],
    image: ['/api/summary-image', '信息图设计师工作中…'],
  }[kind];
  setLoading(true, cfg[1]);
  try {
    const r = await fetch(cfg[0], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: t }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '生成失败');

    if (kind === 'summary') {
      genState.summary = d.result;
      $('#summaryResult').innerHTML = mdToHtml(d.result);
      showTab('summary');
    } else if (kind === 'mindmap') {
      genState.mindmap = d.result;
      await renderMindmap(d.result);
      showTab('mindmap');
    } else {
      genState.imageSvg = d.svg;
      $('#imageResult').innerHTML = d.svg;
      showTab('image');
    }
  } catch (err) {
    toast('生成失败：' + err.message, 5000);
  } finally {
    setLoading(false);
  }
}
document.querySelectorAll('[data-gen]').forEach(b =>
  b.addEventListener('click', () => generate(b.dataset.gen)));

async function renderMindmap(code) {
  const pre = $('#mindmapPre');
  if (!mermaidReady) {
    pre.textContent = code;
    toast('思维导图组件未加载（需要联网加载 mermaid），已显示源码', 4500);
    return;
  }
  pre.removeAttribute('data-processed');
  pre.textContent = code;
  try {
    const { svg } = await mermaid.render('mindmapGraph', code);
    pre.innerHTML = svg;
  } catch (e) {
    pre.textContent = code;
    toast('思维导图渲染失败，已显示源码', 4000);
  }
}

/* ---------- 结果下载 ---------- */
$('#btnCopySummary').addEventListener('click', async () => {
  if (!genState.summary) return;
  await navigator.clipboard.writeText(genState.summary);
  toast('总结已复制到剪贴板 ✔');
});
$('#btnDlSummary').addEventListener('click', () => {
  if (genState.summary) download(`会议纪要_${Date.now()}.md`, genState.summary, 'text/markdown');
});

function svgToPng(svgText, name) {
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      download(name, blob);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('PNG 导出失败，可尝试下载 SVG'); };
  img.src = url;
}

$('#btnDlMindmapSvg').addEventListener('click', () => {
  if (genState.mindmap) {
    const svg = $('#mindmapPre svg');
    download(`思维导图_${Date.now()}.svg`,
      svg ? svg.outerHTML : genState.mindmap, 'image/svg+xml');
  }
});
$('#btnDlMindmapPng').addEventListener('click', () => {
  const svg = $('#mindmapPre svg');
  if (svg) svgToPng(svg.outerHTML, `思维导图_${Date.now()}.png`);
});
$('#btnDlImageSvg').addEventListener('click', () => {
  if (genState.imageSvg) download(`总结图_${Date.now()}.svg`, genState.imageSvg, 'image/svg+xml');
});
$('#btnDlImagePng').addEventListener('click', () => {
  if (genState.imageSvg) svgToPng(genState.imageSvg, `总结图_${Date.now()}.png`);
});

/* ---------- API 配置弹窗 ---------- */
const configModal = $('#configModal');
const cfgTestResult = $('#cfgTestResult');

async function openConfig() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    $('#cfgBaseUrl').value = d.baseUrl || 'https://api.deepseek.com/v1';   // 未配置时预填默认值，只需填 Key
    $('#cfgKey').value = d.apiKeyMasked || '';   // 打码值，未修改则保留原 Key
    $('#cfgKey').placeholder = d.apiKeyMasked ? '已配置（显示打码），留空保持不变' : 'sk-...';
    $('#cfgModel').value = d.model || 'deepseek-chat';
    $('#cfgStt').value = d.sttModel || 'whisper-1';
    // 转写独立配置（留空 = 跟随上面的 LLM 配置）
    $('#cfgSttBase').value = d.sttBaseUrl || '';
    $('#cfgSttKey').value = d.sttApiKeyMasked || '';
    $('#cfgSttKey').placeholder = d.sttApiKeyMasked ? '已配置（显示打码），留空保持不变' : '默认同上面的 Key，可留空';
    $('#cfgEnvText').value = '';
    $('#configPath').textContent = d.envFile || '（尚未创建，将保存到 ~/.meetmind/.env）';
  } catch {
    $('#configPath').textContent = '（服务未连接）';
  }
  cfgTestResult.textContent = '';
  cfgTestResult.className = 'test-result';
  toastEl.hidden = true;          // 避免提示条挡住弹窗按钮
  clearTimeout(toastTimer);
  configModal.hidden = false;
}
$('#btnSettings').addEventListener('click', openConfig);
$('#btnCloseConfig').addEventListener('click', () => (configModal.hidden = true));
configModal.addEventListener('click', e => {
  if (e.target === configModal) configModal.hidden = true;
});

async function saveConfig({ silent = false } = {}) {
  const body = {
    baseUrl: $('#cfgBaseUrl').value.trim(),
    apiKey: $('#cfgKey').value.trim(),
    model: $('#cfgModel').value.trim(),
    sttModel: $('#cfgStt').value.trim(),
    sttBaseUrl: $('#cfgSttBase').value.trim(),
    sttApiKey: $('#cfgSttKey').value.trim(),
    envText: $('#cfgEnvText').value,
  };
  const r = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || '保存失败');
  if (!silent) {
    configModal.hidden = true;
    toast('✔ 配置已保存到外部 .env 并即时生效');
  }
  checkHealth();
  return d;
}

$('#btnTestConfig').addEventListener('click', async () => {
  cfgTestResult.textContent = '保存并测试中…';
  cfgTestResult.className = 'test-result';
  try {
    await saveConfig({ silent: true });   // 先写入内存与外部 .env
    const r = await fetch('/api/config/test', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      cfgTestResult.textContent = `✔ 连接正常 · ${d.model} · ${d.latencyMs}ms`;
      cfgTestResult.className = 'test-result ok';
    } else {
      cfgTestResult.textContent = '✘ ' + d.error;
      cfgTestResult.className = 'test-result bad';
    }
  } catch (err) {
    cfgTestResult.textContent = '✘ ' + err.message;
    cfgTestResult.className = 'test-result bad';
  }
});

$('#btnSaveConfig').addEventListener('click', async () => {
  try { await saveConfig(); }
  catch (err) { toast('保存失败：' + err.message, 5000); }
});

/* Groq 免费转写预设：接口 + 模型一键填入，Key 由用户在 console.groq.com 免费申请 */
$('#btnGroqPreset').addEventListener('click', () => {
  $('#cfgSttBase').value = 'https://api.groq.com/openai/v1';
  $('#cfgStt').value = 'whisper-large-v3-turbo';
  $('#cfgSttKey').placeholder = '填入 Groq Key（console.groq.com 免费申请）';
  cfgTestResult.textContent = '已填入 Groq 免费转写接口与模型，请在「转写 Key」处粘贴 Groq Key 后保存';
  cfgTestResult.className = 'test-result';
  $('#cfgSttKey').focus();
});

/* 生成 1 秒正弦波测试 WAV，验证转写接口真实可用 */
function makeTestWav() {
  const sr = 16000, n = sr;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE'); wstr(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 18) * 10000), true);
  return new Blob([buf], { type: 'audio/wav' });
}

$('#btnTestStt').addEventListener('click', async () => {
  cfgTestResult.textContent = '保存并测试转写中…';
  cfgTestResult.className = 'test-result';
  try {
    await saveConfig({ silent: true });   // 先落盘热生效，确保用最新 STT 配置
    const r = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'x-audio-ext': 'wav' },
      body: makeTestWav(),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '转写失败');
    cfgTestResult.textContent = `✔ 转写接口可用 · 模型 ${d.model || ''} · 返回 ${(d.text || '').length} 字`;
    cfgTestResult.className = 'test-result ok';
  } catch (err) {
    cfgTestResult.textContent = '✘ ' + err.message;
    cfgTestResult.className = 'test-result bad';
  }
});

/* ---------- 初始化 ---------- */
updateCount();
checkHealth();
if (typeof MediaRecorder === 'undefined' && !speechSupported()) {
  $('#btnRecord').title = '当前环境不支持录音转写，建议使用最新版 Edge/Chrome，或粘贴文本、上传音频';
}
