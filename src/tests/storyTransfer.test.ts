import { describe, expect, it } from 'vitest';
import {
  buildProjectFile,
  buildProjectMarkdown,
  encodeDataBlock,
  importProjectFromText,
  SUPPORTED_FORMAT_VERSION,
  TRANSFER_FORMAT,
  type StoryProjectFile,
} from '../models/storyTransfer';
import { createStarterStory, type StoryDocument } from '../models/story';

const emptyOptions = { existingIds: new Set<string>(), existingTitles: new Set<string>() };

function validDocument(): StoryDocument {
  return JSON.parse(JSON.stringify(createStarterStory())) as StoryDocument;
}

function validEnvelope(document: StoryDocument): StoryProjectFile {
  return { format: TRANSFER_FORMAT, formatVersion: SUPPORTED_FORMAT_VERSION, exportedAt: '2026-09-30T10:00:00.000Z', document };
}

describe('project export markdown', () => {
  it('renders a human-readable structure containing identities, order and clue threads', () => {
    const story = createStarterStory();
    const md = buildProjectMarkdown(story);
    expect(md).toContain('# 最后的灯塔');
    // 人物身份与出场
    expect(md).toMatch(/### 米拉[\s\S]*?身份：灯塔守望人/);
    expect(md).toContain('第 1 幕《旧港口的来信》');
    // 场景按时间顺序
    const firstIndex = md.indexOf('第 1 幕 · 旧港口的来信');
    const secondIndex = md.indexOf('第 2 幕 · 风暴前夜');
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    // 伏笔埋下与回收
    expect(md).toContain('埋下的伏笔：《潮汐表背后的日期》');
    expect(md).toMatch(/\*\*潮汐表背后的日期\*\*：第 1 幕[\s\S]*?待回收（未回收）/);
  });

  it('shows payoff relationships for resolved clues', () => {
    const story = createStarterStory();
    story.clues[0].payoffSceneId = story.scenes[1].id;
    const md = buildProjectMarkdown(story);
    expect(md).toContain('回收的伏笔：《潮汐表背后的日期》');
    expect(md).toContain('第 2 幕《风暴前夜》回收（已回收）');
  });

  it('embeds a machine block immune to comment-closing sequences in content', () => {
    const story = createStarterStory();
    story.scenes[0].summary = '有人写了 --> 甚至 <!-- 想破坏数据块';
    const md = buildProjectMarkdown(story);
    const result = importProjectFromText(md, emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.story?.scenes.find((scene) => scene.id === story.scenes[0].id)?.summary).toBe(story.scenes[0].summary);
  });
});

describe('project import: happy paths', () => {
  it('round-trips a markdown export with zero warnings', () => {
    const md = buildProjectMarkdown(createStarterStory());
    const result = importProjectFromText(md, emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.story).toMatchObject({ id: 'story-last-lighthouse', title: '最后的灯塔' });
    expect(result.story?.characters).toHaveLength(2);
    expect(result.story?.scenes.map((scene) => scene.order)).toEqual([1, 2]);
  });

  it('accepts a bare v1 document JSON (older backup shape)', () => {
    const result = importProjectFromText(JSON.stringify(validDocument()), emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.story?.id).toBe('story-last-lighthouse');
  });

  it('accepts a document without a version field, warning it is treated as v1', () => {
    const doc = { ...validDocument() } as Partial<StoryDocument>;
    delete doc.version;
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.story?.version).toBe(1);
    expect(result.warnings.join(' ')).toContain('version');
  });
});

describe('project import: unrecoverable files are rejected wholesale', () => {
  it('rejects plain text without a data block', () => {
    const result = importProjectFromText('# 我的小说\n这只是一段文字。', emptyOptions);
    expect(result.ok).toBe(false);
    expect(result.story).toBeNull();
    expect(result.errors[0]).toContain('未找到');
  });

  it('rejects empty files', () => {
    const result = importProjectFromText('   \n ', emptyOptions);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('空');
  });

  it('rejects a tampered machine block with a JSON syntax message', () => {
    const md = `# 标题\n\n<!-- StoryArchitect/data-v1\n{ "format": "storyarchitect-project", "document": {\n-->\n`;
    const result = importProjectFromText(md, emptyOptions);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('JSON');
    expect(result.story).toBeNull();
  });

  it('rejects unsupported document versions explicitly', () => {
    const doc = validDocument();
    (doc as { version: number }).version = 99;
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('版本');
  });

  it('rejects newer envelope format versions with upgrade guidance', () => {
    const envelope = validEnvelope(validDocument());
    const result = importProjectFromText(JSON.stringify({ ...envelope, formatVersion: 2 }), emptyOptions);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('更新版本');
  });

  it('rejects unknown format identifiers and non-object roots', () => {
    const envelope = validEnvelope(validDocument());
    expect(importProjectFromText(JSON.stringify({ ...envelope, format: 'nope' }), emptyOptions).ok).toBe(false);
    expect(importProjectFromText(JSON.stringify([1, 2, 3]), emptyOptions).errors[0]).toContain('数组');
    expect(importProjectFromText(JSON.stringify('just a string'), emptyOptions).ok).toBe(false);
  });
});

