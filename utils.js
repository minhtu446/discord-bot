async function retryFetch(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); } catch (e) {
      const wait = e.data?.retry_after || e.retry_after;
      if (wait && i < maxRetries - 1) await new Promise(r => setTimeout(r, wait * 1000 + 500));
      else throw e;
    }
  }
}

module.exports = { retryFetch };