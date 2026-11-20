import { useState } from "react";

type Os = "ios" | "android";
const APP = "BadgerGo";

const STEPS: Record<Os, { steps: string[] }> = {
  ios: {
    steps: [
      "Open this page in Safari.",
      "Tap the Share button (the square with an arrow). If you don’t see it, tap ••• first.",
      "Scroll down and tap “Add to Home Screen”.",
      "Make sure “Open as Web App” is on, then tap Add.",
      `Open ${APP} from your home screen.`,
    ],
  },
  android: {
    steps: [
      "Open this page in Chrome.",
      "Tap the ⋮ menu at the top right.",
      "Tap “Add to home screen” (it may say “Install app”).",
      "Tap Install, then Add.",
      `Open ${APP} from your home screen or app drawer.`,
    ],
  },
};

/** Already running as an installed home-screen app. */
function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** "Add to your home screen" steps at the top of the info page: collapsed, and no phone picked, until asked (nothing once installed). */
export function InstallGuide() {
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState<Os | null>(null);
  if (isStandalone()) return null;
  return (
    <section className="install-guide">
      <button className="install-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="install-body">
        <span>
          <b id="install-title">Get {APP} on your phone</b>
          <span className="install-sub">Access {APP} from your home screen</span>
        </span>
        <svg className="install-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div id="install-body" className="install-body">
          <div className="install-os" role="group" aria-label="Your phone">
            {(["ios", "android"] as const).map((o) => (
              <button key={o} aria-pressed={os === o} className={os === o ? "pick" : ""} onClick={() => setOs(os === o ? null : o)}>{o === "ios" ? "iPhone (iOS)" : "Android"}</button>
            ))}
          </div>
          {os && <ol>{STEPS[os].steps.map((st) => <li key={st}>{st}</li>)}</ol>}
        </div>
      )}
    </section>
  );
}
