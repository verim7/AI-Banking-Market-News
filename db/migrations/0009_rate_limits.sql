-- Rate limiting, stored rather than in memory.
--
-- A Worker isolate is not a server: it is created and destroyed constantly and
-- there are many of them at once. A counter in a module-level variable would
-- therefore reset whenever Cloudflare felt like it, and would count each
-- isolate separately — which is not a rate limit, it is a suggestion.
--
-- One row per key. `window_start` is the beginning of the current fixed
-- window; when a request arrives after it has elapsed, the same UPSERT resets
-- the count to 1 and moves the window. That keeps the whole operation to one
-- statement, which matters because two statements could interleave between
-- concurrent requests and let a burst through.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

-- Expired rows are swept opportunistically rather than by a scheduled job, so
-- this index is what keeps the sweep from scanning the table.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
