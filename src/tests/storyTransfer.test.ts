import { describe, expect, it } from 'vitest';
import { type StoryDocument } from '../models/story';
import { exportStoryToMarkdown, parseStoryTransferFile, STORY_DATA_MARKER } from '../models/storyTransfer';
import { createStarterStory } from '../models/story';

function markerContent(file: string): unknown {
  const match = file.match(new RegExp(`<!-- ${STORY_DATA_MARKER}\\r?\\n([\\s\\S]*?)\\r?\\n-->`));
  expect(match).not.toBeNull();
  return JSON.parse(match?.[1] ?? '{}');
}

describe('story transfer files', () => {
  it('exports readable structure and imports the full editable document', () => {
    const story = createStarterStory();
    const file = exportStoryToMarkdown(story);
    expect(file).toContain('# 最后的灯塔');
    expect(file).toContain('## 人物身份');
    expect(file).toContain('米拉 | 灯塔守望人');
    expect(file).toContain('## 场景先后');
    expect(file).toContain('| 1 | 旧港口的来信');
    expect(file).toContain('## 伏笔的埋下与回收');
    expect(file).toContain('潮汐表背后的日期');
    expect(file).toContain('待回收');

    const result = parseStoryTransferFile(file);
    expect(result.errors).toEqual([]);
    expect(result.story).toMatchObject({
      id: story.id,
      title: '最后的灯塔',
      status: 'draft',
      selectedSceneId: story.scenes[0].id,
    });
    expect(result.story?.scenes.map((scene) => [scene.order, scene.title])).toEqual([
      [1, '旧港口的来信'],
      [2, '风暴前夜'],
    ]);
    expect(result.story?.scenes[0].clueIds).toEqual([story.clues[0].id]);
    expect(result.story?.clues[0]).toEqual(story.clues[0]);
    expect(markerContent(file)).toMatchObject({ id: story.id, title: story.title });
  });

  it('reports a missing or manually broken machine block without returning half data', () => {
    expect(parseStoryTransferFile('# 只有正文').errors.join(' ')).toContain(STORY_DATA_MARKER);
    const legacyJson = JSON.stringify({ ...createStarterStory(), version: 0 });
    const legacyResult = parseStoryTransferFile(legacyJson);
    expect(legacyResult.story?.title).toBe('最后的灯塔');
    expect(legacyResult.warnings.join(' ')).toContain('纯 JSON');
    const broken = exportStoryToMarkdown(createStarterStory()).replace('"title": "最后的灯塔"', '"title": ');
    const result = parseStoryTransferFile(broken);
    expect(result.story).toBeNull();
    expect(result.errors.join(' ')).toContain('合法 JSON');
  });

  it('migrates an old version and repairs missing fields and broken relations with explicit warnings', () => {
    const oldFile = JSON.stringify({
      version: 0,
      id: 'old-project',
      title: '  旧城档案  ',
      characters: [
        { id: 'c1', name: '阿澈', role: '调查员', color: 'coral' },
        { id: 'c1', name: '重复人物', role: '线人', color: 'blue' },
        null,
      ],
      scenes: [
        { id: 's2', title: '终幕', order: 2, summary: '答案揭晓', conflict: '', characterIds: ['missing'], clueIds: [] },
        { id: 's1', title: '开端', order: 1, summary: '收到匿名档案', conflict: '真假难辨', characterIds: ['c1', 'c1'], clueIds: ['x1'] },
        { id: 's3', title: '', order: 'bad', summary: '', conflict: '', characterIds: null, clueIds: null },
      ],
      clues: [
        { id: 'x1', title: '匿名档案', setupSceneId: 's1', payoffSceneId: 's2' },
        { id: 'x2', title: '倒置伏笔', setupSceneId: 's2', payoffSceneId: 's1' },
        { id: 'x3', title: '断链伏笔', setupSceneId: 'missing', payoffSceneId: '' },
      ],
      selectedSceneId: 'missing-scene',
      updatedAt: 'not-a-date',
    });
    const result = parseStoryTransferFile(`# 旧城档案\n\n<!-- ${STORY_DATA_MARKER}\n${oldFile}\n-->`);
    expect(result.errors).toEqual([]);
    expect(result.story?.version).toBe(1);
    expect(result.story?.title).toBe('旧城档案');
    expect(result.story?.characters).toHaveLength(2);
    expect(result.story?.scenes.map((scene) => scene.title)).toEqual(['开端', '终幕', '未命名场景 3']);
    expect(result.story?.scenes.map((scene) => scene.order)).toEqual([1, 2, 3]);
    expect(result.story?.scenes[0].characterIds).toEqual(['c1']);
    expect(result.story?.scenes[0].clueIds).toEqual(['x1']);
    expect(result.story?.scenes[1].clueIds).toEqual(['x1', 'x2']);
    expect(result.story?.clues.find((clue) => clue.id === 'x2')?.payoffSceneId).toBe('');
    expect(result.story?.clues.some((clue) => clue.id === 'x3')).toBe(false);
    expect(result.story?.selectedSceneId).toBe(result.story?.scenes[0].id);
    expect(result.warnings.join('\n')).toContain('旧版本');
    expect(result.warnings.join('\n')).toContain('人物 ID');
    expect(result.warnings.join('\n')).toContain('引用了不存在的人物');
    expect(result.warnings.join('\n')).toContain('回收场景早于埋下场景');
    expect(result.warnings.join('\n')).toContain('更新时间无法识别');
  });

  it('refuses a newer file version', () => {
    const future = { ...createStarterStory(), version: 99 } as unknown as StoryDocument;
    const result = parseStoryTransferFile(`<!-- ${STORY_DATA_MARKER}\n${JSON.stringify(future)}\n-->`);
    expect(result.story).toBeNull();
    expect(result.errors.join(' ')).toContain('版本 v99');
  });
});
