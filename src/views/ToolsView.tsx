import * as Dialog from '@radix-ui/react-dialog';
import { ArrowClockwise, CheckCircle, FileCode, FolderOpen, Play, TerminalWindow, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { ScriptRunPreview, ScriptTool } from '../contracts/desktop';
import { desktop } from '../lib/desktop';
import { displayWindowsPath } from '../lib/pathDisplay';
import { useAppStore } from '../store/appStore';

export function ToolsView() {
  const [scripts, setScripts] = useState<ScriptTool[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScriptTool | null>(null);
  const [preview, setPreview] = useState<ScriptRunPreview | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const showToast = useAppStore((state) => state.showToast);
  const load = () => void desktop.listScripts().then(setScripts);
  useEffect(load, []);

  const prepare = async (script: ScriptTool) => {
    setSelected(script);
    setPreview(null);
    setPreviewError(null);
    setPreviewing(script.id);
    try {
      setPreview(await desktop.previewScriptRun(script.id));
    } catch (error) {
      setPreviewError(String(error));
    } finally {
      setPreviewing(null);
    }
  };

  const run = async () => {
    if (!selected || !preview?.ready || running) return;
    const script = selected;
    setRunning(script.id);
    try {
      const operation = await desktop.runScript(script.id);
      showToast({ tone: 'success', message: operation.detail });
      setSelected(null);
      load();
    } catch (error) {
      showToast({ tone: 'danger', message: `无法启动脚本：${String(error)}` });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="tools-page page-stack">
      <section className="tool-intro">
        <div><TerminalWindow size={28} weight="duotone" /><span><strong>原脚本保持不变</strong><small>通过 Windows Terminal 启动并保留 input() 交互；ChatObsidian 只记录运行状态和本地日志。</small></span></div>
        <button className="button secondary" type="button" onClick={load}><ArrowClockwise size={17} />刷新状态</button>
      </section>
      <section className="script-table panel">
        <header className="script-header"><span>脚本</span><span>用途</span><span>路径状态</span><span>最近运行</span><span>操作</span></header>
        {scripts.map((script) => (
          <div className="script-row" key={script.id}>
            <span className="script-name"><span className="script-icon"><FileCode size={19} /></span><strong>{script.name}</strong></span>
            <span className="script-description">{script.description}</span>
            <span className={`script-status ${script.exists ? 'valid' : 'missing'}`}>{script.exists ? <CheckCircle size={16} weight="fill" /> : <WarningCircle size={16} weight="fill" />}{script.exists ? '文件有效' : '文件缺失'}</span>
            <span className="script-last">{script.lastRun ? `${script.lastRun.status === 'success' ? '成功' : script.lastRun.status} · ${formatTime(script.lastRun.createdAt)}` : '尚未运行'}</span>
            <span className="script-actions">
              {script.lastRun?.logPath ? <button type="button" aria-label="打开日志" onClick={() => void desktop.openLocalPath(script.lastRun!.logPath!)}><FolderOpen size={17} /></button> : null}
              <button className="button small primary" type="button" onClick={() => void prepare(script)} disabled={!script.exists || previewing === script.id || running !== null}><Play size={15} weight="fill" />{previewing === script.id ? '检查中' : '运行'}</button>
            </span>
          </div>
        ))}
      </section>
      <div className="script-note"><WarningCircle size={18} /><span>终端中的确认与回滚仍由原脚本负责。关闭终端不会修改脚本文件。</span></div>
      <ScriptRunDialog
        script={selected}
        preview={preview}
        error={previewError}
        running={running !== null}
        onOpenChange={(open) => {
          if (!open && !running) {
            setSelected(null);
            setPreview(null);
            setPreviewError(null);
          }
        }}
        onConfirm={() => void run()}
      />
    </div>
  );
}

function ScriptRunDialog({ script, preview, error, running, onOpenChange, onConfirm }: {
  script: ScriptTool | null;
  preview: ScriptRunPreview | null;
  error: string | null;
  running: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={script !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content script-run-dialog">
          <div className="details-heading">
            <span className="dialog-symbol"><TerminalWindow size={24} weight="duotone" /></span>
            <div><Dialog.Title>确认运行工具</Dialog.Title><Dialog.Description>{script?.name}</Dialog.Description></div>
          </div>
          {!preview && !error ? <div className="script-preview-loading"><ArrowClockwise className="spin" size={20} /><span>正在检查脚本与运行环境…</span></div> : null}
          {error ? <div className="script-preview-issues"><WarningCircle size={18} /><span>预检失败：{error}</span></div> : null}
          {preview ? (
            <>
              <p className="script-preview-description">{preview.description}</p>
              <dl className="script-preview-grid">
                <div><dt>脚本</dt><dd>{displayWindowsPath(preview.scriptPath)}</dd></div>
                <div><dt>Python</dt><dd>{preview.pythonPath ? displayWindowsPath(preview.pythonPath) : '未找到'}<small>{preview.pythonVersion}</small></dd></div>
                <div><dt>工作目录</dt><dd>{displayWindowsPath(preview.workingDirectory)}</dd></div>
                <div><dt>终端</dt><dd>{preview.terminal}</dd></div>
                <div><dt>日志目录</dt><dd>{displayWindowsPath(preview.logDirectory)}</dd></div>
              </dl>
              <div className="script-interactive-note"><TerminalWindow size={18} /><span>这是交互式脚本，终端会保留，可继续使用 <code>input()</code> 输入。</span></div>
              {preview.issues.length ? <div className="script-preview-issues"><WarningCircle size={18} /><span>{preview.issues.join('；')}</span></div> : null}
            </>
          ) : null}
          <div className="dialog-actions">
            <button className="button secondary" type="button" onClick={() => onOpenChange(false)} disabled={running}>取消</button>
            <button className="button primary" type="button" onClick={onConfirm} disabled={!preview?.ready || running}>
              {running ? <ArrowClockwise className="spin" size={16} /> : <Play size={16} weight="fill" />}
              {running ? '正在启动…' : '确认并在终端运行'}
            </button>
          </div>
          <Dialog.Close className="dialog-close" aria-label="关闭" disabled={running}><X size={17} /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatTime(value: number) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value); }
