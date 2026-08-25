import { ArrowClockwise, CheckCircle, Clock, FolderOpen, TerminalWindow, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { OperationRecord } from '../contracts/desktop';
import { desktop } from '../lib/desktop';
import { useAppStore } from '../store/appStore';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function HistoryView() {
  const initial = useAppStore((state) => state.operations);
  const showToast = useAppStore((state) => state.showToast);
  const [operations, setOperations] = useState<OperationRecord[]>(initial);
  const [rollback, setRollback] = useState<OperationRecord | null>(null);
  const load = () => void desktop.refreshScriptRuns().then(() => desktop.listOperations()).then(setOperations);
  useEffect(load, []);

  const restore = async () => {
    if (!rollback) return;
    try {
      const result = await desktop.rollbackOperation(rollback.id);
      showToast({ tone: 'success', message: result.detail });
      load();
    } catch (error) {
      showToast({ tone: 'danger', message: `回滚失败：${String(error)}` });
    }
  };

  return (
    <div className="history-page page-stack">
      <section className="history-summary metric-strip">
        <div className="metric"><span>全部任务</span><strong>{operations.length}</strong><small>本地审计记录</small></div>
        <div className="metric"><span>同步与恢复</span><strong>{operations.filter((item) => item.kind === 'sync' || item.kind === 'rollback').length}</strong><small>含增量备份</small></div>
        <div className="metric"><span>脚本运行</span><strong>{operations.filter((item) => item.kind === 'script').length}</strong><small>外部终端任务</small></div>
        <div className="metric"><span>失败</span><strong>{operations.filter((item) => item.status === 'failed').length}</strong><small>可查看具体原因</small></div>
      </section>
      <section className="panel operation-list">
        <header className="operation-header"><div><small>OPERATION LOG</small><h2>最近任务</h2></div><button className="button secondary" type="button" onClick={load}><ArrowClockwise size={17} />刷新</button></header>
        {operations.length ? operations.map((operation) => <OperationRow key={operation.id} operation={operation} onRollback={() => setRollback(operation)} />) : <div className="empty-state compact"><Clock size={30} /><strong>还没有任务记录</strong><span>扫描、同步与脚本运行会出现在这里。</span></div>}
      </section>
      <ConfirmDialog open={rollback !== null} onOpenChange={(open) => { if (!open) setRollback(null); }} title="回滚这次同步" description="将按照备份清单恢复被覆盖或删除的文件，并移除同步时新增的文件。Obsidian 必须保持关闭。" confirmLabel="开始回滚" tone="danger" onConfirm={() => void restore()} />
    </div>
  );
}

function OperationRow({ operation, onRollback }: { operation: OperationRecord; onRollback: () => void }) {
  const Icon = operation.kind === 'script' ? TerminalWindow : operation.status === 'failed' ? WarningCircle : CheckCircle;
  return <div className="operation-row"><span className={`operation-icon ${operation.status}`}><Icon size={19} weight="fill" /></span><span className="operation-copy"><strong>{operation.title}</strong><small>{operation.detail}</small></span><span className={`operation-status ${operation.status}`}>{statusLabel(operation.status)}</span><time>{new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(operation.createdAt)}</time><span className="operation-actions">{operation.logPath ? <button type="button" onClick={() => void desktop.openLocalPath(operation.logPath!)}><FolderOpen size={17} />日志</button> : null}{operation.canRollback && operation.status === 'success' ? <button type="button" onClick={onRollback}><ArrowClockwise size={17} />回滚</button> : null}</span></div>;
}

function statusLabel(status: string) { return status === 'success' ? '成功' : status === 'failed' ? '失败' : status === 'running' ? '运行中' : '已回滚'; }
