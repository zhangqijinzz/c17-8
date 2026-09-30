import {
  characterColors,
  createId,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
  type StoryStatus,
} from './story';
import { orderedScenes } from './storyRules';

/**
 * 项目文件的导出 / 导入。
 *
 * 导出物是一份 Markdown：开头是给人阅读的故事结构（人物、场景顺序、伏笔走向），
 * 文末用 HTML 注释包着一段机器数据（{@link StoryProjectFile}），用于无损重新导入。
 * 因此同一份文件既能直接阅读，也能重新还原成可继续编辑的项目。
 */

export const TRANSFER_FORMAT = 'storyarchitect-project';
export const SUPPORTED_FORMAT_VERSION = 1;
export const CURRENT_DOCUMENT_VERSION = 1;

const DATA_BEGIN = '<!-- StoryArchitect/data-v1';
const DATA_END = '-->';

export interface StoryProjectFile {
  format: typeof TRANSFER_FORMAT;
  formatVersion: number;
  exportedAt: string;
  document: StoryDocument;
}

export interface ImportResult {
  ok: boolean;
  story: StoryDocument | null;
  errors: string[];
  warnings: string[];
}

export interface ImportOptions {
  /** 当前工作区已有的项目 id，用于判断 id 冲突，避免覆盖。 */
  existingIds: ReadonlySet<string>;
  /** 当前工作区已有的项目标题，用于让导入副本的标题可区分。 */
  existingTitles: ReadonlySet<string>;
  now?: () => string;
}

/* ------------------------------------------------------------------ */
/* 导出                                                                */
/* ------------------------------------------------------------------ */

export function buildProjectFile(story: StoryDocument, exportedAt: string): StoryProjectFile {
  return {
    format: TRANSFER_FORMAT,
    formatVersion: SUPPORTED_FORMAT_VERSION,
    exportedAt,
    document: story,
  };
}

