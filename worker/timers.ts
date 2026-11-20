// Timers Durable Object: one instance per rider's phone (named by a hash of its push address). While a ride is
// on, it wakes once a minute and pushes the countdown (or the 10 / 5 minute / time-up alert) to the phone, which
// is how the notification stays current when the phone has frozen the page. With the dock the rider is heading
// for, each push also says how many docks and bikes are left there, and a separate warning goes out when the
// dock drops from safe to risky. Stored: the push subscription, the ride's start time, that dock and its last
// level; everything is deleted when the ride ends, the phone drops the subscription, or after 3 hours.
import { DurableObject } from "cloudflare:workers";
import { becameRisky, dockLevel, riskNote, type EndDock } from "../src/core/endDock";
import type { Level } from "../src/core/dockStatus";
import { MAX_RIDE_MS, nextPushAt, pushFor } from "../src/core/timerPush";
import { fetchDockCounts } from "./docks";
import type { EndDockRequest } from "./validate";
import { sendPush, vapidFromEnv, type PushSub } from "./webpush";

export interface TimersEnv { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_JWK?: string }
interface Ride { sub: PushSub; startedAt: number; endDock?: EndDock; /** The dock's level at the last check; null until known. */ level?: Level | null }

export class Timers extends DurableObject<TimersEnv> {
  /** A ride has started (or the page reloaded mid-ride: the same call again changes nothing, and keeps what it knows about the dock). */
  async start(sub: PushSub, startedAt: number, endDock?: EndDockRequest): Promise<void> {
    const old = await this.ctx.storage.get<Ride>("ride");
    const same = old?.startedAt === startedAt && old.endDock?.id === endDock?.id;
    const level = same && old?.level ? old.level : endDock?.docks != null ? dockLevel({ bikes: 0, docks: endDock.docks }) : null;
    await this.ctx.storage.put("ride", { sub, startedAt, ...(endDock ? { endDock: { id: endDock.id, name: endDock.name } } : {}), level } satisfies Ride);
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

    /** One push; the push service's status (0: it couldn't be reached). */
    const send = async (payload: unknown): Promise<number> => {
      let status = 0;
      try {
        status = await sendPush(ride.sub, payload, vapid, now, 120);
      } catch (e) {
        console.warn("push failed", e instanceof Error ? e.message : e); // network trouble: try again next minute
      }
      if (status && (status < 200 || status >= 300)) console.warn("push service answered", status, new URL(ride.sub.endpoint).host); // e.g. 403: the key pair is wrong
      return status;
    };
    const gone = (status: number) => status === 404 || status === 410; // the phone dropped the subscription

    const counts = ride.endDock ? await fetchDockCounts(ride.endDock.id) : null; // null: no dock set, or BCycle's feed is down (the push still goes, without it)
    let status = await send(pushFor(ride.startedAt, now, ride.endDock && counts ? { name: ride.endDock.name, counts } : undefined));
    if (gone(status)) return this.stop();

    if (ride.endDock && counts) {
      const level = dockLevel(counts);
      if (becameRisky(ride.level ?? null, level)) {
        status = await send({ ...riskNote(ride.endDock.name, counts), alert: true });
        if (gone(status)) return this.stop();
      }
      if (level !== ride.level) await this.ctx.storage.put("ride", { ...ride, level } satisfies Ride);
    }
    await this.ctx.storage.setAlarm(nextPushAt(ride.startedAt, Date.now()));
  }
}
