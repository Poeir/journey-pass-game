import { type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/design-system/Card';
import { Stamp } from '@/design-system/Stamp';
import { Note } from '@/design-system/Note';
import { PassportButton } from '@/design-system/PassportButton';
import { useGame, selectTeammateDone, selectTriviaDone } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import { missionEndpoints } from '@/api/endpoints';
import { IconCheck, IconHelp, IconUser } from '@/design-system/icons';
import mission01 from '../../../assets/mission01.png';
import mission02 from '../../../assets/mission02.png';
import card04 from '../../../assets/card04.png';
import './MissionSelectPage.css';

export function MissionSelectPage() {
  const navigate = useNavigate();
  const profile = useGame((s) => s.profile);
  const trivia = useGame(selectTriviaDone);
  const team = useGame(selectTeammateDone);
  const leaderSlot = useGame((s) => s.teammate.leaderSlot);
  const setMission = useGame((s) => s.setMission);
  const startTrivia = useGame((s) => s.startTrivia);
  const startTeammate = useGame((s) => s.startTeammate);

  const onPickTrivia = async () => {
    setMission('trivia');
    if (useGame.getState().trivia.cards.length === 0) {
      const { cards } = await missionEndpoints.startTrivia();
      startTrivia(cards);
    }
    navigate(ROUTES.triviaIntro);
  };

  const onPickTeammate = async () => {
    setMission('teammate');
    if (useGame.getState().teammate.year === null) {
      const { year, leaderClue } = await missionEndpoints.startTeammate();
      startTeammate(year, leaderClue);
    }
    navigate(ROUTES.teammateIntro);
  };

  return (
    <div
      className="mission"
      style={
        {
          '--mission-card-1': `url(${mission01})`,
          '--mission-card-2': `url(${mission02})`,
          '--paper-bg': `url(${card04})`,
        } as CSSProperties
      }
    >
      <div className="mission__paper">
      <div className="mission__head">
        <h1 className="sk-hand-b mission__title">Choose a Mission</h1>
        <div className="mission__hello">Hi {profile?.name.split(' ')[0] ?? 'there'}, pick a mission to begin</div>
      </div>

      <p className="mission__desc">
        Complete <strong>both missions</strong> before anyone else to win!
        Open <strong>9:00 AM – 5:00 PM</strong> · winners announced at the closing ceremony.
      </p>

      <Card tone="peach" sketch onClick={onPickTrivia} className="mission__card mission__card--trivia" role="button" tabIndex={0}>
        <div className="mission__card-head">
          <div>
            <div className="sk-hand-b mission__card-title">THE TRIVIA<br />HUNTER</div>
            <div className="mission__card-sub">Hunt down the right person from each clue</div>
          </div>
        </div>
        <div className="mission__stamps">
          {[0, 1, 2, 3, 4].map((i) => (
            <Stamp key={i} size={26} filled={i < trivia}>{i < trivia ? <IconCheck size={14} /> : <IconHelp size={14} />}</Stamp>
          ))}
        </div>
      </Card>

      <Card tone="sky" sketch onClick={onPickTeammate} className="mission__card mission__card--teammate" role="button" tabIndex={0}>
        <div className="mission__card-head">
          <div>
            <div className="sk-hand-b mission__card-title mission__card-title--blue">
              FIND YOUR<br />TEAMMATE
            </div>
            <div className="mission__card-sub">Find people who joined in the same year</div>
          </div>
        </div>
        <div className="mission__stamps">
          {[0, 1, 2, 3, 4].map((i) => (
            <Stamp key={i} size={26} team filled={i < team}>{i < team ? <IconUser size={14} /> : <IconHelp size={14} />}</Stamp>
          ))}
          <span className="mission__stamps-plus" aria-hidden>+</span>
          <div className={`mission__stamp-extra${leaderSlot ? ' mission__stamp-extra--filled' : ''}`}>
            <svg className="mission__stamp-extra-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 8 L7 11 L12 5 L17 11 L20 8 L18.5 17 L5.5 17 Z" strokeLinejoin="round" />
            </svg>
            <span className="mission__stamp-extra-label">EXTRA</span>
          </div>
        </div>
      </Card>

      <Note>Complete all missions before anyone else to win the prize!</Note>
      <div className="mission__cta-sticky">
        <PassportButton block onClick={() => navigate(ROUTES.user)}>
          Back
        </PassportButton>
      </div>
      </div>
    </div>
  );
}
