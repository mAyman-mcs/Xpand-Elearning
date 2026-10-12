import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./ui";

// Form fields with a visible label, an optional hint and an error wired to aria-describedby.

const control =
  "w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50 disabled:text-slate-600";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
        {/* Decorative: the control itself carries `required` for assistive technology. */}
        {required && (
          <span aria-hidden="true" className="text-red-600">
            {" "}
            *
          </span>
        )}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string };

export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput(
  { label, hint, error, required, className, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(a11y) => (
        <input
          ref={ref}
          {...rest}
          {...a11y}
          required={required}
          className={cx(control, error ? "border-red-400" : "border-slate-300", className)}
        />
      )}
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode; error?: string };

export const SelectInput = forwardRef<HTMLSelectElement, SelectProps>(function SelectInput(
  { label, hint, error, required, className, children, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(a11y) => (
        <select
          ref={ref}
          {...rest}
          {...a11y}
          required={required}
          className={cx(control, error ? "border-red-400" : "border-slate-300", className)}
        >
          {children}
        </select>
      )}
    </Field>
  );
});

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: string };

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, required, className, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(a11y) => (
        <textarea
          ref={ref}
          {...rest}
          {...a11y}
          required={required}
          className={cx(control, error ? "border-red-400" : "border-slate-300", className)}
        />
      )}
    </Field>
  );
});

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; hint?: ReactNode };

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, className, ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className={cx("flex items-start gap-2", className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        {...rest}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-teal-600"
      />
      <label htmlFor={id} className="text-sm text-slate-700">
        {label}
        {hint && <span className="block text-xs text-slate-600">{hint}</span>}
      </label>
    </div>
  );
});

/** A form-level error (not tied to one field). */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
      {message}
    </div>
  );
}
