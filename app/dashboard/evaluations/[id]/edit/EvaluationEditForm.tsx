'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/ui';
import { Panel, PanelHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

type TestCase = {
  id: string;
  question: string;
  role: 'PUBLIC' | 'CUSTOMER' | 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  expectedBehavior: 'SHOULD_ANSWER' | 'SHOULD_REFUSE';
  expectedSourceDocuments: string[];
  expectedConcepts: string[];
  permittedRole: 'PUBLIC' | 'CUSTOMER' | 'EMPLOYEE' | 'MANAGER' | 'ADMIN' | '';
  expectedGrounding: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED' | '';
  minimumConfidence: number | '';
  maximumLatencyMs: number | '';
  history: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>;
};

interface Evaluation {
  id: string;
  name: string;
  description: string | null;
  testCases: TestCase[];
  knowledgeBaseId: string;
}

interface Props {
  evaluation: Evaluation;
  knowledgeBases: Array<{ id: string; name: string }>;
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">{children}</label>;
}

function InputField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  required,
  className,
  step,
  min,
  max,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  className?: string;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        step={step}
        min={min}
        max={max}
        className={cn('field', error && 'border-status-critical', className)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-status-critical" role="alert">{error}</p>}
    </div>
  );
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  error,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  error?: string;
  className?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn('field', error && 'border-status-critical', className)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-status-critical" role="alert">{error}</p>}
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  required,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  error?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={cn('field', error && 'border-status-critical', className)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {placeholder && <option value="">— {placeholder} —</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-status-critical" role="alert">{error}</p>}
    </div>
  );
}

function SubmitButton({ children, disabled, className }: { children: React.ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={cn(
        'rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border border-edge px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function EvaluationEditForm({ evaluation, knowledgeBases }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [name, setName] = useState(evaluation.name);
  const [description, setDescription] = useState(evaluation.description ?? '');
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(evaluation.knowledgeBaseId);
  const [testCases, setTestCases] = useState<TestCase[]>(evaluation.testCases);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function createEmptyTestCase(): TestCase {
    return {
      id: crypto.randomUUID(),
      question: '',
      role: 'PUBLIC',
      expectedBehavior: 'SHOULD_ANSWER',
      expectedSourceDocuments: [],
      expectedConcepts: [],
      permittedRole: '',
      expectedGrounding: '',
      minimumConfidence: '',
      maximumLatencyMs: '',
      history: [],
    };
  }

  function updateTestCase(index: number, field: keyof TestCase, value: unknown) {
    const updated = [...testCases];
    updated[index] = { ...updated[index], [field]: value };
    setTestCases(updated);
    clearError(`testCases.${index}.${field}`);
  }

  function addTestCase() {
    setTestCases([...testCases, createEmptyTestCase()]);
  }

  function removeTestCase(index: number) {
    if (testCases.length <= 1) return;
    setTestCases(testCases.filter((_, i) => i !== index));
  }

  function clearError(key: string) {
    setErrors((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) newErrors.name = 'Name is required';
    if (!knowledgeBaseId) newErrors.knowledgeBaseId = 'Knowledge base is required';

    testCases.forEach((tc, i) => {
      if (!tc.question.trim()) newErrors[`testCases.${i}.question`] = 'Question is required';
      if (tc.expectedBehavior === 'SHOULD_ANSWER' && tc.expectedSourceDocuments.length === 0 && tc.expectedConcepts.length === 0) {
        newErrors[`testCases.${i}.expectedSourceDocuments`] = 'At least one expected source document or concept is required for SHOULD_ANSWER';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const response = await fetch(`/api/evaluations/${evaluation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _action: 'update', name, description, testCases }),
      });

      const data = await response.json();
      if (!response.ok) {
        showToast({ type: 'error', message: data.error ?? 'Failed to update evaluation' });
        return;
      }

      showToast({ type: 'success', message: 'Evaluation updated' });
      router.push(`/dashboard/evaluations/${evaluation.id}`);
    } catch {
      showToast({ type: 'error', message: 'Network error' });
    } finally {
      setSubmitting(false);
    }
  }

  const roles = ['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN'] as const;
  const roleOptions = roles.map((r) => ({ value: r, label: r }));
  const permittedRoleOptions = ['', ...roles].map((r) => ({ value: r, label: r || '—' }));
  const behaviorOptions = [
    { value: 'SHOULD_ANSWER', label: 'Should Answer' },
    { value: 'SHOULD_REFUSE', label: 'Should Refuse' },
  ];
  const groundingOptions = [
    { value: '', label: '—' },
    { value: 'SUPPORTED', label: 'SUPPORTED' },
    { value: 'PARTIALLY_SUPPORTED', label: 'PARTIALLY_SUPPORTED' },
    { value: 'UNSUPPORTED', label: 'UNSUPPORTED' },
  ];
  const kbOptions = knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name }));

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <Panel>
        <PanelHeader title="Evaluation Details" />
        <div className="space-y-4 p-4">
          <InputField
            id="name"
            label="Name"
            value={name}
            onChange={setName}
            placeholder="e.g. Refund policy evaluation"
            error={errors.name}
            required
          />
          <TextAreaField
            id="description"
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Optional description of what this evaluation tests"
            rows={3}
          />
          <SelectField
            id="knowledgeBaseId"
            label="Knowledge Base"
            value={knowledgeBaseId}
            onChange={setKnowledgeBaseId}
            options={kbOptions}
            placeholder="Select a knowledge base"
            error={errors.knowledgeBaseId}
            required
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Test Cases" description={`${testCases.length} case${testCases.length !== 1 ? 's' : ''}`} />
        <div className="space-y-4 p-4">
          {testCases.map((tc, i) => (
            <div key={tc.id} className="border border-edge rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-ink">Test Case {i + 1}</h4>
                {testCases.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTestCase(i)}
                    className="text-ink-faint hover:text-critical text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>

              <InputField
                id={`question-${i}`}
                label="Question"
                value={tc.question}
                onChange={(v) => updateTestCase(i, 'question', v)}
                placeholder="What is the refund window for an annual subscription?"
                error={errors[`testCases.${i}.question`]}
                required
              />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SelectField
                  id={`role-${i}`}
                  label="Role"
                  value={tc.role}
                  onChange={(v) => updateTestCase(i, 'role', v as TestCase['role'])}
                  options={roleOptions}
                />
                <SelectField
                  id={`expectedBehavior-${i}`}
                  label="Expected Behavior"
                  value={tc.expectedBehavior}
                  onChange={(v) => updateTestCase(i, 'expectedBehavior', v as TestCase['expectedBehavior'])}
                  options={behaviorOptions}
                />
                <SelectField
                  id={`permittedRole-${i}`}
                  label="Permitted Role"
                  value={tc.permittedRole}
                  onChange={(v) => updateTestCase(i, 'permittedRole', v as TestCase['permittedRole'])}
                  options={permittedRoleOptions}
                  placeholder="Optional"
                />
                <SelectField
                  id={`expectedGrounding-${i}`}
                  label="Expected Grounding"
                  value={tc.expectedGrounding}
                  onChange={(v) => updateTestCase(i, 'expectedGrounding', v as TestCase['expectedGrounding'])}
                  options={groundingOptions}
                  placeholder="Optional"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <InputField
                  id={`minConfidence-${i}`}
                  label="Min Confidence"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={tc.minimumConfidence === '' ? '' : String(tc.minimumConfidence)}
                  onChange={(v) => updateTestCase(i, 'minimumConfidence', v ? parseFloat(v) : '')}
                  placeholder="e.g. 0.7"
                />
                <InputField
                  id={`maxLatency-${i}`}
                  label="Max Latency (ms)"
                  type="number"
                  value={tc.maximumLatencyMs === '' ? '' : String(tc.maximumLatencyMs)}
                  onChange={(v) => updateTestCase(i, 'maximumLatencyMs', v ? parseInt(v, 10) : '')}
                  placeholder="e.g. 5000"
                />
              </div>

              <div className="space-y-2">
                <FieldLabel htmlFor={`sources-${i}`}>Expected Source Documents (one per line)</FieldLabel>
                <TextAreaField
                  id={`sources-${i}`}
                  label=""
                  value={tc.expectedSourceDocuments.join('\n')}
                  onChange={(v) => updateTestCase(i, 'expectedSourceDocuments', v.split('\n').filter(Boolean))}
                  placeholder="Refund Policy\nPricing Guide"
                  rows={2}
                  error={errors[`testCases.${i}.expectedSourceDocuments`]}
                />
              </div>

              <div className="space-y-2">
                <FieldLabel htmlFor={`concepts-${i}`}>Expected Concepts/Keywords (one per line)</FieldLabel>
                <TextAreaField
                  id={`concepts-${i}`}
                  label=""
                  value={tc.expectedConcepts.join('\n')}
                  onChange={(v) => updateTestCase(i, 'expectedConcepts', v.split('\n').filter(Boolean))}
                  placeholder="30\nday\nannual"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <FieldLabel>Conversation History (optional)</FieldLabel>
                <div className="space-y-2">
                  {tc.history.map((turn, hi) => (
                    <div key={hi} className="flex gap-2">
                      <SelectField
                        id={`history-role-${i}-${hi}`}
                        label=""
                        value={turn.role}
                        onChange={(v) => {
                          const updated = [...tc.history];
                          updated[hi] = { ...updated[hi], role: v as 'USER' | 'ASSISTANT' };
                          updateTestCase(i, 'history', updated);
                        }}
                        options={[
                          { value: 'USER', label: 'User' },
                          { value: 'ASSISTANT', label: 'Assistant' },
                        ]}
                        className="w-24"
                      />
                      <InputField
                        id={`history-content-${i}-${hi}`}
                        label=""
                        value={turn.content}
                        onChange={(v) => {
                          const updated = [...tc.history];
                          updated[hi] = { ...updated[hi], content: v };
                          updateTestCase(i, 'history', updated);
                        }}
                        placeholder="Message content"
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = tc.history.filter((_, idx) => idx !== hi);
                          updateTestCase(i, 'history', updated);
                        }}
                        className="text-ink-faint hover:text-critical mt-6 self-end"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const updated = [...tc.history, { role: 'USER' as const, content: '' }];
                      updateTestCase(i, 'history', updated);
                    }}
                    className="text-sm text-accent hover:underline"
                  >
                    + Add history turn
                  </button>
                </div>
              </div>
            </div>
          ))}

          <SecondaryButton onClick={addTestCase}>+ Add Test Case</SecondaryButton>
        </div>
      </Panel>

      <div className="flex items-center justify-end gap-3">
        <Link
          href={`/dashboard/evaluations/${evaluation.id}`}
          className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
        >
          Cancel
        </Link>
        <SubmitButton disabled={submitting}>
          {submitting ? 'Saving…' : 'Save Changes'}
        </SubmitButton>
      </div>
    </form>
  );
}