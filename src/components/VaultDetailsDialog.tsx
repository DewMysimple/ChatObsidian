import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  ArrowSquareOut,
  Copy,
  FolderOpen,
  Heart,
  Note,
  Path,
  ShieldCheck,
  X,
} from '@phosphor-icons/react';
import { useState } from 'react';
import type { VaultRecord } from '../contracts/desktop';
import { desktop } from '../lib/desktop';
import { displayWindowsPath } from '../lib/pathDisplay';
import { useAppStore } from '../store/appStore';

interface VaultDetailsDialogProps {
  vault: VaultRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenVault: (vault: VaultRecord) => void;
}

export function VaultDetailsDialog({ vault, open, onOpenChange, onOpenVault }: VaultDetailsDialogProps) {
  const patchVault = useAppStore((state) => state.patchVault);
  const showToast = useAppStore((state) => state.showToast);
  const [displayName, setDisplayName] = useState(vault?.displayName ?? '');
  const [groupName, setGroupName] = useState(vault?.groupName ?? '');
  const [tags, setTags] = useState(vault?.tags.join('、') ?? '');

  if (!vault) return null;
  const save = () => {
    void patchVault(vault.id, {
      displayName: displayName.trim() || vault.name,
      groupName: groupName.trim() || vault.groupName,
      tags: tags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean),
    });
    onOpenChange(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDisplayName(vault.displayName);
          setGroupName(vault.groupName);
          setTags(vault.tags.join('、'));
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content vault-details">
          <div className="details-heading">
            <div className="vault-glyph large"><Note size={24} weight="duotone" /></div>
            <div>
              <Dialog.Title>{vault.displayName}</Dialog.Title>
              <Dialog.Description>{vault.groupName}</Dialog.Description>
            </div>
          </div>

          <div className="details-stats">
            <div><Note size={17} /><span>笔记</span><strong>{vault.noteCount.toLocaleString()}</strong></div>
            <div><ShieldCheck size={17} /><span>配置</span><strong>{vault.configState === 'synced' ? '一致' : '有差异'}</strong></div>
            <div><Path size={17} /><span>状态</span><strong>{vault.health === 'healthy' ? '有效' : '路径异常'}</strong></div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>显示名称</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label className="field">
              <span>管理器分组</span>
              <input value={groupName} onChange={(event) => setGroupName(event.target.value)} />
            </label>
            <label className="field form-span-2">
              <span>标签</span>
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用顿号或逗号分隔" />
            </label>
          </div>

          <div className="path-box">
            <span>{displayWindowsPath(vault.path)}</span>
            <button
              type="button"
              aria-label="复制路径"
              onClick={() => {
                void navigator.clipboard.writeText(displayWindowsPath(vault.path));
                showToast({ tone: 'success', message: '仓库路径已复制' });
              }}
            ><Copy size={16} /></button>
          </div>

          <div className="details-actions-grid">
            <button className="button primary" type="button" onClick={() => onOpenVault(vault)}><ArrowSquareOut size={17} />打开仓库</button>
            <button className="button secondary" type="button" onClick={() => void desktop.openLocalPath(vault.path)}><FolderOpen size={17} />资源管理器</button>
            <button className="button secondary" type="button" onClick={() => void patchVault(vault.id, { favorite: !vault.favorite })}><Heart size={17} weight={vault.favorite ? 'fill' : 'regular'} />{vault.favorite ? '取消收藏' : '加入收藏'}</button>
            <button className="button secondary" type="button" onClick={() => void patchVault(vault.id, { archived: !vault.archived })}><Archive size={17} />{vault.archived ? '恢复显示' : '归档仓库'}</button>
            <button className="button secondary" type="button" onClick={() => void patchVault(vault.id, { hidden: !vault.hidden })}>{vault.hidden ? '取消隐藏' : '从列表隐藏'}</button>
          </div>

          <div className="dialog-actions">
            <Dialog.Close asChild><button className="button secondary" type="button">取消</button></Dialog.Close>
            <button className="button primary" type="button" onClick={save}>保存修改</button>
          </div>
          <Dialog.Close className="dialog-close" aria-label="关闭"><X size={17} /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
