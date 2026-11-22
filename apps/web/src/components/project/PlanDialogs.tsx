import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { PRIORITY_LABEL } from '@/lib/plan';
import { PLAN_TITLE_ERROR, parsePlanPaste, planMemberName, planScreenName, validPlanTitle, type PlanScreen } from '@/lib/planPaste';
import type { PlanEntryInput, PlanItem, PlanLinkSuggestion, PlanLinkTarget, PlanPriority, ProjectMember } from '@/types';

type DialogProps = { projectId: string; onClose: () => void; onChanged: () => Promise<void> };
type Options = { screens: PlanScreen[]; members: ProjectMember[] };
const fieldClass = 'w-full rounded-md border border-border bg-card px-3 py-2 text-sm';
const fieldLabel = 'space-y-1 text-sm font-medium';
const MAX_BULK_ENTRIES = 200;

export function planError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function PlanDialog({ title, description, onClose, busy, wide, children }: {
  title: string; description: string; onClose: () => void; busy?: boolean; wide?: boolean; children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className={wide ? 'max-w-4xl' : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function usePlanSubmit({ onChanged, onClose }: DialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (write: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await write();
      await onChanged();
      onClose();
    } catch (e) {
      setError(planError(e, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

export function AddPlanDialog(props: DialogProps & Options) {
  const { screens, members, projectId, onClose } = props;
  const { busy, error, submit } = usePlanSubmit(props);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState('');

  return (
    <PlanDialog title="계획 추가" description="테스트로 만들기 전에 확인할 항목을 계획에 추가해요." onClose={onClose} busy={busy}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (!validPlanTitle(title)) {
          setTitleError(PLAN_TITLE_ERROR);
          return;
        }
        const fields = new FormData(event.currentTarget);
        const entry: PlanEntryInput = {
          title: title.trim(),
          screenRouteKey: String(fields.get('screen') || '') || null,
          assigneeUserId: Number(fields.get('assignee')) || null,
          dueDate: String(fields.get('dueDate') || '') || null,
          priority: (fields.get('priority') || null) as PlanPriority | null,
          expected: String(fields.get('expected') || '').trim() || null,
        };
        void submit(() => api.plan.create(projectId, entry));
      }}>
        <label className={`col-span-2 ${fieldLabel}`}>
          제목
          <Input value={title} required maxLength={200} aria-invalid={!!titleError}
                 onPaste={(e) => {
                   if (/[@\r\n\u2028\u2029]/.test(e.clipboardData.getData('text'))) {
                     e.preventDefault();
                     setTitleError(PLAN_TITLE_ERROR);
                   }
                 }}
                 onChange={(e) => {
                   if (!e.target.value || validPlanTitle(e.target.value) || !e.target.value.trim()) {
                     setTitle(e.target.value);
                     setTitleError('');
                   } else {
                     setTitleError(PLAN_TITLE_ERROR);
                   }
                 }} />
        </label>
        {titleError && <p role="alert" className="col-span-2 text-xs text-destructive">{titleError}</p>}
        <label className={fieldLabel}>
          화면
          <select name="screen" className={fieldClass}>
            <option value="">미지정</option>
            {screens.map((node) => <option key={node.routeKey} value={node.routeKey}>{planScreenName(node)}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>
          담당자
          <select name="assignee" className={fieldClass}>
            <option value="">미지정</option>
            {members.map((member) => <option key={member.userId} value={member.userId}>{planMemberName(member)}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>
          마감일
          <Input type="date" name="dueDate" />
        </label>
        <label className={fieldLabel}>
          우선순위
          <select name="priority" className={fieldClass}>
            <option value="">없음</option>
            {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={`col-span-2 ${fieldLabel}`}>
          확인할 내용
          <textarea name="expected" rows={3} className={fieldClass} />
        </label>
        {error && <p role="alert" className="col-span-2 text-sm text-destructive">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>취소</Button>
          <Button type="submit" disabled={busy || !validPlanTitle(title) || !!titleError}>계획 추가</Button>
        </div>
      </form>
    </PlanDialog>
  );
}

export function PastePlanDialog(props: DialogProps & Options) {
  const { projectId, screens, members, onClose } = props;
  const { busy, error, submit } = usePlanSubmit(props);
  const [text, setText] = useState('');
  const rows = useMemo(() => parsePlanPaste(text, screens, members), [text, screens, members]);

  return (
    <PlanDialog title="엑셀에서 붙여넣기"
                description="제목, 화면, 담당자, 마감일, 우선순위, 확인할 내용 순서로 복사한 표를 붙여넣으세요."
                onClose={onClose} busy={busy} wide>
      <textarea aria-label="붙여넣을 표" rows={5} className={fieldClass} value={text} onChange={(e) => setText(e.target.value)} />
      {rows.length > 0 && (
        <div className="mt-3 max-h-64 overflow-auto rounded-md border border-border">
          <table aria-label="추가할 계획 미리보기" className="w-full text-left text-sm [&_td]:p-2 [&_th]:p-2">
            <thead className="bg-muted">
              <tr>{['제목', '화면', '담당자', '마감일', '우선순위', '확인할 내용', '입력 확인'].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_BULK_ENTRIES).map(({ entry, warnings }, index) => {
                const node = screens.find((screen) => screen.routeKey === entry.screenRouteKey);
                const member = members.find((candidate) => candidate.userId === entry.assigneeUserId);
                return (
                  <tr key={index} className="border-t border-border">
                    <td>{entry.title || '—'}</td>
                    <td>{node ? planScreenName(node) : '—'}</td>
                    <td>{member ? planMemberName(member) : '—'}</td>
                    <td>{entry.dueDate ?? '—'}</td>
                    <td>{entry.priority ? PRIORITY_LABEL[entry.priority] : '—'}</td>
                    <td className="whitespace-pre-wrap">{entry.expected ?? '—'}</td>
                    <td className="text-muted-foreground">{warnings.join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > MAX_BULK_ENTRIES && <p role="alert" className="mt-2 text-sm text-destructive">한 번에 200건까지 추가할 수 있어요.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>취소</Button>
        <Button disabled={busy || !rows.length || rows.length > MAX_BULK_ENTRIES || rows.some((row) => row.invalidTitle)}
                onClick={() => void submit(() => api.plan.bulkCreate(projectId, rows.map((row) => row.entry)))}>
          {rows.length}건 추가
        </Button>
      </div>
    </PlanDialog>
  );
}

const caseName = (item: PlanItem) => [item.describePath, item.title].filter(Boolean).join(' › ');
const caseKey = (target: PlanLinkTarget) => JSON.stringify([target.specPath, target.grep]);

export function LinkPlanDialog(props: DialogProps & { plan: PlanItem; candidates: PlanItem[] }) {
  const { projectId, plan, candidates, onClose } = props;
  const { busy, error, submit } = usePlanSubmit(props);
  const [value, setValue] = useState('');
  const target = candidates.find((item) => caseKey(item) === value);
  return (
    <PlanDialog title="기존 테스트 연결" description={`‘${plan.title}’에 연결할 테스트를 고르세요.`} onClose={onClose} busy={busy}>
      {candidates.length ? (
        <label className={fieldLabel}>
          연결할 테스트
          <select className={fieldClass} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">테스트 선택</option>
            {candidates.map((item) => <option key={caseKey(item)} value={caseKey(item)}>{caseName(item)} ({item.specPath})</option>)}
          </select>
        </label>
      ) : <p className="text-sm text-muted-foreground">연결할 수 있는 기존 테스트가 없어요.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>취소</Button>
        <Button disabled={busy || !target} onClick={() => {
          const { planId } = plan;
          if (planId == null || !target) return;
          const { specPath, grep } = target;
          void submit(() => api.plan.link(projectId, planId, { specPath, grep }));
        }}>연결</Button>
      </div>
    </PlanDialog>
  );
}

export function PlanSuggestionsDialog({ projectId, onClose, onChanged, items, aiOff }: DialogProps & { items: PlanItem[]; aiOff: boolean }) {
  const [suggestions, setSuggestions] = useState<PlanLinkSuggestion[] | null>(null);
  const [selected, setSelected] = useState<PlanLinkSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (aiOff) return;
    let active = true;
    api.plan.linkSuggestions(projectId)
      .then((result) => { if (active) setSuggestions(result.suggestions); })
      .catch((e) => {
        if (active) setError(planError(e, 'AI 연결 추천을 불러오지 못했어요. 프로젝트의 AI 설정을 확인해 주세요.'));
      });
    return () => { active = false; };
  }, [aiOff, projectId]);

  const planFor = (row: PlanLinkSuggestion) => items.find((item) => item.planId === row.planId);
  const available = (row: PlanLinkSuggestion) => planFor(row)?.stage === 'UNWRITTEN'
    && items.some((item) => item.stage === 'WRITTEN' && item.planId == null && caseKey(item) === caseKey(row));
  const applicable = selected.filter(available);

  const apply = async () => {
    setBusy(true);
    setError('');
    const failed: PlanLinkSuggestion[] = [];
    for (const suggestion of applicable) {
      const { planId, specPath, grep } = suggestion;
      try {
        await api.plan.link(projectId, planId, { specPath, grep });
      } catch {
        failed.push(suggestion);
      }
    }
    setSuggestions((rows) => rows?.filter((row) => !applicable.includes(row) || failed.includes(row)) ?? []);
    setSelected(failed);
    await onChanged();
    if (failed.length) setError(`${failed.length}건을 연결하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.`);
    else onClose();
    setBusy(false);
  };

  return (
    <PlanDialog title="AI 연결 추천" description="관련 있는 계획과 기존 테스트를 확인하고 연결할 항목을 고르세요."
                onClose={onClose} busy={busy}>
      {aiOff && <p role="alert" className="text-sm text-destructive">AI가 꺼져 있어요. AI를 켠 뒤 다시 시도해 주세요.</p>}
      {!aiOff && !suggestions && !error && <p role="status" className="text-sm text-muted-foreground">연결할 테스트를 찾고 있어요…</p>}
      {suggestions?.length === 0 && <p className="text-sm text-muted-foreground">추천할 연결이 없어요.</p>}
      <ul className="space-y-2">
        {suggestions?.map((row, index) => {
          const checked = selected.includes(row);
          const conflict = applicable.some((other) => other.planId === row.planId || caseKey(other) === caseKey(row));
          const plan = planFor(row);
          const canLink = available(row);
          return (
            <li key={index}>
              <label className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
                <input type="checkbox" className="mt-1 accent-primary" checked={checked}
                       disabled={aiOff || busy || (!checked && (conflict || !canLink))}
                       onChange={() => setSelected((rows) => checked ? rows.filter((item) => item !== row) : [...rows, row])} />
                <span>
                  <span className="font-medium">{plan?.title ?? `계획 ${row.planId}`} ↔ {row.caseTitle}</span>
                  <span className="block text-muted-foreground">{row.reason}</span>
                  {!canLink && <span className="block text-muted-foreground">현재 연결할 수 없어요.</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>닫기</Button>
        <Button onClick={() => void apply()} disabled={busy || aiOff || !applicable.length}>선택한 {applicable.length}건 연결</Button>
      </div>
    </PlanDialog>
  );
}
