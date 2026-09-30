import { createStarterStory, type StoryDocument } from '../models/story';
import { sanitizeStory } from '../models/storyRules';
import type { StorageService } from '../services/storageService';

export interface ProjectSummary {
  id: string;
  title: string;
  status: StoryDocument['status'];
  updatedAt: string;
}

export interface StoryRepository {
  listProjects(): ProjectSummary[];
  loadActive(): StoryDocument;
  save(story: StoryDocument): void;
  switchProject(id: string): StoryDocument | null;
  /** 导入保存：调用方保证 story 已通过规范化且不会与现有 id 冲突。 */
  saveImported(story: StoryDocument): void;
  /** 恢复示例：用给定项目替换当前激活项目（显式操作，允许覆盖当前项目）。 */
  resetActive(story: StoryDocument): void;
}

interface ProjectRegistry {
  activeId: string;
  projects: StoryDocument[];
}

export class LocalStoryRepository implements StoryRepository {
  private registry: ProjectRegistry;

  constructor(private readonly storage: StorageService) {
    this.registry = this.loadRegistry();
  }

  listProjects(): ProjectSummary[] {
    return [...this.registry.projects]
      .map((story) => ({ id: story.id, title: story.title, status: story.status, updatedAt: story.updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  loadActive(): StoryDocument {
    return this.registry.projects.find((story) => story.id === this.registry.activeId) ?? this.registry.projects[0];
  }

  switchProject(id: string): StoryDocument | null {
    const story = this.registry.projects.find((item) => item.id === id);
    if (!story) return null;
    this.registry = { ...this.registry, activeId: id };
    this.persist();
    return story;
  }

  save(story: StoryDocument): void {
    const projects = this.registry.projects.map((item) => (item.id === story.id ? story : item));
    this.registry = { ...this.registry, projects, activeId: story.id };
    this.persist();
  }

  saveImported(story: StoryDocument): void {
    if (this.registry.projects.some((item) => item.id === story.id)) {
      throw new Error('导入的项目 id 与现有项目冲突，导入流程应先生成副本 id。');
    }
    this.registry = { ...this.registry, projects: [...this.registry.projects, story], activeId: story.id };
    this.persist();
  }

  resetActive(story: StoryDocument): void {
    const activeId = this.registry.activeId;
    const projects = this.registry.projects.map((item) => (item.id === activeId ? story : item));
    this.registry = { activeId: story.id, projects };
    this.persist();
  }

  private loadRegistry(): ProjectRegistry {
    const raw = this.storage.readRegistry();
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const candidate = parsed as { activeId?: unknown; projects?: unknown };
          if (Array.isArray(candidate.projects)) {
            const projects = candidate.projects
              .map((item) => sanitizeStory(item))
              .filter((item): item is StoryDocument => item !== null);
            if (projects.length > 0) {
              const activeId =
                typeof candidate.activeId === 'string' && projects.some((story) => story.id === candidate.activeId)
                  ? candidate.activeId
                  : projects[0].id;
              return { activeId, projects };
            }
          }
        }
      } catch {
        // 注册表损坏：继续尝试旧格式迁移，仍失败则退回示例项目。
      }
    }

    const legacyRaw = this.storage.readLegacy();
    if (legacyRaw) {
      try {
        const legacy = sanitizeStory(JSON.parse(legacyRaw));
        if (legacy) {
          const registry = { activeId: legacy.id, projects: [legacy] };
          this.storage.writeRegistry(JSON.stringify(registry));
          return registry;
        }
      } catch {
        // 旧数据同样损坏，忽略并退回示例项目。
      }
    }

    const starter = createStarterStory();
    const registry = { activeId: starter.id, projects: [starter] };
    this.storage.writeRegistry(JSON.stringify(registry));
    return registry;
  }

  private persist(): void {
    this.storage.writeRegistry(JSON.stringify(this.registry));
  }
}
