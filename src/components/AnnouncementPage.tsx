import React, { useMemo, useState } from 'react';
import { Team, RankedTeam } from '../types';
import { getHpTotal } from '../utils/teamUtils';

type AnnouncementPageProps = {
  teams: Team[];
  repomasterRevealedRanks: Set<number>;
  collectionRevealedRanks: Set<number>;
  timeAttackRevealedRanks: Set<number>;
};

const calculateRepomasterScore = (team: Team, hpTotal: number): number | null => {
  const amount = typeof team.finalAmount === 'number' ? team.finalAmount : 0;
  const minutes = typeof team.playTime.minutes === 'number' ? team.playTime.minutes : 0;

  if (minutes === 0 || amount === 0 || hpTotal === 0) {
    return null;
  }

  return (amount / minutes) * hpTotal * team.level;
};

const calculateTimeAttackValue = (team: Team): number | null => {
  if (team.level !== 5) return null;
  const minutes = typeof team.playTime.minutes === 'number' ? team.playTime.minutes : null;
  if (minutes === null || minutes === 0) return null;
  return minutes;
};

const calculateRepomasterRanking = (teams: Team[]): RankedTeam[] => {
  const enriched = teams.map(team => {
    const hpTotal = getHpTotal(team.members);
    const score = calculateRepomasterScore(team, hpTotal);
    return { team, hpTotal, score };
  });

  const validTeams = enriched.filter(t => t.score !== null) as Array<{
    team: Team;
    hpTotal: number;
    score: number;
  }>;

  const sorted = [...validTeams].sort((a, b) => b.score - a.score);

  return sorted.reduce<RankedTeam[]>((acc, item, index) => {
    const prev = sorted[index - 1];
    const isTie = prev && prev.score === item.score;
    const rank = isTie && prev ? acc[acc.length - 1].rank : index + 1;
    acc.push({
      ...item.team,
      hpTotal: item.hpTotal,
      totalSeconds: null,
      rank,
      isTie: Boolean(isTie),
    });
    return acc;
  }, []);
};

const calculateCollectionRanking = (teams: Team[]): RankedTeam[] => {
  const enriched = teams.map(team => ({
    team,
    finalAmount: typeof team.finalAmount === 'number' ? team.finalAmount : 0,
    hpTotal: getHpTotal(team.members),
  }));

  const sorted = [...enriched].sort((a, b) => b.finalAmount - a.finalAmount);

  return sorted.reduce<RankedTeam[]>((acc, item, index) => {
    const prev = sorted[index - 1];
    const isTie = prev && prev.finalAmount === item.finalAmount;
    const rank = isTie && prev ? acc[acc.length - 1].rank : index + 1;
    acc.push({
      ...item.team,
      hpTotal: item.hpTotal,
      totalSeconds: null,
      rank,
      isTie: Boolean(isTie),
    });
    return acc;
  }, []);
};

const calculateTimeAttackRanking = (teams: Team[]): RankedTeam[] => {
  const enriched = teams.map(team => {
    const timeValue = calculateTimeAttackValue(team);
    const hpTotal = getHpTotal(team.members);
    return { team, timeValue, hpTotal };
  });

  const sorted = [...enriched].sort((a, b) => {
    if (b.team.level !== a.team.level) {
      return b.team.level - a.team.level;
    }
    const timeA = a.timeValue !== null ? a.timeValue : Infinity;
    const timeB = b.timeValue !== null ? b.timeValue : Infinity;
    return timeA - timeB;
  });

  const entries: RankedTeam[] = sorted.reduce<RankedTeam[]>((acc, item, index) => {
    const prev = sorted[index - 1];
    const isTie =
      prev &&
      prev.team.level === item.team.level &&
      prev.timeValue === item.timeValue &&
      prev.timeValue !== null &&
      item.timeValue !== null;

    const rank = isTie && prev ? acc[acc.length - 1].rank : index + 1;

    acc.push({
      ...item.team,
      hpTotal: item.hpTotal,
      totalSeconds: null,
      rank,
      isTie: Boolean(isTie),
    });
    return acc;
  }, []);

  return entries;
};

type AnnouncementType = 'repomaster' | 'collection' | 'timeattack';

const formatStat = (team: RankedTeam, type: AnnouncementType): string => {
  switch (type) {
    case 'repomaster': {
      const score = calculateRepomasterScore(team, team.hpTotal);
      return score !== null ? `スコア ${Math.floor(score).toLocaleString('ja-JP')}` : '';
    }
    case 'collection':
      return typeof team.finalAmount === 'number'
        ? `$${team.finalAmount.toLocaleString('en-US')}`
        : '';
    case 'timeattack': {
      const minutes = typeof team.playTime.minutes === 'number' ? team.playTime.minutes : null;
      return minutes !== null ? `${minutes}分` : '未到達';
    }
  }
};

