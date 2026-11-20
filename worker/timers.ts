// Timers Durable Object: one instance per rider's phone (named by a hash of its push address). While a ride is
// on, it wakes once a minute and pushes the countdown (or the 10 / 5 minute / time-up alert) to the phone, which
// is how the notification stays current when the phone has frozen the page. Stored: the push subscription and
// the ride's start time; everything is deleted when the ride ends, the phone drops the subscription, or after 3 hours.
import { DurableObject } from "cloudflare:workers";
import { MAX_RIDE_MS, nextPushAt, pushFor } from "../src/core/timerPush";
import { sendPush, vapidFromEnv, type PushSub } from "./webpush";

export interface TimersEnv { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_JWK?: string }
interface Ride { sub: PushSub; startedAt: number }

export class Timers extends DurableObject<TimersEnv> {
  /** A ride has started (or the page reloaded mid-ride: the same call again changes nothing). */
  async start(sub: PushSub, startedAt: number): Promise<void> {
    await this.ctx.storage.put("ride", { sub, startedAt } satisfies Ride);
    await this.ctx.storage.setAlarm(nextPushAt(startedAt, Date.now()));
  }

  /** The ride ended. */
  async stop(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    const ride = await this.ctx.storage.get<Ride>("ride");
    const vapid = vapidFromEnv(this.env);
    if (!ride || !vapid) return this.stop();
    const now = Date.now();
    if (now - ride.startedAt > MAX_RIDE_MS) return this.stop();
    let status = 0;
    try {
      status = await sendPush(ride.sub, pushFor(ride.startedAt, now), vapid, now, 120);
    } catch (e) {
      console.warn("push failed", e instanceof Error ? e.message : e); // network trouble: try again next minute
    }
    if (status === 404 || status === 410) return this.stop(); // the phone dropped the subscription
    await this.ctx.storage.setAlarm(nextPushAt(ride.startedAt, Date.now()));
  }
}
