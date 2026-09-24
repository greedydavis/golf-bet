import { useQueryClient } from '@tanstack/react-query';
import { useState, useTransition } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '@/app/auth';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 非 https 環境（例如區網 IP）沒有 clipboard API，改用舊方法
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* 使用者取消 */
      }
    }
    window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="mt-4 flex gap-2">
      <button type="button" className="btn-secondary flex-1" onClick={copy}>
        {copied ? '✓ 已複製' : '複製結算文字'}
      </button>
      <button type="button" className="btn flex-1 bg-[#06C755] text-white" onClick={share}>
        分享到 LINE
      </button>
    </div>
  );
}

export function DeleteRoundButton({ id }: { id: number }) {
  const navigate = useNavigate();
  const api = useApi();
  const qc = useQueryClient();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-danger w-full"
      disabled={pending}
      onClick={() => {
        if (!confirm('確定刪除這場球局？刪除後無法復原。')) return;
        start(async () => {
          try {
            await api.deleteRound(id);
          } catch (e) {
            return alert((e as Error).message);
          }
          qc.invalidateQueries({ queryKey: ['rounds'] });
          qc.invalidateQueries({ queryKey: ['players'] });
          navigate('/history', { replace: true });
        });
      }}
    >
      刪除這場球局
    </button>
  );
}
