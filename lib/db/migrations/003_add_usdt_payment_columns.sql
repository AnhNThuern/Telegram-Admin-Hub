ALTER TABLE payment_configs ADD COLUMN IF NOT EXISTS usdt_rate numeric(12,4);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS crypto_amount numeric(20,8);
