import {
  characterColors,
  createId,
  createStarterStory,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
} from '../models/story';
import { exportStoryToMarkdown, parseStoryTransferFile } from '../models/storyTransfer';
import { getStats, getTimelineWarning, orderedScenes, validateName } from '../models/storyRules';
import type { ProjectSummary, StoryRepository } from '../repositories/storyRepository';

export type ViewModelStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface StoryViewState {
  status: ViewModelStatus;
  story: StoryDocument | null;
  stats: ReturnType<typeof getStats>;
  notice: string;
  error: string;
  importWarnings: string[];
  projects: ProjectSummary[];
  search: string;
  activeSection: 'overview' | 'characters' | 'clues';
}

type Listener = () => void;

export class StoryViewModel {
  private state: StoryViewState = {
    status: 'loading',
    story: null,
    stats: { characters: 0, scenes: 0, clues: 0, unresolvedClues: 0, completion: 0 },
    notice: '',
    error: '',
    importWarnings: [],
    projects: [],
    search: '',
    activeSection: 'overview',
  };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly repository: StoryRepository) {}

  get snapshot(): StoryViewState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(): void {
    try {
      const story = this.repository.load();
      this.setState({
        status: story.status === 'complete' ? 'completed' : 'ready',
        story,
        projects: this.repository.listProjects(),
        stats: getStats(story),
        error: '',
        importWarnings: [],
      });
    } catch (error) {
      this.setState({
        status: 'error',
        error: `故事读取失败：${error instanceof Error ? error.message : '本地数据无法解析'}。当前项目未被改动。`,
      });
    }
  }

  setSearch(search: string): void {
    this.setState({ search });
  }

  setSection(activeSection: StoryViewState['activeSection']): void {
    this.setState({ activeSection });
  }

  selectScene(sceneId: string): void {
    this.updateStory((story) => ({ ...story, selectedSceneId: sceneId }));
  }

  switchProject(projectId: string): void {
    if (projectId === this.state.story?.id) return;
    try {
      const story = this.repository.switchProject(projectId);
      this.setState({
        status: story.status === 'complete' ? 'completed' : 'ready',
        story,
        stats: getStats(story),
        projects: this.repository.listProjects(),
        notice: `已切换到项目「${story.title}」`,
        error: '',
        importWarnings: [],
        search: '',
      });
    } catch (error) {
      this.setState({ error: `项目切换失败：${error instanceof Error ? error.message : '请稍后重试'}。` });
    }
  }

  dismissImportWarnings(): void {
    this.setState({ importWarnings: [] });
  }

  exportCurrentProject(): string {
    return exportStoryToMarkdown(this.requireStory());
  }

  importProjectFile(content: string): void {
    const result = parseStoryTransferFile(content);
    if (!result.story || result.errors.length) {
      this.setState({
        error: result.errors.join(' ') || '导入文件无法解析，当前项目没有被修改。',
      });
      return;
    }

    try {
      const imported = this.repository.importProject(result.story);
      this.setState({
        status: imported.status === 'complete' ? 'completed' : 'ready',
        story: imported,
        stats: getStats(imported),
        projects: this.repository.listProjects(),
        notice: `已将「${imported.title}」导入为新项目，当前项目保持不变。`,
        error: '',
        importWarnings: result.warnings,
      });
    } catch (error) {
      this.setState({ error: `导入项目保存失败：${error instanceof Error ? error.message : '浏览器存储不可用'}。当前项目没有被修改。` });
    }
  }

  addCharacter(name: string, role: string): void {
    const cleanName = validateName(name);
    if (cleanName === '至少输入 2 个字') {
      this.setState({ notice: cleanName });
      return;
    }
    const story = this.requireStory();
    const character: StoryCharacter = {
      id: createId('character'),
      name: cleanName,
      role: role.trim() || '待定义角色',
      color: characterColors[story.characters.length % characterColors.length],
    };
    this.updateStory((current) => ({ ...current, characters: [...current.characters, character] }));
    this.setState({ notice: `已加入人物「${character.name}」` });
  }

  addScene(title: string, summary: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    const story = this.requireStory();
    const scene: StoryScene = {
      id: createId('scene'),
      title: cleanTitle,
      order: story.scenes.length + 1,
      summary: summary.trim() || '还没有写下这一幕发生了什么。',
      conflict: '',
      characterIds: [],
      clueIds: [],
    };
    this.updateStory((current) => ({ ...current, scenes: [...current.scenes, scene], selectedSceneId: scene.id }));
    this.setState({ notice: `已创建场景「${scene.title}」` });
  }

  updateScene(sceneId: string, patch: Partial<Pick<StoryScene, 'title' | 'summary' | 'conflict'>>): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
    }), false);
  }

  toggleCharacter(sceneId: string, characterId: string): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const hasCharacter = scene.characterIds.includes(characterId);
        return { ...scene, characterIds: hasCharacter ? scene.characterIds.filter((id) => id !== characterId) : [...scene.characterIds, characterId] };
      }),
    }));
  }

  moveScene(sceneId: string, direction: 'up' | 'down'): void {
    const scenes = orderedScenes(this.requireStory());
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= scenes.length) return;
    [scenes[index], scenes[nextIndex]] = [scenes[nextIndex], scenes[index]];
    this.updateStory((story) => ({ ...story, scenes: scenes.map((scene, sceneIndex) => ({ ...scene, order: sceneIndex + 1 })) }));
    this.setState({ notice: '时间线顺序已更新' });
  }

  addClue(title: string, setupSceneId: string, payoffSceneId: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    if (!setupSceneId) {
      this.setState({ notice: '请先选择伏笔埋下的场景' });
      return;
    }
    const clue: StoryClue = { id: createId('clue'), title: cleanTitle, setupSceneId, payoffSceneId };
    this.updateStory((story) => {
      const linkedSceneIds = [...new Set([setupSceneId, payoffSceneId].filter(Boolean))];
      return {
        ...story,
        clues: [...story.clues, clue],
        scenes: story.scenes.map((scene) => linkedSceneIds.includes(scene.id)
          ? { ...scene, clueIds: [...scene.clueIds, clue.id] }
          : scene),
      };
    });
    this.setState({ notice: payoffSceneId ? '伏笔关系已建立' : '伏笔已记录，等待回收' });
  }

  completeProject(): void {
    this.updateStory((story) => ({ ...story, status: 'complete' }), false);
    if (!this.state.error) this.setState({ status: 'completed', notice: '项目已标记为完成，仍可继续编辑' });
  }

  resetProject(): void {
    const story = this.repository.replaceActiveProject(createStarterStory());
    this.setState({
      status: 'ready',
      story,
      projects: this.repository.listProjects(),
      stats: getStats(story),
      notice: '当前项目已替换为示例项目，其他项目保持不变',
      error: '',
      importWarnings: [],
    });
  }

  get visibleCharacters(): StoryCharacter[] {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    return story.characters.filter((character) => `${character.name}${character.role}`.toLowerCase().includes(keyword));
  }

  get visibleScenes(): StoryScene[] {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    return orderedScenes(story).filter((scene) => `${scene.title}${scene.summary}${scene.conflict}`.toLowerCase().includes(keyword));
  }

  get selectedScene(): StoryScene | null {
    const story = this.state.story;
    return story?.scenes.find((scene) => scene.id === story.selectedSceneId) ?? null;
  }

  get timelineWarning(): string | null {
    const story = this.state.story;
    return story ? getTimelineWarning(story) : null;
  }

  private requireStory(): StoryDocument {
    if (!this.state.story) throw new Error('故事尚未初始化');
    return this.state.story;
  }

  private updateStory(updater: (story: StoryDocument) => StoryDocument, showEditing = true): void {
    const story = updater(this.requireStory());
    const saved = this.persist(story);
    this.setState({
      story,
      stats: getStats(story),
      status: saved ? (showEditing ? 'editing' : this.state.status) : 'error',
      ...(saved ? { error: '', projects: this.repository.listProjects() } : {}),
    });
  }

  private persist(story: StoryDocument): boolean {
    try {
      this.repository.save({ ...story, updatedAt: new Date().toISOString() });
      return true;
    } catch {
      this.setState({ status: 'error', error: '保存失败，但当前编辑仍保留在页面中。' });
      return false;
    }
  }

  private setState(patch: Partial<StoryViewState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
