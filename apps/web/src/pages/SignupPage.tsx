import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api, setStoredAuth } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { BrandLogo } from '@/components/BrandLogo';

/** 회원가입: 누구나 가입하고 가입 즉시 팀원이 된다. 프로젝트는 PM이 초대하면 보인다. */
export function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', name: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.signup(form.username, form.name, form.password);
      setStoredAuth({ token: res.token, username: res.username, role: res.role });
      navigate('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : '가입에 실패했습니다.');
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
          <h2 className="text-[24px] font-bold leading-[1.3] text-foreground">회원가입</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            가입하면 팀원으로 들어갑니다. 프로젝트는 PM이 초대하면 보입니다.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-username">아이디</Label>
              <Input id="signup-username" value={form.username} onChange={set('username')} autoComplete="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-name">이름</Label>
              <Input id="signup-name" value={form.name} onChange={set('name')} autoComplete="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">비밀번호</Label>
              <Input
                id="signup-password"
                type="password"
                value={form.password}
                onChange={set('password')}
                autoComplete="new-password"
                minLength={10}
                required
              />
              <p className="text-[13px] text-muted-foreground">10자 이상</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-confirm">비밀번호 확인</Label>
              <Input
                id="signup-confirm"
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
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '가입하기'}
            </Button>
          </form>

          <p className="mt-5 border-t border-border pt-5 text-center text-[15px] text-muted-foreground">
            이미 계정이 있나요?{' '}
            <Link to="/login" className="font-bold text-primary hover:underline">
              로그인
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
