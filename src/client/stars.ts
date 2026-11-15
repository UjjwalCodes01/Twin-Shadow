// The stars of a rating, drawn as shapes rather than typed as characters, so
// they look the same on every device. An earned star is filled and an
// unearned one is an outline, which reads without colour.

const SVG = 'http://www.w3.org/2000/svg';

export const STAR_TOTAL = 3;

/** A five-pointed star in a 24 by 24 box, point up, as an SVG path. */
export const starPath = (): string => {
  const points: string[] = [];
  for (let index = 0; index < 10; index++) {
    // Outer and inner corners in turn, starting from the top.
    const radius = index % 2 === 0 ? 10.2 : 4.5;
    const angle = (Math.PI / 5) * index - Math.PI / 2;
    const x = 12 + radius * Math.cos(angle);
    const y = 12.7 + radius * Math.sin(angle);
    points.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${points.join(' ')} Z`;
};

/** Which stars are earned, left to right: [true, true, false] for two. */
export const starFlags = (stars: number): boolean[] =>
  Array.from({ length: STAR_TOTAL }, (_, index) => index < stars);

export const starsLabel = (stars: number): string => `${stars} of ${STAR_TOTAL} stars`;

/** A row of stars as one element, read out as "2 of 3 stars". */
export const starRow = (stars: number): HTMLSpanElement => {
  const row = document.createElement('span');
  row.className = 'star-row';
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', starsLabel(stars));
  const path = starPath();
  for (const earned of starFlags(stars)) {
    const star = document.createElementNS(SVG, 'svg');
    star.setAttribute('viewBox', '0 0 24 24');
    star.setAttribute('class', earned ? 'star earned' : 'star');
    star.setAttribute('aria-hidden', 'true');
    const outline = document.createElementNS(SVG, 'path');
    outline.setAttribute('d', path);
    star.append(outline);
    row.append(star);
  }
  return row;
};

/** Shows a rating in an element, replacing whatever it held. */
export const showStars = (target: HTMLElement, stars: number): void => {
  target.replaceChildren(starRow(stars));
};
