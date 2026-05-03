import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import {
  initForm,
  updateField,
  setFieldError,
  setFormSubmitting,
  resetForm,
  touchField,
} from '../chatSlice';
import type { FormField, FormState } from '@prism/shared-types';

interface UseChatFormReturn {
  formState: FormState | undefined;
  init: (fields: Record<string, unknown>) => void;
  update: (name: string, value: unknown) => void;
  setError: (name: string, error: string) => void;
  clearError: (name: string) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  reset: () => void;
  touch: (name: string) => void;
  getField: (name: string) => FormField | undefined;
  isValid: boolean;
  isSubmitting: boolean;
  values: Record<string, unknown>;
}

export function useChatForm(formId: string): UseChatFormReturn {
  const dispatch = useAppDispatch();
  const formState = useAppSelector((state) => state.chat.forms[formId]) as FormState | undefined;

  const init = useCallback(
    (fields: Record<string, unknown>) => {
      const formFields: Record<string, FormField> = {};
      Object.entries(fields).forEach(([name, value]) => {
        formFields[name] = {
          name,
          value,
          touched: false,
          dirty: false,
        };
      });
      dispatch(initForm({ formId, fields: formFields }));
    },
    [dispatch, formId]
  );

  const update = useCallback(
    (name: string, value: unknown) => {
      dispatch(updateField({ formId, name, value }));
    },
    [dispatch, formId]
  );

  const setError = useCallback(
    (name: string, error: string) => {
      dispatch(setFieldError({ formId, name, error }));
    },
    [dispatch, formId]
  );

  const clearError = useCallback(
    (name: string) => {
      dispatch(setFieldError({ formId, name, error: '' }));
    },
    [dispatch, formId]
  );

  const setSubmitting = useCallback(
    (isSubmitting: boolean) => {
      dispatch(setFormSubmitting({ formId, isSubmitting }));
    },
    [dispatch, formId]
  );

  const reset = useCallback(() => {
    dispatch(resetForm(formId));
  }, [dispatch, formId]);

  const touch = useCallback(
    (name: string) => {
      dispatch(touchField({ formId, name }));
    },
    [dispatch, formId]
  );

  const getField = useCallback(
    (name: string) => formState?.fields[name],
    [formState]
  );

  const values = useMemo(() => {
    if (!formState) return {};
    const result: Record<string, unknown> = {};
    Object.entries(formState.fields).forEach(([name, field]) => {
      result[name] = field.value;
    });
    return result;
  }, [formState]);

  return {
    formState,
    init,
    update,
    setError,
    clearError,
    setSubmitting,
    reset,
    touch,
    getField,
    isValid: formState?.isValid ?? true,
    isSubmitting: formState?.isSubmitting ?? false,
    values,
  };
}
