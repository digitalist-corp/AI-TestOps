import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, RotateCcw, X } from 'lucide-react';
import { api, type RecorderApi } from '@/api/client';
import type { Project, RecordedStep } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useRecorderSession } from '@/hooks/useRecorderSession';
import { moveStep, removeStep, renameStep, type RecorderMode } from '@/lib/recorder';
import { RecorderSaveBar } from '@/components/project/recorder/RecorderSaveBar';
import { RecorderScreen } from '@/components/project/recorder/RecorderScreen';
import { RecorderStartPanel } from '@/components/project/recorder/RecorderStartPanel';
import { RecorderStepList } from '@/components/project/recorder/RecorderStepList';
import { RecorderToolbar } from '@/components/project/recorder/RecorderToolbar';

/** 개발 서버에서만: 주소에 ?recorderMock=1 이 있으면 서버 없이 가짜 응답으로 화면을 본다. */
function wantsMock(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('recorderMock') === '1';
}

type RecorderTabProps = {
  project: Project;
  /** 테스트 파일을 저장했을 때: 파일 · 케이스 목록을 새로 읽는 데 쓴다 */
  onSaved: () => void;
  onOpenTests: () => void;
  onRun: (specPath: string, title: string) => void;
};

/**
 * "클릭으로 만들기" 탭. 테스트할 사이트를 원격 브라우저로 열어 직접 클릭 · 입력하면
 * 그 흐름이 Playwright 테스트 파일로 저장된다. AI 없이 동작한다.
 *
 * 탭을 떠나면(언마운트) 세션을 끝내므로, 부모는 projectId 를 key 로 넘겨 프로젝트가 바뀔 때 새로 만든다.
 */
export function RecorderTab(props: RecorderTabProps) {
  const [mockWanted] = useState(wantsMock);
  const [mockApi, setMockApi] = useState<RecorderApi | null>(null);

  // 가짜 응답은 개발 서버에서만 불러온다. 이 분기는 운영 빌드에서 통째로 사라진다.
  useEffect(() => {
    if (import.meta.env.DEV && mockWanted) {
      void import('@/lib/recorderMock').then((m) => setMockApi(m.recorderMockApi));
    }
  }, [mockWanted]);

  const rec = mockWanted ? mockApi : api.recorder;
  if (!rec) return null;
  return <RecorderTabBody {...props} rec={rec} mock={mockWanted} />;
}

function RecorderTabBody({
  project,
  rec,
  mock,
  onSaved,
  onOpenTests,
  onRun,
}: RecorderTabProps & { rec: RecorderApi; mock: boolean }) {
  const session = useRecorderSession(project.projectId, rec);
  const [mode, setMode] = useState<RecorderMode>('click');

  const { state } = session;

  const mockBadge = mock && (
    <Badge variant="warning" className="mb-3">
      개발용 가짜 응답 모드 — 서버에 연결하지 않아요
    </Badge>
  );

  // 아직 세션이 없다: 시작 화면
  if (!state) {
    return (
      <div>
        {mockBadge}
        <RecorderStartPanel
          project={project}
          starting={session.starting}
          error={session.error}
          onStart={session.start}
        />
      </div>
    );
  }

  // 브라우저를 띄우는 중
  if (state.status === 'STARTING') {
    return (
      <div>
        {mockBadge}
        <Card className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-10 text-center" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">브라우저를 준비하는 중… (처음에는 30초 정도)</p>
          <p className="text-xs text-muted-foreground">준비가 끝나면 화면이 바로 나타나요.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void session.close()}>
            <X className="h-3.5 w-3.5" /> 취소
          </Button>
        </Card>
      </div>
    );
  }

  // 서버가 시작에 실패
  if (state.status === 'ERROR') {
    return (
      <div>
        {mockBadge}
        <Card className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-10 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium text-foreground">녹화를 시작하지 못했어요</p>
          <p role="alert" className="break-words text-xs text-muted-foreground">
            {state.error || '알 수 없는 오류가 났어요.'}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void session.retry()}>
              <RotateCcw className="h-3.5 w-3.5" /> 다시 시도
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void session.close()}>
              처음으로
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const closed = state.status === 'CLOSED';
  const editDisabled = session.isLocked || closed || state.status !== 'READY';

  const edit = (next: RecordedStep[]) => {
    // 바뀐 게 없으면(맨 끝에서 더 옮기기 · 같은 설명) 서버를 부르지 않는다.
    if (next !== state.steps) void session.saveSteps(next);
  };

  const endRecording = (hasUnsaved: boolean) => {
    if (hasUnsaved && !confirm('저장하지 않은 단계가 있어요. 그래도 녹화를 끝낼까요?')) return;
    void session.close();
  };

  return (
    <div className="space-y-4">
      {mockBadge}

      {session.error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          <span className="min-w-0 break-words">{session.error}</span>
          <button
            type="button"
            onClick={session.clearError}
            aria-label="오류 닫기"
            className="shrink-0 cursor-pointer rounded-sm p-0.5 hover:bg-destructive/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <RecorderToolbar
            mode={mode}
            onModeChange={setMode}
            onPressEnter={() => void session.send({ type: 'press', key: 'Enter' })}
            disabled={editDisabled}
          />
          <RecorderScreen
            state={state}
            screenshotUrl={session.screenshotUrl}
            busy={session.busy}
            locked={session.isLocked}
            mode={mode}
            inspected={session.inspected}
            onSend={session.send}
            onInspect={session.inspect}
            onClearInspected={session.clearInspected}
            onRestart={() => void session.retry()}
          />
        </div>

        <RecorderStepList
          steps={state.steps}
          disabled={editDisabled}
          saving={session.savingSteps}
          onMove={(id, direction) => edit(moveStep(state.steps, id, direction))}
          onRemove={(id) => edit(removeStep(state.steps, id))}
          onRename={(id, label) => edit(renameStep(state.steps, id, label))}
        />
      </div>

      <RecorderSaveBar
        key={state.sessionId}
        rec={rec}
        projectId={project.projectId}
        sessionId={state.sessionId}
        steps={state.steps}
        disabled={editDisabled}
        onSaved={onSaved}
        onOpenTests={onOpenTests}
        onRun={onRun}
        onEnd={endRecording}
      />
    </div>
  );
}
