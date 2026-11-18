import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api, setStoredAuth } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { BrandLogo } from '@/components/BrandLogo';

/** 기본 비밀번호(admin)로 들어온 계정은 여기서 비밀번호를 바꿔야 다른 화면을 쓸 수 있다 (3-1 보안). */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) {
      setError('새 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.changePassword(form.current, form.next);
      setStoredAuth({ token: res.token, username: res.username, role: res.role });
      navigate('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : '비밀번호를 바꾸지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-card px-6 py-12 dark:bg-transparent">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="flex items-center gap-3">
          <BrandLogo size={40} />
          <span className="text-[19px] font-bold tracking-tight text-foreground">AI-TestOps</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-2">
          <h2 className="text-[24px] font-bold leading-[1.3] text-foreground">비밀번호 바꾸기</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            처음 정해진 비밀번호를 쓰고 있습니다. 바꾼 뒤에 계속할 수 있습니다.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">현재 비밀번호</Label>
              <Input
                id="current-password"
                type="password"
                value={form.current}
                onChange={set('current')}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">새 비밀번호</Label>
              <Input
                id="new-password"
                type="password"
                value={form.next}
                onChange={set('next')}
                autoComplete="new-password"
                minLength={10}
                required
              />
              <p className="text-[13px] text-muted-foreground">10자 이상, admin 은 쓸 수 없습니다</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password-confirm">새 비밀번호 확인</Label>
              <Input
                id="new-password-confirm"
                type="password"
                value={form.confirm}
                onChange={set('confirm')}
                autoComplete="new-password"
                required
              />
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-sm border border-destructive bg-destructive/10 px-3.5 py-2.5 text-[15px] text-destructive"
              >
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '비밀번호 바꾸기'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
