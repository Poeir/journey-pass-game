interface Props {
  size?: string;
}

export function ScanFrame({ size = '78%' }: Props) {
  return (
    <div className="sk-scan-frame" style={{ width: size }}>
      <i />
      <div className="sk-scan-frame__line" />
    </div>
  );
}
