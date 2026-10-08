import './primitives.css';
import type { ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, SearchIcon } from '../icons';
import { Tooltip, type TooltipPlacement } from './tooltip';

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
  tooltipPlacement?: TooltipPlacement;
  tooltipDisabled?: boolean;
}

/** Icon-only control; `label` is the accessible name and tooltip source. */
export function IconButton({
  label,
  size = 'md',
  variant = 'plain',
  active,
  tooltipPlacement = 'auto',
  tooltipDisabled = false,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip content={label} placement={tooltipPlacement} disabled={tooltipDisabled}>
      <button
        type="button"
        aria-label={label}
        {...props}
        className={
          `ui-icon-button ui-icon-button--${size} ui-icon-button--${variant}` +
          `${active ? ' ui-icon-button--active' : ''} ${props.className ?? ''}`
        }
      />
    </Tooltip>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function TextInput({ label, id: idProp, ...props }: TextInputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <span className="ui-field">
      {label ? (
        <label className="ui-field__label" htmlFor={id}>
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

interface SelectProps {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
}

/** Custom dropdown with listbox semantics; the native control cannot match app styling. */
export function Select({ label, options, value, onChange, id: idProp, disabled = false }: SelectProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  // Outside interaction closes the list, matching the home create menu.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open ]);

  function focusOption(index: number): void {
    setTimeout(() => optionRefs.current[index]?.focus(), 0);
  }

  function choose(index: number): void {
    onChange(options[index].value);
    setOpen(false);
    setTimeout(() => buttonRef.current?.focus(), 0);
  }

  function openList(focusIndex: number): void {
    if (disabled) return;
    setOpen(true);
    focusOption(focusIndex);
  }

  function onButtonKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openList(selectedIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openList(selectedIndex);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  function onListKeyDown(event: React.KeyboardEvent, index: number): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption((index + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption((index - 1 + options.length) % options.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setTimeout(() => buttonRef.current?.focus(), 0);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  const selected = options[selectedIndex];

  return (
    <span className="ui-field">
      <span className="ui-field__label" id={`${id}-label`}>
        {label}
      </span>
      <span className="ui-select-custom" ref={rootRef}>
        <button
          ref={buttonRef}
          type="button"
          id={id}
          className="ui-select-custom__button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${id}-label ${id}`}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList(selectedIndex))}
          onKeyDown={onButtonKeyDown}
        >
          <span className="ui-select-custom__value">{selected?.label}</span>
          <ChevronDownIcon className="ui-select-custom__chevron" size={14} />
        </button>
        {open ? (
          <ul
            className="ui-select-custom__list"
            role="listbox"
            aria-labelledby={`${id}-label`}
            tabIndex={-1}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="option"
                aria-selected={option.value === value}
                tabIndex={index === selectedIndex ? 0 : -1}
                className="ui-select-custom__option"
                onClick={() => choose(index)}
                onKeyDown={(event) => onListKeyDown(event, index)}
              >
                <span>{option.label}</span>
                <span className="ui-select-custom__check" aria-hidden="true">
                  <CheckIcon size={14} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </span>
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
    <span className="ui-field">
      <span className="ui-field__label">{label}</span>
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
      <span className="ui-switch__text">
        <span className="ui-switch__label">{label}</span>
        {description ? (
          <span className="ui-switch__description">
            {description}
          </span>
        ) : null}
      </span>
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
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
