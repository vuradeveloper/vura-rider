import type { PoolClient } from "pg";
import { withTransaction, isMissingRelation } from "../config/database";

// Account deletion for POST /api/users/delete.
//
// Google Play and the App Store both require in-app account deletion to really
// remove the account, so this must not fail for a driver who has ever earned,
// been paid out, saved banking details, or rated a rider.
//
// The schema grew in layers: tables added later use ON DELETE CASCADE, but the
// original money/trip tables (rides, ratings, payments, driver_earnings,
// driver_profiles, saved_cards, payouts, driver_banking, …) have plain
// REFERENCES users(id). Deleting the user row first therefore failed with a
// foreign-key error as soon as any of those rows existed. The fix is to delete
// children in dependency order inside ONE transaction, so a failure leaves the
// account untouched instead of half-deleted.
//
// Tables created lazily by later routes may not exist on every deployment, so
// each statement runs under a savepoint and a missing table/column is skipped.
// A final sweep handles any future single-column FK that neither cascades nor
// sets null — without it, one forgotten table would break deletion again.

/**
 * Run one statement in the deletion transaction, ignoring "relation/column
 * does not exist". A savepoint is required because a failed statement aborts
 * the rest of a Postgres transaction.
 */
async function deleteStep(
  client: PoolClient,
  sql: string,
  params: any[]
): Promise<void> {
  await client.query("SAVEPOINT account_delete_step");
  try {
    await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT account_delete_step");
  } catch (err) {
    // A real error must propagate untouched: the transaction is aborted, so
    // even RELEASE would fail and hide the original message. Only the
    // missing-table path restores the savepoint and continues.
    if (!isMissingRelation(err)) throw err;
    await client.query("ROLLBACK TO SAVEPOINT account_delete_step");
    await client.query("RELEASE SAVEPOINT account_delete_step");
  }
}

/**
 * Delete rows from every table whose single-column FK to `parent` neither
 * cascades nor nulls on delete. Known tables are handled explicitly below; this
 * is the safety net for tables added by later migrations.
 */
async function sweepNoActionRefs(
  client: PoolClient,
  parent: "users" | "rides",
  userId: string
): Promise<void> {
  const { rows } = await client.query<{ tbl: string; col: string }>(
    `SELECT c.conrelid::regclass::text AS tbl, quote_ident(a.attname) AS col
       FROM pg_constraint c
       JOIN pg_attribute a
         ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = $1::regclass
        AND array_length(c.conkey, 1) = 1
        AND c.confdeltype IN ('a', 'r', 'd')`,
    [parent]
  );

  for (const { tbl, col } of rows) {
    const where =
      parent === "users"
        ? `${col} = $1`
        : `${col} IN (SELECT id FROM rides WHERE passenger_id = $1 OR driver_id = $1)`;
    await deleteStep(client, `DELETE FROM ${tbl} WHERE ${where}`, [userId]);
  }
}

/**
 * Delete everything that belongs to `userId`, then the user row itself.
 * All-or-nothing: throws (and rolls back) if any real error occurs.
 */
export async function deleteAccountData(userId: string): Promise<void> {
  const rideScope =
    "(SELECT id FROM rides WHERE passenger_id = $1 OR driver_id = $1)";

  await withTransaction(async (client) => {
    // 1. Rows that point at this user's rides. These FKs have no cascade and
    //    must be gone before the rides themselves. Rows created by the other
    //    party on the same ride go too, otherwise the ride cannot be removed.
    await deleteStep(client, `DELETE FROM ratings WHERE passenger_id = $1 OR driver_id = $1 OR ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM disputes WHERE user_id = $1 OR ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM lost_item_reports WHERE user_id = $1 OR ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM split_fares WHERE inviter_id = $1 OR invitee_id = $1 OR ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM safety_events WHERE ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM face_verifications WHERE driver_id = $1 OR ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM payments WHERE user_id = $1 OR ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM ride_events WHERE driver_id = $1 OR ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM chat_messages WHERE sender_id = $1 OR ride_id IN ${rideScope}`, [userId]);
    await deleteStep(client, `DELETE FROM ride_offers WHERE driver_id = $1 OR ride_id IN ${rideScope}`, [userId]);

    // 2. Money. driver_earnings_paid references BOTH driver_earnings and
    //    payouts, so it must go first; payouts/driver_banking/driver_earnings
    //    are the tables that made deletion fail in production.
    await deleteStep(
      client,
      `DELETE FROM driver_earnings_paid
        WHERE earning_id IN (SELECT id FROM driver_earnings WHERE driver_id = $1)
           OR payout_id IN (SELECT id FROM payouts WHERE driver_id = $1)`,
      [userId]
    );
    await deleteStep(client, "DELETE FROM payouts WHERE driver_id = $1", [userId]);
    await deleteStep(client, "DELETE FROM driver_earnings WHERE driver_id = $1", [userId]);
    await deleteStep(client, "DELETE FROM driver_banking WHERE driver_id = $1", [userId]);
    await deleteStep(client, "DELETE FROM saved_cards WHERE user_id = $1", [userId]);

    // 3. Profile and device data without a cascade.
    await deleteStep(client, "DELETE FROM driver_profiles WHERE user_id = $1", [userId]);
    await deleteStep(client, "DELETE FROM recent_searches WHERE user_id = $1", [userId]);
    await deleteStep(client, "DELETE FROM emergency_contacts WHERE user_id = $1", [userId]);

    // 4. Keep shared/audit records but cut the link to the person. Support
    //    tickets use ON DELETE SET NULL and are handled by Postgres below.
    await deleteStep(client, "UPDATE community_places SET created_by = NULL WHERE created_by = $1", [userId]);
    await deleteStep(client, "UPDATE sos_alerts SET triggered_by = NULL WHERE triggered_by = $1", [userId]);
    await deleteStep(client, "UPDATE notifications_log SET user_id = NULL WHERE user_id = $1", [userId]);

    // 5. Catch any table added after this route was written, then remove the
    //    trips and the account itself.
    await sweepNoActionRefs(client, "rides", userId);
    await deleteStep(client, "DELETE FROM rides WHERE passenger_id = $1 OR driver_id = $1", [userId]);
    await sweepNoActionRefs(client, "users", userId);
    await deleteStep(client, "DELETE FROM users WHERE id = $1", [userId]);
  });
}
