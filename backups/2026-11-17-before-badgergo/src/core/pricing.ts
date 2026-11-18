import type { PricingPlan } from "./types";

/** Cost for a single dock-to-dock ride. Each started extra block is charged. */
export function overageCost(rideMinutes: number, plan: PricingPlan): number {
  if (rideMinutes <= plan.freeMinutes) return 0;
  const extra = rideMinutes - plan.freeMinutes;
  return Math.ceil(extra / plan.blockMinutes) * plan.blockCost;
}
