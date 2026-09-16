import { useEffect, useState } from "react";
import { ArrowClockwise, ClockCounterClockwise } from "@phosphor-icons/react";
import { desktop } from "../lib/desktop";
import type { OperationRecord } from "../contracts/desktop";
import { readableError } from "../lib/workspace";

export function HistoryView() {
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      setRecords(await desktop.listOperations());
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="document-page">
      <header className="page-heading">
        <div className="page-emblem">
          <ClockCounterClockwise size={44} weight="light" />
        </div>
        <h1>活动记录</h1>
        <p>查看仓库扫描与打开请求，旧版本记录也保留在这里。</p>
      </header>
      <button className="button" onClick={() => void load()} disabled={busy}>
        <ArrowClockwise size={16} />
        刷新记录
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="activity-list">
        {!busy && !records.length && (
          <div className="empty-state">还没有活动记录。</div>
        )}
        {records.map((record) => (
          <article key={record.id}>
            <span
              className={`status-dot ${record.status === "failed" ? "failed" : "online"}`}
            />
            <div>
              <h3>{record.title}</h3>
              <p>{record.detail}</p>
              <small>
                {new Date(record.createdAt).toLocaleString("zh-CN")} ·{" "}
                {
                  {
                    running: "进行中",
                    success: "已完成",
                    failed: "失败",
                    rolled_back: "已回滚",
                  }[record.status]
                }
              </small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
