/** A stand-in Slack incoming webhook that records every message it receives. */
import express from 'express';

export async function startFakeSlack() {
  const messages = [];
  const state = { fail: false };
  const app = express();
  app.use(express.json());
  app.post('/hook', (req, res) => {
    if (state.fail) return res.status(500).send('no');
    messages.push(req.body.text);
    res.send('ok');
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/hook`,
    messages,
    state,
    /** Wait for background sends to land. */
    waitFor: async (count, ms = 2000) => {
      const end = Date.now() + ms;
      while (messages.length < count && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      return messages;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
