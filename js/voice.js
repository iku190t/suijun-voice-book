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

export function createVoiceController({
  onResult,
  onStatus,
  onListeningChange,
  onError,
  shouldFinalize,
  startTimeoutMs = 10000
}) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return { supported: false, start() {}, cancel() {}, reset() {} };

  let recognition = null;
  let pendingTranscript = "";
  let pendingAlternatives = [];
  let recognitionFailed = false;
  let finishRequested = false;
  let resultDelivered = false;
  let cancelRequested = false;
  let recognitionState = "idle";
  let restartQueued = false;
  let startTimeoutId = null;
  let interimFinalizeTimer = null;
  let interimFinalizeKey = "";

  const clearStartTimeout = () => {
    if (startTimeoutId === null) return;
    clearTimeout(startTimeoutId);
    startTimeoutId = null;
  };

  const clearInterimFinalize = () => {
    if (interimFinalizeTimer !== null) clearTimeout(interimFinalizeTimer);
    interimFinalizeTimer = null;
    interimFinalizeKey = "";
  };

  const deliverResult = (transcript, alternatives, isFinal) => {
    if (
      finishRequested ||
      cancelRequested ||
      recognitionState === "cancelling" ||
      !transcript
    ) return;
    clearInterimFinalize();
    finishRequested = true;
    resultDelivered = true;
    pendingTranscript = "";
    pendingAlternatives = [];
    onStatus("認識結果を復唱します");
    onResult(transcript, { alternatives, isFinal });
    try {
      recognition?.stop();
    } catch {
      onListeningChange(false);
    }
  };

  const beginRecognition = () => {
    if (!recognition) createRecognitionInstance();
    clearStartTimeout();
    clearInterimFinalize();
    cancelRequested = false;
    pendingTranscript = "";
    pendingAlternatives = [];
    recognitionFailed = false;
    finishRequested = false;
    resultDelivered = false;
    recognitionState = "starting";
    try {
      recognition.start();
      startTimeoutId = setTimeout(() => {
        if (recognitionState !== "starting") return;
        startTimeoutId = null;
        recognitionFailed = true;
        cancelRequested = true;
        recognitionState = "cancelling";
        try { recognition?.abort(); } catch {}
        onListeningChange(false);
        onStatus("");
        onError?.("start-timeout");
        // Safariからabort後のendイベントも返らない場合に、次回開始を妨げない。
        setTimeout(() => {
          if (recognitionState !== "cancelling") return;
          recognitionState = "idle";
          cancelRequested = false;
          restartQueued = false;
        }, 250);
      }, startTimeoutMs);
    } catch {
      clearStartTimeout();
      recognitionState = "idle";
      onListeningChange(false);
      onStatus("");
      onError?.("start-failed");
    }
  };

  const handleRecognitionStart = () => {
    clearStartTimeout();
    if (cancelRequested) {
      try { recognition?.abort(); } catch {}
      return;
    }
    recognitionState = "listening";
    onListeningChange(true);
    onStatus("音声を聞き取り中");
  };
  const handleRecognitionEnd = () => {
    clearStartTimeout();
    clearInterimFinalize();
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
  const handleRecognitionError = (event) => {
    clearStartTimeout();
    clearInterimFinalize();
    recognitionFailed = true;
    pendingTranscript = "";
    pendingAlternatives = [];
    if (cancelRequested) return;
    onListeningChange(false);
    onStatus("");
    onError?.(event?.error || "recognition-error");
  };
  const handleRecognitionResult = (event) => {
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
    const recognitionDetails = {
      alternatives: pendingAlternatives,
      isFinal
    };
    const finalizeDecision = !finishRequested
      ? shouldFinalize?.(pendingTranscript, recognitionDetails)
      : false;
    if (!finalizeDecision) {
      clearInterimFinalize();
      return;
    }

    const delayedInterim = (
      !isFinal &&
      typeof finalizeDecision === "object" &&
      Number(finalizeDecision.delayMs) > 0
    );
    if (delayedInterim) {
      const finalizeKey = String(finalizeDecision.key || pendingTranscript);
      if (interimFinalizeTimer !== null && interimFinalizeKey === finalizeKey) return;
      clearInterimFinalize();
      interimFinalizeKey = finalizeKey;
      interimFinalizeTimer = setTimeout(() => {
        interimFinalizeTimer = null;
        interimFinalizeKey = "";
        const transcript = pendingTranscript;
        const alternatives = pendingAlternatives;
        deliverResult(transcript, alternatives, false);
      }, Math.max(80, Number(finalizeDecision.delayMs)));
      return;
    }

    if (!finishRequested) {
      const transcript = pendingTranscript;
      const alternatives = pendingAlternatives;
      deliverResult(transcript, alternatives, isFinal);
    }
  };

  const createRecognitionInstance = () => {
    const instance = new Recognition();
    instance.lang = "ja-JP";
    instance.interimResults = true;
    instance.continuous = false;
    instance.maxAlternatives = 5;
    instance.onstart = handleRecognitionStart;
    instance.onend = handleRecognitionEnd;
    instance.onerror = handleRecognitionError;
    instance.onresult = handleRecognitionResult;
    recognition = instance;
    return instance;
  };

  const resetRecognition = ({ notify = false } = {}) => {
    clearStartTimeout();
    clearInterimFinalize();
    restartQueued = false;
    cancelRequested = true;
    recognitionFailed = true;
    pendingTranscript = "";
    pendingAlternatives = [];
    finishRequested = true;
    resultDelivered = false;
    recognitionState = "idle";
    const previous = recognition;
    recognition = null;
    if (previous) {
      previous.onstart = null;
      previous.onend = null;
      previous.onerror = null;
      previous.onresult = null;
      try { previous.abort(); } catch {}
    }
    cancelRequested = false;
    createRecognitionInstance();
    if (notify) {
      onListeningChange(false);
      onStatus("");
    }
  };

  createRecognitionInstance();

  return {
    supported: true,
    start() {
      // iOS Safariではロック復帰後に古い認識状態だけが残ることがある。
      // 開始のたびに新しいインスタンスへ交換してから聞き取りを始める。
      resetRecognition();
      beginRecognition();
    },
    cancel() {
      window.speechSynthesis?.cancel?.();
      resetRecognition({ notify: true });
    },
    reset() {
      window.speechSynthesis?.cancel?.();
      resetRecognition();
    }
  };
}
