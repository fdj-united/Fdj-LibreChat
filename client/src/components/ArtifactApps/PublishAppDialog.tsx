import { useState } from 'react';
import { X, Rocket } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Controller, useForm } from 'react-hook-form';
import { Button, Checkbox, Input, Label, Textarea } from '@librechat/client';
import type { Artifact } from '~/common';
import { usePublishArtifactAppMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

interface FormValues {
  title: string;
  description: string;
  visibility: 'private' | 'restricted' | 'tenant' | 'public';
  allowEmbed: boolean;
  allowFork: boolean;
  allowAnonymousView: boolean;
  changelog: string;
}

interface PublishAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifact: Artifact;
  conversationId?: string;
  messageId?: string;
}

type RuntimeType = 'react' | 'html' | 'mermaid';
type ToggleField = 'allowEmbed' | 'allowFork' | 'allowAnonymousView';

const STEPS = ['general', 'security', 'publish'] as const;
const TOGGLE_FIELDS: ToggleField[] = ['allowEmbed', 'allowFork', 'allowAnonymousView'];
type Step = (typeof STEPS)[number];

function getRuntimeTypeFromArtifact(artifact: Artifact): RuntimeType {
  if (artifact.type === 'application/vnd.mermaid') {
    return 'mermaid';
  }
  if (artifact.type === 'text/html' || artifact.type === 'application/vnd.code-html') {
    return 'html';
  }
  return 'react';
}

function getStepClassName(index: number, activeIndex: number): string {
  if (index < activeIndex) {
    return 'bg-primary text-primary-foreground';
  }
  if (index === activeIndex) {
    return 'border border-border-heavy bg-surface-active text-text-primary';
  }
  return 'border border-border-light bg-surface-secondary text-text-secondary';
}

