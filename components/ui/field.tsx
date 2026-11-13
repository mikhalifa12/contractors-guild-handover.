import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type FieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn('w-full', className)}>
      <label className="cg-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-ember-400"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="cg-hint">{hint}</p> : null}
      {error ? (
        <p className="cg-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = ComponentProps<'input'> & { invalid?: boolean };

export function TextInput({ className, invalid, ...props }: InputProps) {
  return <input className={cn('cg-input', className)} aria-invalid={invalid || undefined} {...props} />;
}

type TextAreaProps = ComponentProps<'textarea'> & { invalid?: boolean };

export function TextArea({ className, invalid, ...props }: TextAreaProps) {
  return (
    <textarea className={cn('cg-textarea', className)} aria-invalid={invalid || undefined} {...props} />
  );
}

type SelectProps = ComponentProps<'select'> & { invalid?: boolean };

export function Select({ className, invalid, children, ...props }: SelectProps) {
  return (
    <select className={cn('cg-select', className)} aria-invalid={invalid || undefined} {...props}>
      {children}
    </select>
  );
}
