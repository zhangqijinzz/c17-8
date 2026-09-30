/**
 * 浏览器文件下载：导出时生成一个 Blob 并触发另存。
 * 读取用户选择的文件直接使用浏览器原生的 File.text()，无需再包一层。
 */

export interface ProjectFileService {
  downloadText(fileName: string, content: string, mime?: string): void;
}

export class BrowserProjectFileService implements ProjectFileService {
  downloadText(fileName: string, content: string, mime = 'text/markdown;charset=utf-8'): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
