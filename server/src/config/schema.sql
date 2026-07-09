-- Vura Database Schema
-- PostgreSQL (AWS RDS: vura-db)

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────
-- Users table (shared)
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firebase_uid VARCHAR(128) UNIQUE NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('driver', 'passenger')),
  full_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(32),
  profile_photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);

-- ─────────────────────────────
-- Driver profiles
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS driver_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_number VARCHAR(64),
  vehicle_make VARCHAR(64),
  vehicle_model VARCHAR(64),
  vehicle_year INTEGER,
  vehicle_color VARCHAR(32),
  license_plate VARCHAR(32),
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  current_heading DOUBLE PRECISION,
  current_speed DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  total_rides INTEGER NOT NULL DEFAULT 0,
  average_rating DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────
-- Rides
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID REFERENCES users(id),
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  destination_address TEXT NOT NULL,
  destination_lat DOUBLE PRECISION NOT NULL,
  destination_lng DOUBLE PRECISION NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'searching'
    CHECK (status IN ('searching','accepted','driver_arrived','in_progress','completed','cancelled')),
  fare DOUBLE PRECISION,
  distance_km DOUBLE PRECISION,
  duration_mins DOUBLE PRECISION,
  cancelled_by VARCHAR(16) CHECK (cancelled_by IN ('driver', 'passenger', 'system')),
  cancel_reason TEXT,
  accepted_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rides_passenger ON rides(passenger_id);
CREATE INDEX idx_rides_driver ON rides(driver_id);
CREATE INDEX idx_rides_status ON rides(status);

-- ─────────────────────────────
-- Driver earnings
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS driver_earnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID NOT NULL REFERENCES users(id),
  ride_id UUID UNIQUE NOT NULL REFERENCES rides(id),
  gross_fare DOUBLE PRECISION NOT NULL,
  service_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  net_earnings DOUBLE PRECISION NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration_mins DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_earnings_driver ON driver_earnings(driver_id);

-- ─────────────────────────────
-- Ratings
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID UNIQUE NOT NULL REFERENCES rides(id),
  passenger_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ratings_driver ON ratings(driver_id);

-- ─────────────────────────────
-- Updated-at trigger
-- ─────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_driver_profiles_updated_at
  BEFORE UPDATE ON driver_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_rides_updated_at
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────
-- Payment methods (saved cards)
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS payment_methods (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  authorization_code VARCHAR(100) NOT NULL,
  card_type          VARCHAR(20),
  last4              VARCHAR(4),
  bank               VARCHAR(100),
  is_default         BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, last4)
);

-- ─────────────────────────────
-- Payments (transaction log)
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id    UUID REFERENCES rides(id),
  user_id    UUID REFERENCES users(id),
  amount     DECIMAL(10,2) NOT NULL,
  reference  VARCHAR(100) UNIQUE NOT NULL,
  status     VARCHAR(20) DEFAULT 'pending',
  paid_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────
-- Driver payouts
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS driver_payouts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id      UUID REFERENCES users(id),
  amount         DECIMAL(10,2) NOT NULL,
  reference      VARCHAR(100),
  ride_count     INT DEFAULT 0,
  status         VARCHAR(20) DEFAULT 'pending',
  failure_reason TEXT,
  period_start   TIMESTAMPTZ,
  period_end     TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────
-- Add payment columns to rides
-- ─────────────────────────────
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS payment_status    VARCHAR(20) DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payment_method    VARCHAR(20) DEFAULT 'cash';

-- ─────────────────────────────
-- Add payout column to driver_earnings
-- ─────────────────────────────
ALTER TABLE driver_earnings
  ADD COLUMN IF NOT EXISTS payout_status VARCHAR(20) DEFAULT 'pending';

-- ─────────────────────────────
-- Add ride request fee to driver_earnings & rides
-- ─────────────────────────────
ALTER TABLE driver_earnings
  ADD COLUMN IF NOT EXISTS ride_request_fee DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS ride_request_fee DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ─────────────────────────────
-- Add banking columns to driver_profiles
-- ─────────────────────────────
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS bank_code           VARCHAR(10),
  ADD COLUMN IF NOT EXISTS bank_name           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS paystack_recipient  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS paystack_subaccount VARCHAR(100),
  ADD COLUMN IF NOT EXISTS banking_verified    BOOLEAN DEFAULT false;
