// Verifies the shared photo resolver that fixes the reported bug:
// "a saved driver vehicle still shows the SVG icon on the rider side".
//
// Runs against the LOCAL dev database (server/.env). It creates ONE throwaway
// white row, asserts the resolver behaviour, then deletes it. Exit 0 = pass.
import "dotenv/config";
import { execute } from "./dist/config/database.js";
import {
  attachVehicleImages,
  resolveVehicleImage,
  vehicleImageCacheKey,
  generationRange,
} from "./dist/services/vehicleImages.js";

const MAKE = "attachtestmake";
const MODEL = "attachtestmodel";
const RANGE = generationRange(2017);
const KEY = `${MAKE}|${MODEL}|${RANGE}|white`;
const URL = "https://api.ridevura.com/api/vehicle-images/attach-test-white.webp";

let bad = 0;
const say = (ok, label, detail = "") => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};

await execute("DELETE FROM vehicle_images WHERE cache_key = $1", [KEY]);
await execute(
  `INSERT INTO vehicle_images (cache_key, make, model, year, year_range, colour, status, image_url, approved_at)
   VALUES ($1,$2,$3,$4,$5,$6,'approved',$7,NOW())`,
  [KEY, MAKE, MODEL, 2017, RANGE, "white", URL]
);

try {
  console.log(`\n— fixture: one WHITE row "${KEY}"\n`);

  console.log("— the driver's chosen colour must not change the answer")
  for (const colour of ["Red", "Blue", "Black", "Silver", null, undefined]) {
    const r = await resolveVehicleImage({ make: MAKE, model: MODEL, year: 2017, colour });
    say(r.url === URL, `resolveVehicleImage(colour=${colour})`, String(r.url));
  }

  console.log("\n— the cache key / generation helper")
  const key = vehicleImageCacheKey({ make: MAKE, model: MODEL, year: 2017, colour: "white" });
  say(key === KEY, "cache key round-trips", key);
  say(typeof RANGE === "string" && RANGE.length > 0, "generationRange(2017)", RANGE);

  console.log("\n— the shape the ride routes use (in-place mutation)")
  const row = { vehicle_make: MAKE, vehicle_model: MODEL, vehicle_year: 2017, vehicle_color: "Red" };
  await attachVehicleImages(row);
  say(row.vehicle_image_url === URL, "RED driver car -> WHITE photo", String(row.vehicle_image_url));

  const batch = [
    { vehicle_make: MAKE, vehicle_model: MODEL, vehicle_year: 2019, vehicle_color: "Blue" },
    { vehicle_make: MAKE, vehicle_model: MODEL, vehicle_year: 2016, vehicle_color: "Green" },
  ];
  await attachVehicleImages(batch);
  say(batch.every((r) => r.vehicle_image_url === URL), "a ride LIST resolves every row");

  console.log("\n— the SVG fallback must survive")
  const unknown = { vehicle_make: "nosuchmake", vehicle_model: "nosuchmodel", vehicle_year: 2017, vehicle_color: "Red" };
  await attachVehicleImages(unknown);
  say(unknown.vehicle_image_url == null, "car not in the DB stays null", String(unknown.vehicle_image_url));
  say((await attachVehicleImages(null)) === null, "attachVehicleImages(null) is a no-op");
  const noCar = {};
  await attachVehicleImages(noCar);
  say(noCar.vehicle_image_url === undefined, "attachVehicleImages({}) does not throw");
} finally {
  await execute("DELETE FROM vehicle_images WHERE cache_key = $1", [KEY]).catch(() => undefined);
}

console.log(bad ? `\n✗ ${bad} problem(s)\n` : "\n✓ attachVehicleImages verified against real Postgres\n");
process.exit(bad ? 1 : 0);
