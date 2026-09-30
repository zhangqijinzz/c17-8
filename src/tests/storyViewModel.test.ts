import { describe, expect, it } from 'vitest';
import { createStarterStory } from '../models/story';
import { buildProjectMarkdown, importProjectFromText } from '../models/storyTransfer';
import { LocalStoryRepository } from '../repositories/storyRepository';
import { MemoryStorageService } from '../services/storageService';
import { StoryViewModel } from '../viewmodels/storyViewModel';

describe('story view model', () => {
  it('initializes, edits, persists, and restores the main flow', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    expect(viewModel.snapshot.status).toBe('ready');
    viewModel.addCharacter('阿洛', '修复师');
    viewModel.addScene('地下档案室', '他们找到被隐藏的航海日志。');
    const scene = viewModel.selectedScene;
    expect(scene?.title).toBe('地下档案室');
    viewModel.toggleCharacter(scene?.id ?? '', viewModel.snapshot.story?.characters[2]?.id ?? '');
    expect(viewModel.snapshot.stats.characters).toBe(3);

    const restored = new StoryViewModel(new LocalStoryRepository(new MemoryStorageServiceFixture(repository)));
    restored.initialize();
    expect(restored.snapshot.story?.scenes.some((item) => item.title === '地下档案室')).toBe(true);
    expect(restored.snapshot.story?.characters.some((item) => item.name === '阿洛')).toBe(true);
  });

  it('shows recoverable validation feedback and resets corrupt storage', () => {
    const storage = new MemoryStorageService();
    storage.writeRegistry('{broken');
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    expect(viewModel.snapshot.story?.id).toBe(createStarterStory().id);
    viewModel.addCharacter(' ', '');
    expect(viewModel.snapshot.notice).toContain('至少');
    viewModel.resetProject();
    expect(viewModel.snapshot.story?.id).toBe(createStarterStory().id);
  });

  it('imports an exported file as a new project without touching the current one', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    const originalId = viewModel.snapshot.story?.id ?? '';
    const originalTitle = viewModel.snapshot.story?.title ?? '';

    const markdown = buildProjectMarkdown(viewModel.snapshot.story!);
    const projectCountBefore = viewModel.snapshot.projects.length;
    const report = viewModel.importFromText(markdown);

    expect(report.kind).toBe('success');
    expect(viewModel.snapshot.story?.id).not.toBe(originalId);
    expect(viewModel.snapshot.story?.title).toBe(`${originalTitle}（导入副本）`);
    expect(viewModel.snapshot.projects.length).toBe(projectCountBefore + 1);

    // 原项目仍然存在且内容不变，切换即可继续编辑。
    viewModel.switchProject(originalId);
    expect(viewModel.snapshot.story?.title).toBe(originalTitle);
  });

  it('rejects garbage input without changing the current project', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    const beforeId = viewModel.snapshot.story?.id;
    const beforeCount = viewModel.snapshot.projects.length;

    const report = viewModel.importFromText('这不是一个项目文件，也没有数据块。');
    expect(report.kind).toBe('failure');
    expect(report.errors.length).toBeGreaterThan(0);
    expect(viewModel.snapshot.story?.id).toBe(beforeId);
    expect(viewModel.snapshot.projects.length).toBe(beforeCount);
  });

  it('reports an unreadable file as a failure without touching the project', async () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    const beforeId = viewModel.snapshot.story?.id;

    await viewModel.importFile(async () => { throw new Error('unreadable'); }, '坏文件.md');
    const report = viewModel.snapshot.importReport;
    expect(report?.kind).toBe('failure');
    expect(report?.errors[0]).toContain('坏文件.md');
    expect(viewModel.snapshot.story?.id).toBe(beforeId);
  });
});

/** 用已持久化的注册表重建存储（模拟刷新页面）。 */
class MemoryStorageServiceFixture extends MemoryStorageService {
  constructor(repository: LocalStoryRepository) {
    super();
    const summaries = repository.listProjects();
    const projects = summaries.map((summary) => {
      repository.switchProject(summary.id);
      return repository.loadActive();
    });
    const activeId = repository.loadActive().id;
    this.writeRegistry(JSON.stringify({ activeId, projects }));
  }
}

// 纯函数层的往返冒烟，确保导出文件自身可以被重新解析。
describe('export/import round trip helpers', () => {
  it('round-trips a complete document through markdown', () => {
    const story = createStarterStory();
    const markdown = buildProjectMarkdown(story);
    expect(markdown).toContain('# 最后的灯塔');
    expect(markdown).toContain('米拉');
    expect(markdown).toContain('第 1 幕 · 旧港口的来信');
    expect(markdown).toContain('待回收');
    const result = importProjectFromText(markdown, { existingIds: new Set(), existingTitles: new Set() });
    expect(result.ok).toBe(true);
    expect(result.story?.id).toBe(story.id);
    expect(result.story?.characters).toHaveLength(story.characters.length);
    expect(result.story?.scenes.map((scene) => scene.order)).toEqual([1, 2]);
    expect(result.warnings).toEqual([]);
  });
});
