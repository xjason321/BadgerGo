import { useState } from "react";

type Os = "ios" | "android";
const APP = "BadgerGo";

const STEPS: Record<Os, { title: string; steps: string[]; note: string }> = {
  ios: {
    title: "Add to your iPhone home screen",
    steps: [
      "Open this page in Safari.",
      "Tap the Share button (the square with an arrow). If you don’t see it, tap ••• first.",
      "Scroll down and tap “Add to Home Screen”.",
      "Make sure “Open as Web App” is on, then tap Add.",
      `Open ${APP} from your home screen.`,
    ],
    note: "It opens full screen like a regular app, no App Store needed.",
  },
  android: {
    title: "Add to your Android home screen",
    steps: [
      "Open this page in Chrome.",
      "Tap the ⋮ menu at the top right.",
      "Tap “Add to home screen” (it may say “Install app”).",
      "Tap Install, then Add.",
      `Open ${APP} from your home screen or app drawer.`,
    ],
    note: "It opens full screen like a regular app, no Play Store needed.",
  },
};

function platform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** Already running as an installed home-screen app. */
function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** "Add to your home screen" steps, shown at the top of the info page (nothing once the app is already installed). */
export function InstallGuide() {
  const detected = platform();
  const [os, setOs] = useState<Os>(detected === "android" ? "android" : "ios");
  if (isStandalone()) return null;
  const info = STEPS[os];
  return (
    <section className="install-guide" aria-labelledby="install-title">
      <h3 id="install-title">Get {APP} on your phone</h3>
      <p>Add it to your home screen so it opens like an app.</p>
      <div className="install-os" role="tablist" aria-label="Your phone">
        {(["ios", "android"] as const).map((o) => (
          <button key={o} role="tab" aria-selected={os === o} className={os === o ? "pick" : ""} onClick={() => setOs(o)}>{o === "ios" ? "iPhone (iOS)" : "Android"}</button>
        ))}
      </div>
      <ol>{info.steps.map((st) => <li key={st}>{st}</li>)}</ol>
      <p className="note">{info.note}</p>
    </section>
  );
}
