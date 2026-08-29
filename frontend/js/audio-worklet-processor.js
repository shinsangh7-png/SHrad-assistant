class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.resampleRatio = this.targetSampleRate / sampleRate;
    this.buffer = [];
    this.batchSize = 1600; // samples at 16kHz (~100ms per WS frame)
  }

  process(inputs) {
    const input = inputs[0];
    const channelData = input && input[0];
    if (!channelData || channelData.length === 0) return true;

    const outLength = Math.max(1, Math.round(channelData.length * this.resampleRatio));
    for (let i = 0; i < outLength; i++) {
      const srcIndex = i / this.resampleRatio;
      const idx0 = Math.floor(srcIndex);
      const idx1 = Math.min(idx0 + 1, channelData.length - 1);
      const frac = srcIndex - idx0;
      const sample = channelData[idx0] * (1 - frac) + channelData[idx1] * frac;
      this.buffer.push(sample);
    }

    while (this.buffer.length >= this.batchSize) {
      const chunk = this.buffer.splice(0, this.batchSize);
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-worklet-processor", PCMWorkletProcessor);
