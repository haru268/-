import React, { useEffect, useMemo, useState, useRef } from 'react';
import { AppState, Member, Team } from './types';
import { clearState, loadState, saveState } from './utils/storage';
import { getHpTotal, getHpTotalDetail } from './utils/teamUtils';
import {
  loadTemplates,
  deleteTemplate,
  createTemplateFromTeam,
  createTeamFromTemplate,
  TeamTemplate,
} from './utils/templates';
import { initFirebase, saveStateToFirebase, isFirebaseAvailable, loadInitialState, isFirebaseConfigValid } from './utils/firebase';
import RankingPage from './components/RankingPage';
import AnnouncementPage from './components/AnnouncementPage';
import './App.css';

const MEMBER_PRESET_COUNT = 4;
const LEVELS: Team['level'][] = [1, 2, 3, 4, 5];
const LEVEL_SET = new Set<number>(LEVELS);

const createId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
  Math.random().toString(36).slice(2, 10);

const createMember = (): Member => ({
  id: createId(),
  name: '',
  hp: '',
});

const ensureMemberSlots = (members?: Member[]): Member[] => {
  const base = Array.isArray(members)
    ? members.map(member => ({
        id: member?.id ?? createId(),
        name: member?.name ?? '',
        hp: typeof member?.hp === 'number' && Number.isFinite(member.hp) ? member.hp : '',
      }))
    : [];
  const trimmed = base.slice(0, MEMBER_PRESET_COUNT);
  while (trimmed.length < MEMBER_PRESET_COUNT) {
    trimmed.push(createMember());
  }
  return trimmed;
};

const normalizeTeam = (raw?: Partial<Team>): Team => ({
  id: raw?.id ?? createId(),
  name: raw?.name ?? '',
  finalAmount:
    typeof raw?.finalAmount === 'number' && Number.isFinite(raw.finalAmount) ? raw.finalAmount : '',
  playTime: {
    minutes:
      typeof raw?.playTime?.minutes === 'number' && Number.isFinite(raw.playTime.minutes)
        ? raw.playTime.minutes
        : '',
  },
  members: ensureMemberSlots(raw?.members),
  level: LEVEL_SET.has(Number(raw?.level)) ? (Number(raw?.level) as Team['level']) : 1,
});

const createTeam = (): Team => normalizeTeam();

const createTestTeams = (): Team[] => [
  normalizeTeam({
    name: 'レポロゴα',
    finalAmount: 12500,
    playTime: { minutes: 87 },
    level: 4,
    members: [
      { name: 'たろう', hp: 120 },
      { name: 'じろう', hp: 95 },
      { name: 'さぶろう', hp: 110 },
      { name: 'しろう', hp: 80 },
    ],
  }),
  normalizeTeam({
    name: 'ナイトレポ隊',
    finalAmount: 9800,
    playTime: { minutes: 102 },
    level: 3,
    members: [
      { name: 'アキ', hp: 100 },
      { name: 'ユウ', hp: 85 },
      { name: 'レン', hp: 0 },
      { name: 'カイ', hp: 0 },
    ],
  }),
  normalizeTeam({
    name: '資材ハンターズ',
    finalAmount: 15200,
    playTime: { minutes: 95 },
    level: 5,
    members: [
      { name: 'モモ', hp: 130 },
      { name: 'ソラ', hp: 115 },
      { name: 'ハル', hp: 105 },
      { name: 'コト', hp: 90 },
    ],
  }),
  normalizeTeam({
    name: 'スピードスター',
    finalAmount: 7600,
    playTime: { minutes: 68 },
    level: 5,
    members: [
      { name: 'ケン', hp: 70 },
      { name: 'リク', hp: 65 },
    ],
  }),
  normalizeTeam({
    name: 'ゆるふわ組',
    finalAmount: 5400,
    playTime: { minutes: 120 },
    level: 2,
    members: [
      { name: 'ぱんだ', hp: 50 },
      { name: 'うさぎ', hp: 45 },
      { name: 'ねこ', hp: 40 },
      { name: 'いぬ', hp: 55 },
    ],
  }),
];

const createInitialState = (): AppState => {
  // テストデータを使用（本番では通常のcreateTeam()を使用）
  const useTestData = true; // テストデータを使う場合はtrue、通常はfalse
  return {
    teams: useTestData ? createTestTeams() : [createTeam()],
  };
};

