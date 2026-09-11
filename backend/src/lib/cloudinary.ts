import { v2 as cloudinary } from 'cloudinary';
import { env } from '@/config.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

// Cap concurrent Cloudinary uploads. Each holds an 8MB buffer in RAM and an
// outbound HTTPS stream — without a cap, a burst of confirms (penalty pairs
// closing at the same time) can spike memory on the 1-vCPU dyno and hammer
// Cloudinary's rate limit. Excess uploads queue and resolve in FIFO order.
const MAX_CONCURRENT_UPLOADS = 8;
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_UPLOADS) {
    active++;
    return;
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

export async function uploadImage(buffer: Buffer, folder: string): Promise<string> {
  await acquire();
  try {
    return await new Promise<string>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image', format: 'jpg' },
        (err, result) => {
          if (err) return reject(err);
          if (!result) return reject(new Error('cloudinary upload returned no result'));
          resolve(result.secure_url);
        },
      );
      stream.end(buffer);
    });
  } finally {
    release();
  }
}

// Extract the public_id portion of a Cloudinary delivery URL so we can pass it
// to `uploader.destroy`. Cloudinary URLs look like
//   https://res.cloudinary.com/<cloud>/image/upload/[transforms/][v123/]<folder>/<id>.<ext>
// The public_id we want is `<folder>/<id>` (no extension, no version, no transforms).
export function publicIdFromCloudinaryUrl(url: string): string | null {
  const marker = '/upload/';
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const tail = url.slice(i + marker.length);
  const segments = tail.split('/');
  const cleaned: string[] = [];
  for (const seg of segments) {
    // Drop the version segment (e.g. `v1716239812`).
    if (/^v\d+$/.test(seg)) continue;
    // Drop transformation segments only at the head — e.g. `c_fill,w_300`.
    // Actual public_ids never contain a comma.
    if (cleaned.length === 0 && seg.includes(',')) continue;
    cleaned.push(seg);
  }
  if (cleaned.length === 0) return null;
  const last = cleaned[cleaned.length - 1];
  const dot = last.lastIndexOf('.');
  cleaned[cleaned.length - 1] = dot === -1 ? last : last.slice(0, dot);
  return cleaned.join('/');
}

export async function destroyImage(url: string): Promise<void> {
  const publicId = publicIdFromCloudinaryUrl(url);
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
}
