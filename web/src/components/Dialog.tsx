import * as RadixDialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { errorMessage } from "../lib/api";
import { FormError, TextArea } from "./form";
import { Button, cx } from "./ui";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Accessible modal (focus trap, Escape, labelled by its title) on Radix. */
export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/50" />
        <RadixDialog.Content
          className={cx(
            "fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-6 shadow-2xl",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
          // Without a description Radix warns; pass undefined to opt out explicitly.
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <RadixDialog.Title className="text-lg font-bold text-slate-800">{title}</RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mt-1 text-sm text-slate-600">{description}</RadixDialog.Description>
          )}
          <div className="mt-4 space-y-4">{children}</div>
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Ask for a reason (required when the API takes one; it goes into the audit log). */
  reason?: { label: string; required: boolean };
  onConfirm: (reason: string) => Promise<unknown>;
}

/** Confirmation for destructive or sensitive actions. Stays open and shows the error on failure. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  reason,
  onConfirm,
}: ConfirmProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const missingReason = reason?.required && !text.trim();

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setText("");
      setError(null);
    }
    onOpenChange(next);
  };

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      setText("");
      onOpenChange(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => void confirm()}
            busy={busy}
            disabled={missingReason}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {reason && (
        <TextArea
          label={reason.label}
          required={reason.required}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <FormError message={error ? errorMessage(error) : null} />
    </Dialog>
  );
}

/**
 * Shows a secret once (temporary passwords). It lives only in this component's props: never in
 * query caches, storage or logs. Closing the dialog loses it for good.
 */
export function SecretDialog({
  secret,
  title,
  description,
  onClose,
}: {
  secret: { label: string; value: string }[] | null;
  title: string;
  description: ReactNode;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(value);
  };
  return (
    <Dialog
      open={secret !== null}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      footer={<Button onClick={onClose}>I have saved it</Button>}
    >
      <ul className="space-y-2">
        {secret?.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2">
            <span className="text-sm">
              <span className="block text-xs text-slate-600">{s.label}</span>
              <code data-testid="secret-value" className="font-mono text-base font-bold text-slate-900">
                {s.value}
              </code>
            </span>
            <Button size="sm" variant="secondary" onClick={() => void copy(s.value)}>
              {copied === s.value ? "Copied" : "Copy"}
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs font-medium text-amber-700">This is shown only once. It can't be displayed again later.</p>
    </Dialog>
  );
}
