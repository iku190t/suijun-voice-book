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
  if (/^-?\d{4}$/.test(normalized)) {
    const sign = normalized.startsWith("-") ? "-" : "";
    const digits = normalized.replace(/^-/, "");
    normalized = `${sign}${digits[0]}.${digits.slice(1)}`;
  }
  if (!/^-?\d\.\d{3}$/.test(normalized)) return "";
  const number = Number(normalized);
  return Number.isFinite(number) && Math.abs(number) < 10 ? normalized : "";
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
    .map((character) => {
      if (character === "-") return "マイナス";
      if (character === ".") return "点";
      return character;
    })
    .join("、");
}

let speechPrepared = false;
let speechRequestSequence = 0;
let releaseActiveSpeech = null;

export function resetSpeechSynthesis() {
  speechPrepared = false;
  speechRequestSequence += 1;
  releaseActiveSpeech?.();
  releaseActiveSpeech = null;
  window.speechSynthesis?.cancel?.();
  window.speechSynthesis?.resume?.();
}

export function prepareSpeechSynthesis({ force = false } = {}) {
  if (force) resetSpeechSynthesis();
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
  prepareSpeechSynthesis();
  const spoken = String(value).replace(/^-/, "マイナス").replace(/\./g, "点");
  const synthesis = window.speechSynthesis;
  const requestId = ++speechRequestSequence;
  releaseActiveSpeech?.();
  synthesis.cancel();
  synthesis.resume();

  return (async () => {
    await new Promise((resolve) => setTimeout(resolve, 90));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (requestId !== speechRequestSequence) return;
      if (attempt > 0) {
        speechPrepared = false;
        prepareSpeechSynthesis();
        synthesis.cancel();
        synthesis.resume();
        await new Promise((resolve) => setTimeout(resolve, 160 + (attempt * 80)));
      }
      const result = await new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.lang = "ja-JP";
        utterance.rate = Math.min(1.5, Math.max(0.5, Number(rate) || 0.9));
        const japaneseVoice = synthesis.getVoices?.().find((voice) => (
          /^ja(?:-|_)/i.test(voice.lang || "")
        ));
        if (japaneseVoice) utterance.voice = japaneseVoice;
        let completed = false;
        let started = false;
        let quietSamples = 0;
        const timers = [];
        let heartbeat = null;
        const finish = (status) => {
          if (completed) return;
          completed = true;
          timers.forEach(clearTimeout);
          clearInterval(heartbeat);
          if (releaseActiveSpeech === release) releaseActiveSpeech = null;
          resolve(status);
        };
        const release = () => finish("cancelled");
        releaseActiveSpeech = release;
        utterance.onstart = () => {
          started = true;
          quietSamples = 0;
        };
        utterance.onend = () => finish("ended");
        utterance.onerror = () => finish(
          requestId === speechRequestSequence ? "retry" : "cancelled"
        );
        utterance.onpause = () => synthesis.resume();
        synthesis.speak(utterance);
        [60, 220, 520].forEach((delay) => {
          timers.push(setTimeout(() => {
            if (!completed && requestId === speechRequestSequence) synthesis.resume();
          }, delay));
        });
        timers.push(setTimeout(() => {
          if (!completed && !started) {
            finish("retry");
            synthesis.cancel();
          }
        }, 1600));
        timers.push(setTimeout(() => {
          if (!completed) {
            finish("retry");
            synthesis.cancel();
          }
        }, 8000));
        heartbeat = setInterval(() => {
          if (completed || requestId !== speechRequestSequence) {
            finish("cancelled");
            return;
          }
          synthesis.resume();
          if (!started) return;
          if (!synthesis.speaking && !synthesis.pending) {
            quietSamples += 1;
            if (quietSamples >= 4) finish("retry");
          } else {
            quietSamples = 0;
          }
        }, 260);
      });
      if (result === "ended" || result === "cancelled") return;
      synthesis.cancel();
      synthesis.resume();
    }
  })();
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
  let queuedResult = null;
  let resultDeliveryTimer = null;
  let recognitionStopFallbackTimer = null;

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

  const clearResultDeliveryTimers = () => {
    if (resultDeliveryTimer !== null) clearTimeout(resultDeliveryTimer);
    if (recognitionStopFallbackTimer !== null) {
      clearTimeout(recognitionStopFallbackTimer);
    }
    resultDeliveryTimer = null;
    recognitionStopFallbackTimer = null;
  };

  const dispatchQueuedResult = () => {
    if (!queuedResult || resultDeliveryTimer !== null) return;
    if (recognitionStopFallbackTimer !== null) {
      clearTimeout(recognitionStopFallbackTimer);
      recognitionStopFallbackTimer = null;
    }
    const result = queuedResult;
    queuedResult = null;
    resultDeliveryTimer = setTimeout(() => {
      resultDeliveryTimer = null;
      const delivery = onResult(result.transcript, {
        alternatives: result.alternatives,
        isFinal: result.isFinal
      });
      Promise.resolve(delivery)
        .catch(() => {})
        .finally(() => {
          resultDelivered = false;
        });
    }, 180);
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
    queuedResult = { transcript, alternatives, isFinal };
    onStatus("認識結果を復唱します");
    try {
      recognition?.stop();
      recognitionStopFallbackTimer = setTimeout(() => {
        recognitionStopFallbackTimer = null;
        recognitionState = "idle";
        onListeningChange(false);
        dispatchQueuedResult();
      }, 700);
    } catch {
      recognitionState = "idle";
      onListeningChange(false);
      dispatchQueuedResult();
    }
  };

  const beginRecognition = () => {
    if (!recognition) createRecognitionInstance();
    clearStartTimeout();
    clearInterimFinalize();
    clearResultDeliveryTimers();
    queuedResult = null;
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
      dispatchQueuedResult();
      return;
    }
    if (!wasCancelled && !recognitionFailed && pendingTranscript) {
      const transcript = pendingTranscript;
      const alternatives = pendingAlternatives;
      pendingTranscript = "";
      queuedResult = { transcript, alternatives, isFinal: true };
      resultDelivered = true;
      onStatus("認識結果を復唱します");
      dispatchQueuedResult();
    } else {
      onStatus("");
    }
  };
  const handleRecognitionError = (event) => {
    clearStartTimeout();
    clearInterimFinalize();
    if (resultDelivered) return;
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
    clearResultDeliveryTimers();
    queuedResult = null;
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
      resetSpeechSynthesis();
      resetRecognition({ notify: true });
    },
    reset() {
      resetSpeechSynthesis();
      resetRecognition();
    }
  };
}
