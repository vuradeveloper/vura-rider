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
    -- Economy / standard cars (sedans & hatchbacks, ~4-5 seats)
    ('Volkswagen', 'Polo', ARRAY['economy', 'standard']::text[]),
    ('Volkswagen', 'Polo Vivo', ARRAY['economy', 'standard']::text[]),
    ('Volkswagen', 'Polo Sedan', ARRAY['economy', 'standard']::text[]),
    ('Volkswagen', 'Golf', ARRAY['economy', 'standard']::text[]),
    ('Volkswagen', 'Crafter', ARRAY['xl']::text[]),
    ('Toyota', 'Corolla', ARRAY['economy', 'standard']::text[]),
    ('Toyota', 'Fortuner', ARRAY['xl']::text[]),
    ('Kia', 'K2700', ARRAY['xl', 'van', 'send']::text[]),
    ('Ford', 'Ranger', ARRAY['xl']::text[]),
    ('Honda', 'BR-V', ARRAY['xl', 'standard', 'economy']::text[]),
    ('Honda', 'Odyssey', ARRAY['xl', 'van', 'send']::text[]),
    ('Mazda', 'Mazda2', ARRAY['economy', 'standard']::text[]),
    ('Mazda', 'Mazda3', ARRAY['economy', 'standard']::text[]),
    ('Mazda', 'CX-3', ARRAY['economy', 'standard', 'xl']::text[]),
    ('Mazda', 'CX-5', ARRAY['xl', 'standard', 'economy']::text[]),
    ('Mazda', '2', ARRAY['economy', 'standard']::text[]),
    ('Mazda', '2 Hatch', ARRAY['economy', 'standard']::text[]),
    ('Mazda', '3', ARRAY['economy', 'standard']::text[]),
    ('Mazda', '3 Hatch', ARRAY['economy', 'standard']::text[]),
    ('Mercedes-Benz', 'A-Class', ARRAY['economy', 'standard']::text[]),
    ('Mercedes-Benz', 'C-Class', ARRAY['comfort', 'business']::text[]),
    ('Mercedes-Benz', 'GLC', ARRAY['xl', 'standard', 'economy']::text[]),
    ('Mercedes-Benz', 'Vito', ARRAY['xl', 'van', 'send']::text[]),
    ('Mercedes-Benz', 'Sprinter', ARRAY['xl', 'van', 'send']::text[]),
    ('Mercedes-Benz', 'E-Class', ARRAY['comfort', 'business']::text[]),
    ('Mercedes-Benz', 'S-Class', ARRAY['premium', 'business']::text[]),
    ('Mercedes-Benz', 'V-Class', ARRAY['xl', 'van']::text[]),
    ('BMW', '1 Series', ARRAY['economy', 'standard']::text[]),
    ('BMW', '3 Series', ARRAY['comfort', 'business']::text[]),
    ('BMW', 'X1', ARRAY['xl', 'standard', 'economy']::text[]),
    ('BMW', 'X3', ARRAY['xl', 'standard', 'economy']::text[]),
    ('BMW', '5 Series', ARRAY['comfort', 'business']::text[]),
    ('BMW', '7 Series', ARRAY['premium', 'business']::text[]),
    ('Audi', 'A1', ARRAY['economy', 'standard']::text[]),
    ('Audi', 'A3', ARRAY['economy', 'standard']::text[]),
    ('Audi', 'Q3', ARRAY['xl', 'standard', 'economy']::text[]),
    ('Audi', 'A4', ARRAY['comfort', 'business']::text[]),
    ('Audi', 'A5', ARRAY['comfort', 'business']::text[]),
    ('Audi', 'Q5', ARRAY['xl', 'standard', 'economy']::text[]),
    ('Opel', 'Corsa', ARRAY['economy', 'standard']::text[]),
    ('Opel', 'Astra', ARRAY['economy', 'standard']::text[]),
    ('Mitsubishi', 'Triton', ARRAY['xl']::text[]),
    ('Mitsubishi', 'Pajero', ARRAY['xl']::text[]),
    ('Mitsubishi', 'Attrage', ARRAY['economy', 'standard']::text[]),
    ('Mitsubishi', 'Mirage', ARRAY['economy', 'standard']::text[]),
    ('Mitsubishi', 'Mirage Hatch', ARRAY['economy', 'standard']::text[]),
    ('GWM', 'Steed', ARRAY['xl']::text[]),
    ('GWM', 'P-Series', ARRAY['xl']::text[]),
    ('GWM', 'Ora 07', ARRAY['electric', 'economy']::text[]),
    ('GWM', 'Ora Excel', ARRAY['electric', 'economy']::text[]),
    ('Datsun', 'Go', ARRAY['economy', 'standard']::text[]),
    ('Fiat', 'Uno', ARRAY['economy', 'standard']::text[]),
    ('Peugeot', '208', ARRAY['economy', 'standard']::text[]),
    ('Peugeot', '2008', ARRAY['economy', 'standard', 'xl']::text[]),
    ('Peugeot', '108', ARRAY['economy', 'standard']::text[]),
    ('Peugeot', '308', ARRAY['economy', 'standard']::text[]),
    ('Peugeot', '301', ARRAY['economy', 'standard']::text[]),
    ('Bajaj', 'Qute', ARRAY['economy']::text[]),
    ('Byd', 'Dolphin', ARRAY['electric', 'economy']::text[]),
    ('Byd', 'Atto 3', ARRAY['electric', 'economy', 'xl']::text[]),
    ('Byd', 'Yuan Plus', ARRAY['electric', 'economy', 'xl']::text[]),
    ('Byd', 'Seal', ARRAY['electric', 'economy']::text[]),
    ('Chevrolet', 'Spark', ARRAY['economy', 'standard']::text[]),
    ('Chevrolet', 'Aveo Sonic', ARRAY['economy', 'standard']::text[]),
    ('Chevrolet', 'Cruze', ARRAY['economy', 'standard']::text[]),
    ('Chevrolet', 'Spin', ARRAY['xl']::text[]),
    ('Chevrolet', 'Suburban', ARRAY['xl', 'van', 'send']::text[]),
    ('Citroen', 'C3 Aircross', ARRAY['economy', 'standard', 'xl']::text[]),
    ('Lexus', 'ES', ARRAY['comfort', 'business']::text[]),
    ('Lexus', 'NX', ARRAY['xl', 'standard', 'economy']::text[]),
    ('Maxus', 'G10', ARRAY['xl', 'van', 'send']::text[]),
    ('MG', 'ZS EV', ARRAY['electric', 'economy', 'xl']::text[]),
    ('Tesla', 'Model 3', ARRAY['electric', 'economy']::text[]),
    ('Tesla', 'Model S', ARRAY['electric', 'premium', 'business']::text[]),
    ('Tesla', 'Model Y', ARRAY['electric', 'economy', 'xl']::text[]),
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
