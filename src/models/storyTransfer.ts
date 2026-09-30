import {
  characterColors,
  createId,
  CURRENT_STORY_VERSION,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
  type StoryStatus,
} from './story';
import { orderedScenes } from './storyRules';

export const STORY_DATA_MARKER = 'STORY-ARCHITECT-DATA/V1';

export interface StoryTransferResult {
  story: StoryDocument | null;
  warnings: string[];
  errors: string[];
}

const statuses: StoryStatus[] = ['draft', 'complete'];

function asRecord(value: unknown, path: string, warnings: string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(`${path || '根节点'} 应为对象，此项已忽略。`);
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string, warnings: string[]): unknown[] | null {
  if (!Array.isArray(value)) {
    warnings.push(`缺少有效的「${path}」数组，已按空列表处理。`);
    return [];
  }
  return value;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function normalizeCharacters(input: unknown[], warnings: string[]): {
  characters: StoryCharacter[];
  idMap: Map<string, string>;
} {
  const characters: StoryCharacter[] = [];
  const idMap = new Map<string, string>();
  input.forEach((item, index) => {
    const path = `characters[${index + 1}]`;
    const record = asRecord(item, path, warnings);
    if (!record) return;

    const oldId = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
    const id = oldId && !idMap.has(oldId) ? oldId : createId('character');
    if (!oldId) warnings.push(`${path} 缺少人物 ID，已重新生成。`);
    if (oldId && idMap.has(oldId)) warnings.push(`${path} 的人物 ID「${oldId}」重复，已重新生成。`);

    const name = text(record.name, '');
    if (!name) warnings.push(`${path} 的人物名称为空，已临时命名。`);
    const role = text(record.role, '待定义角色');
    if (typeof record.role !== 'string' || !record.role.trim()) warnings.push(`${path} 缺少身份/职责，已标记为「${role}」。`);
    const colorInput = typeof record.color === 'string' ? record.color : '';
    const color = characterColors.includes(colorInput as typeof characterColors[number])
      ? colorInput as typeof characterColors[number]
      : characterColors[characters.length % characterColors.length];
    if (!colorInput) warnings.push(`${path} 缺少人物颜色，已自动分配。`);
    else if (color !== colorInput) warnings.push(`${path} 的颜色「${colorInput}」无法识别，已自动分配。`);

    characters.push({ id, name: name || `未命名人物 ${characters.length + 1}`, role, color });
    if (oldId && !idMap.has(oldId)) idMap.set(oldId, id);
  });
  return { characters, idMap };
}

function normalizeScenes(
  input: unknown[],
  characterIdMap: Map<string, string>,
  warnings: string[],
): { idMap: Map<string, string>; ordered: StoryScene[]; rawById: Map<string, unknown> } {
  const prepared: Array<{ scene: StoryScene; index: number; raw: unknown }> = [];
  const idMap = new Map<string, string>();
  const rawById = new Map<string, unknown>();
  const usedIds = new Set<string>();

  input.forEach((item, index) => {
    const path = `scenes[${index + 1}]`;
    const record = asRecord(item, path, warnings);
    if (!record) return;

    const oldId = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
    const id = oldId && !usedIds.has(oldId) ? oldId : createId('scene');
    if (!oldId) warnings.push(`${path} 缺少场景 ID，已重新生成。`);
    if (oldId && usedIds.has(oldId)) warnings.push(`${path} 的场景 ID「${oldId}」重复，已重新生成。`);
    usedIds.add(id);

    const title = text(record.title, '');
    if (!title) warnings.push(`${path} 缺少场景标题，已临时命名。`);
    const summary = text(record.summary, '');
    if (!summary) warnings.push(`${path} 缺少剧情概述，已留空待补。`);
    const conflict = text(record.conflict, '');

    let order = typeof record.order === 'number' ? record.order : NaN;
    if (!Number.isFinite(order)) {
      warnings.push(`${path} 缺少有效的场景顺序，已先放到末尾。`);
      order = Number.MAX_SAFE_INTEGER;
    }

    const characterRefs = asArray(record.characterIds, `${path}.characterIds`, warnings) ?? [];
    const sceneCharacterIds = characterRefs.flatMap((ref) => {
      if (typeof ref !== 'string' || !ref.trim()) {
        warnings.push(`${path} 包含无效的人物引用，已移除。`);
        return [];
      }
      if (!characterIdMap.has(ref)) {
        warnings.push(`${path} 引用了不存在的人物「${ref}」，已移除。`);
        return [];
      }
      return [characterIdMap.get(ref) ?? ref];
    });
    const uniqueCharacterIds = [...new Set(sceneCharacterIds)];
    if (uniqueCharacterIds.length < sceneCharacterIds.length) warnings.push(`${path} 的人物引用有重复，已去重。`);

    const scene: StoryScene = {
      id,
      title: title || `未命名场景 ${prepared.length + 1}`,
      order,
      summary,
      conflict,
      characterIds: uniqueCharacterIds,
      clueIds: [],
    };
    prepared.push({ scene, index, raw: record });
    if (oldId && !idMap.has(oldId)) idMap.set(oldId, id);
    if (oldId) rawById.set(id, record);
  });

  prepared.sort((a, b) => (a.scene.order === b.scene.order ? a.index - b.index : a.scene.order - b.scene.order));
  const finiteOrders = prepared.map(({ scene }) => scene.order).filter(Number.isFinite);
  if (prepared.some(({ scene }) => !Number.isFinite(scene.order))) {
    warnings.push('部分场景缺少有效的顺序值，已按出现位置重新编号。');
  }
  if (finiteOrders.some((order) => order < 1) || finiteOrders.some((order, index) => order !== index + 1)) {
    warnings.push('场景顺序存在空缺、重复或无效值，已按出现位置重新编号。');
  }
  if (new Set(finiteOrders).size < finiteOrders.length) {
    warnings.push('检测到重复的场景顺序，已稳定保留相邻关系并重新编号。');
  }
  const ordered = prepared.map((entry, index) => ({ ...entry.scene, order: index + 1 }));
  return { idMap, ordered, rawById };
}

function normalizeClues(
  input: unknown[],
  sceneIdMap: Map<string, string>,
  sceneOrderById: Map<string, number>,
  warnings: string[],
): { clues: StoryClue[]; idMap: Map<string, string> } {
  const clues: StoryClue[] = [];
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();
  input.forEach((item, index) => {
    const path = `clues[${index + 1}]`;
    const record = asRecord(item, path, warnings);
    if (!record) return;

    const oldId = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
    const id = oldId && !usedIds.has(oldId) ? oldId : createId('clue');
    if (!oldId) warnings.push(`${path} 缺少伏笔 ID，已重新生成。`);
    if (oldId && usedIds.has(oldId)) warnings.push(`${path} 的伏笔 ID「${oldId}」重复，已重新生成。`);
    usedIds.add(id);

    const title = text(record.title, '');
    if (!title) warnings.push(`${path} 缺少伏笔标题，已临时命名。`);

    const rawSetup = typeof record.setupSceneId === 'string' ? record.setupSceneId.trim() : '';
    const setupSceneId = rawSetup ? sceneIdMap.get(rawSetup) ?? '' : '';
    if (!rawSetup) warnings.push(`${path} 没有指明伏笔埋下的场景，该伏笔无法建立，已忽略。`);
    else if (!setupSceneId) warnings.push(`${path} 指向的埋下场景「${rawSetup}」不存在，该伏笔已忽略。`);
    if (!setupSceneId) return;

    const rawPayoff = typeof record.payoffSceneId === 'string' ? record.payoffSceneId.trim() : '';
    if (record.payoffSceneId !== undefined && typeof record.payoffSceneId !== 'string') {
      warnings.push(`${path} 的回收场景不是有效 ID，已标记为待回收。`);
    }
    let payoffSceneId = rawPayoff ? sceneIdMap.get(rawPayoff) ?? '' : '';
    if (rawPayoff && !payoffSceneId) warnings.push(`${path} 指向的回收场景「${rawPayoff}」不存在，已标记为待回收。`);
    if (payoffSceneId) {
      const setupOrder = sceneOrderById.get(setupSceneId) ?? 0;
      const payoffOrder = sceneOrderById.get(payoffSceneId) ?? 0;
      if (payoffOrder < setupOrder) {
        warnings.push(`${path} 的回收场景早于埋下场景，已先标记为待回收。`);
        payoffSceneId = '';
      }
    }

    clues.push({ id, title: title || `未命名伏笔 ${clues.length + 1}`, setupSceneId, payoffSceneId });
    if (oldId && !idMap.has(oldId)) idMap.set(oldId, id);
  });
  return { clues, idMap };
}

export function parseStoryTransferFile(content: string): StoryTransferResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (typeof content !== 'string' || !content.trim()) {
    return { story: null, warnings: [], errors: ['文件是空的，或没有读取到文本内容。'] };
  }

  const markerPattern = new RegExp(`<!-- ${STORY_DATA_MARKER}\\r?\\n([\\s\\S]*?)\\r?\\n-->`);
  let parsed: unknown;
  const match = content.match(markerPattern);
  if (!match) {
    try {
      parsed = JSON.parse(content);
      warnings.push(`没有找到「${STORY_DATA_MARKER}」可读数据块，已按旧版纯 JSON 项目恢复。`);
    } catch {
      return {
        story: null,
        warnings: [],
        errors: [`没有找到「${STORY_DATA_MARKER}」数据块，且整个文件也不是合法 JSON。请确认文件由 StoryArchitect 导出，且末尾注释未被删除。`],
      };
    }
  } else {
    try {
      parsed = JSON.parse(match[1]);
    } catch (error) {
      errors.push(`机器数据不是合法 JSON：${error instanceof Error ? error.message : '无法解析'}。请修复数据块后重试。`);
      return { story: null, warnings, errors };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { story: null, warnings, errors: ['机器数据根节点必须是一个故事对象。'] };
  }

  const input = parsed as Partial<StoryDocument> & { version?: unknown };
  const rawVersion = (input as { version?: unknown }).version;
  const version = typeof rawVersion === 'number' && Number.isFinite(rawVersion) ? rawVersion : 0;
  if (rawVersion === undefined) warnings.push('文件缺少版本号，已按旧版本处理。');
  else if (typeof rawVersion !== 'number') warnings.push('文件版本号不是数字，已按旧版本处理。');
  else if (version < CURRENT_STORY_VERSION) warnings.push(`文件来自旧版本（v${version}），已迁移到 v${CURRENT_STORY_VERSION}。`);
  else if (version > CURRENT_STORY_VERSION) {
    return {
      story: null,
      warnings,
      errors: [`文件版本 v${version} 比当前应用支持的 v${CURRENT_STORY_VERSION} 更新，请先升级应用。`],
    };
  }

  const characterInput = asArray(input.characters, 'characters', warnings) ?? [];
  const { characters, idMap: characterIdMap } = normalizeCharacters(characterInput, warnings);
  const sceneInput = asArray(input.scenes, 'scenes', warnings) ?? [];
  const { idMap: sceneIdMap, ordered, rawById } = normalizeScenes(sceneInput, characterIdMap, warnings);

  const sceneOrderById = new Map(ordered.map((scene, index) => [scene.id, index + 1]));
  const clueInput = asArray(input.clues, 'clues', warnings) ?? [];
  const { clues, idMap: clueIdMap } = normalizeClues(clueInput, sceneIdMap, sceneOrderById, warnings);

  ordered.forEach((scene) => {
    const record = rawById.get(scene.id) as Record<string, unknown> | undefined;
    const rawClueRefs = record && Array.isArray(record.clueIds) ? record.clueIds : null;
    if (record && !Array.isArray(record.clueIds)) {
      warnings.push(`场景「${scene.title}」的伏笔列表不是数组，已按伏笔关系重建。`);
    }
    rawClueRefs?.forEach((ref) => {
      if (typeof ref !== 'string' || !ref.trim() || !clueIdMap.has(ref)) {
        warnings.push(`场景「${scene.title}」包含无效或已失效的伏笔引用，已按伏笔关系重建。`);
      }
    });
  });

  const clueIdsByScene = new Map<string, string[]>();
  clues.forEach((clue) => {
    [clue.setupSceneId, clue.payoffSceneId].filter(Boolean).forEach((sceneId) => {
      clueIdsByScene.set(sceneId, [...(clueIdsByScene.get(sceneId) ?? []), clue.id]);
    });
  });
  const reconciledScenes = ordered.map((scene) => ({ ...scene, clueIds: clueIdsByScene.get(scene.id) ?? [] }));

  const title = text(input.title, '');
  if (input.title === undefined) warnings.push('文件缺少项目标题，已命名为「导入的故事」。');
  else if (!title) warnings.push('项目标题为空或不是文本，已命名为「导入的故事」。');
  let status: StoryStatus = statuses.includes(input.status as StoryStatus) ? input.status as StoryStatus : 'draft';
  if (input.status === undefined) {
    warnings.push('文件缺少项目状态，已按草稿处理。');
  } else if (!statuses.includes(input.status as StoryStatus)) {
    warnings.push(`项目状态「${String(input.status)}」无法识别，已按草稿处理。`);
  }

  const id = text(input.id, '');
  if (!id) warnings.push('项目缺少 ID，导入时已为新项目生成 ID。');

  let selectedSceneId = typeof input.selectedSceneId === 'string' ? sceneIdMap.get(input.selectedSceneId.trim()) ?? '' : '';
  if (input.selectedSceneId === undefined || typeof input.selectedSceneId !== 'string' || !input.selectedSceneId.trim() || !selectedSceneId) {
    if (reconciledScenes.length > 0) warnings.push('当前选中的场景缺失或已不存在，已自动选择第一个场景。');
  }
  if (!selectedSceneId && reconciledScenes[0]) {
    selectedSceneId = reconciledScenes[0].id;
  }

  const updatedAt = typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt))
    ? input.updatedAt
    : new Date().toISOString();
  if (input.updatedAt === undefined) warnings.push('文件缺少更新时间，已使用导入时间。');
  else if (updatedAt !== input.updatedAt) warnings.push('更新时间无法识别，已使用导入时间。');

  if (reconciledScenes.length === 0) warnings.push('文件中没有可用场景，已创建为空项目，请在导入后补充时间线。');

  return {
    story: {
      version: CURRENT_STORY_VERSION,
      id: id || createId('story'),
      title: title || '导入的故事',
      status,
      characters,
      scenes: reconciledScenes,
      clues,
      selectedSceneId,
      updatedAt,
    },
    warnings,
    errors,
  };
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—';
}

