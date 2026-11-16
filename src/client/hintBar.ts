// The strip under the board where a hint is shown: one line at a time, with
// at most one button of its own and, during the warm-up, a Skip beside it. It
// sits in its own row, so it never covers the board or takes a tap meant for it.

export type HintAction = { label: string; run: () => void };

export type HintBar = {
  /** Opens the strip. With `skip`, a quiet Skip button is shown beside the hint. */
  open: (skip: (() => void) | null) => void;
  /** Shows a line, with a button beside it if `action` is given. */
  show: (text: string, action?: HintAction) => void;
  /** Takes the line away but keeps the strip's place, so the board does not jump between hints. */
  clear: () => void;
  /** Closes the strip altogether. */
  close: () => void;
};

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
};

export const createHintBar = (): HintBar => {
  const bar = element('hint');
  const slip = element('hint-slip');
  const text = element('hint-text');
  const action = element('hint-action');
  const skip = element('hint-skip');
  let onAction: (() => void) | null = null;
  let onSkip: (() => void) | null = null;
  action.addEventListener('click', () => onAction?.());
  skip.addEventListener('click', () => onSkip?.());

  const clear = (): void => {
    slip.classList.add('empty');
    text.textContent = '';
    action.hidden = true;
    onAction = null;
    skip.hidden = onSkip === null;
  };

  return {
    open: (run) => {
      onSkip = run;
      skip.hidden = run === null;
      bar.hidden = false;
    },
    show: (line, button) => {
      // Showing the same line again must not restart its arrival.
      if (text.textContent !== line) {
        slip.classList.remove('empty', 'arriving');
        // Reading the width makes the browser notice the class has gone, so the arrival plays again.
        void slip.offsetWidth;
        slip.classList.add('arriving');
        text.textContent = line;
      }
      onAction = button?.run ?? null;
      action.hidden = button === undefined;
      action.textContent = button?.label ?? '';
      // A hint with its own way forward makes Skip redundant.
      skip.hidden = onSkip === null || button !== undefined;
    },
    clear,
    close: () => {
      clear();
      onSkip = null;
      bar.hidden = true;
    },
  };
};
