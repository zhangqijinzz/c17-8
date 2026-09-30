export function downloadTextFile(filename: string, content: string, type = 'text/markdown;charset=utf-8'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

export function safeProjectFilename(title: string): string {
  const clean = title.trim().replace(/[\\/:*?"<>|#]+/g, '-').replace(/\s+/g, '-');
  return `${clean || 'story-project'}.story.md`;
}
