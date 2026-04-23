CREATE TABLE IF NOT EXISTS notification_logs (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  audience TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_logs_product_sent_at_idx ON notification_logs (product_id, sent_at DESC);
