-- Migration: Add gamification fields to User table
-- Run this in your production database (Coolify) after deploying

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS xp INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS streak INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_streak INT DEFAULT 0;
