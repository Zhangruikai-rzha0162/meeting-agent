/** 智能体 1：会议纪要专员 —— 将转写文本总结为结构化纪要 */
const llm = require('./llm');

const SYSTEM = '你是专业的会议纪要助手，输出高质量的 Markdown 纪要。';
const PROMPT = `你是一名专业的会议纪要助手。请阅读以下会议转写文本，输出结构化的 Markdown 纪要，包含：
## 会议概要
（一段话概括会议主题与结论）
## 核心要点
（5-8 条要点，每条一句话）
## 会议决议
（会上明确做出的决定）
## 待办事项
（用表格：| 事项 | 负责人 | 截止时间 |，没有负责人的写"待定"）
## 后续跟进建议
（2-3 条）
要求：语言精炼、准确，忠实于原文，不要编造原文没有的信息。会议转写文本如下：

`;

module.exports = {
  name: '纪要专员',
  role: '将会议转写文本总结为结构化 Markdown 纪要（概要 / 要点 / 决议 / 待办 / 建议）',
  async run(transcript) {
    const summary = await llm.chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: PROMPT + String(transcript).slice(0, 60000) },
    ]);
    return { summary };
  },
};
