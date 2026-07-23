const KANJI_DIGITS = new Map([
  ["〇", "0"], ["零", "0"], ["一", "1"], ["二", "2"], ["三", "3"], ["四", "4"],
  ["五", "5"], ["六", "6"], ["七", "7"], ["八", "8"], ["九", "9"]
]);

export function normalizeSpokenNumber(text) {
  let normalized = String(text ?? "")
    .normalize("NFKC")
    .replace(/マイナス|負の|ひく|引く/g, "-")
    .replace(/コンマ|カンマ|点/g, ".")
    .replace(/[、。,\s]/g, "");
  KANJI_DIGITS.forEach((digit, kanji) => {
    normalized = normalized.replaceAll(kanji, digit);
  });
  return normalized.replace(/[^0-9.+-]/g, "");
}

let speechPrepared = false;

export function prepareSpeechSynthesis() {
  if (speechPrepared || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  speechPrepared = true;
  window.speechSynthesis.getVoices();
  const primer = new SpeechSynthesisUtterance("\u00a0");
  primer.lang = "ja-JP";
  primer.volume = 0;
  primer.rate = 10;
  window.speechSynthesis.speak(primer);
  window.speechSynthesis.cancel();
}

export function speakBack(value) {
  if (!("speechSynthesis" in window) || value === "" || value === null || value === undefined) {
    return Promise.resolve();
  }
  const spoken = String(value).replace(/^-/, "マイナス").replace(/\./g, "点");
  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = "ja-JP";
  utterance.rate = 0.9;
  return new Promise((resolve) => {
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      clearTimeout(fallbackTimer);
      resolve();
    };
    const fallbackTimer = setTimeout(finish, 8000);
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}

export function createVoiceController({ onResult, onStatus, onListeningChange }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return { supported: false, start() {} };

  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = false;
  let pendingTranscript = "";
  let recognitionFailed = false;
  recognition.onstart = () => {
    pendingTranscript = "";
    recognitionFailed = false;
    onListeningChange(true);
    onStatus("音声を聞き取り中");
  };
  recognition.onend = () => {
    onListeningChange(false);
    if (!recognitionFailed && pendingTranscript) {
      const transcript = pendingTranscript;
      pendingTranscript = "";
      onStatus("認識結果を復唱します");
      setTimeout(() => onResult(transcript), 180);
    }
  };
  recognition.onerror = () => {
    recognitionFailed = true;
    pendingTranscript = "";
    onListeningChange(false);
    onStatus("");
  };
  recognition.onresult = (event) => {
    pendingTranscript = event.results[0][0].transcript;
  };

  return {
    supported: true,
    start() {
      try {
        recognition.start();
      } catch {
        onListeningChange(false);
      }
    }
  };
}