const RANK_LABELS: Record<1 | 2 | 3, string> = {
  1: '第1位',
  2: '第2位',
  3: '第3位',
};

type AwardCertificateProps = {
  rank: 1 | 2 | 3;
  team?: RankedTeam;
  type: AnnouncementType;
  awardTitle: string;
};

function AwardCertificate({ rank, team, type, awardTitle }: AwardCertificateProps) {
  const revealed = Boolean(team);
  const medal = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';

  return (
    <article className={`award-certificate award-certificate--${medal}`}>
      <div className="award-certificate__frame">
        <p className="award-certificate__heading">表彰状</p>
        <div className="award-certificate__line" aria-hidden="true" />
        <p className="award-certificate__award">{awardTitle}</p>
        <p className="award-certificate__rank">{RANK_LABELS[rank]}</p>
        <p className="award-certificate__name">
          {revealed ? team!.name || '名称未設定' : '？？？？'}
        </p>
        {revealed && (
          <p className="award-certificate__stat">{formatStat(team!, type)}</p>
        )}
        <div className="award-certificate__line" aria-hidden="true" />
        <p className="award-certificate__footer">謹んで表彰する</p>
      </div>
    </article>
  );
}

type TopThreeAnnouncementProps = {
  title: string;
  topThree: RankedTeam[];
  type: AnnouncementType;
};

function TopThreeAnnouncement({ title, topThree, type }: TopThreeAnnouncementProps) {
  const first = topThree.find(t => t.rank === 1);
  const second = topThree.find(t => t.rank === 2);
  const third = topThree.find(t => t.rank === 3);
  const hasAnyRevealed = topThree.length > 0;

  return (
    <section className="announcement-stage">
      <div className="announcement-stage__header">
        <p className="announcement-stage__eyebrow">RESULT</p>
        <h2 className="announcement-stage__title">{title}</h2>
      </div>

      {!hasAnyRevealed ? (
        <p className="announcement-stage__empty">
          ランキング表示ページで順位を発表すると、ここに表彰状が表示されます
        </p>
      ) : (
        <div className="award-certificates">
          <AwardCertificate rank={2} team={second} type={type} awardTitle={title} />
          <AwardCertificate rank={1} team={first} type={type} awardTitle={title} />
          <AwardCertificate rank={3} team={third} type={type} awardTitle={title} />
        </div>
      )}
    </section>
  );
}

export default function AnnouncementPage({
  teams,
  repomasterRevealedRanks,
  collectionRevealedRanks,
  timeAttackRevealedRanks,
}: AnnouncementPageProps) {
  const [activeTab, setActiveTab] = useState<AnnouncementType>('repomaster');

  const repomasterRanking = useMemo(() => calculateRepomasterRanking(teams), [teams]);
  const collectionRanking = useMemo(() => calculateCollectionRanking(teams), [teams]);
  const timeAttackRanking = useMemo(() => calculateTimeAttackRanking(teams), [teams]);

  const getTopThree = (ranking: RankedTeam[], revealedRanks: Set<number>) => {
    return ranking
      .filter(team => team.rank <= 3 && revealedRanks.has(team.rank))
      .sort((a, b) => a.rank - b.rank);
  };

  const repomasterTopThree = getTopThree(repomasterRanking, repomasterRevealedRanks);
  const collectionTopThree = getTopThree(collectionRanking, collectionRevealedRanks);
  const timeAttackTopThree = getTopThree(timeAttackRanking, timeAttackRevealedRanks);

  const getActiveTopThree = () => {
    switch (activeTab) {
      case 'repomaster':
        return repomasterTopThree;
      case 'collection':
        return collectionTopThree;
      case 'timeattack':
        return timeAttackTopThree;
    }
  };

  const getActiveTitle = () => {
    switch (activeTab) {
      case 'repomaster':
        return 'R.E.P.O.マスター賞';
      case 'collection':
        return '資材回収王チーム';
      case 'timeattack':
        return 'タイムアタック賞';
    }
  };

  return (
    <div className="announcement-page">
      <div className="announcement-tabs">
        <button
          className={`announcement-tab ${activeTab === 'repomaster' ? 'announcement-tab--active' : ''}`}
          onClick={() => setActiveTab('repomaster')}
        >
          R.E.P.O.マスター賞
        </button>
        <button
          className={`announcement-tab ${activeTab === 'collection' ? 'announcement-tab--active' : ''}`}
          onClick={() => setActiveTab('collection')}
        >
          資材回収王チーム
        </button>
        <button
          className={`announcement-tab ${activeTab === 'timeattack' ? 'announcement-tab--active' : ''}`}
          onClick={() => setActiveTab('timeattack')}
        >
          タイムアタック賞
        </button>
      </div>

      <TopThreeAnnouncement
        title={getActiveTitle()}
        topThree={getActiveTopThree()}
        type={activeTab}
      />
    </div>
  );
}
