export class Recorder {
  constructor({ onStatus, onFinal, onError }) {
    this.onStatus = onStatus;
    this.onFinal = onFinal;
    this.onError = onError;
    this.ws = null;
    this.audioContext = null;
    this.workletNode = null;
    this.stream = null;
    this.recording = false;
  }

  async start({ modality, bodyRegion, mode = "ko-en" }) {
    if (this.recording) return;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext();
    await this.audioContext.audioWorklet.addModule("js/audio-worklet-processor.js");

    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-worklet-processor");
    source.connect(this.workletNode);

    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${wsProtocol}//${location.host}/ws/transcribe?mode=${encodeURIComponent(mode)}`);
    this.ws.binaryType = "arraybuffer";

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error("WebSocket connection failed"));
    });

    this.ws.send(JSON.stringify({ type: "start", sample_rate: 16000, modality, body_region: bodyRegion }));

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "vad_status") this.onStatus?.(data.state);
      else if (data.type === "final") this.onFinal?.(data);
      else if (data.type === "error") this.onError?.(data.message);
    };
    this.ws.onerror = () => this.onError?.("WebSocket error");

    this.workletNode.port.onmessage = (event) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(event.data);
      }
    };

    this.recording = true;
  }

  stop() {
    if (!this.recording) return;
    this.recording = false;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop" }));
      const ws = this.ws;
      setTimeout(() => ws.close(), 1500);
    }
    this.ws = null;

    this.workletNode?.disconnect();
    this.workletNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audioContext?.close();
    this.audioContext = null;
  }
}
