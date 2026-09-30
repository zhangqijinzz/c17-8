import { createId, createStarterStory, type StoryDocument } from '../models/story';
import { createProjectImportName } from '../models/storyTransfer';
import { sanitizeStory } from '../models/storyRules';
import type { ProjectLibraryStorage } from '../services/storageService';

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
  status: StoryDocument['status'];
}

export interface StoryRepository {
  load(): StoryDocument;
  save(story: StoryDocument): void;
  listProjects(): ProjectSummary[];
  switchProject(projectId: string): StoryDocument;
  replaceActiveProject(story: StoryDocument): StoryDocument;
  importProject(story: StoryDocument): StoryDocument;
}

interface ProjectLibrary {
  version: 1;
  projects: StoryDocument[];
}

export class LocalStoryRepository implements StoryRepository {
  private projects: StoryDocument[] = [];
  private activeProjectId = '';

  constructor(private readonly storage: ProjectLibraryStorage) {}

  load(): StoryDocument {
    const rawProjects = this.storage.readProjects();
    if (rawProjects !== null) {
      const parsed = JSON.parse(rawProjects) as Partial<ProjectLibrary>;
      if (!parsed || !Array.isArray(parsed.projects)) {
        throw new Error('本地项目库索引损坏：缺少 projects 数组。');
      }
      const projects = parsed.projects.map((project, index) => {
        const story = sanitizeStory(project);
        if (!story) throw new Error(`本地项目库中第 ${index + 1} 个项目结构损坏。`);
        return story;
      });
      if (!projects.length) throw new Error('本地项目库为空。可从其他设备导入项目，或创建一个示例项目。');
      this.projects = projects;
      const activeId = this.storage.readActiveProjectId();
      const activeProject = projects.find((project) => project.id === activeId) ?? projects[0];
      this.activeProjectId = activeProject.id;
      this.storage.writeActiveProjectId(this.activeProjectId);
      return activeProject;
    }

    const starter = this.migrateLegacyStory();
    this.persistLibrary();
    return starter;
  }

  save(story: StoryDocument): void {
    const index = this.projects.findIndex((project) => project.id === story.id);
    const saved = { ...story, updatedAt: new Date().toISOString() };
    if (index >= 0) this.projects[index] = saved;
    else this.projects.push(saved);
    this.activeProjectId = saved.id;
    this.persistLibrary();
  }

  listProjects(): ProjectSummary[] {
    return [...this.projects]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map(({ id, title, updatedAt, status }) => ({ id, title, updatedAt, status }));
  }

  switchProject(projectId: string): StoryDocument {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('要切换的项目不存在。');
    this.activeProjectId = project.id;
    this.storage.writeActiveProjectId(project.id);
    return project;
  }

  replaceActiveProject(story: StoryDocument): StoryDocument {
    this.projects = this.projects.filter((project) => project.id !== this.activeProjectId);
    return this.importProject(story);
  }

  importProject(story: StoryDocument): StoryDocument {
    const titles = this.projects.map((project) => project.title);
    const projectId = createId('project');
    const imported: StoryDocument = {
      ...story,
      id: projectId,
      title: createProjectImportName(story.title, titles),
      updatedAt: new Date().toISOString(),
    };
    this.projects.push(imported);
    this.activeProjectId = projectId;
    this.persistLibrary();
    return imported;
  }

  private migrateLegacyStory(): StoryDocument {
    const raw = this.storage.readLegacyStory();
    let legacy: StoryDocument | null = null;
    if (raw) {
      try {
        legacy = sanitizeStory(JSON.parse(raw));
      } catch {
        legacy = null;
      }
    }
    const story = legacy ?? createStarterStory();
    this.projects = [story];
    this.activeProjectId = story.id;
    this.storage.writeActiveProjectId(story.id);
    return story;
  }

  private persistLibrary(): void {
    const library: ProjectLibrary = { version: 1, projects: this.projects };
    this.storage.writeProjects(JSON.stringify(library));
    this.storage.writeActiveProjectId(this.activeProjectId);
  }
}
