// Public-ish endpoint (gated by `requireSession`) that exposes the
// PhotoPlace pool to the frontend's SuccessPage. The page picks one at
// random to show as a photo-spot hint above the memory upload. Admin CRUD
// for this table lives in routes/admin.ts.

import type { FastifyInstance } from 'fastify';
import { requireSession } from '@/middleware/auth.js';
import { getAllPhotoPlaces } from '@/lib/photoPlaceCache.js';

export async function photoPlaceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/photo-places',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Photo'],
        summary: 'Pool of photo-spot suggestions for SuccessPage',
      },
    },
    async () => {
      const places = await getAllPhotoPlaces();
      return { places: places.map((p) => ({ id: p.id, text: p.text })) };
    },
  );
}
