import { Team, Member } from '../types';

export type TeamTemplate = {
  id: string;
  name: string;
  teamName: string;
  members: Array<{
    name: string;
    hp: number | '';
  }>;
  createdAt: string;
};

const TEMPLATES_STORAGE_KEY = 'teamRaceBoard:templates:v1';

// テンプレート一覧を取得
export function loadTemplates(): TeamTemplate[] {
  try {
    const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as TeamTemplate[];
  } catch (error) {
    console.error('Failed to load templates:', error);
    return [];
  }
}

// テンプレートを保存
export function saveTemplate(template: Omit<TeamTemplate, 'id' | 'createdAt'>): TeamTemplate {
  const templates = loadTemplates();
  const newTemplate: TeamTemplate = {
    ...template,
    id: Date.now().toString() + Math.random().toString(36).slice(2, 9),
    createdAt: new Date().toISOString(),
  };
  templates.push(newTemplate);
  localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  return newTemplate;
}

// テンプレートを削除
export function deleteTemplate(templateId: string): void {
  const templates = loadTemplates();
  const filtered = templates.filter(t => t.id !== templateId);
  localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(filtered));
}

// チームからテンプレートを作成
export function createTemplateFromTeam(team: Team, templateName: string): TeamTemplate {
  return saveTemplate({
    name: templateName,
    teamName: team.name,
    members: team.members
      .filter(m => m.name.trim() !== '' || m.hp !== '')
      .map(m => ({
        name: m.name,
        hp: m.hp,
      })),
  });
}

// テンプレートからチームを作成
export function createTeamFromTemplate(template: TeamTemplate): Team {
  const createId = () =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
    Math.random().toString(36).slice(2, 10);

  const members: Member[] = template.members.map(m => ({
    id: createId(),
    name: m.name,
    hp: m.hp,
  }));

  // 4人分のスロットを確保
  while (members.length < 4) {
    members.push({
      id: createId(),
      name: '',
      hp: '',
    });
  }

  return {
    id: createId(),
    name: template.teamName,
    finalAmount: '',
    playTime: {
      minutes: '',
    },
    members: members.slice(0, 4),
    level: 1,
  };
}
