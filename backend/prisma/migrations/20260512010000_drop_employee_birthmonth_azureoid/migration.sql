-- Drops two unused Employee columns:
--   * `birthMonth` — never read by any game logic. Was seeded from the CSV
--     for a birthday-based mission that never shipped.
--   * `azureOid` — never written. The SSO callback matches by `email` only;
--     the column was added speculatively and stayed unused. The `email`
--     column already enforces the SSO-link uniqueness contract.

ALTER TABLE "Employee" DROP COLUMN "birthMonth";
ALTER TABLE "Employee" DROP COLUMN "azureOid";
