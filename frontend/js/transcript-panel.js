export class TranscriptPanel {
  constructor({ micBtn, findingsEl }) {
    this.micBtn = micBtn;
    this.findingsEl = findingsEl;
  }

  setStatus(state) {
    this.micBtn.classList.toggle("speech", state === "speech");
  }

  appendSegment({ text }) {
    if (!text) return;
    const current = this.findingsEl.value;
    const sep = current && !current.endsWith("\n") && !current.endsWith(" ") ? " " : "";
    this.findingsEl.value = current + sep + text;
  }
}
