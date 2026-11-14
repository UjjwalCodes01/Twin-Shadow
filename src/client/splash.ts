import { requestExpandedMode } from '@devvit/web/client';

// The inline view shown in the feed. Keep it light: no three.js here.
document.getElementById('play-button')?.addEventListener('click', (event) => {
  requestExpandedMode(event, 'game');
});
