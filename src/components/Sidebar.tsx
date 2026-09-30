import { useRef, type ChangeEventHandler } from 'react';
import type { ImportReport } from '../viewmodels/storyViewModel';
import type { StoryViewModel } from '../viewmodels/storyViewModel';
import type { StoryStats } from '../models/story';

interface SidebarProps {
  viewModel: StoryViewModel;
  stats: StoryStats;
}

export function Sidebar({ viewModel, stats }: SidebarProps) {
  const { story, projects, activeSection, importReport } = viewModel.snapshot;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickImportFile = () => fileInputRef.current?.click();
  const onFileChosen: ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0];
    if (file) void viewModel.importFile(() => file.text(), file.name);
    event.target.value = '';
  };

  return (
    <aside className="sidebar">
      <input ref={fileInputRef} type="file" accept=".md,.markdown,.json,text/markdown,application/json" className="hidden-file-input" onChange={onFileChosen} aria-label="选择要导入的项目文件" />
      <div className="brand"><span className="brand-mark">✦</span><span>StoryArchitect</span></div>
      <div className="project-switcher">
        <span className="eyebrow">当前项目（共 {projects.length} 个）</span>
        <select
          className="project-select"
          aria-label="切换项目"
          value={story?.id ?? ''}
          onChange={(event) => viewModel.switchProject(event.target.value)}
        >
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
        <div className="project-actions">
          <button className="sidebar-action" onClick={() => viewModel.downloadProject()}>⇩ 导出项目</button>
          <button className="sidebar-action" onClick={pickImportFile}>⇧ 导入项目</button>
        </div>
        {importReport && <ReportCard report={importReport} onClose={() => viewModel.dismissImportReport()} />}
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

function ReportCard({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  if (report.kind === 'failure') {
    return (
      <div className="import-report failure" role="alert">
        <div className="import-report-head"><strong>导入失败</strong><button onClick={onClose} aria-label="关闭导入报告">×</button></div>
        <p>文件未通过检查，没有改动任何现有项目。</p>
        <ul>{report.errors.map((message, index) => <li key={`error-${index}`}>{message}</li>)}</ul>
        {report.warnings.length > 0 && (
          <details>
            <summary>另有 {report.warnings.length} 条修复说明</summary>
            <ul>{report.warnings.map((message, index) => <li key={`warning-${index}`}>{message}</li>)}</ul>
          </details>
        )}
      </div>
    );
  }
  return (
    <div className="import-report success" role="status">
      <div className="import-report-head"><strong>导入成功</strong><button onClick={onClose} aria-label="关闭导入报告">×</button></div>
      <p>已作为新项目「{report.title ?? ''}」导入并切换，原来的项目保持不变。</p>
      {report.warnings.length > 0 && (
        <details open={report.warnings.length <= 3}>
          <summary>{report.warnings.length} 条自动修复（点击折叠）</summary>
          <ul>{report.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
