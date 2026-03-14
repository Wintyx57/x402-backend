-- Migration 015: Add quick_registered flag to services table
ALTER TABLE services ADD COLUMN IF NOT EXISTS quick_registered BOOLEAN DEFAULT false;
