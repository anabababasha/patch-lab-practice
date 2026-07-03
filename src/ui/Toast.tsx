import { useEffect } from 'react';
import { useApp } from '../app/store';

export function Toast() {
  const toast = useApp((s) => s.ui.toast);
  const dismiss = useApp((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismiss, 2600);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className="pl-toast" role="status">
      {toast.msg}
    </div>
  );
}
