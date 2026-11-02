/** 轻量 Markdown → rich-text HTML（支持标题、列表、表格、加粗、行内代码） */
function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inline(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
}

function md2html(md) {
  const lines = String(md || '').split('\n');
  const out = [];
  let listType = null;
  let tableRows = [];

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const closeTable = () => {
    if (tableRows.length) {
      out.push('<table style="border-collapse:collapse;width:100%;font-size:26rpx;margin:16rpx 0;">' + tableRows.join('') + '</table>');
      tableRows = [];
    }
  };
  const rowHtml = (cells, tag) =>
    '<tr>' + cells.map(c =>
      `<${tag} style="border:1rpx solid #232c47;padding:12rpx 16rpx;text-align:left;">${inline(c)}</${tag}>`
    ).join('') + '</tr>';

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
      tableRows.push(rowHtml(cells, tableRows.length ? 'td' : 'th'));
      continue;
    }
    closeTable();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const size = [40, 34, 30, 28][h[1].length - 1];
      out.push(`<div style="font-size:${size}rpx;font-weight:700;color:#c7d2fe;margin:22rpx 0 12rpx;">${inline(h[2])}</div>`);
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)/);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul style="margin:8rpx 0 8rpx 36rpx;">'); listType = 'ul'; }
      out.push(`<li style="margin:6rpx 0;color:#cbd5e1;">${inline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\d+[.、]\s*(.*)/);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol style="margin:8rpx 0 8rpx 36rpx;">'); listType = 'ol'; }
      out.push(`<li style="margin:6rpx 0;color:#cbd5e1;">${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    out.push(`<div style="margin:10rpx 0;color:#cbd5e1;">${inline(line)}</div>`);
  }
  closeList(); closeTable();
  return out.join('');
}

module.exports = { md2html };
