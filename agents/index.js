/**
 * 协调器（Orchestrator）—— 多智能体协作入口
 * 一个转写文本，并行调度多个智能体，聚合结果
 */
const summaryAgent = require('./summaryAgent');
const mindmapAgent = require('./mindmapAgent');
const infographicAgent = require('./infographicAgent');
const sttAgent = require('./sttAgent');

function requireTranscript(transcript) {
  if (!transcript || !String(transcript).trim()) {
    const err = new Error('缺少转写文本'); err.status = 400; throw err;
  }
  return String(transcript);
}

module.exports = {
  summaryAgent,
  mindmapAgent,
  infographicAgent,
  sttAgent,

  /** 单个智能体入口 */
  summarize: t => summaryAgent.run(requireTranscript(t)),
  mindmap: t => mindmapAgent.run(requireTranscript(t)),
  infographic: t => infographicAgent.run(requireTranscript(t)),
  transcribe: (buf, ext) => sttAgent.run(buf, ext),

  /**
   * 一键全流程：并行调度 纪要专员 / 导图专家 / 信息图设计师
   * onProgress(agentName) 可选回调，用于前端展示协作进度
   */
  async runAll(transcript, onProgress) {
    const t = requireTranscript(transcript);
    const jobs = [
      { name: summaryAgent.name, run: () => summaryAgent.run(t) },
      { name: mindmapAgent.name, run: () => mindmapAgent.run(t) },
      { name: infographicAgent.name, run: () => infographicAgent.run(t) },
    ];
    const results = await Promise.all(jobs.map(async j => {
      if (onProgress) onProgress(j.name);
      return j.run();
    }));
    return {
      summary: results[0].summary,
      mindmap: results[1].mindmap,
      tree: results[1].tree,
      svg: results[2].svg,
      info: results[2].info,
      agents: jobs.map(j => j.name),
    };
  },
};
