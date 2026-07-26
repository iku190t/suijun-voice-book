const GA_MEASUREMENT_ID = "G-88B9YPJXWP";
const APP_NAME = "suijun_voice_book";
const APP_VERSION = "183";

function getGtag() {
  return typeof window.gtag === "function" ? window.gtag : null;
}

export function trackEvent(eventName, parameters = {}) {
  const gtag = getGtag();
  if (!gtag) return;
  try {
    gtag("event", eventName, {
      app_name: APP_NAME,
      app_version: APP_VERSION,
      ...parameters
    });
  } catch {
    // アクセス解析が利用できなくても、野帳本体の操作は止めない。
  }
}

export function initializeAnalytics() {
  if (!GA_MEASUREMENT_ID || window.__suijunAnalyticsInitialized) return;
  window.__suijunAnalyticsInitialized = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  script.dataset.suijunAnalytics = "true";
  document.head.append(script);

  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID, {
    app_name: APP_NAME,
    app_version: APP_VERSION,
    page_title: "水準ボイス",
    anonymize_ip: true
  });
  trackEvent("page_access");
}
