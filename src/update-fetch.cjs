const { Readable } = require('node:stream');

// net.fetch({ redirect: 'manual' }) rejects Chromium redirects instead of
// returning their status and Location. Expose each hop through net.request so
// AppUpdater can validate the destination before making the next request.
function createUpdateFetch(net) {
  return (url, { signal, headers } = {}) => new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', headers });
    let settled = false, response;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = error => {
      if (!settled) { settled = true; cleanup(); reject(error); }
      else if (response && !response.destroyed) response.destroy(error);
    };
    const abort = () => { fail(signal.reason || new Error('Request aborted')); request.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    request.on('error', fail);
    request.on('abort', () => fail(new Error('Request aborted')));
    request.on('redirect', (status, _method, location) => {
      if (settled) return;
      settled = true; cleanup();
      resolve(new Response(null, { status, headers: { location } }));
      request.abort();
    });
    request.on('response', incoming => {
      if (settled) { incoming.on('error', () => {}); incoming.destroy(); request.abort(); return; }
      response = incoming;
      incoming.on('error', fail);
      incoming.once('end', cleanup); incoming.once('close', () => { cleanup(); request.abort(); });
      incoming.once('aborted', () => incoming.destroy(new Error('Response aborted')));
      try {
        const responseHeaders = new Headers();
        for (const [name, values] of Object.entries(incoming.headers))
          for (const value of Array.isArray(values) ? values : [values]) responseHeaders.append(name, value);
        const body = [204, 205, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming);
        if (!body) incoming.resume();
        const result = new Response(body, { status: incoming.statusCode, headers: responseHeaders });
        settled = true; resolve(result);
      } catch (error) { fail(error); request.abort(); }
    });
    request.end();
  });
}

module.exports = { createUpdateFetch };
