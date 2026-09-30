import { characterColors, type StoryDocument, type StoryScene, type StoryStats } from './story';

export function orderedScenes(story: StoryDocument): StoryScene[] {
  return [...story.scenes].sort((a, b) => a.order - b.order);
}

export function getStats(story: StoryDocument): StoryStats {
  const unresolvedClues = story.clues.filter((clue) => clue.payoffSceneId === '').length;
  const totalSignals = story.characters.length + story.scenes.length + story.clues.length;
  const completedSignals = story.characters.length + story.scenes.length + (story.clues.length - unresolvedClues);
  const completion = totalSignals === 0 ? 0 : Math.round((completedSignals / totalSignals) * 100);
  return {
    characters: story.characters.length,
    scenes: story.scenes.length,
    clues: story.clues.length,
    unresolvedClues,
    completion,
  };
}

export function validateName(value: string): string {
  const cleanValue = value.trim();
  return cleanValue.length < 2 ? '至少输入 2 个字' : cleanValue;
}

export function getTimelineWarning(story: StoryDocument): string | null {
  const orders = story.scenes.map((scene) => scene.order);
  return new Set(orders).size !== orders.length ? '时间线存在重复顺序，请重新排列。' : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function sanitizeStory(input: unknown): StoryDocument | null {
  if (!isObjectRecord(input)) return null;
  if (
    input.version !== 1 ||
    typeof input.id !== 'string' ||
    typeof input.title !== 'string' ||
    (input.status !== 'draft' && input.status !== 'complete') ||
    typeof input.selectedSceneId !== 'string' ||
    typeof input.updatedAt !== 'string' ||
    !Array.isArray(input.characters) ||
    !Array.isArray(input.scenes) ||
    !Array.isArray(input.clues)
  ) {
    return null;
  }

  const characters = input.characters.every((character) =>
    isObjectRecord(character) &&
    typeof character.id === 'string' &&
    typeof character.name === 'string' &&
    typeof character.role === 'string' &&
    typeof character.color === 'string' &&
    characterColors.includes(character.color as typeof characterColors[number])
  );
  const scenes = input.scenes.every((scene) =>
    isObjectRecord(scene) &&
    typeof scene.id === 'string' &&
    typeof scene.title === 'string' &&
    typeof scene.order === 'number' &&
    typeof scene.summary === 'string' &&
    typeof scene.conflict === 'string' &&
    isStringArray(scene.characterIds) &&
    isStringArray(scene.clueIds)
  );
  const clues = input.clues.every((clue) =>
    isObjectRecord(clue) &&
    typeof clue.id === 'string' &&
    typeof clue.title === 'string' &&
    typeof clue.setupSceneId === 'string' &&
    typeof clue.payoffSceneId === 'string'
  );

  return characters && scenes && clues ? input as StoryDocument : null;
}
