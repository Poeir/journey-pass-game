import { useRef, useState } from 'react';
import './Avatar.css';

interface Props {
  initial?: string;
  photoUrl?: string | null;
  size?: number;
  tone?: 'flame' | 'blue' | 'neutral';
  alt?: string;
}

export function Avatar({ initial = '?', photoUrl, size = 44, tone = 'flame', alt }: Props) {
  const [failed, setFailed] = useState(false);
  // Guard against onError -> setState -> rerender -> same broken src -> onError
  // loops by remembering the URL we've already failed on.
  const failedSrcRef = useRef<string | null>(null);

  const useImage = !!photoUrl && !failed;

  return (
    <div
      className={`avatar avatar--${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {useImage ? (
        <img
          className="avatar__img"
          src={photoUrl!}
          alt={alt ?? initial}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (failedSrcRef.current === photoUrl) return;
            failedSrcRef.current = photoUrl ?? null;
            setFailed(true);
          }}
        />
      ) : (
        initial
      )}
    </div>
  );
}
