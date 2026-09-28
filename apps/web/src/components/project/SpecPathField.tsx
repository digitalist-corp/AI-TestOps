import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Info } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

/** Playwright 가 테스트를 찾는 기준 폴더. playwright.config.ts 의 testDir 와 같아야 한다. */
const TEST_DIR = 'tests';
const NEW_FOLDER = '__new__';

/** 서버(AiChatToolService.normalizeSpecPath)와 같은 규칙으로 경로를 맞춘다. */
export function normalizeSpecPath(folder: string, fileName: string): string {
  const cleanFolder = folder
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^\.\//, '');
  let cleanFile = fileName.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanFile) return '';
  if (!/\.(spec|test)\.(ts|js)$/.test(cleanFile)) {
    cleanFile = `${cleanFile.replace(/\.(ts|js)$/, '')}.spec.ts`;
  }
  const withFolder = cleanFolder ? `${cleanFolder}/${cleanFile}` : cleanFile;
  return withFolder.startsWith(`${TEST_DIR}/`) ? withFolder : `${TEST_DIR}/${withFolder}`;
}

/** 기존 spec 경로들에서 실제로 쓰이고 있는 폴더를 뽑는다. */
function foldersOf(specPaths: string[]): string[] {
  const folders = new Set<string>([TEST_DIR]);
  for (const path of specPaths) {
    const normalized = path.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash > 0) {
      folders.add(normalized.slice(0, lastSlash));
    }
  }
  return [...folders].sort();
}

/**
 * 새 spec 파일을 어디에 만들지 고르는 입력.
 *
 * 예전에는 "tests/checkout.spec.ts" 를 통째로 직접 적게 했다. 그러면 tests/ 를 빠뜨려
 * Playwright 가 찾지 못하는 자리에 파일이 생기거나, 폴더를 미리 만들어야 하는 줄 알고 막힌다.
 * 폴더와 파일 이름을 나누고 최종 경로를 미리 보여주어 그 두 가지를 없앤다.
 */
export function SpecPathField({
  specPaths,
  value,
  onChange,
}: {
  specPaths: string[];
  value: string;
  onChange: (path: string) => void;
}) {
  const folders = useMemo(() => foldersOf(specPaths), [specPaths]);
  const [folder, setFolder] = useState(TEST_DIR);
  const [newFolder, setNewFolder] = useState('');
  const [fileName, setFileName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const effectiveFolder = creatingFolder ? newFolder : folder;
  const preview = normalizeSpecPath(effectiveFolder, fileName);

  // 입력이 바뀔 때마다 정규화된 최종 경로를 부모에게 올린다.
  useEffect(() => {
    onChange(preview);
    // onChange 는 부모에서 매 렌더 새로 만들어질 수 있어 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  // 다이얼로그가 닫히며 값이 비워지면 입력도 초기 상태로 되돌린다.
  useEffect(() => {
    if (value === '') {
      setFileName('');
      setNewFolder('');
      setCreatingFolder(false);
      setFolder(TEST_DIR);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const isNewFolder = creatingFolder && newFolder.trim().length > 0
    && !folders.includes(normalizeFolderForCompare(newFolder));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 @min-[26rem]:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">폴더</label>
          {creatingFolder ? (
            <Input
              autoFocus
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="tests/checkout"
              className="font-mono text-xs"
            />
          ) : (
            <select
              value={folder}
              onChange={(e) => {
                if (e.target.value === NEW_FOLDER) {
                  setCreatingFolder(true);
                  setNewFolder(`${TEST_DIR}/`);
                  return;
                }
                setFolder(e.target.value);
              }}
              className="h-10 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ai-accent"
            >
              {folders.map((item) => (
                <option key={item} value={item}>
                  {item}/
                </option>
              ))}
              <option value={NEW_FOLDER}>+ 새 폴더 직접 입력</option>
            </select>
          )}
          {creatingFolder && (
            <button
              type="button"
              onClick={() => setCreatingFolder(false)}
              className="text-[11px] text-muted-foreground underline underline-offset-2"
            >
              기존 폴더에서 고르기
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">파일 이름</label>
          <Input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="checkout"
            className="font-mono text-xs"
            required
          />
        </div>
      </div>

      <div className="rounded-sm border border-border bg-muted/40 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          만들어질 파일
        </p>
        <p className={cn('mt-0.5 font-mono text-xs', preview ? 'text-foreground' : 'text-muted-foreground')}>
          {preview || '파일 이름을 입력하세요'}
        </p>
        {isNewFolder && (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ai-accent">
            <FolderPlus className="h-3 w-3" />
            새 폴더라 자동으로 만들어집니다. 미리 만들 필요 없습니다.
          </p>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          Playwright 는 <span className="font-mono">tests/</span> 안의{' '}
          <span className="font-mono">.spec.ts</span> 파일만 테스트로 인식합니다. 그래서 경로가 자동으로
          맞춰집니다. 폴더를 나눠 두면 나중에 그 폴더만 골라 실행할 수 있습니다.
        </span>
      </p>
    </div>
  );
}

function normalizeFolderForCompare(folder: string) {
  return folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
