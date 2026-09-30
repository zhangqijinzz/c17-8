const LEGACY_STORAGE_KEY = 'story-architect.document.v1';
const PROJECTS_STORAGE_KEY = 'story-architect.projects.v1';
const ACTIVE_PROJECT_KEY = 'story-architect.active-project.v1';

export interface StorageService {
  read(): string | null;
  write(value: string): void;
}

export interface ProjectLibraryStorage {
  readLegacyStory(): string | null;
  readProjects(): string | null;
  writeProjects(value: string): void;
  readActiveProjectId(): string | null;
  writeActiveProjectId(value: string): void;
}

export class BrowserStorageService implements StorageService {
  read(): string | null {
    return window.localStorage.getItem(LEGACY_STORAGE_KEY);
  }

  write(value: string): void {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, value);
  }
}

export class BrowserProjectLibraryStorage implements ProjectLibraryStorage {
  readLegacyStory(): string | null {
    return window.localStorage.getItem(LEGACY_STORAGE_KEY);
  }

  readProjects(): string | null {
    return window.localStorage.getItem(PROJECTS_STORAGE_KEY);
  }

  writeProjects(value: string): void {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, value);
  }

  readActiveProjectId(): string | null {
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  }

  writeActiveProjectId(value: string): void {
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, value);
  }
}

export class MemoryStorageService implements StorageService, ProjectLibraryStorage {
  private legacyValue: string | null = null;
  private projectsValue: string | null = null;
  private activeProjectId: string | null = null;

  read(): string | null {
    return this.legacyValue;
  }

  write(value: string): void {
    this.legacyValue = value;
  }

  readLegacyStory(): string | null {
    return this.legacyValue;
  }

  readProjects(): string | null {
    return this.projectsValue;
  }

  writeProjects(value: string): void {
    this.projectsValue = value;
  }

  readActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  writeActiveProjectId(value: string): void {
    this.activeProjectId = value;
  }
}
