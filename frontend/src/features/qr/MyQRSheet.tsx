import { QRCodeSVG } from 'qrcode.react';
import { Sheet } from '@/design-system/Sheet';
import { Card } from '@/design-system/Card';
import { Note } from '@/design-system/Note';
import { useGame } from '@/game/gameStore';
import './MyQRSheet.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MyQRSheet({ open, onClose }: Props) {
  const profile = useGame((s) => s.profile);

  return (
    <Sheet open={open} onClose={onClose} title="My QR Code">
      <p className="qr__desc">Let others scan the QR below to verify who you are</p>
      <Card sketch className="qr__card">
        <div className="qr__frame">
          {profile ? (
            <QRCodeSVG value={profile.id} size={200} level="M" />
          ) : (
            <div className="qr__placeholder">Not logged in yet</div>
          )}
        </div>
        <div className="sk-hand-b qr__name">{profile?.name ?? '—'}</div>
        <div className="qr__meta" style={{ marginTop: 5 }}>
          {profile ? `${profile.id} · ${profile.dept} · Class of ${profile.year}` : '—'}
        </div>
      </Card>
      <Note>Have others scan this QR to confirm your identity!</Note>
    </Sheet>
  );
}
