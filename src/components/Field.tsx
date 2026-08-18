import type { ReactNode } from 'react';

/**
 * Form field primitives.
 *
 * These exist because login, signup and onboarding are three separate client
 * components that had already drifted: two different error colours, two
 * different focus treatments and two different input sizes across forms the
 * user experiences as one flow. Shared classes make that drift impossible
 * rather than merely discouraged.
 *
 * Sizes are set for a phone first. Inputs are `text-base` deliberately —
 * anything under 16px makes iOS zoom the viewport on focus, which is a real
 * usability failure on the one surface every new account has to pass through.
 * Controls land at 44px, the standard minimum touch target.
 */

/**
 * Border, ground and focus treatment shared by every control.
 *
 * Focus takes the **full** accent rather than `accent-dim`. These inputs set
 * `outline-none`, so the border is the entire focus indicator, and dim brass
 * measures only 2.54:1 against the resting border — a change you have to look
 * for. Full brass measures 5.94:1 against it and 7.66:1 against the ground,
 * which clears the 3:1 WCAG 2.2 asks of a non-text indicator with room to
 * spare. The search input still uses the dim value and is now the outlier.
 */
const SHELL =
  'rounded-md border border-border bg-surface transition-colors focus-within:border-accent';

/** A plain input that carries its own shell. */
export const INPUT = `w-full ${SHELL} px-3 py-2.5 text-base text-text outline-none placeholder:text-text-faint focus:border-accent`;

/** Wrapper for a control with adornments — the handle field's URL prefix. */
export const INPUT_SHELL = `flex w-full items-center ${SHELL}`;

/** The bare input inside an `INPUT_SHELL`, where the wrapper owns the border. */
export const BARE_INPUT =
  'min-w-0 flex-1 bg-transparent py-2.5 pr-3 text-base text-text outline-none';

/**
 * Primary submit.
 *
 * Brass, matching every other primary action in the product. These buttons
 * were previously `border-border bg-surface`, which is the *secondary*
 * treatment — the most important control on each auth page was styled as the
 * least important thing on it.
 */
export const SUBMIT =
  'w-full rounded-sm bg-accent px-4 py-3 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

type FieldProps = {
  id: string;
  label: string;
  optional?: boolean;
  /** Shown only while there is no error, so the two never stack. */
  hint?: string;
  error?: string;
  children: ReactNode;
};

export function Field({ id, label, optional, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-text-secondary">
        {label}
        {optional && <span className="ml-1.5 text-text-faint">optional</span>}
      </label>

      {children}

      {/*
       * Error replaces the hint rather than joining it: two lines of small
       * text under one field is where a form starts to feel like it is telling
       * you off. The colour is a muted brick from the palette rather than an
       * alarm red — visible, measured at 5.28:1, and not aggressive.
       */}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger-text">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-sm text-text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
