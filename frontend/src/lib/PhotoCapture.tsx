import { useEffect, useRef, useState } from 'react';
import { compressImage } from '@/lib/compressImage';
import { IconCamera } from '@/design-system/icons';
import './PhotoCapture.css';

interface Props {
  label: string;
  ctaIdle?: string;
  ctaSubmit?: string;
  ctaSubmitting?: string;
  ctaRetake?: string;
  onUpload: (file: File) => Promise<void>;
  onDone?: () => void;
  disabled?: boolean;
  color?: 'flame' | 'blue';
}

export function PhotoCapture({
  label,
  ctaIdle = 'Take photo',
  ctaSubmit = 'Submit photo',
  ctaSubmitting = 'Sending...',
  ctaRetake = 'Retake',
  onUpload,
  onDone,
  disabled = false,
  color = 'flame',
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const scrollActionsIntoView = () => {
    const el = actionsRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    // Belt-and-suspenders: also scroll the nearest scrollable ancestor to its
    // bottom in case scrollIntoView underestimates (image not fully laid out).
    let parent: HTMLElement | null = el.parentElement;
    while (parent) {
      const overflowY = getComputedStyle(parent).overflowY;
      const canScroll =
        (overflowY === 'auto' || overflowY === 'scroll') &&
        parent.scrollHeight > parent.clientHeight;
      if (canScroll) {
        parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
        return;
      }
      parent = parent.parentElement;
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    if (previewUrl) scrollActionsIntoView();
  }, [previewUrl]);

  const onPick = () => fileRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    try {
      const compressed = await compressImage(picked);
      setFile(compressed);
      const url = URL.createObjectURL(compressed);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
    } catch {
      setFile(picked);
      const url = URL.createObjectURL(picked);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
    }
  };

  const onRetake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
  };

  const onSubmit = async () => {
    if (!file) return;
    setSubmitting(true);
    try {
      await onUpload(file);
      setDone(true);
      onDone?.();
    } catch {
      // error toast handled by API client
    } finally {
      setSubmitting(false);
    }
  };

  const accentClass =
    color === 'blue' ? 'photo-capture__link--accent photo-capture__link--blue' : 'photo-capture__link--accent';

  return (
    <div className="photo-capture">
      <div className="photo-capture__label">{label}</div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFileChange}
      />
      {previewUrl ? (
        <div className="photo-capture__preview-wrap">
          <img
            src={previewUrl}
            alt="preview"
            className="photo-capture__preview"
            onLoad={scrollActionsIntoView}
          />
        </div>
      ) : null}
      {done ? (
        <div className="sk-hand-b photo-capture__done">Photo saved ✓</div>
      ) : !previewUrl ? (
        <button
          type="button"
          className={`photo-capture__idle photo-capture__idle--${color}`}
          onClick={onPick}
          disabled={disabled}
        >
          <IconCamera size={16} />
          <span>{ctaIdle}</span>
        </button>
      ) : (
        <div className="photo-capture__actions" ref={actionsRef}>
          <button
            type="button"
            className="photo-capture__link"
            onClick={onRetake}
            disabled={submitting}
          >
            {ctaRetake}
          </button>
          <button
            type="button"
            className={`photo-capture__link ${accentClass}`}
            onClick={onSubmit}
            disabled={submitting || disabled}
          >
            {submitting ? ctaSubmitting : ctaSubmit}
          </button>
        </div>
      )}
    </div>
  );
}
