import { useRef } from 'react';
import type { StoryStats } from '../models/story';
import { downloadTextFile, readTextFile, safeProjectFilename } from '../services/fileService';
import type { StoryViewModel } from '../viewmodels/storyViewModel';

interface SidebarProps {
  viewModel: StoryViewModel;
  stats: StoryStats;
}

export function Sidebar({ viewModel, stats }: SidebarProps) {
  const { story, activeSection, projects } = viewModel.snapshot;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = () => {
    if (!story) return;
    try {
      downloadTextFile(safeProjectFilename(story.title), viewModel.exportCurrentProject());
    } catch {
      alert('导出失败，请确认浏览器允许下载文件。');
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await readTextFile(file);
      viewModel.importProjectFile(content);
    } catch {
      alert(`文件「${file.name}」读取失败，请确认它是 UTF-8 文本文件。`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✦</span><span>StoryArchitect</span></div>
      <div className="project-switcher">
        <span className="eyebrow">当前项目</span>
        <strong>{story?.title ?? '正在加载…'}</strong>
        <span className="project-dot" />
        <select
          aria-label="切换项目"
          value={story?.id ?? ''}
          onChange={(event) => viewModel.switchProject(event.target.value)}
        >
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
        <div className="project-file-actions">
          <button type="button" onClick={handleExport}>⇩ 导出</button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>⇧ 导入</button>
        </div>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          onChange={(event) => void handleImportFile(event.target.files?.[0])}
        />
      </div>
      <nav className="side-nav" aria-label="主要导航">
        <button className={activeSection === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => viewModel.setSection('overview')}><span>◈</span>故事总览</button>
        <button className={activeSection === 'characters' ? 'nav-item active' : 'nav-item'} onClick={() => viewModel.setSection('characters')}><span>♧</span>人物关系</button>
        <button className={activeSection === 'clues' ? 'nav-item active' : 'nav-item'} onClick={() => viewModel.setSection('clues')}><span>⌁</span>伏笔关系</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="mini-progress"><div><span>结构完成度</span><b>{stats.completion}%</b></div><div className="progress-track"><span style={{ width: `${stats.completion}%` }} /></div></div>
        <button className="reset-link" onClick={() => viewModel.resetProject()}>↻ 恢复示例项目</button>
        <span className="saved-state">● 本地自动保存</span>
      </div>
    </aside>
  );
}
