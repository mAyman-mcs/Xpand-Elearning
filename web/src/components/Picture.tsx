import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { uploadUrl } from "../lib/questions";
import { Dialog } from "./Dialog";
import { FormError, TextInput } from "./form";
import { Button, cx } from "./ui";

// Pictures in questions, options and cases (docs/CASE_QUESTIONS_PLAN.md C6, C13).

/**
 * A picture that opens larger in an in-page viewer (never the browser's fullscreen, which the exam
 * would count as leaving it). Not draggable, no "save image" menu, no referrer sent to outside links.
 */
export function Picture({
  src,
  alt,
  className,
  zoomable = true,
}: {
  src: string;
  alt: string | null;
  className?: string;
  zoomable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const img = (big: boolean) => (
    <img
      src={src}
      alt={alt ?? ""}
      referrerPolicy="no-referrer"
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      className={big ? "mx-auto max-h-[75vh] w-auto max-w-full" : cx("rounded border border-slate-200", className)}
    />
  );
  if (!zoomable) return img(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Inside an option label: zooming must not also select the option.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Enlarge picture${alt ? `: ${alt}` : ""}`}
        className="group relative block max-w-full cursor-zoom-in rounded focus:ring-2 focus:ring-teal-500 focus:outline-none"
      >
        {img(false)}
        <span
          aria-hidden="true"
          className="absolute right-1 bottom-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs text-white opacity-80 group-hover:opacity-100"
        >
          ⤢
        </span>
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={alt || "Picture"}
        wide
        footer={<Button onClick={() => setOpen(false)}>Close</Button>}
      >
        {img(true)}
      </Dialog>
    </>
  );
}

/** The picture types the server accepts. */
const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Upload or replace a picture, with its description (alt text, required by the server). Used for
 * question, option and case pictures in the editor.
 */
export function ImageField({
  examId,
  label,
  imageId,
  imageAlt,
  onChange,
  compact,
}: {
  examId: string;
  label: string;
  imageId: string | null | undefined;
  imageAlt: string | null | undefined;
  onChange: (patch: { imageId: string | null; imageAlt: string | null }) => void;
  /** Smaller layout, for options. */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [tooBig, setTooBig] = useState(false);
  const upload = useMutation({
    mutationFn: (file: File) => api.uploads.create(examId, file),
    onSuccess: (res) => onChange({ imageId: res.id, imageAlt: imageAlt ?? null }),
  });
  const pick = (file: File | undefined) => {
    if (!file) return;
    setTooBig(file.size > MAX_BYTES);
    if (file.size <= MAX_BYTES) upload.mutate(file);
  };

  return (
    <div className={cx("space-y-2", !compact && "rounded-lg border border-slate-200 p-3")}>
      <div className="flex flex-wrap items-center gap-2">
        <span id={id} className={cx("font-semibold text-slate-700", compact ? "text-xs" : "text-sm")}>
          {label}
        </span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-labelledby={id}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="secondary" busy={upload.isPending} onClick={() => input.current?.click()}>
          {imageId ? "Replace picture" : "Upload picture"}
        </Button>
        {imageId && (
          <Button size="sm" variant="ghost" onClick={() => onChange({ imageId: null, imageAlt: null })}>
            Remove
          </Button>
        )}
      </div>
      {imageId && (
        <div className={cx("flex flex-wrap items-start gap-3", compact && "text-sm")}>
          <Picture src={uploadUrl(imageId)} alt={imageAlt ?? null} className={compact ? "max-h-24" : "max-h-40"} />
          <div className="min-w-48 flex-1">
            <TextInput
              label="Describe the picture (alt text)"
              required
              maxLength={300}
              value={imageAlt ?? ""}
              hint="Read aloud to students using a screen reader. Describe it neutrally: don't give away the answer."
              error={imageAlt?.trim() ? undefined : "Required"}
              onChange={(e) => onChange({ imageId, imageAlt: e.target.value || null })}
            />
          </div>
        </div>
      )}
      {!imageId && !compact && (
        <p className="text-xs text-slate-600">
          PNG, JPEG or WebP, at most 2 MB. Camera and location details are removed.
        </p>
      )}
      <FormError
        message={tooBig ? "The picture is larger than 2 MB." : upload.error ? errorMessage(upload.error) : null}
      />
    </div>
  );
}
