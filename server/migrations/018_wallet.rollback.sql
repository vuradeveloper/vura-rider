-- 018 rollback — wallet ledger + balances (money history: dropping is a
-- deliberate operational choice; payout records live in `payouts` regardless).
DROP TABLE IF EXISTS wallet_ledger;
DROP TABLE IF EXISTS driver_wallets;
DROP TABLE IF EXISTS wallet_config;
