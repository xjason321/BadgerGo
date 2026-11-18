import { useEffect, useState } from "react";
import { CloseIcon, InfoIcon } from "./icons";

type Os = "ios" | "android";
const KEY = "badgergo.installTipHidden";
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

const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const write = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } };

/** A small tip at the top-left of the map on the start screen, and the how-to pop-up it opens. */
export function InstallTip() {
  const [hidden, setHidden] = useState(read);
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState<Os | null>(null);
  const detected = platform();

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  if (isStandalone() || hidden) return null;
  const dismiss = () => { write(); setHidden(true); };
  const close = () => { setOpen(false); setOs(null); };
  const info = os ? STEPS[os] : null;

  return (
    <>
      <div className="install-tip" role="note">
        <span className="install-badge" aria-hidden="true"><InfoIcon size={18} /></span>
        <p>
          Want to have easy access to this in the future?{" "}
          <button className="install-link" onClick={() => setOpen(true)}>Add it to your home screen.</button>
        </p>
        <button className="install-x" onClick={dismiss} aria-label="Dismiss tip"><CloseIcon size={14} /></button>
      </div>
      {open && (
        <div className="about-wrap" onClick={close}>
          <div className="about install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(e) => e.stopPropagation()}>
            <button className="about-x" onClick={close} aria-label="Close"><CloseIcon size={18} /></button>
            <div className="install-body">
              <h2 id="install-title">{info ? info.title : `Get ${APP} on your phone`}</h2>
              {!info ? (
                <>
                  <p>Add it to your home screen so it opens like an app. What phone do you have?</p>
                  <div className="install-os">
                    {(["ios", "android"] as const).map((o) => (
                      <button key={o} className={detected === o ? "pick" : ""} onClick={() => setOs(o)}>{o === "ios" ? "iPhone (iOS)" : "Android"}</button>
                    ))}
                  </div>
                  <button className="install-ghost" onClick={close}>Maybe later</button>
                </>
              ) : (
                <>
                  <ol>{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  <p className="note">{info.note}</p>
                  <div className="install-row">
                    <button className="install-ghost" onClick={() => setOs(null)}>‹ Back</button>
                    <button className="install-done" onClick={() => { dismiss(); close(); }}>Got it</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
