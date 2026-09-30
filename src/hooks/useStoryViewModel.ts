import { useEffect, useState } from 'react';
import { LocalStoryRepository } from '../repositories/storyRepository';
import { BrowserProjectLibraryStorage } from '../services/storageService';
import { StoryViewModel } from '../viewmodels/storyViewModel';

const viewModel = new StoryViewModel(new LocalStoryRepository(new BrowserProjectLibraryStorage()));

export function useStoryViewModel(): StoryViewModel {
  const [, refresh] = useState(0);
  useEffect(() => {
    const unsubscribe = viewModel.subscribe(() => refresh((value) => value + 1));
    viewModel.initialize();
    return unsubscribe;
  }, []);
  return viewModel;
}
