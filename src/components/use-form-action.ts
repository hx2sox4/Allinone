"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import type { FormState } from "@/app/actions";

/** 서버 액션을 폼에 연결한다. 오류가 나도 입력한 내용이 지워지지 않도록 직접 제출한다. */
export function useFormAction(action: (prev: FormState, form: FormData) => Promise<FormState>) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const [, startTransition] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return [state, onSubmit, pending] as const;
}
