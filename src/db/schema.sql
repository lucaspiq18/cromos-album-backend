-- Album de Cromos Virtual - Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users (collectors)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin accounts (club staff)
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams within the club
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- e.g. "Senior", "Juvenil", "Cadete"
  season TEXT NOT NULL,   -- e.g. "2024-25"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Players (athletes)
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT,
  number INT,
  bio TEXT,
  photo_key TEXT NOT NULL,  -- R2 object key
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'legendary')),
  stats JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pack types (price tiers)
CREATE TABLE pack_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  price_cents INT NOT NULL,
  sticker_count INT NOT NULL DEFAULT 5,
  rarity_weights JSONB NOT NULL DEFAULT '{"common": 60, "rare": 30, "legendary": 10}',
  active BOOLEAN DEFAULT TRUE
);

-- Purchases (pack orders)
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  pack_type_id UUID NOT NULL REFERENCES pack_types(id),
  quantity INT NOT NULL DEFAULT 1,
  total_cents INT NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_transfer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stickers owned by users
CREATE TABLE stickers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  player_id UUID NOT NULL REFERENCES players(id),
  purchase_id UUID REFERENCES purchases(id),
  is_duplicate BOOLEAN DEFAULT FALSE, -- true when user already had this player
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for album view (unique players per user)
CREATE UNIQUE INDEX idx_stickers_user_player_first ON stickers(user_id, player_id)
  WHERE is_duplicate = FALSE;

-- Trades between users
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id UUID NOT NULL REFERENCES users(id),
  offered_sticker_id UUID NOT NULL REFERENCES stickers(id),
  requested_player_id UUID NOT NULL REFERENCES players(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Default pack type
INSERT INTO pack_types (name, price_cents, sticker_count, rarity_weights)
VALUES ('Sobre Estándar', 299, 5, '{"common": 60, "rare": 30, "legendary": 10}');
