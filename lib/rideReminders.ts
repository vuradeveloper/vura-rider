import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Local, OS-scheduled reminders for a reserved (scheduled) ride: 10 minutes
// before pickup, 5 minutes before, and at pickup time.
//
// These are handed to the phone's OS alarm scheduler, so they fire even when the
// app is closed, backgrounded, or force-stopped. That is deliberately different
// from a server push (see lib/notifications.ts): a push needs a live token and a
// reachable device, whereas a scheduled local notification is owned by the OS.
//
// Android does NOT persist scheduled alarms across a reboot, so reminders are
// re-created from the server's list whenever the app starts (see
// syncRideReminders) rather than trusted to survive on their own.

const CHANNEL_ID = "ride-reminders";

// Guards syncRideReminders so a 30s poll can't keep re-arming the alarms.
let syncedThisLaunch = false;

// Minutes before pickup. 0 = "the ride is now".
const REMINDER_OFFSETS_MIN = [10, 5, 0];

const MAX_IMPORTANCE = Notifications.AndroidNotificationPriority.MAX;

export type ReminderRide = {
  id: string;
  scheduled_at: string;
  pickup_address?: string | null;
  destination_address?: string | null;
};

// A stable identifier per (ride, offset) lets us cancel/overwrite precisely, so
// re-syncing can never stack up duplicate reminders for the same ride.
function identifierFor(rideId: string, minutesBefore: number) {
  return `vura-ride-${rideId}-${minutesBefore}`;
}

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Ride reminders",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
  });
}

/**
 * Android 13+ requires runtime permission for notifications. Without it the OS
 * accepts the schedule call and then silently shows nothing, which looks exactly
 * like "my reminders never fire".
 */
async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === "granted";
}

function copyFor(minutesBefore: number, ride: ReminderRide) {
  const pickup = ride.pickup_address || "your pickup point";
  if (minutesBefore === 0) {
    return {
      title: "Your ride is now",
      body: `Your scheduled ride from ${pickup} is due now.`,
    };
  }
  return {
    title: `Ride in ${minutesBefore} minutes`,
    body: `Your scheduled pickup is at ${pickup}.`,
  };
}

/**
 * Schedules (or re-schedules) the reminders for one reserved ride.
 * Safe to call repeatedly: existing reminders for that ride are cleared first.
 */
export async function scheduleRideReminders(ride: ReminderRide): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const pickupAt = new Date(ride.scheduled_at).getTime();
    if (!Number.isFinite(pickupAt)) return;

    if (!(await ensurePermission())) return;
    await ensureChannel();

    // Drop anything already queued for this ride before re-adding.
    await cancelRideReminders(ride.id);

    for (const minutesBefore of REMINDER_OFFSETS_MIN) {
      const fireAt = pickupAt - minutesBefore * 60 * 1000;
      // A reminder whose moment has passed can't be scheduled. This is why
      // booking only 8 minutes out still correctly yields the "5 min" and
      // "now" reminders and simply skips the 10-minute one.
      if (fireAt <= Date.now()) continue;

      const { title, body } = copyFor(minutesBefore, ride);
      await Notifications.scheduleNotificationAsync({
        identifier: identifierFor(ride.id, minutesBefore),
        content: {
          title,
          body,
          sound: "default",
          priority: MAX_IMPORTANCE,
          data: { rideId: ride.id, type: "ride_reminder", minutesBefore },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireAt),
        },
      });
    }
  } catch {
    /* reminders are best-effort and must never block booking a ride */
  }
}

/** Cancels any pending reminders for a ride (cancelled or already completed). */
export async function cancelRideReminders(rideId: string): Promise<void> {
  if (Platform.OS === "web") return;
  for (const minutesBefore of REMINDER_OFFSETS_MIN) {
    try {
      await Notifications.cancelScheduledNotificationAsync(
        identifierFor(rideId, minutesBefore)
      );
    } catch {
      /* nothing queued under that identifier */
    }
  }
}

/**
 * Rebuilds reminders for every upcoming reserved ride. Called when the app
 * loads its scheduled rides, because Android forgets scheduled alarms on
 * reboot — this makes the reminders self-healing instead of silently lost.
 */
export async function syncRideReminders(
  rides: ReminderRide[] | null | undefined
): Promise<void> {
  // The home tab re-fetches scheduled rides every 30s. Re-arming the alarms on
  // every poll would cancel and re-create them constantly, which risks dropping
  // one as its fire time passes — so this runs once per app launch.
  if (syncedThisLaunch) return;
  if (!rides?.length) return;
  syncedThisLaunch = true;
  for (const ride of rides) {
    await scheduleRideReminders(ride);
  }
}
