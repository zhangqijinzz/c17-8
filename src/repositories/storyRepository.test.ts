import { describe, expect, it } from 'vitest';
import { createStarterStory, type StoryDocument } from '../models/story';
import { LocalStoryRepository } from './storyRepository';
import { MemoryStorageService } from '../services/storageService';

function editedStory(): StoryDocument {
  const story = createStarterStory();
  story.title = '迁移来的旧项目';
  return story;
}

describe('LocalStoryRegistry', () => {
  it('starts from the starter story when nothing is stored', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    expect(repository.loadActive().id).toBe(createStarterStory().id);
    expect(repository.listProjects()).toHaveLength(1);
  });

  it('migrates legacy single-document storage once', () => {
    const storage = new MemoryStorageService();
    storage.seedLegacy(JSON.stringify(editedStory()));

    const repository = new LocalStoryRepository(storage);
    expect(repository.loadActive().title).toBe('迁移来的旧项目');
    expect(repository.listProjects()).toHaveLength(1);

    // 重新构造（相当于刷新页面）：注册表已持久化，不再依赖旧 key。
    const reopened = new LocalStoryRepository(storage);
    expect(reopened.loadActive().title).toBe('迁移来的旧项目');
  });

  it('ignores corrupt registry and corrupt legacy data, falling back to the starter', () => {
    const storage = new MemoryStorageService();
    storage.writeRegistry('{broken');
    storage.seedLegacy('also broken');
    const repository = new LocalStoryRepository(storage);
    expect(repository.loadActive().id).toBe(createStarterStory().id);
  });

  it('filters invalid projects out of a damaged registry', () => {
    const storage = new MemoryStorageService();
    const good = createStarterStory();
    storage.writeRegistry(JSON.stringify({ activeId: good.id, projects: [good, { version: 99 }] }));
    const repository = new LocalStoryRepository(storage);
    expect(repository.listProjects()).toHaveLength(1);
    expect(repository.loadActive().id).toBe(good.id);
  });

  it('keeps imported projects separate and switches between them', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const starter = repository.loadActive();

    const imported: StoryDocument = { ...createStarterStory(), id: 'story-imported', title: '导入的故事' };
    repository.saveImported(imported);
    expect(repository.loadActive().id).toBe('story-imported');

    expect(repository.switchProject(starter.id)?.id).toBe(starter.id);
    expect(repository.switchProject('missing')).toBeNull();
    expect(repository.listProjects().map((project) => project.id).sort()).toEqual([starter.id, 'story-imported'].sort());

    // 保存编辑只影响当前项目。
    const changed = { ...starter, title: '改了名的示例' };
    repository.save(changed);
    expect(repository.loadActive().title).toBe('改了名的示例');
    expect(repository.switchProject('story-imported')?.title).toBe('导入的故事');
  });

  it('refuses to save an imported story whose id already exists', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    expect(() => repository.saveImported(repository.loadActive())).toThrow();
  });

  it('resetActive replaces the active project in place', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const imported: StoryDocument = { ...createStarterStory(), id: 'story-keep', title: '另一个项目' };
    repository.saveImported(imported);
    repository.switchProject(createStarterStory().id);

    const fresh = createStarterStory();
    repository.resetActive(fresh);
    expect(repository.loadActive().id).toBe(fresh.id);
    // 另一个项目不受影响。
    expect(repository.switchProject('story-keep')?.title).toBe('另一个项目');
  });
});