function sceneTitle(scenes: StoryScene[], sceneId: string): string {
  return scenes.find((scene) => scene.id === sceneId)?.title ?? '未连接的场景';
}

export function exportStoryToMarkdown(story: StoryDocument): string {
  const scenes = orderedScenes(story);
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const characterById = new Map(story.characters.map((character) => [character.id, character]));
  const lines: string[] = [
    `# ${story.title}`,
    '',
    '> 这是一份 StoryArchitect 项目文件。上方内容可供人阅读，但导入时以末尾机器数据块为准；请保留该数据块，应用将依赖它完整还原项目。',
    '',
    `- 项目 ID：${story.id}`,
    `- 状态：${story.status === 'complete' ? '已完成' : '草稿'}`,
    `- 人物：${story.characters.length} 位`,
    `- 场景：${story.scenes.length} 个`,
    `- 伏笔：${story.clues.length} 条（待回收 ${story.clues.filter((clue) => !clue.payoffSceneId).length} 条）`,
    `- 最后更新：${story.updatedAt}`,
    '',
    '## 人物身份',
    '',
    '| 人物 | 身份/职责 | 标记色 |',
    '| --- | --- | --- |',
    ...(story.characters.length
      ? story.characters.map((character) => `| ${markdownCell(character.name)} | ${markdownCell(character.role)} | ${markdownCell(character.color)} |`)
      : ['| _暂无人物_ | — | — |']),
    '',
    '## 场景先后',
    '',
    '| 顺序 | 场景 | 出场人物 | 概述 | 冲突 | 关联伏笔 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(scenes.length
      ? scenes.map((scene) => {
        const names = scene.characterIds.map((id) => characterById.get(id)?.name ?? '').filter(Boolean).join('、');
        const clueTitles = scene.clueIds.map((id) => story.clues.find((clue) => clue.id === id)?.title ?? '').filter(Boolean).join('、');
        return `| ${scene.order} | ${markdownCell(scene.title)} | ${markdownCell(names)} | ${markdownCell(scene.summary)} | ${markdownCell(scene.conflict)} | ${markdownCell(clueTitles)} |`;
      })
      : ['| — | _暂无场景_ | — | — | — | — |']),
    '',
    '## 伏笔的埋下与回收',
    '',
    '| 伏笔 | 埋下（场景顺序） | 回收（场景顺序） | 状态 |',
    '| --- | --- | --- | --- |',
    ...(story.clues.length
      ? story.clues.map((clue) => {
        const setupScene = sceneById.get(clue.setupSceneId);
        const payoffScene = clue.payoffSceneId ? sceneById.get(clue.payoffSceneId) : undefined;
        const setup = setupScene ? `第 ${setupScene.order} 幕 · ${setupScene.title}` : sceneTitle(scenes, clue.setupSceneId);
        const payoff = payoffScene ? `第 ${payoffScene.order} 幕 · ${payoffScene.title}` : '待回收';
        return `| ${markdownCell(clue.title)} | ${markdownCell(setup)} | ${markdownCell(payoff)} | ${clue.payoffSceneId ? '已回收' : '待回收'} |`;
      })
      : ['| _暂无伏笔_ | — | — | — |']),
    '',
    `<!-- ${STORY_DATA_MARKER}`,
    JSON.stringify({ ...story, scenes }, null, 2),
    '-->',
    '',
  ];
  return lines.join('\n');
}

export function createProjectImportName(title: string, existingTitles: string[]): string {
  const normalizedTitles = new Set(existingTitles);
  const normalizedTitle = title.trim();
  if (!normalizedTitles.has(normalizedTitle)) return normalizedTitle;
  let index = 2;
  while (normalizedTitles.has(`${normalizedTitle}（导入副本 ${index}）`)) index += 1;
  return `${normalizedTitle}（导入副本 ${index}）`;
}
