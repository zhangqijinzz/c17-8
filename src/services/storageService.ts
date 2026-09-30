/** 单项目时代使用的 key，读取注册表失败时用于一次性迁移。 */
const LEGACY_STORAGE_KEY = 'story-architect.document.v1';
/** 多项目注册表：{ activeId, projects: StoryDocument[] }。 */
const REGISTRY_STORAGE_KEY = 'story-architect.registry.v1';

export interface StorageService {
  readLegacy(): string | null;
  readRegistry(): string | null;
  writeRegistry(value: string): void;
}

export class BrowserStorageService implements StorageService {
  readLegacy(): string | null {
    return window.localStorage.getItem(LEGACY_STORAGE_KEY);
  }

  readRegistry(): string | null {
    return window.localStorage.getItem(REGISTRY_STORAGE_KEY);
  }

  writeRegistry(value: string): void {
    window.localStorage.setItem(REGISTRY_STORAGE_KEY, value);
  }
}

export class MemoryStorageService implements StorageService {
  private registry: string | null = null;
  private legacy: string | null = null;

  readLegacy(): string | null {
    return this.legacy;
  }

  readRegistry(): string | null {
    return this.registry;
  }

  writeRegistry(value: string): void {
    this.registry = value;
  }

  /** 测试辅助：模拟单项目时代遗留的数据。 */
  seedLegacy(value: string): void {
    this.legacy = value;
  }
}
