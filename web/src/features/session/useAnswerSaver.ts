import { useEffect, useMemo, useRef } from "react";
import { AnswerSaver, type SaverOptions } from "./saver";

export interface Saver<T> {
  set: (questionId: string, value: T) => void;
  setLater: (questionId: string, value: T, delayMs: number) => void;
  flush: () => Promise<void>;
  stop: () => void;
}

/**
 * The exam page's autosave, tied to the page's lifetime: a saver is created when the page mounts
 * and stopped when it unmounts. React may mount, unmount and mount again (Strict Mode in
 * development does this on purpose); each mount gets a fresh, working saver. A saver made once
 * and stopped on unmount would stay stopped and drop every answer without a word.
 *
 * `key` is the attempt: a new attempt gets a new saver. The callbacks may change between renders;
 * the saver always calls the latest ones.
 */
export function useAnswerSaver<T>(key: string, options: Omit<SaverOptions<T>, "wait">): Saver<T> {
  const latest = useRef(options);
  latest.current = options;
  const current = useRef<AnswerSaver<T> | null>(null);

  useEffect(() => {
    const saver = new AnswerSaver<T>({
      save: (questionId, value) => latest.current.save(questionId, value),
      onState: (questionId, state, message) => latest.current.onState(questionId, state, message),
      onStop: (reason) => latest.current.onStop(reason),
    });
    current.current = saver;
    return () => {
      saver.stop();
      if (current.current === saver) current.current = null;
    };
  }, [key]);

  // One stable object for the page; it always talks to the saver of the current mount.
  return useMemo(
    () => ({
      set: (questionId, value) => current.current?.set(questionId, value),
      setLater: (questionId, value, delayMs) => current.current?.setLater(questionId, value, delayMs),
      flush: () => current.current?.flush() ?? Promise.resolve(),
      stop: () => current.current?.stop(),
    }),
    [],
  );
}
