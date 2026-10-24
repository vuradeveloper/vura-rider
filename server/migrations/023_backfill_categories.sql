-- 023: Backfill ride-class categories from the canonical vehicle catalogue.
--
-- WHY: 021 was intended to populate categories for the existing Car DB, but its
-- VALUES list had a trailing comma (syntax error), so production never recorded
-- it and 784/785 images stayed unclassified. 021 is fixed separately. This
-- migration covers every make/model in src/data/vehicleCatalogue.ts, normalises
-- VW / Mercedes aliases, and also fills driver_profiles.vehicle_categories so
-- class-matched dispatch works for drivers who saved their car before 021.
--
-- Idempotent: only rows with NULL/empty categories are touched. Unmatched cars
-- stay empty on purpose so they appear in the admin category queue.
-- The migrator wraps this file in one transaction, so the temp tables live for
-- the whole file and disappear on COMMIT.

CREATE TEMP TABLE vura_category_catalogue (
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  category TEXT[] NOT NULL
) ON COMMIT DROP;

INSERT INTO vura_category_catalogue (make, model, category) VALUES
  ('Volkswagen', 'Polo', ARRAY['economy', 'standard']::text[]),
  ('Volkswagen', 'Polo Vivo', ARRAY['economy', 'standard']::text[]),
  ('Volkswagen', 'Polo Sedan', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Volkswagen', 'Golf', ARRAY['economy', 'standard']::text[]),
  ('Volkswagen', 'Caddy', ARRAY['xl', 'van', 'send']::text[]),
  ('Volkswagen', 'T-Cross', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Volkswagen', 'Tiguan', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Volkswagen', 'Amarok', ARRAY['xl']::text[]),
  ('Volkswagen', 'Crafter', ARRAY['xl', 'van', 'send']::text[]),
  ('Volkswagen', 'Jetta', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Volkswagen', 'Touran', ARRAY['xl', 'van', 'send']::text[]),
  ('Volkswagen', 'V-Class', ARRAY['xl', 'van', 'send']::text[]),
  ('Toyota', 'Starlet', ARRAY['economy', 'standard']::text[]),
  ('Toyota', 'Etios', ARRAY['economy', 'standard']::text[]),
  ('Toyota', 'Corolla Quest', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Toyota', 'Corolla', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Toyota', 'Rush', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Toyota', 'Urban Cruiser', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Toyota', 'Fortuner', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Toyota', 'Hilux', ARRAY['xl']::text[]),
  ('Toyota', 'Quantum', ARRAY['xl', 'van', 'send']::text[]),
  ('Toyota', 'Avanza', ARRAY['xl', 'van', 'send']::text[]),
  ('Toyota', 'Yaris', ARRAY['economy', 'standard']::text[]),
  ('Toyota', 'Prius', ARRAY['economy', 'standard', 'electric']::text[]),
  ('Toyota', 'Starlet GP', ARRAY['economy', 'standard']::text[]),
  ('Toyota', 'Etios Liva', ARRAY['economy', 'standard']::text[]),
  ('Toyota', 'Avalon', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Toyota', 'Camry', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Toyota', 'RAV4', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Toyota', 'Corolla Cross', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Toyota', 'Hiace', ARRAY['xl', 'van', 'send']::text[]),
  ('Toyota', 'Innova', ARRAY['xl', 'van', 'send']::text[]),
  ('Toyota', 'Sienna', ARRAY['xl', 'van', 'send']::text[]),
  ('Suzuki', 'Swift', ARRAY['economy', 'standard']::text[]),
  ('Suzuki', 'Dzire', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Suzuki', 'Vitara Brezza', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Suzuki', 'Jimny', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Suzuki', 'Ertiga', ARRAY['xl', 'van', 'send']::text[]),
  ('Suzuki', 'Baleno', ARRAY['economy', 'standard']::text[]),
  ('Suzuki', 'Celerio', ARRAY['economy', 'standard']::text[]),
  ('Suzuki', 'S-Presso', ARRAY['economy', 'standard']::text[]),
  ('Suzuki', 'Ciaz', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Hyundai', 'i10', ARRAY['economy', 'standard']::text[]),
  ('Hyundai', 'Grand i10', ARRAY['economy', 'standard']::text[]),
  ('Hyundai', 'Atos', ARRAY['economy', 'standard']::text[]),
  ('Hyundai', 'i20', ARRAY['economy', 'standard']::text[]),
  ('Hyundai', 'Accent', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Hyundai', 'Venue', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Hyundai', 'H1', ARRAY['xl', 'van', 'send']::text[]),
  ('Hyundai', 'Elantra', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Hyundai', 'Ioniq', ARRAY['economy', 'standard', 'electric']::text[]),
  ('Hyundai', 'Creta', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Hyundai', 'Kona EV', ARRAY['xl', 'standard', 'economy', 'electric']::text[]),
  ('Hyundai', 'Staria', ARRAY['xl', 'van', 'send']::text[]),
  ('Kia', 'Rio', ARRAY['economy', 'standard']::text[]),
  ('Kia', 'Pegas', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Kia', 'Sonet', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Kia', 'Sportage', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Kia', 'K2700', ARRAY['xl']::text[]),
  ('Kia', 'Ceed', ARRAY['economy', 'standard']::text[]),
  ('Kia', 'Soul', ARRAY['economy', 'standard']::text[]),
  ('Kia', 'Cerato', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Kia', 'Niro EV', ARRAY['xl', 'standard', 'economy', 'electric']::text[]),
  ('Kia', 'Carnival', ARRAY['xl', 'van', 'send']::text[]),
  ('Kia', 'Sedona', ARRAY['xl', 'van', 'send']::text[]),
  ('Kia', 'Picanto', ARRAY['economy', 'standard']::text[]),
  ('Renault', 'Kwid', ARRAY['economy', 'standard']::text[]),
  ('Renault', 'Clio', ARRAY['economy', 'standard']::text[]),
  ('Renault', 'Sandero', ARRAY['economy', 'standard']::text[]),
  ('Renault', 'Duster', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Renault', 'Triber', ARRAY['xl', 'van', 'send']::text[]),
  ('Renault', 'Logan', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Ford', 'Figo', ARRAY['economy', 'standard']::text[]),
  ('Ford', 'Fiesta', ARRAY['economy', 'standard']::text[]),
  ('Ford', 'Focus', ARRAY['economy', 'standard']::text[]),
  ('Ford', 'EcoSport', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Ford', 'Ranger', ARRAY['xl']::text[]),
  ('Ford', 'Everest', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Ford', 'Transit', ARRAY['xl', 'van', 'send']::text[]),
  ('Ford', 'Tourneo Custom', ARRAY['xl', 'van', 'send']::text[]),
  ('Nissan', 'Micra', ARRAY['economy', 'standard']::text[]),
  ('Nissan', 'Almera', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Nissan', 'Magnite', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Nissan', 'X-Trail', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Nissan', 'NP200', ARRAY['xl']::text[]),
  ('Nissan', 'NP300', ARRAY['xl']::text[]),
  ('Nissan', 'Navara', ARRAY['xl']::text[]),
  ('Nissan', 'NV350', ARRAY['xl', 'van', 'send']::text[]),
  ('Nissan', 'Leaf', ARRAY['economy', 'standard', 'electric']::text[]),
  ('Nissan', 'Tiida', ARRAY['economy', 'standard']::text[]),
  ('Nissan', 'Sentra', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Nissan', 'Versa', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Nissan', 'NV200', ARRAY['xl', 'van', 'send']::text[]),
  ('Nissan', 'Serena', ARRAY['xl', 'van', 'send']::text[]),
  ('Isuzu', 'D-Max', ARRAY['xl']::text[]),
  ('Isuzu', 'MU-X', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Haval', 'Jolion', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Haval', 'H6', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Chery', 'Tiggo 4 Pro', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Chery', 'Tiggo 7 Pro', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Honda', 'Fit', ARRAY['economy', 'standard']::text[]),
  ('Honda', 'Ballade', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Honda', 'Amaze', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Honda', 'BR-V', ARRAY['xl', 'van', 'send']::text[]),
  ('Honda', 'Jazz', ARRAY['economy', 'standard']::text[]),
  ('Honda', 'City', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Honda', 'Civic', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Honda', 'Accord', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Honda', 'Odyssey', ARRAY['xl', 'van', 'send']::text[]),
  ('Mahindra', 'XUV300', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Mahindra', 'Scorpio', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Mahindra', 'Pik Up', ARRAY['xl']::text[]),
  ('Mazda', 'Mazda2', ARRAY['economy', 'standard']::text[]),
  ('Mazda', 'Mazda3', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Mazda', 'CX-3', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Mazda', 'CX-5', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Mazda', '2', ARRAY['economy', 'standard']::text[]),
  ('Mazda', '2 Hatch', ARRAY['economy', 'standard']::text[]),
  ('Mazda', '3', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Mazda', '3 Hatch', ARRAY['economy', 'standard']::text[]),
  ('Mercedes-Benz', 'A-Class', ARRAY['economy', 'standard']::text[]),
  ('Mercedes-Benz', 'C-Class', ARRAY['comfort', 'business']::text[]),
  ('Mercedes-Benz', 'GLC', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Mercedes-Benz', 'Vito', ARRAY['xl', 'van', 'send']::text[]),
  ('Mercedes-Benz', 'Sprinter', ARRAY['xl', 'van', 'send']::text[]),
  ('Mercedes-Benz', 'E-Class', ARRAY['comfort', 'business']::text[]),
  ('Mercedes-Benz', 'S-Class', ARRAY['premium', 'business']::text[]),
  ('Mercedes-Benz', 'V-Class', ARRAY['xl', 'van', 'send']::text[]),
  ('BMW', '1 Series', ARRAY['economy', 'standard']::text[]),
  ('BMW', '3 Series', ARRAY['comfort', 'business']::text[]),
  ('BMW', 'X1', ARRAY['xl', 'standard', 'economy']::text[]),
  ('BMW', 'X3', ARRAY['xl', 'standard', 'economy']::text[]),
  ('BMW', '5 Series', ARRAY['comfort', 'business']::text[]),
  ('BMW', '7 Series', ARRAY['premium', 'business']::text[]),
  ('Audi', 'A1', ARRAY['economy', 'standard']::text[]),
  ('Audi', 'A3', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Audi', 'Q3', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Audi', 'A4', ARRAY['comfort', 'business']::text[]),
  ('Audi', 'A5', ARRAY['comfort', 'business']::text[]),
  ('Audi', 'Q5', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Opel', 'Corsa', ARRAY['economy', 'standard']::text[]),
  ('Opel', 'Astra', ARRAY['economy', 'standard']::text[]),
  ('Mitsubishi', 'Triton', ARRAY['xl']::text[]),
  ('Mitsubishi', 'Pajero', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Mitsubishi', 'Attrage', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Mitsubishi', 'Mirage', ARRAY['economy', 'standard']::text[]),
  ('Mitsubishi', 'Mirage Hatch', ARRAY['economy', 'standard']::text[]),
  ('GWM', 'Steed', ARRAY['xl']::text[]),
  ('GWM', 'P-Series', ARRAY['xl']::text[]),
  ('GWM', 'Ora 07', ARRAY['economy', 'standard', 'comfort', 'electric']::text[]),
  ('GWM', 'Ora Excel', ARRAY['economy', 'standard', 'electric']::text[]),
  ('Datsun', 'Go', ARRAY['economy', 'standard']::text[]),
  ('Fiat', 'Uno', ARRAY['economy', 'standard']::text[]),
  ('Peugeot', '208', ARRAY['economy', 'standard']::text[]),
  ('Peugeot', '2008', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Peugeot', '108', ARRAY['economy', 'standard']::text[]),
  ('Peugeot', '308', ARRAY['economy', 'standard']::text[]),
  ('Peugeot', '301', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Bajaj', 'Qute', ARRAY['economy', 'standard']::text[]),
  ('Byd', 'Dolphin', ARRAY['economy', 'standard', 'electric']::text[]),
  ('Byd', 'Atto 3', ARRAY['xl', 'standard', 'economy', 'electric']::text[]),
  ('Byd', 'Yuan Plus', ARRAY['xl', 'standard', 'economy', 'electric']::text[]),
  ('Byd', 'Seal', ARRAY['economy', 'standard', 'comfort', 'electric']::text[]),
  ('Chevrolet', 'Spark', ARRAY['economy', 'standard']::text[]),
  ('Chevrolet', 'Aveo Sonic', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Chevrolet', 'Cruze', ARRAY['economy', 'standard', 'comfort']::text[]),
  ('Chevrolet', 'Spin', ARRAY['xl', 'van', 'send']::text[]),
  ('Chevrolet', 'Suburban', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Citroen', 'C3 Aircross', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Lexus', 'ES', ARRAY['comfort', 'business']::text[]),
  ('Lexus', 'NX', ARRAY['xl', 'standard', 'economy']::text[]),
  ('Maxus', 'G10', ARRAY['xl', 'van', 'send']::text[]),
  ('MG', 'ZS EV', ARRAY['xl', 'standard', 'economy', 'electric']::text[]),
  ('Tesla', 'Model 3', ARRAY['economy', 'standard', 'comfort', 'electric']::text[]),
  ('Tesla', 'Model S', ARRAY['premium', 'business', 'electric']::text[]),
  ('Tesla', 'Model Y', ARRAY['xl', 'standard', 'economy', 'electric']::text[]),
  ('Volvo', 'EX30', ARRAY['xl', 'standard', 'economy', 'electric']::text[]),
  ('Volvo', 'S60', ARRAY['comfort', 'business']::text[]),
  ('Volvo', 'XC90', ARRAY['xl', 'standard', 'economy']::text[])
;

CREATE TEMP TABLE vura_make_alias (
  alias TEXT PRIMARY KEY,
  make TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO vura_make_alias (alias, make) VALUES
  ('audi', 'Audi'),
  ('bajaj', 'Bajaj'),
  ('benz', 'Mercedes-Benz'),
  ('bmw', 'BMW'),
  ('byd', 'Byd'),
  ('chery', 'Chery'),
  ('chev', 'Chevrolet'),
  ('chevrolet', 'Chevrolet'),
  ('chevy', 'Chevrolet'),
  ('citroen', 'Citroen'),
  ('citroën', 'Citroen'),
  ('datsun', 'Datsun'),
  ('fiat', 'Fiat'),
  ('ford', 'Ford'),
  ('gwm', 'GWM'),
  ('haval', 'Haval'),
  ('honda', 'Honda'),
  ('hyundai', 'Hyundai'),
  ('isuzu', 'Isuzu'),
  ('kia', 'Kia'),
  ('lexus', 'Lexus'),
  ('mahindra', 'Mahindra'),
  ('maxus', 'Maxus'),
  ('mazda', 'Mazda'),
  ('merc', 'Mercedes-Benz'),
  ('mercedes', 'Mercedes-Benz'),
  ('mercedes benz', 'Mercedes-Benz'),
  ('mercedes-benz', 'Mercedes-Benz'),
  ('mg', 'MG'),
  ('mitsubishi', 'Mitsubishi'),
  ('nissan', 'Nissan'),
  ('opel', 'Opel'),
  ('peugeot', 'Peugeot'),
  ('renault', 'Renault'),
  ('suzuki', 'Suzuki'),
  ('tesla', 'Tesla'),
  ('toyota', 'Toyota'),
  ('volkswagen', 'Volkswagen'),
  ('volvo', 'Volvo'),
  ('vw', 'Volkswagen')
;

-- Car DB photos: fill only approved rows still missing a category.
UPDATE vehicle_images v
SET categories = best.category
FROM (
  SELECT n.id, c.category
  FROM (
    SELECT v2.id,
           COALESCE(a.make, v2.make) AS make,
           v2.model
    FROM vehicle_images v2
    LEFT JOIN vura_make_alias a
      ON lower(trim(a.alias)) = lower(trim(v2.make))
    WHERE v2.status = 'approved'
      AND v2.make IS NOT NULL
      AND v2.model IS NOT NULL
      AND (v2.categories IS NULL OR v2.categories = '{}')
  ) n
  JOIN LATERAL (
    SELECT c.category
    FROM vura_category_catalogue c
    WHERE lower(trim(c.make)) = lower(trim(n.make))
      AND (
        lower(regexp_replace(c.model, '[-_]+', ' ', 'g')) =
          lower(regexp_replace(n.model, '[-_]+', ' ', 'g'))
        OR lower(regexp_replace(n.model, '[-_]+', ' ', 'g')) LIKE
          lower(regexp_replace(c.model, '[-_]+', ' ', 'g')) || ' %'
      )
    ORDER BY length(c.model) DESC
    LIMIT 1
  ) c ON true
) best
WHERE v.id = best.id;

-- Driver profiles: dispatch reads this JSONB array. Fill only empty ones.
UPDATE driver_profiles dp
SET vehicle_categories = to_jsonb(best.category)
FROM (
  SELECT n.user_id, c.category
  FROM (
    SELECT dp2.user_id,
           COALESCE(a.make, dp2.vehicle_make) AS make,
           dp2.vehicle_model AS model
    FROM driver_profiles dp2
    LEFT JOIN vura_make_alias a
      ON lower(trim(a.alias)) = lower(trim(dp2.vehicle_make))
    WHERE (dp2.vehicle_categories IS NULL OR dp2.vehicle_categories = '[]'::jsonb)
      AND dp2.vehicle_make IS NOT NULL
      AND dp2.vehicle_model IS NOT NULL
  ) n
  JOIN LATERAL (
    SELECT c.category
    FROM vura_category_catalogue c
    WHERE lower(trim(c.make)) = lower(trim(n.make))
      AND (
        lower(regexp_replace(c.model, '[-_]+', ' ', 'g')) =
          lower(regexp_replace(n.model, '[-_]+', ' ', 'g'))
        OR lower(regexp_replace(n.model, '[-_]+', ' ', 'g')) LIKE
          lower(regexp_replace(c.model, '[-_]+', ' ', 'g')) || ' %'
      )
    ORDER BY length(c.model) DESC
    LIMIT 1
  ) c ON true
) best
WHERE dp.user_id = best.user_id;
