-- Migration 016: Add logo_url column to services table
ALTER TABLE services ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT NULL;
