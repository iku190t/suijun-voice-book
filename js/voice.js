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

export function normalizeLevelReading(text) {
  let normalized = normalizeSpokenNumber(text).replace(/^\+/, "");
  if (/^\d{4}$/.test(normalized)) {
    normalized = `${normalized[0]}.${normalized.slice(1)}`;
  }
  if (!/^\d\.\d{3}$/.test(normalized)) return "";
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 && number < 10 ? normalized : "";
}

export function chooseLevelReading(transcript, alternatives = []) {
  const readings = [transcript, ...alternatives]
    .map(normalizeLevelReading)
    .filter(Boolean);
  const uniqueReadings = [...new Set(readings)];
  return uniqueReadings.length === 1 ? uniqueReadings[0] : "";
}

export function levelReadingToSpeech(value) {
  return String(value ?? "")
    .split("")
    .map((character) => character === "." ? "点" : character)
    .join("、");
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

export function speakBack(value, rate = 0.9) {
  if (!("speechSynthesis" in window) || value === "" || value === null || value === undefined) {
    return Promise.resolve();
  }
  const spoken = String(value).replace(/^-/, "マイナス").replace(/\./g, "点");
  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = "ja-JP";
  utterance.rate = Math.min(1.5, Math.max(0.5, Number(rate) || 0.9));
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

export function createVoiceController({ onResult, onStatus, onListeningChange, shouldFinalize }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return { supported: false, start() {}, cancel() {} };

  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 5;
  let pendingTranscript = "";
  let pendingAlternatives = [];
  let recognitionFailed = false;
  let finishRequested = false;
  let resultDelivered = false;
  let cancelRequested = false;
  let recognitionState = "idle";
  let restartQueued = false;

  const beginRecognition = () => {
    cancelRequested = false;
    pendingTranscript = "";
    pendingAlternatives = [];
    recognitionFailed = false;
    finishRequested = false;
    resultDelivered = false;
    recognitionState = "starting";
    try {
      recognition.start();
    } catch {
      recognitionState = "idle";
      onListeningChange(false);
      onStatus("");
    }
  };

  recognition.onstart = () => {
    if (cancelRequested) {
      try { recognition.abort(); } catch {}
      return;
    }
    recognitionState = "listening";
    onListeningChange(true);
    onStatus("音声を聞き取り中");
  };
  recognition.onend = () => {
    const wasCancelled = cancelRequested;
    recognitionState = "idle";
    if (wasCancelled && restartQueued) {
      restartQueued = false;
      beginRecognition();
      return;
    }
    onListeningChange(false);
    cancelRequested = false;
    if (resultDelivered) {
      resultDelivered = false;
      return;
    }
    if (!wasCancelled && !recognitionFailed && pendingTranscript) {
      const transcript = pendingTranscript;
      const alternatives = pendingAlternatives;
      pendingTranscript = "";
      onStatus("認識結果を復唱します");
      onResult(transcript, { alternatives, isFinal: true });
    } else {
      onStatus("");
    }
  };
  recognition.onerror = () => {
    recognitionFailed = true;
    pendingTranscript = "";
    pendingAlternatives = [];
    if (cancelRequested) return;
    onListeningChange(false);
    onStatus("");
  };
  recognition.onresult = (event) => {
    if (cancelRequested || recognitionState === "cancelling") return;
    const results = Array.from(event.results);
    pendingTranscript = results
      .map((result) => result[0]?.transcript || "")
      .join("");
    const leadingTranscript = results
      .slice(0, -1)
      .map((result) => result[0]?.transcript || "")
      .join("");
    pendingAlternatives = results.length
      ? Array.from(results.at(-1))
        .map((alternative) => `${leadingTranscript}${alternative?.transcript || ""}`)
        .filter(Boolean)
      : [];
    const isFinal = Boolean(results.at(-1)?.isFinal);
    if (!finishRequested && shouldFinalize?.(pendingTranscript, {
      alternatives: pendingAlternatives,
      isFinal
    })) {
      finishRequested = true;
      resultDelivered = true;
      const transcript = pendingTranscript;
      const alternatives = pendingAlternatives;
      pendingTranscript = "";
      pendingAlternatives = [];
      onStatus("認識結果を復唱します");
      onResult(transcript, { alternatives, isFinal });
      try {
        recognition.stop();
      } catch {
        onListeningChange(false);
      }
    }
  };

  return {
    supported: true,
    start() {
      if (recognitionState !== "idle") {
        if (cancelRequested || recognitionState === "cancelling") {
          restartQueued = true;
          onStatus("音声入力を準備中");
        }
        return;
      }
      beginRecognition();
    },
    cancel() {
      restartQueued = false;
      cancelRequested = true;
      recognitionFailed = true;
      pendingTranscript = "";
      pendingAlternatives = [];
      finishRequested = true;
      resultDelivered = false;
      if (recognitionState !== "idle") recognitionState = "cancelling";
      try { recognition.abort(); } catch {}
      window.speechSynthesis?.cancel?.();
      onListeningChange(false);
      onStatus("");
    }
  };
}
