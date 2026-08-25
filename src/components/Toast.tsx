import { CheckCircle, Info, Warning, X, XCircle } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';

const icons = {
  success: CheckCircle,
  warning: Warning,
  danger: XCircle,
  neutral: Info,
};

export function Toast() {
  const toast = useAppStore((state) => state.toast);
  const showToast = useAppStore((state) => state.showToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => showToast(null), 4400);
    return () => window.clearTimeout(timer);
  }, [toast, showToast]);

  if (!toast) return null;
  const ToneIcon = icons[toast.tone];
  return (
    <div className={`toast toast-${toast.tone}`} role="status">
      <ToneIcon size={20} weight="fill" />
      <span>{toast.message}</span>
      <button type="button" aria-label="关闭通知" onClick={() => showToast(null)}>
        <X size={16} />
      </button>
    </div>
  );
}