describe('project import: damaged fields are repaired and reported', () => {
  it('fills missing scalar fields with placeholders', () => {
    const doc = validDocument() as unknown as Record<string, unknown>;
    delete doc.title;
    delete doc.id;
    delete doc.updatedAt;
    doc.status = 'weird';
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.story?.title).toBe('未命名故事');
    expect(result.story?.id).toMatch(/^story-/);
    expect(result.story?.status).toBe('draft');
    expect(result.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('skips non-object entries and invalid character rows', () => {
    const doc = validDocument() as unknown as { characters: unknown[] };
    doc.characters = ['坏条目', { name: '', role: '', color: 'rainbow' }];
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.story?.characters).toHaveLength(1);
    expect(result.story?.characters[0].name).toBe('未命名人物');
    expect(result.story?.characters[0].color).toBe('coral');
    expect(result.warnings.join(' ')).toContain('跳过');
  });

  it('repairs dangling references in scenes without dropping the scene', () => {
    const doc = validDocument();
    doc.scenes[0].characterIds = [doc.characters[0].id, 'character-ghost', 123] as unknown as string[];
    doc.scenes[0].clueIds = ['clue-ghost', doc.clues[0].id];
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(true);
    const scene = result.story!.scenes.find((item) => item.id === doc.scenes[0].id)!;
    expect(scene.characterIds).toEqual([doc.characters[0].id]);
    // 不存在的伏笔引用被移除，但伏笔自身声明的挂载被补回
    expect(scene.clueIds).toEqual([doc.clues[0].id]);
    expect(result.warnings.some((message) => message.includes('不存在的人物'))).toBe(true);
    expect(result.warnings.some((message) => message.includes('不存在的伏笔'))).toBe(true);
  });

  it('repairs dangling clue scenes: bad setup drops the clue, bad payoff clears to unresolved', () => {
    const doc = validDocument();
    doc.clues.push({ id: 'clue-no-setup', title: '没有埋下场景的伏笔', setupSceneId: 'scene-ghost', payoffSceneId: '' });
    doc.clues[0].payoffSceneId = 'scene-ghost-payoff';
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.story?.clues).toHaveLength(1);
    expect(result.story?.clues[0].payoffSceneId).toBe('');
    expect(result.warnings.some((message) => message.includes('埋下场景') && message.includes('跳过'))).toBe(true);
    expect(result.warnings.some((message) => message.includes('回收场景'))).toBe(true);
  });

  it('resequences duplicate and missing orders, warning once', () => {
    const doc = validDocument();
    doc.scenes[1].order = 1;
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.story?.scenes.map((scene) => scene.order).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(result.warnings.filter((message) => message.includes('重新编号'))).toHaveLength(1);
  });

  it('warns when a clue pays off before it is planted', () => {
    const doc = validDocument();
    doc.clues[0].setupSceneId = doc.scenes[1].id;
    doc.clues[0].payoffSceneId = doc.scenes[0].id;
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((message) => message.includes('回收场景早于埋下场景'))).toBe(true);
  });

  it('repairs a missing selectedSceneId and non-array lists', () => {
    const doc = validDocument() as unknown as Record<string, unknown>;
    doc.selectedSceneId = 'scene-ghost';
    doc.characters = { nope: true };
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(true);
    expect(result.story?.selectedSceneId).toBe(validDocument().scenes[0].id);
    expect(result.story?.characters).toEqual([]);
    expect(result.warnings.some((message) => message.includes('characters 字段不是数组'))).toBe(true);
  });

  it('deduplicates repeated ids by remapping the second entity', () => {
    const doc = validDocument();
    doc.characters.push({ ...doc.characters[0], name: '冒牌米拉' });
    const result = importProjectFromText(JSON.stringify(doc), emptyOptions);
    expect(result.ok).toBe(true);
    expect(new Set(result.story!.characters.map((c) => c.id)).size).toBe(result.story!.characters.length);
    expect(result.warnings.some((m) => m.includes('重复'))).toBe(true);
  });
});

describe('project import: collisions never overwrite current work', () => {
  it('creates an import copy with a new id and a distinguishable title', () => {
    const doc = validDocument();
    const options = { existingIds: new Set([doc.id]), existingTitles: new Set([doc.title]) };
    const result = importProjectFromText(buildProjectMarkdown(doc), options);
    expect(result.ok).toBe(true);
    expect(result.story?.id).not.toBe(doc.id);
    expect(result.story?.title).toBe('最后的灯塔（导入副本）');
    expect(result.warnings.some((m) => m.includes('未被覆盖'))).toBe(true);
  });

  it('numbers copy titles when several copies already exist', () => {
    const doc = validDocument();
    const options = {
      existingIds: new Set([doc.id]),
      existingTitles: new Set(['最后的灯塔（导入副本）']),
    };
    const result = importProjectFromText(JSON.stringify(doc), options);
    expect(result.story?.title).toBe('最后的灯塔（导入副本 2）');
  });
});

describe('export data block encoding', () => {
  it('escapes angle brackets so content cannot close the HTML comment', () => {
    const block = encodeDataBlock(buildProjectFile(createStarterStory(), '2026-09-30T10:00:00.000Z'));
    expect(block.startsWith('<!-- StoryArchitect/data-v1')).toBe(true);
    expect(block.endsWith('-->')).toBe(true);
    expect(block.includes('-->')).toBe(true); // 仅收尾处
    expect(block.split('-->')).toHaveLength(2);
  });
});
