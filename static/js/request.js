/* Deadline covers headers AND response-body parsing, including stuck proxies. */
(function () {
  window.DokkadokiFetch = function (url, options) {
    var controller = new AbortController();
    var timer;
    var deadline = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        var error = new Error('The request timed out. Please try again.');
        error.name = 'TimeoutError';
        reject(error);
        controller.abort();
      }, 10000);
    });
    var request = fetch(url, Object.assign({}, options || {}, { signal: controller.signal })).then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, status: response.status, json: function () { return Promise.resolve(data); } };
      });
    });
    return Promise.race([request, deadline]).finally(function () { clearTimeout(timer); });
  };
})();
