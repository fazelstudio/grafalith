import './primitives.css';
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { useId, useRef } from 'react';
import { SearchIcon } from '../icons';

/** Button variants by semantic role; sizes map to control tokens. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'secondary', size = 'md', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={`ui-button ui-button--${variant} ui-button--${size} ${props.className ?? ''}`.trim()}
    />
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
  variant?: 'plain' | 'secondary';
  active?: boolean;
}

/** Icon-only control; `label` is the accessible name and tooltip source. */
export function IconButton({ label, size = 'md', variant = 'plain', active, ...props }: IconButtonProps) {
  return (
    <span className="ui-tooltip-wrap">
      <button
        type="button"
        aria-label={label}
        {...props}
        className={
          `ui-icon-button ui-icon-button--${size} ui-icon-button--${variant}` +
          `${active ? ' ui-icon-button--active' : ''} ${props.className ?? ''}`
        }
      />
      <span className="ui-tooltip" role="presentation">
        {label}
      </span>
    </span>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function TextInput({ label, id: idProp, ...props }: TextInputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <span style={{ display: 'block', width: '100%' }}>
      {label ? (
        <label htmlFor={id} style={{ display: 'block', font: 'var(--font-label)', marginBottom: 'var(--space-xs)' }}>
          {label}
        </label>
      ) : null}
      <input id={id} {...props} className={`ui-input ${props.className ?? ''}`.trim()} />
    </span>
  );
}

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function SearchInput({ label, inputRef, ...props }: SearchInputProps) {
  return (
    <span className="ui-search-wrap">
      <SearchIcon size={14} />
      <input
        type="search"
        aria-label={label}
        ref={inputRef}
        {...props}
        className="ui-input"
        placeholder={props.placeholder}
      />
    </span>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: readonly SelectOption[];
}

export function Select({ label, options, id: idProp, ...props }: SelectProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <span style={{ display: 'block', width: '100%' }}>
      <label htmlFor={id} style={{ display: 'block', font: 'var(--font-label)', marginBottom: 'var(--space-xs)' }}>
        {label}
      </label>
      <select id={id} {...props} className="ui-select">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Single-select control with radiogroup semantics and arrow-key support. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + delta + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <span style={{ display: 'block' }}>
      <span style={{ display: 'block', font: 'var(--font-label)', marginBottom: 'var(--space-xs)' }}>{label}</span>
      <span className="ui-segmented" role="radiogroup" aria-label={label}>
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            title={option.title ?? option.label}
            tabIndex={option.value === value ? 0 : -1}
            className="ui-segmented__option"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </span>
    </span>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

export function Switch({ label, checked, onChange, description }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="ui-switch" onClick={() => onChange(!checked)}>
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
      <span>
        <span style={{ display: 'block', font: 'var(--font-label)' }}>{label}</span>
        {description ? (
          <span style={{ display: 'block', font: 'var(--font-body-small)', color: 'var(--fg-secondary)' }}>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function Divider() {
  return <hr className="ui-divider" />;
}

/** Inline keyboard-hint chip; display only, never a substitute for shortcuts. */
export function ShortcutHint({ keys }: { keys: string }) {
  return <kbd className="ui-shortcut">{keys}</kbd>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty__title">{title}</div>
      {description ? <div className="ui-empty__description">{description}</div> : null}
      {action}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="ui-loading" role="status" aria-live="polite">
      {label}
    </div>
  );
}
