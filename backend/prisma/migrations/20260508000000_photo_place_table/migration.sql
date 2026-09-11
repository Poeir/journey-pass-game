-- Move the photo-spot suggestion pool out of the frontend's i18n
-- (locales/{en,th}.ts → result.success.photoPlaces) and into a PhotoPlace
-- table so admins can edit them via the portal without a redeploy.
--
-- The frontend picks a random row per render and shows it as the photo-spot
-- hint above the memory upload on SuccessPage. Nothing references
-- PhotoPlace.id (no FK from any other table), so admin deletes are safe.

CREATE TABLE "PhotoPlace" (
    "id"   TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "PhotoPlace_pkey" PRIMARY KEY ("id")
);

-- Seed the 10 Thai entries from frontend/src/lib/i18n/locales/th.ts so
-- behavior on first deploy matches the previous frontend-only list.
INSERT INTO "PhotoPlace" ("id", "text") VALUES
    ('place-00', 'หน้าโปสเตอร์ ''Made With Love'''),
    ('place-01', 'หน้าโปสเตอร์ ''Self-Driven'''),
    ('place-02', 'หน้าโปสเตอร์ ''Take Challenge'''),
    ('place-03', 'หน้าโปสเตอร์ ''Open & Sharing'''),
    ('place-04', 'ที่บีนแบ็กของเรา'),
    ('place-05', 'ห้อง Pandora'),
    ('place-06', 'ห้อง Wakanda'),
    ('place-07', 'หน้าตู้เย็นในโรงอาหารบริษัท'),
    ('place-08', 'ข้างสแตนดี้พี่ติ'),
    ('place-09', 'ในตู้โทรศัพท์');
