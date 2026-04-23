-- Binance Pay configuration columns (added progressively; safe to run on existing DBs)
ALTER TABLE payment_configs ADD COLUMN IF NOT EXISTS binance_api_key TEXT;
ALTER TABLE payment_configs ADD COLUMN IF NOT EXISTS binance_api_secret TEXT;
ALTER TABLE payment_configs ADD COLUMN IF NOT EXISTS binance_merchant_trade_no_prefix TEXT DEFAULT 'SHOP';
ALTER TABLE payment_configs ADD COLUMN IF NOT EXISTS binance_is_active BOOLEAN NOT NULL DEFAULT FALSE;

-- USDT exchange rate for Binance Pay (Task #61: global VND/USDT rate, admin-configured)
ALTER TABLE payment_configs ADD COLUMN IF NOT EXISTS usdt_rate NUMERIC(12, 4);

-- Binance prepay ID for webhook correlation
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS binance_prepay_id TEXT;

-- Crypto amount stored with full precision for USDT payments (Task #61)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS crypto_amount NUMERIC(20, 8);

-- Stock request throttle window (hours) added to system_settings
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS stock_request_window_hours INTEGER NOT NULL DEFAULT 24;
