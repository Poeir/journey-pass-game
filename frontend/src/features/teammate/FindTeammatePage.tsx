import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/design-system/Avatar';
import { Button } from '@/design-system/Button';
import { EmployeeRow } from '@/design-system/EmployeeRow';
import { PageHeader } from '@/design-system/PageHeader';
import { SectionLabel } from '@/design-system/SectionLabel';
import { Sheet } from '@/design-system/Sheet';
import { IconCheck, IconPlus, IconStar, IconUsers, IconX } from '@/design-system/icons';
import { useGame, selectTeammateDone, formatYearGroup } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import { useT } from '@/lib/i18n';
import button02 from '../../../assets/button02.png';
import infoCard01 from '../../../assets/info_card_01.png';
import infoCard02 from '../../../assets/info_card_02.png';
import info01 from '../../../assets/info01.png';
import './FindTeammatePage.css';

export function FindTeammatePage() {
  const t = useT();
  const navigate = useNavigate();
  const profile = useGame((s) => s.profile);
  const leaderSlot = useGame((s) => s.teammate.leaderSlot);
  const slots = useGame((s) => s.teammate.slots);
  const year = useGame((s) => s.teammate.year);
  const leaderClue = useGame((s) => s.teammate.leaderClue);
  const done = useGame(selectTeammateDone);
  const [helpOpen, setHelpOpen] = useState(false);
  const isSelfLeader = profile?.isLeader === true;

  const membersFound = done;

  return (
    <div
      className="team"
      style={
        {
          '--btn-blue-bg': `url(${button02})`,
          '--card-found-bg': `url(${infoCard01})`,
          '--card-empty-bg': `url(${infoCard02})`,
        } as CSSProperties
      }
    >
      <PageHeader
        onBack={() => navigate(ROUTES.missions)}
        titleSize="lg"
        title={
          <>
            Find Your <span className="team__year">Teammate</span>
          </>
        }
        trailing={
          <button
            type="button"
            className="team__help-btn"
            onClick={() => setHelpOpen(true)}
            aria-label="View how to play"
          >
            <img src={info01} alt="" className="team__help-icon" />
          </button>
        }
      />

      

      <SectionLabel icon={<IconUsers size={15} />} iconTone="blue">
        Same-Year Members ({membersFound}/5) · {formatYearGroup(year)}
      </SectionLabel>
      <p className="team__sub">
        Found {done}/5 so far
      </p>
      <ul className="team__list">
        {slots.map((emp, i) => (
          <EmployeeRow
            as="li"
            key={i}
            variant={emp ? 'solid' : 'dashed'}
            tone={emp ? 'filled-blue' : 'default'}
            className="team__row"
            leading={
              <span className="team__row-mark" aria-hidden>{emp?.initial ?? '?'}</span>
            }
            trailing={emp ? <div className="team__row-check"><IconCheck /></div> : undefined}
          >
            {emp ? (
              <>
                <div className="sk-hand-b team__row-name">{emp.name}</div>
                <div className="team__row-dept">{emp.dept}</div>
              </>
            ) : (
              <div className="team__row-empty">Empty slot · Waiting for scan</div>
            )}
          </EmployeeRow>
        ))}
      </ul>

      <SectionLabel icon={<IconStar size={15} />} iconTone="gold">
        Leader (Extra)
      </SectionLabel>
      {isSelfLeader && profile ? (
        <EmployeeRow
          variant="leader"
          className="team__leader-row team__leader-row--filled"
          leading={<Avatar initial={profile.initial} photoUrl={profile.photoUrl} tone="blue" size={48} />}
          trailing={<div className="team__row-crown" aria-hidden>👑</div>}
        >
          <div className="sk-hand-b team__row-name">{profile.name} (You)</div>
          <div className="team__row-dept">{profile.dept} · You are the Leader</div>
        </EmployeeRow>
      ) : (
        <EmployeeRow
          variant="leader"
          className={`team__leader-row ${leaderSlot ? 'team__leader-row--filled' : ''}`}
          leading={
            <Avatar
              initial={leaderSlot?.initial ?? '★'}
              photoUrl={leaderSlot?.photoUrl}
              tone={leaderSlot ? 'blue' : 'neutral'}
              size={48}
            />
          }
          trailing={leaderSlot ? <div className="team__row-crown" aria-hidden>👑</div> : undefined}
        >
          {leaderSlot ? (
            <>
              <div className="sk-hand-b team__row-name">{leaderSlot.name}</div>
              <div className="team__row-dept">{leaderSlot.dept} · Leader</div>
            </>
          ) : (
            <>
              <div className="team__row-empty">No Leader scanned yet</div>
              {leaderClue && (
                <div className="team__row-dept" style={{ marginTop: 4, fontStyle: 'italic' }}>
                  Clue: {leaderClue}
                </div>
              )}
            </>
          )}
        </EmployeeRow>
      )}

      <div className="team__cta-bar">
        <Button block color="blue" onClick={() => navigate(ROUTES.teammateScan)}>
          <span className="team__btn-inner"><IconPlus size={16} /> Scan Next</span>
        </Button>
      </div>

      <Sheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        position="center"
        title="How to Play"
      >
        <div className="team__help-body">
          <p>
            <b>How to play:</b> Find{' '}
            <b style={{ color: 'var(--venio-bluetiful)' }}>5 teammates from your same year</b> and scan your assigned Leader.
            <br />
            <b style={{ color: '#c98a00' }}>The Leader</b> is an <b>Extra</b> —{' '}
            each player gets <b>their own assigned Leader</b>; follow the clue to find them.
          </p>
          <p>
            <b style={{ color: 'var(--venio-bluetiful)' }}>Members</b>{' '}
            must be <b>{formatYearGroup(year)}</b> only.
            <br />
            Each person scans on their own · Only the scanner adds to their team.
          </p>
          <p>
            <b style={{ color: 'var(--gf-flame)' }}>★ Special rule:</b>{' '}
            Anyone who joined <b>in 2022 or earlier</b> (the seniors)
            counts as <b>one cohort</b> — only this group can scan across years.
          </p>
          <p>
            <b style={{ color: '#c98a00' }}>🐅 Leaders only:</b>{' '}
            <b>Two tigers can't share one cave</b> — Leaders can't recruit other Leaders.
            You're already the Leader of your own team, so just hunt your <b>5 same-year members</b>.
          </p>
        </div>
      </Sheet>
    </div>
  );
}
