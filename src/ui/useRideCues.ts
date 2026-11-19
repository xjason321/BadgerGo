import { useEffect } from "react";
import { cueFor } from "../core/cues";
import type { NavLeg } from "../core/navLinks";
import { speak, vibrate } from "./feedback";

/** While riding, buzz and say the next step each time the rider moves onto a new leg (and at the start). */
export function useRideCues(on: boolean, active: boolean, legs: NavLeg[], index: number) {
  useEffect(() => {
    if (!active || !on) return;
    const cue = cueFor(legs, index);
    if (!cue) return;
    vibrate(cue.pattern);
    speak(cue.text);
  }, [active, on, index]); // eslint-disable-line react-hooks/exhaustive-deps
  // Switching cues off, or ending the ride, cuts off anything still being said.
  useEffect(() => {
    if (active && on) return;
    try { window.speechSynthesis?.cancel(); } catch { /* no speech */ }
  }, [active, on]);
}
