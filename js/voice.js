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

export function createVoiceController({ onResult, onStatus, onListeningChange }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    onStatus("このブラウザは音声認識に未対応です。キーボード入力はそのまま使えます。");
    return { supported: false, start() {} };
  }

  const recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    onListeningChange(true);
    onStatus("音声を聞き取り中です…");
  };
  recognition.onend = () => onListeningChange(false);
  recognition.onerror = (event) => {
    onListeningChange(false);
    const messages = {
      "not-allowed": "マイクの使用が許可されていません。",
      "no-speech": "音声を認識できませんでした。もう一度お試しください。",
      "audio-capture": "マイクを利用できません。"
    };
    onStatus(messages[event.error] || `音声認識エラー：${event.error}`);
  };
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    onResult(transcript);
  };

  return {
    supported: true,
    start() {
      try {
        recognition.start();
      } catch {
        onStatus("音声認識はすでに開始しています。");
      }
    }
  };
}
