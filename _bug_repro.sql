-- repro for bug 1 + bug 2 on scratch PG (vura-module1-db, vura_test)
\set QUIET off
-- BUG 1: make_interval mins typed double precision
SELECT 'T1a make_interval mins => double' AS t, (NOW() + make_interval(mins => 180::double precision)) IS NOT NULL AS ok;
SELECT 'T1b make_interval secs => double' AS t, (NOW() + make_interval(secs => 60::double precision)) IS NOT NULL AS ok;
SELECT 'T1c minutes * interval' AS t, (NOW() + (180::double precision * interval '1 minute')) IS NOT NULL AS ok;

-- BUG 2: available-rides query, variant A (rides HAS distance_km col)
CREATE SCHEMA IF NOT EXISTS varA;
SET search_path TO varA;
DROP TABLE IF EXISTS varA.rides; DROP TABLE IF EXISTS varA.users;
CREATE TABLE varA.users (id uuid PRIMARY KEY, full_name text, phone text);
CREATE TABLE varA.rides (id uuid DEFAULT gen_random_uuid(), passenger_id uuid, pickup_lat float8, pickup_lng float8,
  destination_lat float8, destination_lng float8, status varchar(20) DEFAULT 'searching', scheduled_at timestamptz,
  created_at timestamptz DEFAULT NOW(), distance_km numeric(10,2), estimated_fare numeric(10,2),
  actual_fare numeric(10,2), driver_id uuid);
PREPARE qa AS SELECT r.*,
        u.full_name AS passenger_name, u.phone AS passenger_phone,
        CASE WHEN r.status = 'scheduled' THEN TRUE ELSE FALSE END AS is_scheduled,
        -- Distance is only meaningful when we actually know where the
        -- asking driver is. Without a fix it would be measured from
        -- (0,0) in the Gulf of Guinea and could reorder a no-GPS
        -- driver's list nonsensically, so it is left NULL and ordering
        -- falls back to newest-first -- exactly the old behaviour.
        CASE WHEN $3::boolean AND r.pickup_lat IS NOT NULL AND r.pickup_lng IS NOT NULL
          THEN (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians($2)) * cos(radians(r.pickup_lat)) *
              cos(radians(r.pickup_lng) - radians($1)) +
            sin(radians($2)) * sin(radians(r.pickup_lat))
          ))))
        END AS distance_km
   FROM rides r
   LEFT JOIN users u ON u.id = r.passenger_id
  WHERE ((r.status IN ('searching', 'no_drivers') AND r.created_at > NOW() - INTERVAL '30 minutes')
     OR (r.status = 'scheduled' AND r.scheduled_at > NOW()))
  AND (NOT $3::boolean
       OR r.pickup_lat IS NULL OR r.pickup_lng IS NULL
       OR (6371 * acos(LEAST(1, GREATEST(-1,
             cos(radians($2)) * cos(radians(r.pickup_lat)) *
               cos(radians(r.pickup_lng) - radians($1)) +
             sin(radians($2)) * sin(radians(r.pickup_lat))
           )))) <= $4::double precision)
  ORDER BY CASE WHEN r.status = 'scheduled' THEN 0 ELSE 1 END,
           distance_km ASC NULLS LAST,
           r.created_at DESC
  LIMIT 20;
EXECUTE qa(0,0,false,5);

-- BUG 2 variant B (rides has NO distance_km col)
CREATE SCHEMA IF NOT EXISTS varB;
SET search_path TO varB;
DROP TABLE IF EXISTS varB.rides; DROP TABLE IF EXISTS varB.users;
CREATE TABLE varB.users (id uuid PRIMARY KEY, full_name text, phone text);
CREATE TABLE varB.rides (id uuid DEFAULT gen_random_uuid(), passenger_id uuid, pickup_lat float8, pickup_lng float8,
  destination_lat float8, destination_lng float8, status varchar(20) DEFAULT 'searching', scheduled_at timestamptz,
  created_at timestamptz DEFAULT NOW(), estimated_fare numeric(10,2),
  actual_fare numeric(10,2), driver_id uuid);
PREPARE qb AS SELECT r.*,
        u.full_name AS passenger_name, u.phone AS passenger_phone,
        CASE WHEN r.status = 'scheduled' THEN TRUE ELSE FALSE END AS is_scheduled,
        CASE WHEN $3::boolean AND r.pickup_lat IS NOT NULL AND r.pickup_lng IS NOT NULL
          THEN (6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians($2)) * cos(radians(r.pickup_lat)) *
              cos(radians(r.pickup_lng) - radians($1)) +
            sin(radians($2)) * sin(radians(r.pickup_lat))
          ))))
        END AS distance_km
   FROM rides r
   LEFT JOIN users u ON u.id = r.passenger_id
  WHERE ((r.status IN ('searching', 'no_drivers') AND r.created_at > NOW() - INTERVAL '30 minutes')
     OR (r.status = 'scheduled' AND r.scheduled_at > NOW()))
  AND (NOT $3::boolean
       OR r.pickup_lat IS NULL OR r.pickup_lng IS NULL
       OR (6371 * acos(LEAST(1, GREATEST(-1,
             cos(radians($2)) * cos(radians(r.pickup_lat)) *
               cos(radians(r.pickup_lng) - radians($1)) +
             sin(radians($2)) * sin(radians(r.pickup_lat))
           )))) <= $4::double precision)
  ORDER BY CASE WHEN r.status = 'scheduled' THEN 0 ELSE 1 END,
           distance_km ASC NULLS LAST,
           r.created_at DESC
  LIMIT 20;
EXECUTE qb(0,0,false,5);
SELECT 'DONE' AS marker;
