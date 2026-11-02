/** 智能体 0：语音转写员 —— 调用接入 API 的音频转写能力（STT） */
const llm = require('./llm');

module.exports = {
  name: '语音转写员',
  role: '调用 LLM 服务商的 /audio/transcriptions 接口，将会议音频转成文字',
  async run(audioBuffer, ext) {
    return { text: await llm.transcribeAudio(audioBuffer, ext) };
  },
};
