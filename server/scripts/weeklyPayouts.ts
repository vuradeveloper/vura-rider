import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import pool, { query } from "../src/config/database";
import {
  transferToDriver,
  checkBalance,
} from "../src/services/paystackService";

const runWeeklyPayouts = async () => {
  console.log("Starting weekly driver payouts...");

  const client = await pool.connect();

  try {
    const driversResult = await client.query(
      `SELECT
        u.id AS driver_id, u.full_name AS driver_name,
        dp.paystack_recipient,
        SUM(de.gross_fare - LEAST(de.gross_fare * 0.20, 5::double precision)) AS total_earnings,
        COUNT(de.id) AS total_rides,
        ARRAY_AGG(de.ride_id) AS ride_ids
      FROM driver_earnings de
      JOIN users u ON u.id = de.driver_id
      JOIN driver_profiles dp ON dp.user_id = de.driver_id
      WHERE de.payout_status = 'pending'
        AND dp.paystack_recipient IS NOT NULL
        AND dp.banking_verified = true
      GROUP BY u.id, u.full_name, dp.paystack_recipient
      HAVING SUM(de.gross_fare - LEAST(de.gross_fare * 0.20, 5::double precision)) >= 50`
    );

    if (!driversResult.rows.length) {
      console.log("No drivers with pending earnings");
      return;
    }

    for (const driver of driversResult.rows) {
      try {
        const transfer = await transferToDriver({
          amountRands: parseFloat(driver.total_earnings),
          driverName: driver.driver_name,
          recipientCode: driver.paystack_recipient,
          rideIds: driver.ride_ids,
        });

        await client.query(
          `INSERT INTO driver_payouts (driver_id, amount, reference, ride_count, status, period_start, period_end)
           VALUES ($1, $2, $3, $4, 'processing', DATE_TRUNC('week', NOW()), NOW())`,
          [
            driver.driver_id,
            driver.total_earnings,
            transfer.reference,
            driver.total_rides,
          ]
        );

        await client.query(
          `UPDATE driver_earnings SET payout_status = 'processing'
           WHERE driver_id = $1 AND payout_status = 'pending'`,
          [driver.driver_id]
        );

        console.log(`Paid ${driver.driver_name}: R${driver.total_earnings}`);
      } catch (err: any) {
        console.error(`Failed for ${driver.driver_name}: ${err.message}`);
      }
    }

    console.log("Weekly payouts complete");
  } finally {
    client.release();
    process.exit(0);
  }
};

runWeeklyPayouts();
