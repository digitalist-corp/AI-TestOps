import { Fragment, type ReactNode } from 'react';
import { z } from 'zod';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v1_0';
import { createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react';
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * 첫 실행 브리핑 카탈로그 `onboarding/v1` (docs/design/onboarding-briefing-contract.md).
 * 서버가 보낸 A2UI v1.0 메시지의 컴포넌트를 우리 화면 부품으로 그린다.
 *
 * 렌더러가 컴포넌트마다 `display: contents` 인 host 요소를 끼워 넣으므로,
 * 자식 사이 간격은 margin(`space-y-*`)이 아니라 flex `gap` 으로 준다.
 */
export const ONBOARDING_CATALOG_ID = 'https://playops.dev/a2ui/catalogs/onboarding/v1';

/** 정적 목록이면 id 문자열, 데이터 템플릿이면 `{ id }` 로 풀린다. 계약은 정적 목록만 쓴다. */
function renderChildren(children: unknown, buildChild: (id: string, basePath?: string) => ReactNode) {
  if (!Array.isArray(children)) return null;
  return children.map((child, index) => {
    if (typeof child === 'string') return <Fragment key={child}>{buildChild(child)}</Fragment>;
    const ref = child as { id?: string; basePath?: string };
    return ref?.id ? <Fragment key={`${ref.id}-${index}`}>{buildChild(ref.id, ref.basePath)}</Fragment> : null;
  });
}

/** 데이터 모델에서 온 목록을 화면에 쓸 수 있는 항목만 남긴다. 서버 내용이 어긋나도 화면이 깨지지 않게 한다. */
function objectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    : [];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const Column = createComponentImplementation(
  { name: 'Column', schema: z.object({ children: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => <div className="flex flex-col gap-3">{renderChildren(props.children, buildChild)}</div>
);

const Section = createComponentImplementation(
  { name: 'Section', schema: z.object({ title: z.string(), children: CommonSchemas.ChildList }) },
  ({ props, buildChild }) => (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <h3 className="text-sm font-bold text-foreground">{props.title}</h3>
      {renderChildren(props.children, buildChild)}
    </section>
  )
);

const TextView = createComponentImplementation(
  {
    name: 'Text',
    schema: z.object({ text: CommonSchemas.DynamicString, variant: z.enum(['body', 'muted']).optional() }),
  },
  ({ props }) => (
    <p className={cn('text-xs leading-relaxed', props.variant === 'muted' ? 'text-muted-foreground' : 'text-foreground')}>
      {text(props.text)}
    </p>
  )
);

const NOTICE_TONES = {
  info: { icon: Info, className: 'bg-info/10 text-info' },
  success: { icon: CheckCircle2, className: 'bg-success/10 text-success' },
  warning: { icon: TriangleAlert, className: 'bg-warning/10 text-warning' },
  danger: { icon: XCircle, className: 'bg-destructive/10 text-destructive' },
} as const;

const Notice = createComponentImplementation(
  {
    name: 'Notice',
    schema: z.object({
      text: CommonSchemas.DynamicString,
      tone: z.enum(['info', 'success', 'warning', 'danger']),
    }),
  },
  ({ props }) => {
    const tone = NOTICE_TONES[props.tone] ?? NOTICE_TONES.info;
    const Icon = tone.icon;
    return (
      <div role="status" className={cn('flex items-start gap-2 rounded px-2.5 py-2 text-xs', tone.className)}>
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{text(props.text)}</span>
      </div>
    );
  }
);

const ScreenList = createComponentImplementation(
  { name: 'ScreenList', schema: z.object({ items: CommonSchemas.DynamicValue }) },
  ({ props }) => {
    const items = objectList(props.items);
    if (items.length === 0) return null;
    return (
      <ul className="flex flex-col gap-1 rounded-lg bg-muted/40 p-2 text-xs">
        {items.map((item, index) => (
          <li key={`${text(item.path)}-${index}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-foreground">{text(item.title)}</span>
            <span className="break-all font-mono text-[11px] text-muted-foreground">{text(item.path)}</span>
            {text(item.note) && <span className="w-full text-muted-foreground">{text(item.note)}</span>}
          </li>
        ))}
      </ul>
    );
  }
);

const CheckList = createComponentImplementation(
  {
    name: 'CheckList',
    schema: z.object({ items: CommonSchemas.DynamicValue, value: CommonSchemas.DynamicStringList }),
  },
  ({ props }) => {
    const items = objectList(props.items).filter((item) => typeof item.id === 'string');
    const selected = Array.isArray(props.value) ? props.value : [];
    const toggle = (id: string, checked: boolean) => {
      const next = checked ? [...selected.filter((s) => s !== id), id] : selected.filter((s) => s !== id);
      props.setValue(next);
    };
    return (
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const id = item.id as string;
          return (
            <li key={id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2 text-xs hover:bg-muted/40 has-[:disabled]:cursor-not-allowed">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                  checked={selected.includes(id)}
                  onChange={(e) => toggle(id, e.target.checked)}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-foreground">{text(item.title)}</span>
                    {text(item.badge) && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {text(item.badge)}
                      </span>
                    )}
                  </span>
                  {text(item.detail) && <span className="text-muted-foreground">{text(item.detail)}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    );
  }
);

const ButtonView = createComponentImplementation(
  {
    name: 'Button',
    schema: z.object({
      label: z.string(),
      variant: z.enum(['primary', 'outline']).optional(),
      action: CommonSchemas.Action,
    }),
  },
  ({ props }) => (
    <div className="flex justify-end">
      <Button
        type="button"
        size="sm"
        variant={props.variant === 'outline' ? 'outline' : 'default'}
        onClick={() => void props.action()}
      >
        {props.label}
      </Button>
    </div>
  )
);

export const onboardingCatalog = new Catalog<ReactCatalogComponent>(ONBOARDING_CATALOG_ID, '1.0', [
  Column,
  Section,
  TextView,
  Notice,
  ScreenList,
  CheckList,
  ButtonView,
]);
