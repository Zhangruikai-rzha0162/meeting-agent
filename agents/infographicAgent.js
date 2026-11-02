/** 智能体 3：信息图设计师 —— 先由 LLM 提取关键信息，再合成为 SVG 总结图 */
const llm = require('./llm');

const SYSTEM = '你是信息图设计师，只输出符合指定格式的 JSON。';
const PROMPT = `你是一名信息图设计师。请阅读以下会议转写文本，提取关键信息并**只输出一个 JSON 对象**（不要输出 markdown 代码块、不要任何解释），格式如下：
{
  "title": "会议标题（不超过 20 字）",
  "date": "会议日期（YYYY-MM-DD，若原文未提及则用今天）",
  "key_points": ["核心要点1", "核心要点2", ...最多 6 条，每条不超过 40 字],
  "decisions": ["决议1", "决议2", ...最多 4 条，每条不超过 30 字],
  "actions": [{"task": "任务内容（不超过 25 字）", "owner": "负责人"}, ...最多 5 条]
}
忠实于原文，不要编造。会议转写文本如下：

`;

/* ---------------- SVG 合成 ---------------- */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wrapText(text, maxUnits) {
  const lines = []; let line = '';
  for (const ch of String(text)) {
    line += ch;
    const w = [...line].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
    if (w >= maxUnits) { lines.push(line); line = ''; }
  }
  if (line) lines.push(line);
  return lines;
}
function bulletLines(items, maxPerItem, maxItems, maxUnits) {
  const out = [];
  (items || []).slice(0, maxItems).forEach(it => {
    wrapText(it, maxUnits).slice(0, maxPerItem).forEach((l, i) =>
      out.push({ text: (i === 0 ? '• ' : '  ') + l }));
  });
  return out;
}

function buildSummarySvg(info, modelName) {
  const W = 900;
  const title = info.title || '会议总结';
  const date = info.date || new Date().toLocaleDateString('zh-CN');
  const keyPoints = Array.isArray(info.key_points) ? info.key_points : [];
  const decisions = Array.isArray(info.decisions) ? info.decisions : [];
  const actions = Array.isArray(info.actions) ? info.actions : [];

  const kpLines = bulletLines(keyPoints, 2, 6, 52);
  const dcLines = bulletLines(decisions, 2, 4, 52);
  const acWrapped = [];
  actions.slice(0, 5).forEach(a => {
    const t = `□ ${a.owner ? a.owner + '：' : ''}${a.task || a}`;
    wrapText(t, 46).forEach((l, i) => acWrapped.push({ text: i === 0 ? l : '  ' + l }));
  });

  const lineH = 26;
  const H = 200 + Math.max(1, kpLines.length) * lineH + Math.max(1, dcLines.length) * lineH
    + Math.max(1, acWrapped.length) * lineH + 130;

  let y = 0;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif">`);
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="head" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)" rx="16"/>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="120" fill="url(#head)" rx="16"/>`);
  parts.push(`<rect x="0" y="60" width="${W}" height="60" fill="url(#head)"/>`);
  parts.push(`<text x="40" y="58" fill="#fff" font-size="30" font-weight="700">${esc(title)}</text>`);
  parts.push(`<text x="40" y="92" fill="#e0e7ff" font-size="15">📅 ${esc(date)}　📝 要点 ${keyPoints.length} 条　✅ 决议 ${decisions.length} 项　📌 待办 ${actions.length} 件</text>`);
  y = 150;

  function section(label, icon, lines, x, accent) {
    let out = `<text x="${x}" y="${y + 8}" fill="${accent}" font-size="18" font-weight="700">${icon} ${esc(label)}</text>`;
    out += `<rect x="${x}" y="${y + 16}" width="36" height="3" rx="1.5" fill="${accent}"/>`;
    let ly = y + 48;
    if (!lines.length) {
      out += `<text x="${x}" y="${ly}" fill="#64748b" font-size="14">（无）</text>`;
      ly += lineH;
    }
    for (const l of lines) {
      for (const t of wrapText(l.text, 100)) {
        out += `<text x="${x}" y="${ly}" fill="#cbd5e1" font-size="15">${esc(t)}</text>`;
        ly += lineH;
      }
    }
    return { svg: out, height: ly - y + 4 };
  }

  const s1 = section('核心要点', '💡', kpLines, 40, '#818cf8');
  y += s1.height + 12; parts.push(s1.svg);
  const s2 = section('会议决议', '✅', dcLines, 40, '#34d399');
  y += s2.height + 12; parts.push(s2.svg);
  const s3 = section('待办事项', '📌', acWrapped, 40, '#fbbf24');
  y += s3.height + 12; parts.push(s3.svg);

  parts.push(`<text x="${W - 40}" y="${H - 20}" text-anchor="end" fill="#475569" font-size="12">由 MeetMind 多智能体生成 · ${esc(modelName || '')}</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

function safeJson(text) {
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

module.exports = {
  name: '信息图设计师',
  role: '提取会议关键信息并合成为一图流 SVG 总结卡片',
  buildSummarySvg,
  async run(transcript) {
    const text = await llm.chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: PROMPT + String(transcript).slice(0, 60000) },
    ], { temperature: 0.2 });
    let info;
    try { info = safeJson(text); }
    catch { info = { title: '会议总结', key_points: [], decisions: [], actions: [] }; }
    const snap = llm.snapshot();
    return { svg: buildSummarySvg(info, snap.model), info };
  },
};
