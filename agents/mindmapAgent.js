/** 智能体 2：思维导图专家 —— 从转写文本提炼 Mermaid mindmap */
const llm = require('./llm');

const SYSTEM = '你是思维导图专家，只输出 Mermaid mindmap 代码。';
const PROMPT = `你是一名思维导图专家。请阅读以下会议转写文本，生成一个 Mermaid mindmap 思维导图代码。
要求：
1. 只输出 Mermaid 代码，不要输出任何解释或其他内容；
2. 第一行必须是 "mindmap"（使用 mindmap 语法，缩进用两个空格）；
3. 根节点是会议主题（简短概括）；
4. 二级分支建议包括：核心议题、关键结论、决议事项、待办任务、风险与问题；
5. 每个分支下提炼 2-5 个子节点，节点文字尽量精炼（不超过 15 字），不要包含换行和特殊符号。

会议转写文本如下：

`;

function parseMermaidTree(code) {
  /** 将 mermaid mindmap 文本解析为嵌套树（供小程序原生渲染） */
  const lines = String(code).split('\n');
  const root = { name: '会议总结', children: [] };
  const stack = [{ depth: -1, node: root }];
  let started = false;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (!started) {
      if (raw.trim() === 'mindmap') { started = true; }
      continue;
    }
    const indent = raw.match(/^ */)[0].length;
    let name = raw.trim()
      .replace(/::icon\([^)]*\)/g, '')
      .replace(/^\((.*)\)$/g, '$1')
      .replace(/^root\s*\(\s*(.*)\s*\)$/g, '$1')
      .trim();
    if (!name) continue;
    const depth = Math.floor(indent / 2);
    const node = { name, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }
  const first = root.children[0];
  return first ? { name: first.name, children: first.children } : root;
}

module.exports = {
  name: '导图专家',
  role: '从会议内容提炼层级结构，输出 Mermaid mindmap 思维导图代码',
  parseMermaidTree,
  async run(transcript) {
    let code = await llm.chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: PROMPT + String(transcript).slice(0, 60000) },
    ], { temperature: 0.2 });
    code = code.replace(/^```(?:mermaid)?\s*/i, '').replace(/\s*```$/, '').trim();
    return { mindmap: code, tree: parseMermaidTree(code) };
  },
};