const hasMeaningfulData = (teams: Team[]) =>
  teams.some(
    team =>
      team.name.trim() !== '' ||
      team.finalAmount !== '' ||
      typeof team.playTime.minutes === 'number' ||
      team.members.some(m => m.name.trim() !== '' || m.hp !== '')
  );

const hydrateState = (): AppState => {
  const stored = loadState();
  if (!stored) return createInitialState();

  const safeTeams =
    Array.isArray(stored.teams) && stored.teams.length > 0
      ? stored.teams.map(team => normalizeTeam(team))
      : [createTeam()];

  // テストデータモードで空の保存データしかない場合はサンプルを表示
  const useTestData = true;
  if (useTestData && !hasMeaningfulData(safeTeams)) {
    return createInitialState();
  }

  return {
    teams: safeTeams,
  };
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const toNumberOrEmpty = (value: string, opts?: { max?: number; min?: number }) => {
  if (value === '') return '';
  const parsed = Number(value);
  const safeNumber = Number.isFinite(parsed) ? parsed : 0;
  if (!opts) return safeNumber;
  const { min = 0, max = Number.POSITIVE_INFINITY } = opts;
  return clampNumber(safeNumber, min, max);
};

// R.E.P.O.マスター賞のスコア計算: （最終獲得金額 ÷ プレイ時間［分］） × 生存HP合計 × 最終到達Lv
const calculateRepomasterScore = (team: Team, hpTotal: number): number | null => {
  const amount = typeof team.finalAmount === 'number' ? team.finalAmount : 0;
  const minutes = typeof team.playTime.minutes === 'number' ? team.playTime.minutes : 0;
  
  if (minutes === 0 || amount === 0 || hpTotal === 0) {
    return null; // 計算不可
  }
  
  return (amount / minutes) * hpTotal * team.level;
};

// 資材回収王チーム順位計算（最終獲得金額のみで並び替え）
const calculateCollectionRankings = (teams: Team[]): Map<string, number> => {
  const enriched = teams.map(team => ({
    id: team.id,
    finalAmount: typeof team.finalAmount === 'number' ? team.finalAmount : 0,
  }));
  
  // 最終獲得金額が高い順でソート（レベルは関係なし）
  const sorted = [...enriched].sort((a, b) => b.finalAmount - a.finalAmount);
  const rankingMap = new Map<string, number>();
  
  sorted.forEach((team, index) => {
    const prev = sorted[index - 1];
    // 最終獲得金額が同じ場合は同点
    const rank = prev && prev.finalAmount === team.finalAmount 
      ? (rankingMap.get(prev.id) ?? index + 1)
      : index + 1;
    rankingMap.set(team.id, rank);
  });
  
  return rankingMap;
};

// R.E.P.O.マスター賞順位計算
const calculateRepomasterRankings = (teams: Team[]): Map<string, { rank: number; score: number }> => {
  const enriched = teams.map(team => {
    const hpTotal = getHpTotal(team.members);
    const score = calculateRepomasterScore(team, hpTotal);
    return { id: team.id, score };
  });
  
  // スコアがnullのものは除外して計算
  const validTeams = enriched.filter(t => t.score !== null) as Array<{ id: string; score: number }>;
  const sorted = [...validTeams].sort((a, b) => b.score - a.score);
  const rankingMap = new Map<string, { rank: number; score: number }>();
  
  sorted.forEach((team, index) => {
    const prev = sorted[index - 1];
    const rank = prev && prev.score === team.score 
      ? (rankingMap.get(prev.id)?.rank ?? index + 1)
      : index + 1;
    rankingMap.set(team.id, { rank, score: team.score });
  });
  
  return rankingMap;
};

type Page = 'input' | 'ranking' | 'announcement';

export default function App() {
  const [state, setState] = useState<AppState>(() => hydrateState());
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'syncing'>('idle');
  const [currentPage, setCurrentPage] = useState<Page>('input');
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
  const [roomId] = useState<string>(() => {
    // URLパラメータからroomIdを取得、なければデフォルト値を使用
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'default';
  });
  
  // 自分の変更かどうかを追跡（無限ループを防ぐ）
  const isLocalChange = useRef(true);

  // 各ランキングごとに独立したstateを管理（結果発表ページでも使用）
  const [repomasterRevealedRanks, setRepomasterRevealedRanks] = useState<Set<number>>(new Set());
  const [repomasterIsRevealing, setRepomasterIsRevealing] = useState(false);
  
  const [collectionRevealedRanks, setCollectionRevealedRanks] = useState<Set<number>>(new Set());
  const [collectionIsRevealing, setCollectionIsRevealing] = useState(false);
  
  const [timeAttackRevealedRanks, setTimeAttackRevealedRanks] = useState<Set<number>>(new Set());
  const [timeAttackIsRevealing, setTimeAttackIsRevealing] = useState(false);

  // テンプレート管理
  const [templates, setTemplates] = useState<TeamTemplate[]>(() => loadTemplates());
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [collapsedTeamIds, setCollapsedTeamIds] = useState<Set<string>>(new Set());

  // Firebase初期化とリアルタイム同期の設定
  useEffect(() => {
    initFirebase();
    const configValid = isFirebaseConfigValid();
    const available = isFirebaseAvailable();
    setIsFirebaseConnected(available);

    if (!configValid) {
      console.warn('Firebase設定が未設定です。環境変数を確認してください。');
    }

    // 同期は手動ボタン（相手のデータを取得 / 自分のデータを送信）で行う
  }, [roomId]);

  // ローカルストレージへの自動保存（Firebaseへの送信は手動ボタン）
  useEffect(() => {
    saveState(state);
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    }, 400);
    return () => clearTimeout(timer);
  }, [state, roomId]);

  // タイムアタック賞順位マップ（レベル優先 → 時間が短い順）
  const timeAttackRankMap = useMemo(() => {
    const enriched = state.teams.map(team => {
      const hpTotal = getHpTotal(team.members);
      const minutes = typeof team.playTime.minutes === 'number' ? team.playTime.minutes : null;
      return { ...team, hpTotal, minutes };
    });
    
    // レベル優先 → 時間が短い順でソート
    const sorted = [...enriched].sort((a, b) => {
      // まずレベルで比較（高い順）
      if (b.level !== a.level) {
        return b.level - a.level;
      }
      // レベルが同じ場合は時間で比較（短い順）
      const timeA = a.minutes !== null ? a.minutes : Infinity;
      const timeB = b.minutes !== null ? b.minutes : Infinity;
      if (timeA !== timeB) return timeA - timeB;
      // 時間も同じ場合は名前順
      return (a.name || '').localeCompare(b.name || '', 'ja');
    });
    
    const map = new Map<string, number>();
    sorted.forEach((team, index) => {
      const prev = sorted[index - 1];
      // レベルと時間が同じ場合は同点
      const timeA = team.minutes !== null ? team.minutes : Infinity;
      const timeB = prev ? (prev.minutes !== null ? prev.minutes : Infinity) : -1;
      const rank = prev && prev.level === team.level && timeA === timeB
        ? (map.get(prev.id) ?? index + 1)
        : index + 1;
      map.set(team.id, rank);
    });
    return map;
  }, [state.teams]);

  // 資材回収王チーム順位マップ
  const collectionRankMap = useMemo(() => {
    return calculateCollectionRankings(state.teams);
  }, [state.teams]);

  // R.E.P.O.マスター賞順位マップ
  const repomasterRankMap = useMemo(() => {
    return calculateRepomasterRankings(state.teams);
  }, [state.teams]);

  const handleTeamChange = (teamId: string, updater: (team: Team) => Team) => {
    isLocalChange.current = true; // 自分の変更であることをマーク
    setState(prev => ({
      ...prev,
      teams: prev.teams.map(team => (team.id === teamId ? updater(team) : team)),
    }));
  };

  const handleTeamFieldChange = <K extends keyof Team>(teamId: string, field: K, value: Team[K]) => {
    handleTeamChange(teamId, team => ({ ...team, [field]: value }));
  };

  const handlePlayTimeChange = (teamId: string, value: string) => {
    handleTeamChange(teamId, team => ({
      ...team,
      playTime: {
        ...team.playTime,
        minutes: toNumberOrEmpty(value, { min: 0, max: 9_999 }),
      },
    }));
  };

  const handleMemberChange = (
    teamId: string,
    memberId: string,
    field: keyof Member,
    value: string
  ) => {
    handleTeamChange(teamId, team => ({
      ...team,
      members: team.members.map(member =>
        member.id === memberId
          ? {
              ...member,
              [field]: field === 'hp' ? toNumberOrEmpty(value, { min: 0, max: 9_999 }) : value,
            }
          : member
      ),
    }));
  };

  const handleAddTeam = () => {
    isLocalChange.current = true; // 自分の変更であることをマーク
    setState(prev => ({
      ...prev,
      teams: [...prev.teams, createTeam()],
    }));
  };

  const toggleTeamCollapsed = (teamId: string) => {
    setCollapsedTeamIds(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  const handleRemoveTeam = (teamId: string) => {
    isLocalChange.current = true; // 自分の変更であることをマーク
    setState(prev => ({
      ...prev,
      teams: prev.teams.filter(team => team.id !== teamId),
    }));
  };

  const handleReset = () => {
    if (!window.confirm('全データをリセットしますか？')) return;
    isLocalChange.current = true; // 自分の変更であることをマーク
    clearState();
    setState(createInitialState());
  };

  // 相手のデータを取得（Firebase → 自分の画面）
  const handlePullRemote = async () => {
    if (!isFirebaseAvailable()) {
      alert('Firebaseが設定されていません。環境変数を確認してください。');
      return;
    }
    if (!window.confirm('Firebase上のデータで上書きします。よろしいですか？')) return;

    setSaveStatus('syncing');
    try {
      const remoteState = await loadInitialState(roomId);
      if (remoteState) {
        isLocalChange.current = false;
        setState(remoteState);
        saveState(remoteState);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 1500);
      } else {
        setSaveStatus('idle');
        alert('Firebaseにデータがありません。');
      }
    } catch (error) {
      console.error('データ取得エラー:', error);
      setSaveStatus('idle');
      alert('データの取得に失敗しました。');
    }
  };

  // 自分のデータを送信（自分の画面 → Firebase）
  const handlePushLocal = async () => {
    if (!isFirebaseAvailable()) {
      alert('Firebaseが設定されていません。環境変数を確認してください。');
      return;
    }
    if (!window.confirm('自分のデータをFirebaseに送信します。相手のデータは上書きされます。よろしいですか？')) return;

    setSaveStatus('syncing');
    try {
      isLocalChange.current = true;
      await saveStateToFirebase(state, roomId);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (error) {
      console.error('データ送信エラー:', error);
      setSaveStatus('idle');
      alert('データの送信に失敗しました。');
    }
  };

  // テンプレートを保存
  const handleSaveAsTemplate = (team: Team) => {
    const templateName = window.prompt('テンプレート名を入力してください:', team.name || '無題のテンプレート');
    if (!templateName) return;
    
    try {
      createTemplateFromTeam(team, templateName);
      setTemplates(loadTemplates());
      alert(`テンプレート「${templateName}」を保存しました。`);
    } catch (error) {
      console.error('テンプレート保存エラー:', error);
      alert('テンプレートの保存に失敗しました。');
    }
  };

  // テンプレートからチームを読み込む
  const handleLoadTemplate = (template: TeamTemplate) => {
    if (!window.confirm(`テンプレート「${template.name}」を読み込みますか？`)) return;
    
    const newTeam = createTeamFromTemplate(template);
    isLocalChange.current = true;
    setState(prev => ({
      ...prev,
      teams: [...prev.teams, newTeam],
    }));
    setShowTemplateModal(false);
  };

  // テンプレートを削除
  const handleDeleteTemplate = (templateId: string, templateName: string) => {
    if (!window.confirm(`テンプレート「${templateName}」を削除しますか？`)) return;
    
    deleteTemplate(templateId);
    setTemplates(loadTemplates());
  };

  const saveStatusLabel =
    saveStatus === 'saving' ? '自動保存中…' 
    : saveStatus === 'syncing' ? '同期中…'
    : saveStatus === 'saved' ? '保存済み' 
    : '待機中';

  return (
    <div className="app">
      <header className="app__header">
        <h1>レポチーム対抗生還レース</h1>
        <div className="header__status">
          <span className="status-text">
            {isFirebaseConnected
              ? 'Firebase接続済'
              : isFirebaseConfigValid()
                ? 'Firebase接続エラー'
                : 'ローカルのみ'}
            {' / '}
            {saveStatusLabel}
            {roomId !== 'default' && ` / ルーム: ${roomId}`}
          </span>
          {isFirebaseAvailable() && (
            <>
              <button
                className="ghost-btn ghost-btn--small"
                onClick={handlePullRemote}
                disabled={saveStatus === 'syncing'}
                title="Firebase上のデータを取得して上書き"
              >
                相手のデータを取得
              </button>
              <button
                className="ghost-btn ghost-btn--small"
                onClick={handlePushLocal}
                disabled={saveStatus === 'syncing'}
                title="自分のデータをFirebaseに送信"
              >
                自分のデータを送信
              </button>
            </>
          )}
          <button className="ghost-btn ghost-btn--small" onClick={handleReset}>
            リセット
          </button>
        </div>
      </header>

      <nav className="page-tabs">
        <button
          className={`tab-btn ${currentPage === 'input' ? 'tab-btn--active' : ''}`}
          onClick={() => setCurrentPage('input')}
        >
          データ入力
        </button>
        <button
          className={`tab-btn ${currentPage === 'ranking' ? 'tab-btn--active' : ''}`}
          onClick={() => setCurrentPage('ranking')}
        >
          ランキング表示
        </button>
        <button
          className={`tab-btn ${currentPage === 'announcement' ? 'tab-btn--active' : ''}`}
          onClick={() => setCurrentPage('announcement')}
        >
          結果発表
        </button>
      </nav>

      {currentPage === 'input' && (
        <section className="toolbar">
          <button className="primary-btn" onClick={handleAddTeam}>
            チームを追加
          </button>
          <button className="ghost-btn" onClick={() => setShowTemplateModal(true)}>
            テンプレート
          </button>
        </section>
      )}

      {currentPage === 'input' && (
        <section className="teams-section">
        {state.teams.map(team => {
          const hpTotal = getHpTotal(team.members);
          const repomasterData = repomasterRankMap.get(team.id);
          const repomasterRank = repomasterData?.rank;
          // ランキングに含まれている場合はそのスコアを使用、そうでなければ直接計算
          const repomasterScore = repomasterData?.score ?? calculateRepomasterScore(team, hpTotal);
          const collectionRank = collectionRankMap.get(team.id);
          const timeAttackRank = timeAttackRankMap.get(team.id);
          const isCollapsed = collapsedTeamIds.has(team.id);
          
          return (
            <article key={team.id} className={`team-card ${isCollapsed ? 'team-card--collapsed' : ''}`}>
              <header className="team-card__header">
                <button
                  type="button"
                  className="team-card__toggle"
                  onClick={() => toggleTeamCollapsed(team.id)}
                  aria-expanded={!isCollapsed}
                >
                  <span className="team-card__chevron" aria-hidden="true">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <span className="team-card__label">
                    {team.name || '名称未設定'}
                  </span>
                </button>
                <div className="team-card__header-actions">
                  <button 
                    className="ghost-btn ghost-btn--small" 
                    onClick={() => handleSaveAsTemplate(team)}
                    title="テンプレートとして保存"
                  >
                    保存
                  </button>
                  {state.teams.length > 1 && (
                    <button className="ghost-btn ghost-btn--small" onClick={() => handleRemoveTeam(team.id)}>
                      削除
                    </button>
                  )}
                </div>
              </header>

              {!isCollapsed && (
              <div className="team-card__body">
              <div className="team-card__grid">
                <label>
                  チーム名
                  <input
                    type="text"
                    value={team.name}
                    onChange={e => handleTeamFieldChange(team.id, 'name', e.target.value)}
                    placeholder="例：レポロゴα"
                  />
                </label>

                <label>
                  最終獲得金額
                  <div className="inline-input">
                    <input
                      type="number"
                      min={0}
                      value={team.finalAmount}
                      onChange={e =>
                        handleTeamFieldChange(team.id, 'finalAmount', toNumberOrEmpty(e.target.value))
                      }
                      placeholder="金額"
                    />
                    <span className="unit">$</span>
                  </div>
                </label>

                <label>
                  プレイ時間（分のみ）
                  <div className="inline-input">
                    <input
                      type="number"
                      min={0}
                      value={team.playTime.minutes}
                      onChange={e => handlePlayTimeChange(team.id, e.target.value)}
                      placeholder="プレイ時間"
                    />
                    <span className="unit">分</span>
                  </div>
                </label>

                <label>
                  最終到達レベル
                  <select
                    value={team.level}
                    onChange={e =>
                      handleTeamFieldChange(team.id, 'level', Number(e.target.value) as Team['level'])
                    }
                  >
                    {LEVELS.map(level => (
                      <option key={level} value={level}>
                        Lv.{level}
                      </option>
                    ))}
                  </select>
                </label>

              </div>

              <div className="members-panel">
                <div className="members-panel__header">
                  <h3>メンバーHP内訳（最大4名）</h3>
                  {(() => {
                    const hpDetail = getHpTotalDetail(team.members);
                    return (
                      <p>
                        合計HP：<strong>{hpDetail.total}</strong>
                        {hpDetail.compensation > 0 && (
                          <span style={{ marginLeft: '8px', fontSize: '15px', color: 'var(--muted)' }}>
                            （実HP：{hpDetail.actual} + 補正：+{hpDetail.compensation}）
                          </span>
                        )}
                      </p>
                    );
                  })()}
                </div>

                <div className="members-list">
                  {team.members.map(member => (
                    <div key={member.id} className="member-row">
                      <input
                        type="text"
                        value={member.name}
                        placeholder="メンバー名"
                        onChange={e =>
                          handleMemberChange(team.id, member.id, 'name', e.target.value)
                        }
                      />
                      <div className="inline-input">
                        <input
                          type="number"
                          min={0}
                          value={member.hp}
                          placeholder="HP"
                          onChange={e =>
                            handleMemberChange(team.id, member.id, 'hp', e.target.value)
                          }
                        />
                        <span className="unit">HP</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              </div>
              )}
            </article>
          );
        })}
        </section>
      )}

      {currentPage === 'ranking' && (
        <RankingPage
          teams={state.teams}
          repomasterRevealedRanks={repomasterRevealedRanks}
          setRepomasterRevealedRanks={setRepomasterRevealedRanks}
          repomasterIsRevealing={repomasterIsRevealing}
          setRepomasterIsRevealing={setRepomasterIsRevealing}
          collectionRevealedRanks={collectionRevealedRanks}
          setCollectionRevealedRanks={setCollectionRevealedRanks}
          collectionIsRevealing={collectionIsRevealing}
          setCollectionIsRevealing={setCollectionIsRevealing}
          timeAttackRevealedRanks={timeAttackRevealedRanks}
          setTimeAttackRevealedRanks={setTimeAttackRevealedRanks}
          timeAttackIsRevealing={timeAttackIsRevealing}
          setTimeAttackIsRevealing={setTimeAttackIsRevealing}
        />
      )}

      {currentPage === 'announcement' && (
        <AnnouncementPage
          teams={state.teams}
          repomasterRevealedRanks={repomasterRevealedRanks}
          collectionRevealedRanks={collectionRevealedRanks}
          timeAttackRevealedRanks={timeAttackRevealedRanks}
        />
      )}

      {/* テンプレート管理モーダル */}
      {showTemplateModal && (
        <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content__header">
              <h2>テンプレート</h2>
              <button className="ghost-btn ghost-btn--small" onClick={() => setShowTemplateModal(false)}>
                閉じる
              </button>
            </div>

            {templates.length === 0 ? (
              <p className="hint" style={{ textAlign: 'center', padding: '24px 0' }}>
                保存されたテンプレートがありません。
              </p>
            ) : (
              <div className="template-list">
                {templates.map((template) => (
                  <div key={template.id} className="template-item">
                    <div className="template-item__header">
                      <div>
                        <h3>{template.name}</h3>
                        <p className="template-item__meta">
                          {template.teamName || '名称未設定'} / メンバー {template.members.length}人
                        </p>
                      </div>
                      <div className="template-item__actions">
                        <button
                          className="ghost-btn ghost-btn--small"
                          onClick={() => handleLoadTemplate(template)}
                        >
                          読み込む
                        </button>
                        <button
                          className="ghost-btn ghost-btn--small"
                          onClick={() => handleDeleteTemplate(template.id, template.name)}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    {template.members.length > 0 && (
                      <p className="template-item__members">
                        {template.members.map(m => m.name || '—').join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

