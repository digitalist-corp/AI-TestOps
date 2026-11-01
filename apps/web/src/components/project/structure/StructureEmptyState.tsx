import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileCode2, Globe, Loader2, MousePointerClick, Network, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const CHOICE_CLASS =
  'flex h-full flex-col items-start gap-1.5 rounded-lg border border-border bg-card p-4 text-left transition-colors';
const CHOICE_ENABLED = 'cursor-pointer hover:border-primary hover:bg-primary-subtle';
const CHOICE_DISABLED = 'cursor-not-allowed bg-muted/40 text-muted-foreground';

function ChoiceBody({ icon, title, description, hint, disabled }: {
  icon: ReactNode;
  title: string;
  description: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-muted', disabled ? 'text-muted-foreground' : 'text-primary')}>
        {icon}
      </span>
      <span className={cn('text-sm font-semibold', disabled ? 'text-muted-foreground' : 'text-foreground')}>{title}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      {hint && <span className="mt-auto pt-1 text-xs text-warning">{hint}</span>}
    </>
  );
}

/**
 * 화면을 하나도 못 찾았을 때 가운데에 보이는 카드. 그래프 대신 화면을 찾는 방법 세 가지를 고르게 한다.
 * 분석이 돌고 있으면 제목만 바꾸고, 분석을 다시 시작하는 두 선택지는 잠근다.
 */
export function StructureEmptyState({
  projectId,
  running,
  urlRun,
  busy,
  siteReady,
  sourceHint,
  onFindBySite,
  onFindByCode,
  onAddNode,
}: {
  projectId: string;
  running: boolean;
  /** 돌고 있는 분석이 사이트 탐색인지 (코드 분석이 아닌지) */
  urlRun: boolean;
  busy: boolean;
  /** 대상 사이트 주소가 입력돼 있다 */
  siteReady: boolean;
  /** 코드로 찾을 수 없는 이유. 찾을 수 있으면 null */
  sourceHint: string | null;
  onFindBySite: () => void;
  onFindByCode: () => void;
  onAddNode?: () => void;
}) {
  const locked = busy || running;
  const siteDisabled = locked || !siteReady;
  const codeDisabled = locked || sourceHint != null;

  return (
    <section
      className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-card px-6 py-10 text-center"
      data-testid="structure-empty"
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {running ? <Loader2 className="h-7 w-7 animate-spin" /> : <Network className="h-7 w-7" />}
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">
        {running ? '화면을 찾고 있습니다' : '아직 찾은 화면이 없습니다'}
      </h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        {running
          ? urlRun
            ? '대상 사이트를 열어 링크를 따라가며 화면 · 버튼을 모으고 있습니다. 클릭이나 폼 제출은 하지 않으며 최대 3분 걸립니다.'
            : '저장소를 받아 화면을 찾고 있습니다. 화면 하나에 10초쯤 걸립니다.'
          : '테스트할 앱에 어떤 화면과 버튼이 있는지 찾아 두면 여기에 지도로 보입니다. 찾는 방법을 골라 주세요.'}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 text-left @3xl:grid-cols-3">
        <button
          type="button"
          disabled={siteDisabled}
          onClick={onFindBySite}
          className={cn(CHOICE_CLASS, siteDisabled ? CHOICE_DISABLED : CHOICE_ENABLED)}
        >
          <ChoiceBody
            icon={running && urlRun ? <Loader2 className="h-5 w-5 animate-spin" /> : <Globe className="h-5 w-5" />}
            title="사이트 주소로 화면 찾기"
            description="자동으로 링크를 따라가며 화면 · 버튼을 수집합니다. 1~3분 걸립니다."
            hint={siteReady ? undefined : '프로젝트 설정에서 대상 사이트 주소를 먼저 입력하세요'}
            disabled={siteDisabled}
          />
        </button>

        <button
          type="button"
          disabled={codeDisabled}
          onClick={onFindByCode}
          className={cn(CHOICE_CLASS, codeDisabled ? CHOICE_DISABLED : CHOICE_ENABLED)}
        >
          <ChoiceBody
            icon={running && !urlRun ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileCode2 className="h-5 w-5" />}
            title="저장소 코드로 화면 찾기"
            description="React Router · Next.js 코드를 분석합니다."
            hint={sourceHint ?? undefined}
            disabled={codeDisabled}
          />
        </button>

        <Link to={`/projects/${projectId}/recorder`} className={cn(CHOICE_CLASS, CHOICE_ENABLED)}>
          <ChoiceBody
            icon={<MousePointerClick className="h-5 w-5" />}
            title="직접 클릭해서 테스트 만들기"
            description="사이트를 직접 눌러 보면 그 흐름을 테스트로 녹화합니다."
          />
        </Link>

        {onAddNode && (
          <button
            type="button"
            onClick={onAddNode}
            className={cn(CHOICE_CLASS, CHOICE_ENABLED)}
          >
            <ChoiceBody
              icon={<Plus className="h-5 w-5" />}
              title="화면 직접 추가하기"
              description="URL 경로를 적어 새 화면 노드를 즉시 지도에 추가합니다."
            />
          </button>
        )}
      </div>
    </section>
  );
}
