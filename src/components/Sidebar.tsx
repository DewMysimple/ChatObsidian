import {
  Archive,
  CaretDown,
  ClockCounterClockwise,
  GearSix,
  MagnifyingGlass,
  Plus,
  Star,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { desktop } from "../lib/desktop";
import { CollectionDialog } from "./DatabaseDialogs";
import appIcon from "../../assets/app-icon.svg";

export function Sidebar() {
  const { view, collectionId, scope, workspace, navigate, setView } =
    useAppStore();
  const [create, setCreate] = useState(false);
  const count = (id: string) =>
    workspace?.items.filter(
      (item) => item.collectionId === id && !item.archived,
    ).length ?? 0;
  return (
    <aside className="sidebar">
      <div className="workspace-brand">
        <img src={appIcon} alt="" />
        <div>
          <strong>ChatObsidian</strong>
          <span>个人工作空间</span>
        </div>
        <CaretDown size={13} />
      </div>
      <button
        className="sidebar-search"
        onClick={() => void desktop.showQuickSwitcher("additive")}
      >
        <MagnifyingGlass size={18} />
        <span>搜索与快速打开</span>
        <kbd>Ctrl K</kbd>
      </button>
      <nav aria-label="工作空间导航">
        <div className="nav-section-label">工作空间</div>
        {workspace?.collections.map((collection) => (
          <button
            key={collection.id}
            className={`nav-item ${view === "database" && collectionId === collection.id && scope === "all" ? "is-active" : ""}`}
            onClick={() => navigate(collection.id)}
          >
            <span className="nav-icon">{collection.icon}</span>
            <span>{collection.name}</span>
            <span className="nav-count">{count(collection.id)}</span>
          </button>
        ))}
        <button
          className="nav-item nav-add"
          disabled={!workspace}
          onClick={() => setCreate(true)}
        >
          <Plus size={17} />
          <span>新建数据库</span>
        </button>
        <div className="nav-section-label second">整理</div>
        <button
          className={`nav-item ${scope === "favorites" && view === "database" ? "is-active" : ""}`}
          onClick={() => navigate(collectionId, "favorites")}
        >
          <Star size={18} />
          <span>我的收藏</span>
        </button>
        <button
          className={`nav-item ${scope === "archive" && view === "database" ? "is-active" : ""}`}
          onClick={() => navigate(collectionId, "archive")}
        >
          <Archive size={18} />
          <span>已归档</span>
        </button>
        <button
          className={`nav-item ${view === "history" ? "is-active" : ""}`}
          onClick={() => setView("history")}
        >
          <ClockCounterClockwise size={18} />
          <span>活动记录</span>
        </button>
      </nav>
      <div className="sidebar-bottom">
        <button
          className={`nav-item ${view === "settings" ? "is-active" : ""}`}
          onClick={() => setView("settings")}
        >
          <GearSix size={18} />
          <span>设置</span>
          <span className="nav-version">0.1.14</span>
        </button>
        <div className="sidebar-user">
          <span className="user-avatar">我</span>
          <div>
            <strong>我的工作空间</strong>
            <small>保存在这台电脑上</small>
          </div>
          <span className="status-dot online" />
        </div>
      </div>
      {create && <CollectionDialog onClose={() => setCreate(false)} />}
    </aside>
  );
}
