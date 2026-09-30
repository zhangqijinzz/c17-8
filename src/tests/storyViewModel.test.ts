import { describe, expect, it } from 'vitest';
import { createStarterStory } from '../models/story';
import { exportStoryToMarkdown } from '../models/storyTransfer';
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

    const restored = new StoryViewModel(repository);
    restored.initialize();
    expect(restored.snapshot.story?.scenes.some((item) => item.title === '地下档案室')).toBe(true);
    expect(restored.snapshot.story?.characters.some((item) => item.name === '阿洛')).toBe(true);
  });

  it('shows recoverable validation feedback and resets the active project without deleting other projects', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    const originalId = viewModel.snapshot.story?.id;
    viewModel.importProjectFile(exportStoryToMarkdown(createStarterStory()));
    const importedId = viewModel.snapshot.story?.id;
    expect(importedId).not.toBe(originalId);
    expect(viewModel.snapshot.projects).toHaveLength(2);

    viewModel.switchProject(originalId ?? '');
    viewModel.addCharacter(' ', '');
    expect(viewModel.snapshot.notice).toContain('至少');
    viewModel.resetProject();
    expect(viewModel.snapshot.projects).toHaveLength(2);
    expect(viewModel.snapshot.story?.id).not.toBe(originalId);
    expect(viewModel.snapshot.story?.title).toBe(createStarterStory().title);

    viewModel.switchProject(importedId ?? '');
    expect(viewModel.snapshot.story?.id).toBe(importedId);
  });

  it('imports as a separate project and keeps the current project available', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    const current = viewModel.snapshot.story;
    const importedStory = {
      ...createStarterStory(),
      id: 'story-imported',
      title: '北境来信',
      characters: [],
      scenes: [],
      clues: [],
      selectedSceneId: '',
    };
    viewModel.importProjectFile(exportStoryToMarkdown(importedStory));
    expect(viewModel.snapshot.story?.title).toBe('北境来信');
    expect(viewModel.snapshot.story?.id).not.toBe('story-imported');
    expect(viewModel.snapshot.story?.id).not.toBe(current?.id);
    expect(viewModel.snapshot.projects.map((project) => project.title)).toEqual(expect.arrayContaining(['北境来信', current?.title ?? '']));
    viewModel.switchProject(current?.id ?? '');
    expect(viewModel.snapshot.story?.id).toBe(current?.id);
    expect(viewModel.snapshot.story?.characters.length).toBeGreaterThan(0);
  });

  it('does not change the current project when an imported file is broken', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    const current = viewModel.snapshot.story;
    viewModel.importProjectFile('# 没有数据块');
    expect(viewModel.snapshot.story?.id).toBe(current?.id);
    expect(viewModel.snapshot.error).toContain('STORY-ARCHITECT-DATA/V1');
    expect(viewModel.snapshot.projects).toHaveLength(1);
  });
});
