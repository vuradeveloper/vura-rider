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

// A second car that HAS a coloured render, so colour preference can be proved.
const C_MODEL = "attachtestmodel-coloured";
const C_RANGE = generationRange(2017);
const RED_KEY = `${MAKE}|${C_MODEL}|${C_RANGE}|red`;
const WHITE_KEY = `${MAKE}|${C_MODEL}|${C_RANGE}|white`;
const BLUE_KEY = `${MAKE}|${C_MODEL}|${C_RANGE}|blue`;
const RED_URL = "https://api.ridevura.com/api/vehicle-images/attach-test-red.webp";
const WHITE_URL = "https://api.ridevura.com/api/vehicle-images/attach-test-white2.webp";

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

  console.log("\n— a driver who picked a colour the car HAS a render for")
  for (const [k, colour, url] of [
    [RED_KEY, "red", RED_URL],
    [WHITE_KEY, "white", WHITE_URL],
  ]) {
    await execute("DELETE FROM vehicle_images WHERE cache_key = $1", [k]);
    await execute(
      `INSERT INTO vehicle_images (cache_key, make, model, year, year_range, colour, status, image_url, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,'approved',$7,NOW())`,
      [k, MAKE, C_MODEL, 2017, C_RANGE, colour, url]
    );
  }

  const red = await resolveVehicleImage({ make: MAKE, model: C_MODEL, year: 2017, colour: "Red" });
  say(red.url === RED_URL, "a RED driver gets the RED photo", String(red.url));
  say(red.matched === "exact", "…and it is an exact colour match", String(red.matched));

  const green = await resolveVehicleImage({ make: MAKE, model: C_MODEL, year: 2017, colour: "Green" });
  say(green.url === WHITE_URL, "a GREEN driver (no green render) falls back to WHITE", String(green.url));

  // A colour must never leak across: with only red + white rows, a BLUE driver has to
  // get the white fallback, never the red car.
  const blue2 = await resolveVehicleImage({ make: MAKE, model: C_MODEL, year: 2017, colour: "Blue" });
  say(blue2.url === WHITE_URL, "a BLUE driver never gets the RED photo", String(blue2.url));

  const carRow = { vehicle_make: MAKE, vehicle_model: C_MODEL, vehicle_year: 2017, vehicle_color: "Red" };
  await attachVehicleImages(carRow);
  say(carRow.vehicle_image_url === RED_URL, "the ride row carries the RED photo", String(carRow.vehicle_image_url));
} finally {
  for (const k of [KEY, RED_KEY, WHITE_KEY, BLUE_KEY]) {
    await execute("DELETE FROM vehicle_images WHERE cache_key = $1", [k]).catch(() => undefined);
  }
}

console.log(bad ? `\n✗ ${bad} problem(s)\n` : "\n✓ attachVehicleImages verified against real Postgres\n");
process.exit(bad ? 1 : 0);