/** 生成机器数据块；尖括号统一转义，保证注释不会被正文内容意外闭合。 */
export function encodeDataBlock(file: StoryProjectFile): string {
  const json = JSON.stringify(file, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `${DATA_BEGIN}\n${json}\n${DATA_END}`;
}

export function buildProjectMarkdown(story: StoryDocument, exportedAt: string = new Date().toISOString()): string {
  const scenes = orderedScenes(story);
  const sceneTitle = (id: string): string => scenes.find((scene) => scene.id === id)?.title ?? '（已丢失的场景）';
  const characterName = (id: string): string => story.characters.find((character) => character.id === id)?.name ?? '（已丢失的人物）';
  const unresolved = story.clues.filter((clue) => clue.payoffSceneId === '').length;
  const statusLabel = story.status === 'complete' ? '已完成' : '草稿';
  const sceneOrder = new Map(scenes.map((scene, index) => [scene.id, index + 1]));

  const lines: string[] = [
    `# ${story.title}`,
    '',
    `> StoryArchitect 项目文件 · 导出时间 ${formatDateTime(exportedAt)}`,
    `> 状态：${statusLabel} · ${story.characters.length} 位人物 · ${story.scenes.length} 个场景 · ${story.clues.length} 条伏笔（${unresolved} 条待回收）`,
    '> 本文件前半部分是可读的故事结构，末尾「机器数据」区块用于无损重新导入，阅读不受影响，但请勿删除该区块。',
    '',
    '## 人物',
    '',
  ];

  if (story.characters.length === 0) {
    lines.push('（暂无人物）', '');
  }
  story.characters.forEach((character) => {
    const appears = scenes.filter((scene) => scene.characterIds.includes(character.id));
    lines.push(`### ${character.name}`);
    lines.push(`- 身份：${character.role || '待定义角色'}`);
    lines.push(
      appears.length > 0
        ? `- 出场场景：${appears.map((scene) => `第 ${sceneOrder.get(scene.id)} 幕《${scene.title}》`).join('、')}`
        : '- 出场场景：暂未安排',
    );
    lines.push('');
  });

  lines.push('## 场景（按时间顺序）', '');
  if (scenes.length === 0) {
    lines.push('（暂无场景）', '');
  }
  scenes.forEach((scene, index) => {
    lines.push(`### 第 ${index + 1} 幕 · ${scene.title}`);
    lines.push(
      scene.characterIds.length > 0
        ? `- 出场人物：${scene.characterIds.map(characterName).join('、')}`
        : '- 出场人物：无',
    );
    lines.push(`- 发生了什么：${indentBlock(scene.summary || '（还没有写下这一幕发生了什么。）')}`);
    lines.push(`- 核心冲突：${indentBlock(scene.conflict || '（暂未填写）')}`);
    const planted = story.clues.filter((clue) => clue.setupSceneId === scene.id);
    const paidOff = story.clues.filter((clue) => clue.payoffSceneId === scene.id);
    lines.push(
      planted.length > 0
        ? `- 埋下的伏笔：${planted.map((clue) => `《${clue.title}》`).join('、')}`
        : '- 埋下的伏笔：无',
    );
    if (paidOff.length > 0) lines.push(`- 回收的伏笔：${paidOff.map((clue) => `《${clue.title}》`).join('、')}`);
    lines.push('');
  });

  lines.push('## 伏笔', '');
  if (story.clues.length === 0) {
    lines.push('（暂无伏笔）', '');
  }
  story.clues.forEach((clue) => {
    const setupOrder = sceneOrder.get(clue.setupSceneId);
    const setupText = setupOrder ? `第 ${setupOrder} 幕《${sceneTitle(clue.setupSceneId)}》埋下` : '埋下场景缺失';
    if (clue.payoffSceneId) {
      const payoffOrder = sceneOrder.get(clue.payoffSceneId);
      const payoffText = payoffOrder ? `第 ${payoffOrder} 幕《${sceneTitle(clue.payoffSceneId)}》回收` : '回收场景缺失';
      lines.push(`- **${clue.title}**：${setupText} → ${payoffText}（已回收）`);
    } else {
      lines.push(`- **${clue.title}**：${setupText} → 待回收（未回收）`);
    }
  });

  lines.push('', '---', '', '## 机器数据（请勿手工编辑）', '', '以下区块由 StoryArchitect 生成，重新导入本文件时会读取它；上面的可读内容修改不会影响导入数据。', '', encodeDataBlock(buildProjectFile(story, exportedAt)), '', '');
  return lines.join('\n');
}

function indentBlock(value: string): string {
  return value.split(/\r?\n/).join('\n  ');
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 生成导出文件名，去掉各操作系统不允许出现在文件名里的字符。 */
export function buildExportFileName(story: StoryDocument, exportedAt: string = new Date().toISOString()): string {
  const date = new Date(exportedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = Number.isNaN(date.getTime())
    ? 'unknown-date'
    : `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const safeTitle = story.title.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ') || '未命名故事';
  return `故事项目-${safeTitle}-${stamp}.md`;
}

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */

const DATA_BLOCK_PATTERN = new RegExp(
  `${DATA_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)\\n${DATA_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

/**
 * 从文件文本中取出项目负载：优先取 Markdown 末尾的机器数据块，
 * 找不到则把整份文本当作 JSON 备份解析。任何失败都抛出带中文说明的错误。
 */
export function extractProjectPayload(text: string): unknown {
  const match = DATA_BLOCK_PATTERN.exec(text);
  const source = match ? match[1] : text.trim();
  if (!source.trim()) {
    throw new Error('文件是空的，没有可导入的项目数据。');
  }
  try {
    return JSON.parse(match ? unescapeJsonAngles(source) : source);
  } catch (error) {
    if (match) {
      throw new Error(`机器数据区块不是有效的 JSON（${jsonErrorDetail(error)}），文件可能被手工改坏了。可读部分不受影响，但无法据此还原项目。`);
    }
    throw new Error('未找到 StoryArchitect 项目数据。请确认这是由本工具导出的 .md 项目文件，或是完整的 JSON 备份；不要只复制可读正文。');
  }
}

/** 导出时把尖括号转义成了 \\u003c / \\u003e，JSON.parse 会自动还原；这里仅兜底显式还原。 */
function unescapeJsonAngles(value: string): string {
  return value.replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>');
}

function jsonErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : '语法错误';
}

/* ------------------------------------------------------------------ */
/* 规范化（容错）                                                       */
/* ------------------------------------------------------------------ */

export function importProjectFromText(text: string, options: ImportOptions): ImportResult {
  let raw: unknown;
  try {
    raw = extractProjectPayload(text);
  } catch (error) {
    return { ok: false, story: null, errors: [error instanceof Error ? error.message : '文件无法解析。'], warnings: [] };
  }

  if (!isObject(raw)) {
    return {
      ok: false,
      story: null,
      errors: [`项目内容必须是一个对象（object），实际收到的是 ${raw === null ? 'null' : Array.isArray(raw) ? '数组' : typeof raw}，无法导入。`],
      warnings: [],
    };
  }

  const looksLikeEnvelope = 'format' in raw || 'formatVersion' in raw || 'document' in raw;
  if (looksLikeEnvelope) {
    const envelope = raw as Record<string, unknown>;
    if (envelope.format !== undefined && envelope.format !== TRANSFER_FORMAT) {
      return failure(`无法识别的文件格式「${String(envelope.format)}」，请使用 StoryArchitect 导出的项目文件。`);
    }
    if (envelope.formatVersion !== undefined && envelope.formatVersion !== SUPPORTED_FORMAT_VERSION) {
      const version = Number(envelope.formatVersion);
      const reason = version > SUPPORTED_FORMAT_VERSION
        ? `文件来自更新版本的 StoryArchitect（格式版本 ${version}），当前仅支持版本 ${SUPPORTED_FORMAT_VERSION}，请升级本工具后再导入。`
        : `不支持的格式版本「${String(envelope.formatVersion)}」，当前仅支持版本 ${SUPPORTED_FORMAT_VERSION}。`;
      return failure(reason);
    }
    if (!isObject(envelope.document)) {
      return failure('文件缺少有效的 document 字段（故事正文），无法导入。');
    }
    return normalizeDocument(envelope.document as Record<string, unknown>, options);
  }

  return normalizeDocument(raw as Record<string, unknown>, options);
}

function failure(message: string): ImportResult {
  return { ok: false, story: null, errors: [message], warnings: [] };
}

/**
 * 把不可信的项目数据规范化成完整的 StoryDocument。
 * 原则：结构性、无法理解的问题 → 致命错误拒绝整个文件；
 * 局部缺字段 / 悬空引用 / 顺序错乱 → 尽量修复，并把每一处修复写进警告。
 */
function normalizeDocument(input: Record<string, unknown>, options: ImportOptions): ImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const warn = makeWarner(warnings);
  const now = options.now ?? (() => new Date().toISOString());

  // ---- 版本 -----------------------------------------------------------------
  if (input.version === undefined) {
    warn('缺少 version 字段，已按版本 1 处理（可能来自更旧的版本）。');
  } else if (input.version !== 1) {
    return failure(`项目数据版本为「${String(input.version)}」，当前仅支持版本 1，无法导入。`);
  }

  // ---- 根字段 ---------------------------------------------------------------
  let title = typeof input.title === 'string' && input.title.trim() ? input.title : '';
  if (!title) {
    warn('缺少有效的 title 字段，已命名为「未命名故事」。');
    title = '未命名故事';
  }

  let id = typeof input.id === 'string' && input.id.trim() ? input.id : '';
  if (!id) {
    warn('缺少 id 字段，已自动生成新项目 id。');
    id = createId('story');
  }

  let status: StoryStatus = 'draft';
  if (input.status === 'draft' || input.status === 'complete') {
    status = input.status;
  } else if (input.status !== undefined) {
    warn(`status 值「${String(input.status)}」无效，已按草稿处理。`);
  }

  let updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : '';
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) {
    warn('updatedAt 缺失或不是有效时间，已替换为导入时间。');
    updatedAt = now();
  }

  const rawCharacters = Array.isArray(input.characters) ? input.characters : null;
  if (rawCharacters === null) warn('characters 字段不是数组，已按没有人物处理。');
  const rawScenes = Array.isArray(input.scenes) ? input.scenes : null;
  if (rawScenes === null) warn('scenes 字段不是数组，已按没有场景处理。');
  const rawClues = Array.isArray(input.clues) ? input.clues : null;
  if (rawClues === null) warn('clues 字段不是数组，已按没有伏笔处理。');

  // ---- 人物 -----------------------------------------------------------------
  const characters: StoryCharacter[] = [];
  const characterIdMap = new Map<string, string>();
  const usedCharacterIds = new Set<string>();
  (rawCharacters ?? []).forEach((item, index) => {
    const where = `第 ${index + 1} 个人物`;
    if (!isObject(item)) {
      warn(`${where}不是有效对象，已跳过。`);
      return;
    }
    let characterId = asCleanString(item.id);
    if (!characterId) {
      characterId = createId('character');
      warn(`${where}缺少 id，已自动生成。`);
    } else if (usedCharacterIds.has(characterId)) {
      const nextId = createId('character');
      characterIdMap.set(characterId, nextId);
      characterId = nextId;
      warn(`人物 id「${item.id}」重复，已为后者重新分配 id。`);
    }
    usedCharacterIds.add(characterId);

    let name = asCleanString(item.name);
    if (!name) {
      warn(`${where}缺少姓名，已命名为「未命名人物」。`);
      name = '未命名人物';
    }
    const role = asCleanString(item.role) || '待定义角色';
    let color = asCleanString(item.color);
    if (!color || !characterColors.includes(color as (typeof characterColors)[number])) {
      if (color) warn(`${where}的颜色「${color}」不在可选范围内，已改用默认颜色。`);
      color = characterColors[0];
    }
    characters.push({ id: characterId, name, role, color });
  });
  const characterIds = new Set(characters.map((character) => character.id));

  // ---- 场景 -----------------------------------------------------------------
  const scenes: StoryScene[] = [];
  const sceneIdMap = new Map<string, string>();
  const usedSceneIds = new Set<string>();
  (rawScenes ?? []).forEach((item, index) => {
    const where = `第 ${index + 1} 个场景`;
    if (!isObject(item)) {
      warn(`${where}不是有效对象，已跳过。`);
      return;
    }
    let sceneId = asCleanString(item.id);
    if (!sceneId) {
      sceneId = createId('scene');
      warn(`${where}缺少 id，已自动生成。`);
    } else if (usedSceneIds.has(sceneId)) {
      const nextId = createId('scene');
      sceneIdMap.set(sceneId, nextId);
      sceneId = nextId;
      warn(`场景 id「${item.id}」重复，已为后者重新分配 id。`);
    }
    usedSceneIds.add(sceneId);

    const sceneTitle = asCleanString(item.title) || '未命名场景';
    if (!asCleanString(item.title)) warn(`${where}《${sceneTitle}》缺少标题，已用占位标题。`);
    const summary = typeof item.summary === 'string' ? item.summary : '';
    const conflict = typeof item.conflict === 'string' ? item.conflict : '';
    if (item.summary !== undefined && typeof item.summary !== 'string') warn(`场景《${sceneTitle}》的 summary 不是文本，已清空。`);
    if (item.conflict !== undefined && typeof item.conflict !== 'string') warn(`场景《${sceneTitle}》的 conflict 不是文本，已清空。`);

    const order = typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : NaN;
    if (Number.isNaN(order)) warn(`场景《${sceneTitle}》缺少有效的顺序号，稍后统一重新编号。`);

    let characterRefs: string[] = [];
    if (Array.isArray(item.characterIds)) {
      characterRefs = uniqueStrings(item.characterIds, (bad) => warn(`场景《${sceneTitle}》的出场人物里 ${bad}，已忽略。`));
      characterRefs = characterRefs
        .map((ref) => characterIdMap.get(ref) ?? ref)
        .filter((ref) => {
          if (characterIds.has(ref)) return true;
          warn(`场景《${sceneTitle}》引用了不存在的人物 id「${ref}」，已移除。`);
          return false;
        });
    } else if (item.characterIds !== undefined) {
      warn(`场景《${sceneTitle}》的 characterIds 不是数组，已按无出场人物处理。`);
    }

    let clueRefs: string[] = [];
    if (Array.isArray(item.clueIds)) {
      clueRefs = uniqueStrings(item.clueIds, (bad) => warn(`场景《${sceneTitle}》的伏笔列表里 ${bad}，已忽略。`));
    } else if (item.clueIds !== undefined) {
      warn(`场景《${sceneTitle}》的 clueIds 不是数组，已按空列表处理。`);
    }

    scenes.push({ id: sceneId, title: sceneTitle, order, summary, conflict, characterIds: characterRefs, clueIds: clueRefs });
  });
  const sceneIds = new Set(scenes.map((scene) => scene.id));

  // 顺序：缺失 / 重复 / 不连续 → 稳定排序后重新编号 1..N
  const needsOrderNumbers = scenes.some((scene) => Number.isNaN(scene.order));
  const presentOrders = scenes.filter((scene) => !Number.isNaN(scene.order)).map((scene) => scene.order);
  const orderBroken =
    needsOrderNumbers ||
    new Set(presentOrders).size !== presentOrders.length ||
    presentOrders.some((order, index) => order !== index + 1) ||
    presentOrders.length !== scenes.length;
  const ordered = orderBroken ? [...scenes].sort((a, b) => a.order - b.order) : scenes;
  if (orderBroken) {
    warn('场景顺序存在缺失、重复或不连续，已按文件中的先后重新编号为 1..N。');
  }
  ordered.forEach((scene, index) => {
    scene.order = index + 1;
  });
  const orderOf = new Map(ordered.map((scene, index) => [scene.id, index + 1]));

  // ---- 伏笔 -----------------------------------------------------------------
  const clues: StoryClue[] = [];
  const usedClueIds = new Set<string>();
  (rawClues ?? []).forEach((item, index) => {
    const where = `第 ${index + 1} 条伏笔`;
    if (!isObject(item)) {
      warn(`${where}不是有效对象，已跳过。`);
      return;
    }
    let clueId = asCleanString(item.id);
    if (!clueId) {
      clueId = createId('clue');
      warn(`${where}缺少 id，已自动生成。`);
    } else if (usedClueIds.has(clueId)) {
      clueId = createId('clue');
      warn(`伏笔 id「${item.id}」重复，已重新分配 id。`);
    }
    usedClueIds.add(clueId);

    const title = asCleanString(item.title) || '未命名伏笔';
    if (!asCleanString(item.title)) warn(`${where}缺少标题，已命名为「未命名伏笔」。`);

    let setupSceneId = asCleanString(item.setupSceneId);
    setupSceneId = sceneIdMap.get(setupSceneId) ?? setupSceneId;
    if (!setupSceneId || !sceneIds.has(setupSceneId)) {
      warn(`伏笔《${title}》的埋下场景（id「${asCleanString(item.setupSceneId) || '空'}」）不存在，已跳过该伏笔。`);
      return;
    }

    let payoffSceneId = asCleanString(item.payoffSceneId);
    if (payoffSceneId) {
      payoffSceneId = sceneIdMap.get(payoffSceneId) ?? payoffSceneId;
      if (!sceneIds.has(payoffSceneId)) {
        warn(`伏笔《${title}》的回收场景（id「${payoffSceneId}」）不存在，已清空，仍记为待回收。`);
        payoffSceneId = '';
      }
    }
    if (payoffSceneId && (orderOf.get(payoffSceneId) ?? 0) < (orderOf.get(setupSceneId) ?? 0)) {
      warn(`伏笔《${title}》的回收场景早于埋下场景，数据已保留，请确认顺序是否正确。`);
    }

    clues.push({ id: clueId, title, setupSceneId, payoffSceneId });
  });
  const clueIds = new Set(clues.map((clue) => clue.id));

  // ---- 回填场景的 clueIds：移除悬空 / 错挂项，并补上伏笔声明的埋下关系 ----------
  scenes.forEach((scene) => {
    const valid = scene.clueIds.filter((ref) => {
      if (!clueIds.has(ref)) {
        warn(`场景《${scene.title}》引用了不存在的伏笔 id「${ref}」，已移除。`);
        return false;
      }
      const clue = clues.find((item) => item.id === ref);
      if (clue && clue.setupSceneId !== scene.id) {
        warn(`伏笔《${clue.title}》被错误挂在场景《${scene.title}》上（它实际埋于另一幕），已移除。`);
        return false;
      }
      return true;
    });
    const claimed = clues.filter((clue) => clue.setupSceneId === scene.id).map((clue) => clue.id);
    const missing = claimed.filter((ref) => !valid.includes(ref));
    if (missing.length > 0) {
      warn(`场景《${scene.title}》缺少伏笔声明的挂载关系，已自动补齐 ${missing.length} 条。`);
    }
    scene.clueIds = [...new Set([...valid, ...claimed])];
  });

  // ---- 当前选中场景 -----------------------------------------------------------
  let selectedSceneId = asCleanString(input.selectedSceneId);
  selectedSceneId = sceneIdMap.get(selectedSceneId) ?? selectedSceneId;
  if (selectedSceneId && !sceneIds.has(selectedSceneId)) {
    warn(`选中场景 id「${selectedSceneId}」不存在，已改选时间线上的第一个场景。`);
    selectedSceneId = ordered[0]?.id ?? '';
  } else if (!selectedSceneId) {
    selectedSceneId = ordered[0]?.id ?? '';
  }

  let document: StoryDocument = { version: CURRENT_DOCUMENT_VERSION, id, title, status, characters, scenes: ordered, clues, selectedSceneId, updatedAt };

  // ---- 与现有项目冲突：绝不覆盖，转成副本 --------------------------------------
  if (options.existingIds.has(document.id)) {
    const newId = createId('story');
    let candidateTitle = `${document.title}（导入副本）`;
    let suffix = 2;
    while (options.existingTitles.has(candidateTitle) || title === candidateTitle) {
      candidateTitle = `${document.title}（导入副本 ${suffix}）`;
      suffix += 1;
    }
    warn(`项目 id 与现有项目「${document.title}」相同，已作为副本「${candidateTitle}」导入（新 id：${newId}），现有项目保持不变、未被覆盖。`);
    document = { ...document, id: newId, title: candidateTitle };
  }

  return { ok: true, story: document, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 数组里只保留去重后的非空字符串；非字符串元素通过回调报告。 */
function uniqueStrings(values: unknown[], report: (description: string) => void): string[] {
  const result: string[] = [];
  values.forEach((value) => {
    if (typeof value !== 'string' || !value.trim()) {
      report('包含非字符串或空 id');
      return;
    }
    if (!result.includes(value)) result.push(value);
  });
  return result;
}

function makeWarner(sink: string[]): (message: string) => void {
  const seen = new Set<string>();
  return (message: string) => {
    if (!seen.has(message)) {
      seen.add(message);
      sink.push(message);
    }
  };
}