export default function PublishAppDialog({
  open,
  onOpenChange,
  artifact,
  conversationId,
  messageId,
}: PublishAppDialogProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('general');
  const publishMutation = usePublishArtifactAppMutation();

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      title: artifact.title ?? '',
      description: '',
      visibility: 'private',
      allowEmbed: false,
      allowFork: false,
      allowAnonymousView: false,
      changelog: '',
    },
  });

  const visibility = watch('visibility');
  const visibilityLabels: Record<FormValues['visibility'], string> = {
    private: localize('com_ui_artifact_app_visibility_private'),
    restricted: localize('com_ui_artifact_app_visibility_restricted'),
    tenant: localize('com_ui_artifact_app_visibility_tenant'),
    public: localize('com_ui_artifact_app_visibility_public'),
  };
  const toggleLabels: Record<ToggleField, string> = {
    allowEmbed: localize('com_ui_artifact_app_allow_embed'),
    allowFork: localize('com_ui_artifact_app_allow_fork'),
    allowAnonymousView: localize('com_ui_artifact_app_allow_anonymous'),
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep('general');
      publishMutation.reset();
      reset();
    }
    onOpenChange(nextOpen);
  };

  const onSubmit = handleSubmit(async (data) => {
    if (step !== 'publish') {
      const nextStep = STEPS[STEPS.indexOf(step) + 1];
      if (nextStep) {
        setStep(nextStep);
      }
      return;
    }

    try {
      const result = await publishMutation.mutateAsync({
        title: data.title,
        description: data.description,
        visibility: data.visibility,
        allowEmbed: data.allowEmbed,
        allowFork: data.allowFork,
        allowAnonymousView: data.allowAnonymousView,
        changelog: data.changelog,
        artifact: {
          type: getRuntimeTypeFromArtifact(artifact),
          content: artifact.content ?? '',
          title: artifact.title,
        },
        source: conversationId
          ? {
              conversationId,
              messageId,
              originalArtifactId: artifact.id,
            }
          : undefined,
      });
      handleOpenChange(false);
      navigate(`/apps/${result.app.artifactAppId}`);
    } catch {
      return;
    }
  });

  const stepLabels: Record<Step, string> = {
    general: localize('com_ui_artifact_app_step_general'),
    security: localize('com_ui_artifact_app_step_security'),
    publish: localize('com_ui_artifact_app_step_publish'),
  };

  const stepIndex = STEPS.indexOf(step);
  const isLastStep = step === 'publish';
  let submitLabel = localize('com_ui_next');
  if (isLastStep) {
    submitLabel = publishMutation.isLoading
      ? localize('com_ui_artifact_app_publishing')
      : localize('com_ui_artifact_app_publish');
  }

  const summaryItems = [
    { label: localize('com_ui_artifact_app_title'), value: watch('title') },
    {
      label: localize('com_ui_description'),
      value: watch('description') || localize('com_ui_none'),
    },
    {
      label: localize('com_ui_artifact_app_visibility'),
      value: visibilityLabels[visibility],
    },
    {
      label: localize('com_ui_artifact_app_allow_embed'),
      value: watch('allowEmbed') ? localize('com_ui_yes') : localize('com_ui_no'),
    },
    {
      label: localize('com_ui_artifact_app_allow_fork'),
      value: watch('allowFork') ? localize('com_ui_yes') : localize('com_ui_no'),
    },
    {
      label: localize('com_ui_artifact_app_allow_anonymous'),
      value: watch('allowAnonymousView') ? localize('com_ui_yes') : localize('com_ui_no'),
    },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-surface-primary opacity-70 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border-light bg-surface-primary p-6 shadow-2xl focus:outline-none">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Rocket size={18} className="text-text-primary" aria-hidden="true" />
              <Dialog.Title className="text-base font-semibold text-text-primary">
                {localize('com_ui_artifact_app_publish')}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label={localize('com_ui_close')}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>

          <nav
            aria-label={localize('com_ui_artifact_app_publish_progress')}
            className="mb-6 flex items-center gap-2"
          >
            {STEPS.map((currentStep, index) => (
              <div key={currentStep} className="flex items-center gap-2">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${getStepClassName(index, stepIndex)}`}
                >
                  {index < stepIndex ? '✓' : index + 1}
                </div>
                <span
                  className={`text-xs ${index === stepIndex ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}
                >
                  {stepLabels[currentStep]}
                </span>
                {index < STEPS.length - 1 && <div className="h-px w-6 bg-border-light" />}
              </div>
            ))}
          </nav>

          <form onSubmit={onSubmit} noValidate>
            {step === 'general' && (
              <div className="space-y-4">
                <div>
                  <Label className="mb-1 font-medium text-text-primary" htmlFor="pub-title">
                    {localize('com_ui_artifact_app_title')}
                  </Label>
                  <Input
                    id="pub-title"
                    className="border-border-medium bg-surface-secondary text-text-primary focus-visible:ring-2 focus-visible:ring-ring-primary"
                    {...register('title', {
                      required: localize('com_ui_field_required'),
                      maxLength: {
                        value: 200,
                        message: localize('com_ui_field_max_length', {
                          field: localize('com_ui_artifact_app_title'),
                          length: 200,
                        }),
                      },
                    })}
                  />
                  {errors.title && (
                    <p role="alert" className="mt-1 text-xs text-text-destructive">
                      {errors.title.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="mb-1 font-medium text-text-primary" htmlFor="pub-desc">
                    {localize('com_ui_description')}
                  </Label>
                  <Textarea
                    id="pub-desc"
                    rows={3}
                    className="w-full border-border-medium bg-surface-secondary text-text-primary focus-visible:ring-ring-primary"
                    {...register('description', {
                      maxLength: {
                        value: 2000,
                        message: localize('com_ui_field_max_length', {
                          field: localize('com_ui_description'),
                          length: 2000,
                        }),
                      },
                    })}
                  />
                  {errors.description && (
                    <p role="alert" className="mt-1 text-xs text-text-destructive">
                      {errors.description.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="mb-1 font-medium text-text-primary" htmlFor="pub-changelog">
                    {localize('com_ui_artifact_app_changelog')}
                  </Label>
                  <Input
                    id="pub-changelog"
                    className="border-border-medium bg-surface-secondary text-text-primary focus-visible:ring-2 focus-visible:ring-ring-primary"
                    {...register('changelog')}
                  />
                </div>
              </div>
            )}

            {step === 'security' && (
              <div className="space-y-4">
                <div>
                  <Label className="mb-1 font-medium text-text-primary" htmlFor="pub-visibility">
                    {localize('com_ui_artifact_app_visibility')}
                  </Label>
                  <select
                    id="pub-visibility"
                    className="w-full rounded-lg border border-border-medium bg-surface-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring-primary"
                    {...register('visibility')}
                  >
                    {Object.entries(visibilityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  {TOGGLE_FIELDS.map((field) => {
                    const labelId = `pub-${field}-label`;
                    return (
                      <div key={field} className="flex items-start gap-2">
                        <Controller
                          name={field}
                          control={control}
                          render={({ field: checkboxField }) => (
                            <Checkbox
                              id={`pub-${field}`}
                              checked={checkboxField.value}
                              onCheckedChange={(checked) =>
                                checkboxField.onChange(checked === true)
                              }
                              aria-labelledby={labelId}
                            />
                          )}
                        />
                        <label
                          id={labelId}
                          htmlFor={`pub-${field}`}
                          className="cursor-pointer text-sm text-text-primary"
                        >
                          {toggleLabels[field]}
                          {field === 'allowAnonymousView' && visibility !== 'public' && (
                            <span className="ml-1 text-text-secondary">
                              {localize('com_ui_artifact_app_allow_anonymous_hint')}
                            </span>
                          )}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 'publish' && (
              <div className="space-y-3">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_artifact_app_review_settings')}
                </p>
                <dl className="divide-y divide-border-light rounded-xl border border-border-light">
                  {summaryItems.map(({ label, value }) => (
                    <div key={label} className="flex justify-between gap-4 px-3 py-2">
                      <dt className="text-sm text-text-secondary">{label}</dt>
                      <dd className="text-right text-sm font-medium text-text-primary">{value}</dd>
                    </div>
                  ))}
                </dl>
                {publishMutation.isError && (
                  <p role="alert" className="text-xs text-text-destructive">
                    {localize('com_ui_artifact_app_failed')}
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-between gap-3">
              {stepIndex > 0 ? (
                <Button type="button" variant="ghost" onClick={() => setStep(STEPS[stepIndex - 1])}>
                  {localize('com_ui_back')}
                </Button>
              ) : (
                <div />
              )}
              <Button type="submit" disabled={publishMutation.isLoading}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
