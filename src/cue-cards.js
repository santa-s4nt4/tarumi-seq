// The upcoming-cue cards shared by LIVE and CUSTOM: the next cue large, the
// two after it as single rows.
const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };

export function createCueCards(list) {
  const cards = new Map();
  // `title` names a cue; `note` is the line under the next cue, if any.
  return function render(events, { title, note = () => '' }) {
    const shown = events.slice(0, 3), active = shown.map((event, index) => {
      let card = cards.get(event.id);
      if (!card) {
        card = document.createElement('article');
        card.innerHTML = '<h2></h2><p class="cue-countdown"><span class="cue-seconds"><strong></strong><span class="cue-unit">秒</span></span></p><p class="journey-cue-note" hidden></p>';
        cards.set(event.id, card);
      }
      const className = 'cue-card' + (index === 0 ? ' cue-primary' : '');
      if (card.className !== className) card.className = className;
      text(card.querySelector('h2'), title(event));
      text(card.querySelector('strong'), String(Math.ceil(event.etaSeconds)));
      const line = card.querySelector('.journey-cue-note'), noteText = note(event);
      text(line, noteText); if (line.hidden === Boolean(noteText)) line.hidden = !noteText;
      return card;
    });
    const children = [...list.children];
    if (children.length !== active.length || children.some((child, i) => child !== active[i])) list.replaceChildren(...active);
    for (const key of cards.keys()) if (!shown.some(event => event.id === key)) cards.delete(key);
  };
}
