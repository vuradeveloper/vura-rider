-- 021: Assign ride-class categories to existing cars in vehicle_images.
-- Idempotent; nothing destructive. Re-run safe.
--
-- The categories column was just ADDED (from 013). This migration POPULATES it
-- from the static catalogue so all cars already in the DB get a real tier.
--
-- Damage scope: none. Only updates rows where categories IS NULL.
BEGIN;

-- Static catalogue as a CTE: (make, model, category)
WITH model_catalogue AS (
  SELECT * FROM (SELECT NULL) t(make VARCHAR, model VARCHAR, category TEXT[])
  WHERE false
),

-- Perform the update: join vehicle_images to the catalogue by make+model
-- and assign the category for all approved cars missing one.
update_categories AS (
  UPDATE vehicle_images v
  SET categories = m.category
  FROM (VALUES
    ('Volkswagen', 'Polo', NULL::text[]),
    ('Volkswagen', 'Polo Vivo', NULL::text[]),
    ('Volkswagen', 'Polo Sedan', NULL::text[]),
    ('Volkswagen', 'Golf', NULL::text[]),
    ('Volkswagen', 'Crafter', ARRAY['xl']::text[]),
    ('Toyota', 'Corolla', NULL::text[]),
    ('Toyota', 'Fortuner', ARRAY['xl']::text[]),
    ('Kia', 'K2700', ARRAY['xl']::text[]),
    ('Ford', 'Ranger', ARRAY['xl']::text[]),
    ('Honda', 'BR-V', ARRAY['xl']::text[]),
    ('Honda', 'Odyssey', ARRAY['xl']::text[]),
    ('Mazda', 'Mazda2', NULL::text[]),
    ('Mazda', 'Mazda3', NULL::text[]),
    ('Mazda', 'CX-3', NULL::text[]),
    ('Mazda', 'CX-5', NULL::text[]),
    ('Mazda', '2', NULL::text[]),
    ('Mazda', '2 Hatch', NULL::text[]),
    ('Mazda', '3', NULL::text[]),
    ('Mazda', '3 Hatch', NULL::text[]),
    ('Mercedes-Benz', 'A-Class', NULL::text[]),
    ('Mercedes-Benz', 'C-Class', NULL::text[]),
    ('Mercedes-Benz', 'GLC', ARRAY['xl']::text[]),
    ('Mercedes-Benz', 'Vito', ARRAY['xl']::text[]),
    ('Mercedes-Benz', 'Sprinter', ARRAY['xl']::text[]),
    ('Mercedes-Benz', 'E-Class', NULL::text[]),
    ('Mercedes-Benz', 'S-Class', NULL::text[]),
    ('Mercedes-Benz', 'V-Class', ARRAY['xl']::text[]),
    ('BMW', '1 Series', NULL::text[]),
    ('BMW', '3 Series', NULL::text[]),
    ('BMW', 'X1', NULL::text[]),
    ('BMW', 'X3', NULL::text[]),
    ('BMW', '5 Series', NULL::text[]),
    ('BMW', '7 Series', NULL::text[]),
    ('Audi', 'A1', NULL::text[]),
    ('Audi', 'A3', NULL::text[]),
    ('Audi', 'Q3', NULL::text[]),
    ('Audi', 'A4', NULL::text[]),
    ('Audi', 'A5', NULL::text[]),
    ('Audi', 'Q5', NULL::text[]),
    ('Opel', 'Corsa', NULL::text[]),
    ('Opel', 'Astra', NULL::text[]),
    ('Mitsubishi', 'Triton', ARRAY['xl']::text[]),
    ('Mitsubishi', 'Pajero', ARRAY['xl']::text[]),
    ('Mitsubishi', 'Attrage', NULL::text[]),
    ('Mitsubishi', 'Mirage', NULL::text[]),
    ('Mitsubishi', 'Mirage Hatch', NULL::text[]),
    ('GWM', 'Steed', NULL::text[]),
    ('GWM', 'P-Series', ARRAY['xl']::text[]),
    ('GWM', 'Ora 07', NULL::text[]),
    ('GWM', 'Ora Excel', NULL::text[]),
    ('Datsun', 'Go', NULL::text[]),
    ('Fiat', 'Uno', NULL::text[]),
    ('Peugeot', '208', NULL::text[]),
    ('Peugeot', '2008', NULL::text[]),
    ('Peugeot', '108', NULL::text[]),
    ('Peugeot', '308', NULL::text[]),
    ('Peugeot', '301', NULL::text[]),
    ('Bajaj', 'Qute', NULL::text[]),
    ('Byd', 'Dolphin', NULL::text[]),
    ('Byd', 'Atto 3', NULL::text[]),
    ('Byd', 'Yuan Plus', NULL::text[]),
    ('Byd', 'Seal', NULL::text[]),
    ('Chevrolet', 'Spark', NULL::text[]),
    ('Chevrolet', 'Aveo Sonic', NULL::text[]),
    ('Chevrolet', 'Cruze', NULL::text[]),
    ('Chevrolet', 'Spin', ARRAY['xl']::text[]),
    ('Chevrolet', 'Suburban', ARRAY['xl']::text[]),
    ('Citroen', 'C3 Aircross', NULL::text[]),
    ('Lexus', 'ES', NULL::text[]),
    ('Lexus', 'NX', NULL::text[]),
    ('Maxus', 'G10', ARRAY['xl']::text[]),
    ('MG', 'ZS EV', NULL::text[]),
    ('Tesla', 'Model 3', NULL::text[]),
    ('Tesla', 'Model S', NULL::text[]),
    ('Tesla', 'Model Y', NULL::text[]),
  ) AS m(make VARCHAR, model VARCHAR, category TEXT[])
  WHERE v.status = 'approved'
    AND v.make IS NOT NULL
    AND v.model IS NOT NULL
    AND (v.categories IS NULL OR v.categories = '{}')
    AND lower(trim(v.make)) = m.make
    AND lower(trim(v.model)) = m.model
)

-- Report summary
SELECT 'rows updated' AS status, COUNT(*) AS count FROM vehicle_images WHERE categories IS NOT NULL AND categories != '{}';

COMMIT;
