const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isSpeechSupported() {
  return !!SpeechRecognitionImpl;
}

export class Dictation {
  constructor({ onFinalResult, onError, onSpeechStart, onSpeechEnd }) {
    this.onFinalResult = onFinalResult;
    this.onError = onError;
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.recognition = null;
    this.shouldBeRunning = false;
  }

  start() {
    if (!SpeechRecognitionImpl) {
      this.onError?.("이 브라우저는 음성인식을 지원하지 않습니다. Chrome이나 Edge를 사용해주세요.");
      return;
    }
    if (this.shouldBeRunning) return;
    this.shouldBeRunning = true;
    this._startRecognition();
  }

  stop() {
    this.shouldBeRunning = false;
    this.recognition?.stop();
  }

  _startRecognition() {
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const transcript = result[0].transcript.trim();
          if (transcript) this.onFinalResult?.(transcript);
        }
      }
    };

    recognition.onspeechstart = () => this.onSpeechStart?.();
    recognition.onspeechend = () => this.onSpeechEnd?.();

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.onError?.(`음성인식 오류: ${event.error}`);
    };

    recognition.onend = () => {
      // Web Speech API stops itself after a period of silence even in continuous mode —
      // transparently restart so the mic stays "on" until the user explicitly stops it.
      if (this.shouldBeRunning) {
        this._startRecognition();
      }
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (e) {
      // start() throws if called while already running — safe to ignore.
    }
  }
}
