-- Adds a profile photo URL to Employee. Sourced from empeo's
-- `workingInformation.imagePath` when admin runs the HR sync, or hand-set
-- via the admin employee edit form. Nullable so existing rows stay valid
-- without backfill; Avatar component falls back to the initial letter when
-- this is null or the URL fails to load.

ALTER TABLE "Employee" ADD COLUMN "photoUrl" TEXT;
