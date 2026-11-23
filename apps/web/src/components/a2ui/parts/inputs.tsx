import { useId } from 'react';
import { z } from 'zod';
import { CommonSchemas } from '@a2ui/web_core/v1_0';
import { createComponentImplementation } from '@a2ui/react';
import { objectList, text } from './common';

/**
 * A2UI 카탈로그 부품 — 입력(여러 개 고르기 · 하나 고르기 · 짧은 입력).
 * 모두 기본 HTML 입력 요소를 써서 라벨 연결 · 키보드 조작(Tab, Space, 화살표)과
 * 전역 포커스 링(index.css 의 :focus-visible)을 그대로 얻는다.
 * 감싸는 `<fieldset disabled>` 가 있으면 함께 잠긴다.
 */

interface Option {
  id: string;
  title: string;
  detail: string;
  badge: string;
}

function options(value: unknown): Option[] {
  return objectList(value)
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({
      id: item.id as string,
      title: text(item.title),
      detail: text(item.detail),
      badge: text(item.badge),
    }));
}

/** CheckList · ChoiceList 가 함께 쓰는 한 줄. 고른 줄은 테두리 · 배경으로 알 수 있게 한다. */
function OptionRow({
  type,
  name,
  option,
  checked,
  onChange,
}: {
  type: 'checkbox' | 'radio';
  name?: string;
  option: Option;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2 text-xs transition-colors hover:bg-muted/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary-subtle/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:hover:bg-transparent">
        <input
          type={type}
          name={name}
          value={option.id}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-foreground">{option.title}</span>
            {option.badge && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{option.badge}</span>
            )}
          </span>
          {option.detail && <span className="text-muted-foreground">{option.detail}</span>}
        </span>
      </label>
    </li>
  );
}

export const CheckList = createComponentImplementation(
  {
    name: 'CheckList',
    schema: z.object({ items: CommonSchemas.DynamicValue, value: CommonSchemas.DynamicStringList }),
  },
  ({ props }) => {
    const selected = Array.isArray(props.value) ? props.value : [];
    const toggle = (id: string, checked: boolean) => {
      const next = checked ? [...selected.filter((s) => s !== id), id] : selected.filter((s) => s !== id);
      props.setValue(next);
    };
    return (
      <ul className="flex flex-col gap-1.5">
        {options(props.items).map((option) => (
          <OptionRow
            key={option.id}
            type="checkbox"
            option={option}
            checked={selected.includes(option.id)}
            onChange={(checked) => toggle(option.id, checked)}
          />
        ))}
      </ul>
    );
  }
);

function ChoiceListView({ items, value, setValue }: { items: unknown; value: unknown; setValue: (v: string) => void }) {
  // 같은 name 의 라디오끼리 화살표 키로 오간다. 화면에 여러 개가 있어도 섞이지 않게 고유 이름을 쓴다.
  const name = useId();
  return (
    <ul role="radiogroup" className="flex flex-col gap-1.5">
      {options(items).map((option) => (
        <OptionRow
          key={option.id}
          type="radio"
          name={name}
          option={option}
          checked={value === option.id}
          onChange={(checked) => checked && setValue(option.id)}
        />
      ))}
    </ul>
  );
}

export const ChoiceList = createComponentImplementation(
  {
    name: 'ChoiceList',
    schema: z.object({ items: CommonSchemas.DynamicValue, value: CommonSchemas.DynamicString }),
  },
  ({ props }) => <ChoiceListView items={props.items} value={props.value} setValue={props.setValue} />
);

function TextInputView({
  label,
  value,
  placeholder,
  multiline,
  setValue,
}: {
  label: string;
  value: unknown;
  placeholder?: string;
  multiline?: boolean;
  setValue: (v: string) => void;
}) {
  const id = useId();
  const className =
    'w-full rounded-sm border border-border bg-background px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-70';
  const common = {
    id,
    value: text(value),
    placeholder,
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    className,
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      {multiline ? <textarea rows={3} {...common} className={`${className} resize-y`} /> : <input type="text" {...common} />}
    </div>
  );
}

export const TextInput = createComponentImplementation(
  {
    name: 'TextInput',
    schema: z.object({
      label: z.string(),
      value: CommonSchemas.DynamicString,
      placeholder: z.string().optional(),
      multiline: z.boolean().optional(),
    }),
  },
  ({ props }) => (
    <TextInputView
      label={props.label}
      value={props.value}
      placeholder={props.placeholder}
      multiline={props.multiline}
      setValue={props.setValue}
    />
  )
);
