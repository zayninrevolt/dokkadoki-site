/* One visibility calculation for search, date windows and homepage expiry. */
(function () {
  var list = document.querySelector('[data-events-list]');
  if (!list) return;
  var cards = Array.prototype.slice.call(list.querySelectorAll('[data-event-start]'));
  var home = document.querySelector('[data-events-home]');
  var search = document.getElementById('event-search');
  var range = document.getElementById('event-range');
  var results = document.getElementById('event-results');
  var empty = document.querySelector('[data-events-empty]');
  var noMatch = document.querySelector('[data-events-no-match]');
  var dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  function day(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    var parts = dayFormat.formatToParts(date);
    return ['year', 'month', 'day'].map(function (type) { return parts.find(function (p) { return p.type === type; }).value; }).join('-');
  }
  function applyFilters() {
    var today = day(new Date());
    var query = search ? search.value.trim().toLowerCase() : '';
    var days = range && range.value !== 'all' ? Number(range.value) : null;
    // Calendar-day arithmetic in UTC avoids DST shifts; comparison keys are UK dates.
    var cutoff = days === null ? null : new Date(Date.parse(today + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    var upcoming = 0, visible = 0;
    cards.forEach(function (card) {
      var starts = day(card.getAttribute('data-event-start'));
      var ends = day(card.getAttribute('data-event-end'));
      var active = !!starts && !!ends && ends >= today && card.getAttribute('data-event-status') !== 'https://schema.org/EventCancelled';
      if (active) upcoming += 1;
      var show = active && (!query || card.textContent.toLowerCase().indexOf(query) !== -1) && (!cutoff || starts <= cutoff);
      if (home && visible >= 3) show = false;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (home) home.hidden = visible === 0;
    if (results) results.textContent = visible + (visible === 1 ? ' event' : ' events') + ' shown';
    if (empty) empty.hidden = upcoming !== 0;
    if (noMatch) noMatch.hidden = visible !== 0 || upcoming === 0;
  }
  if (search) search.addEventListener('input', applyFilters);
  if (range) range.addEventListener('change', applyFilters);
  applyFilters();
  // Refresh expiry on a tab left open overnight, without polling APIs.
  if (typeof setInterval === 'function') setInterval(applyFilters, 60000);
})();
