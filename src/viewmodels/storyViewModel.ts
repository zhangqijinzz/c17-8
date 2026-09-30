import {
  buildExportFileName,
  buildProjectMarkdown,
  importProjectFromText,
} from '../models/storyTransfer';
import {
  characterColors,
  createId,
  createStarterStory,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
} from '../models/story';
import { getStats, getTimelineWarning, orderedScenes, validateName } from '../models/storyRules';
import type { ProjectSummary, StoryRepository } from '../repositories/storyRepository';
import type { ProjectFileService } from '../services/fileService';

export type ViewModelStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface ImportReport {
  kind: 'success' | 'failure';
  title: string | null;
  errors: string[];
  warnings: string[];
}

export interface StoryViewState {
  status: ViewModelStatus;
  story: StoryDocument | null;
  projects: ProjectSummary[];
  stats: ReturnType<typeof getStats>;
  notice: string;
  error: string;
  search: string;
  activeSection: 'overview' | 'characters' | 'clues';
  importReport: ImportReport | null;
}

type Listener = () => void;

export class StoryViewModel {
  private state: StoryViewState = {
    status: 'loading',
    story: null,
    projects: [],
    stats: { characters: 0, scenes: 0, clues: 0, unresolvedClues: 0, completion: 0 },
    notice: '',
    error: '',
    search: '',
    activeSection: 'overview',
    importReport: null,
  };
  private readonly listeners = new Set<Listener>();
  private initialized = false;

  constructor(
    private readonly repository: StoryRepository,
    private readonly fileService?: ProjectFileService,
  ) {}

  get snapshot(): StoryViewState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const story = this.repository.loadActive();
      this.applyLoadedStory(story, 'ready');
    } catch {
      this.setState({ status: 'error', error: '故事读取失败，请重置为示例项目。' });
    }
  }

  switchProject(id: string): void {
    try {
      const story = this.repository.switchProject(id);
      if (!story) {
        this.setState({ error: '没有找到要切换的项目，当前项目保持不变。' });
        return;
      }
      this.applyLoadedStory(story, 'ready');
      this.setState({ notice: `已切换到项目「${story.title}」`, search: '' });
    } catch {
      this.setState({ error: '切换项目失败，当前项目保持不变。' });
    }
  }

  /** 生成当前项目的导出文件文本与文件名；下载由调用方（浏览器环境）执行。 */
  exportProject(): { fileName: string; content: string } {
    const story = this.requireStory();
    const exportedAt = new Date().toISOString();
    return { fileName: buildExportFileName(story, exportedAt), content: buildProjectMarkdown(story, exportedAt) };
  }

  downloadProject(): void {
    if (!this.fileService) {
      this.setState({ error: '当前环境不支持文件下载。' });
      return;
    }
    try {
      const { fileName, content } = this.exportProject();
      this.fileService.downloadText(fileName, content);
      this.setState({ notice: `已导出项目「${this.requireStory().title}」为 ${fileName}` });
    } catch {
      this.setState({ error: '导出失败，请重试。' });
    }
  }

  /**
   * 从文件文本导入：规范化失败只展示报告，绝不动当前项目；
   * 成功则作为新项目保存并切换过去，原项目完整保留。
   */
  importFromText(text: string): ImportReport {
    const existingIds = new Set(this.state.projects.map((project) => project.id));
    const existingTitles = new Set(this.state.projects.map((project) => project.title));
    const result = importProjectFromText(text, { existingIds, existingTitles });

    if (!result.ok || !result.story) {
      const report: ImportReport = { kind: 'failure', title: null, errors: result.errors, warnings: result.warnings };
      this.setState({ importReport: report });
      return report;
    }

    try {
      this.repository.saveImported(result.story);
    } catch {
      const report: ImportReport = {
        kind: 'failure',
        title: result.story.title,
        errors: ['导入的项目无法保存到本地存储（可能是存储空间不足），当前项目未受影响。'],
        warnings: result.warnings,
      };
      this.setState({ importReport: report });
      return report;
    }

    const report: ImportReport = {
      kind: 'success',
      title: result.story.title,
      errors: [],
      warnings: result.warnings,
    };
    this.applyLoadedStory(result.story, result.story.status === 'complete' ? 'completed' : 'ready');
    this.setState({
      importReport: report,
      notice: result.warnings.length > 0
        ? `已作为新项目「${result.story.title}」导入，有 ${result.warnings.length} 条修复说明`
        : `已作为新项目「${result.story.title}」导入，可以继续写作`,
      search: '',
    });
    return report;
  }

  dismissImportReport(): void {
    this.setState({ importReport: null });
  }

  /**
   * 读取并导入一个文件：文件 IO 失败与数据校验失败都会产出报告，
   * 任何一种失败都不会改动当前项目。文本读取由调用方（浏览器环境）完成。
   */
  async importFile(read: () => Promise<string>, fileName: string): Promise<void> {
    let text: string;
    try {
      text = await read();
    } catch {
      this.setState({
        importReport: {
          kind: 'failure',
          title: null,
          errors: [`无法读取文件「${fileName}」，请确认文件没有损坏后重试。`],
          warnings: [],
        },
      });
      return;
    }
    this.importFromText(text);
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
      characters: story.characters,
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
    this.updateStory((story) => ({
      ...story,
      clues: [...story.clues, clue],
      scenes: story.scenes.map((scene) => scene.id === setupSceneId ? { ...scene, clueIds: [...scene.clueIds, clue.id] } : scene),
    }));
    this.setState({ notice: payoffSceneId ? '伏笔关系已建立' : '伏笔已记录，等待回收' });
  }

  completeProject(): void {
    this.updateStory((story) => ({ ...story, status: 'complete' }));
    this.setState({ status: 'completed', notice: '项目已标记为完成，仍可继续编辑' });
  }

  resetProject(): void {
    const activeId = this.requireStory().id;
    let story = createStarterStory();
    // 恢复示例会就地替换当前项目；只有当示例 id 被*另一个*项目占用时才换新 id。
    if (this.state.projects.some((project) => project.id === story.id && project.id !== activeId)) {
      story = { ...story, id: createId('story') };
    }
    try {
      this.repository.resetActive(story);
    } catch {
      this.setState({ status: 'error', error: '恢复示例项目失败，当前编辑仍保留在页面中。' });
      return;
    }
    this.setState({ status: 'ready', story, stats: getStats(story), projects: this.repository.listProjects(), notice: '已恢复示例项目', error: '' });
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

  private applyLoadedStory(story: StoryDocument, status: ViewModelStatus): void {
    this.setState({
      status: story.status === 'complete' ? 'completed' : status,
      story,
      projects: this.repository.listProjects(),
      stats: getStats(story),
      error: '',
    });
  }

  private requireStory(): StoryDocument {
    if (!this.state.story) throw new Error('故事尚未初始化');
    return this.state.story;
  }

  private updateStory(updater: (story: StoryDocument) => StoryDocument, showEditing = true): void {
    const story = updater(this.requireStory());
    this.persist(story);
    this.setState({ story, stats: getStats(story), status: showEditing ? 'editing' : this.state.status, error: '', projects: this.repository.listProjects() });
  }

  private persist(story: StoryDocument): void {
    try {
      this.repository.save({ ...story, updatedAt: new Date().toISOString() });
    } catch {
      this.setState({ status: 'error', error: '保存失败，但当前编辑仍保留在页面中。' });
    }
  }

  private setState(patch: Partial<StoryViewState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
