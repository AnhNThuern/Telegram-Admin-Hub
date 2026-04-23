-- Migration: add shop_name and welcome_message to bot_configs
-- These columns allow admins to set a custom display name and /start welcome
-- message for the Telegram bot without code changes.
-- Applied via: pnpm --filter @workspace/db push

ALTER TABLE bot_configs
  ADD COLUMN IF NOT EXISTS shop_name TEXT,
  ADD COLUMN IF NOT EXISTS welcome_message TEXT;
