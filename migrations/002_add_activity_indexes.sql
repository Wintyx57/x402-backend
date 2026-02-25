-- Migration 002 — Add missing indexes on `activity` table for performance
--
-- Context: The `activity` table is queried extensively by dashboard, analytics,
-- monitoring, telegram-bot, and retention modules. Most queries filter by `type`
-- and sort/filter by `created_at`. Without proper indexes, these queries do
-- sequential scans on the entire table, which degrades as activity grows.
--
-- Existing index (from setup-activity.js / 001):
--   idx_activity_created_at ON activity(created_at) — may or may not exist
--
-- This migration adds the indexes that are actually needed based on query analysis.
-- All use IF NOT EXISTS so they're safe to re-run.
--
-- Run via: node migrations/apply-activity-indexes.js
-- Or paste directly in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/kucrowtjsgusdxnjglug/sql/new

-- =============================================================================
-- INDEX 1: type + created_at DESC (COMPOSITE)
-- =============================================================================
-- THE most critical index. Covers 15+ queries across the codebase:
--
--   dashboard.js    .eq('type','payment').order('created_at', asc)
--   dashboard.js    .eq('type','api_call').order('created_at', desc).limit(1000)
--   services.js     .eq('type','api_call').order('created_at', desc).limit(200)
--   monitoring.js   .eq('type','api_call').order('created_at', desc).limit(1000)
--   monitoring.js   .eq('type','api_call').gte('created_at', since)  -- count
--   telegram-bot.js .eq('type','api_call').gte('created_at', since)  -- count
--   telegram-bot.js .eq('type','api_call').order('created_at', desc).limit(1000)
--   telegram-bot.js .eq('type','payment').order('created_at', desc)
--
-- Postgres can use this composite index for:
--   - WHERE type = X ORDER BY created_at DESC (index scan)
--   - WHERE type = X ORDER BY created_at ASC  (backward index scan)
--   - WHERE type = X AND created_at >= Y      (index range scan)
--   - WHERE type = X (count)                  (index-only scan)

CREATE INDEX IF NOT EXISTS idx_activity_type_created_at
    ON activity (type, created_at DESC);


-- =============================================================================
-- INDEX 2: created_at DESC (SINGLE COLUMN)
-- =============================================================================
-- For queries that sort by created_at WITHOUT filtering by type:
--
--   dashboard.js    .order('created_at', desc).limit(10)    -- recent activity
--   services.js     .order('created_at', desc).limit(50)    -- /api/activity
--   telegram-bot.js .order('created_at', desc).limit(10)    -- /recent
--   retention.js    .delete().lt('created_at', cutoff)       -- purge old rows
--
-- Note: setup-activity.js may have already created this as idx_activity_created_at.
-- We create it with an explicit DESC direction and a different name to be safe.
-- If the old one exists, both will coexist (Postgres handles this fine, and
-- you can drop the old one later with: DROP INDEX IF EXISTS idx_activity_created_at;)

CREATE INDEX IF NOT EXISTS idx_activity_created_at_desc
    ON activity (created_at DESC);


-- =============================================================================
-- INDEX 3: type (SINGLE COLUMN for COUNT queries)
-- =============================================================================
-- For count-only queries that filter by type without ordering:
--
--   monitoring.js   .eq('type','api_call').select('*', {count:'exact', head:true})
--   monitoring.js   .eq('type','payment').select('*', {count:'exact', head:true})
--   telegram-bot.js .eq('type','api_call').select('*', {count:'exact', head:true})
--   dashboard.js    .eq('type','payment').select('amount')
--
-- The composite index (type, created_at) can also serve these, but a single-column
-- index on `type` is smaller and faster for pure count/filter queries.
-- With only ~4 distinct type values (api_call, payment, 402, register, search),
-- this has good selectivity.

CREATE INDEX IF NOT EXISTS idx_activity_type
    ON activity (type);


-- =============================================================================
-- INDEX 4: type + detail pattern (for ILIKE searches on detail)
-- =============================================================================
-- For the /endpoint command in telegram-bot.js:
--
--   telegram-bot.js .eq('type','api_call').ilike('detail', '%keyword%')
--
-- ILIKE with leading wildcard (%keyword%) cannot use a regular B-tree index.
-- A pg_trgm GIN index enables fast trigram-based pattern matching.
-- This is optional — only needed if /endpoint searches are slow.
-- Requires the pg_trgm extension (enabled by default on Supabase).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_activity_detail_trgm
    ON activity USING gin (detail gin_trgm_ops);


-- =============================================================================
-- ANALYZE
-- =============================================================================
-- Update table statistics so the query planner uses the new indexes immediately.

ANALYZE activity;
