/**
 * submission-created — Netlify runs this automatically after every VERIFIED
 * form submission (the filename is the trigger; no wiring needed).
 *
 * Sends the notification through the business's own Zoho SMTP, mailbox -> mailbox.
 * Netlify's built-in email notifications were silently swallowed by Zoho's
 * inbound filtering; same-domain mail submitted through Zoho's own server is
 * delivered to the local mailbox directly (proven: 250 Message received on a
 * live test before this was built).
 *
 * Dependency-free on purpose — node's tls + six SMTP commands. A mail library
 * already sank one attempt at this on another runtime (import alone blew the
 * memory ceiling), and bundling zero deps means nothing to install or drift.
 *
 * Credentials come from Netlify env vars (ZOHO_SMTP_USER / ZOHO_SMTP_PASS /
 * MAIL_TO), never from code. The submission is already stored by Netlify
 * before this runs, so a mail failure can never lose the lead — it only means
 * nobody was paged; the error lands in the function log.
 */
const tls = require('tls');

const READ_TIMEOUT_MS = 15000;

function smtpSend({ host, port, user, pass, from, to, message }) {
  return new Promise((resolve, reject) => {
    const log = [];
    const sock = tls.connect(port, host, { servername: host });
    sock.setEncoding('utf8');
    let buf = '';
    let onReply = null;
    let timer = null;

    const fail = (why) => {
      clearTimeout(timer);
      try { sock.destroy(); } catch (_) { /* already gone */ }
      reject(new Error(why + '\n--- transcript ---\n' + log.join('\n')));
    };
    const arm = (what) => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(`timeout waiting for ${what}`), READ_TIMEOUT_MS);
    };

    sock.on('error', (e) => fail('socket error: ' + e.message));
    sock.on('data', (d) => {
      buf += d;
      if (!buf.endsWith('\r\n')) return;                    // partial line
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (!/^\d{3} /.test(last)) return;                    // multiline reply continuing
      log.push('< ' + lines.join(' | '));
      buf = '';
      const code = parseInt(last.slice(0, 3), 10);
      const h = onReply; onReply = null;
      if (h) h(code);
    });

    /* expect === null means "report the code, don't enforce it" — used for
       RCPT TO, where one bad address must not sink the whole message. */
    const step = (line, expect, what, redact) =>
      new Promise((res) => {
        onReply = (code) => {
          if (expect && !expect.includes(code)) return fail(`expected ${expect.join('/')} got ${code} at ${what}`);
          res(code);
        };
        arm(what);
        if (line !== null) {
          log.push('> ' + (redact ? '[redacted]' : line));
          sock.write(line + '\r\n');
        }
      });

    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

    (async () => {
      await step(null, [220], 'greeting');                  // server speaks first
      await step('EHLO brightechdistribution.com', [250], 'EHLO');
      await step('AUTH PLAIN ' + b64('\0' + user + '\0' + pass), [235], 'AUTH', true);
      await step(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');

      /* Per RFC 5321 a rejected RCPT leaves the session usable, so take the
         recipients the server accepts and carry on. Only an empty accepted
         list is fatal — otherwise adding a second address could silence the
         notifications that already work. */
      const accepted = [];
      const rejected = [];
      for (const rcpt of to) {
        const code = await step(`RCPT TO:<${rcpt}>`, null, 'RCPT ' + rcpt);
        if (code === 250 || code === 251) accepted.push(rcpt);
        else rejected.push(`${rcpt} (${code})`);
      }
      if (!accepted.length) return fail('every recipient was rejected: ' + rejected.join(', '));

      await step('DATA', [354], 'DATA');
      const body = message.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');
      log.push('> [message body ' + body.length + ' bytes]');
      await step(body + '\r\n.', [250], 'end-of-DATA');
      await step('QUIT', [221], 'QUIT');
      clearTimeout(timer);
      sock.end();
      resolve({ transcript: log.join('\n'), accepted, rejected });
    })().catch((e) => fail(e.message));
  });
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const row = (label, value) => {
  if (value == null || String(value).trim() === '') return '';
  return `<tr><td style="padding:6px 14px 6px 0;color:#5A6472;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td>` +
         `<td style="padding:6px 0;color:#0C1E30;font-size:14px">${esc(value)}</td></tr>`;
};

exports.handler = async (event) => {
  const user = process.env.ZOHO_SMTP_USER || '';
  const pass = process.env.ZOHO_SMTP_PASS || '';
  const to = (process.env.MAIL_TO || user).split(',').map((s) => s.trim()).filter(Boolean);
  if (!user || !pass || !to.length) {
    console.error('mail env vars missing (ZOHO_SMTP_USER / ZOHO_SMTP_PASS / MAIL_TO)');
    return { statusCode: 200, body: 'not configured' };
  }

  let data = {};
  try { data = JSON.parse(event.body).payload.data || {}; }
  catch (e) { console.error('unexpected payload shape:', e.message); }

  const name = String(data.name || 'Unknown');
  const company = String(data.company || '');
  const replyTo = String(data.email || '');
  const subject = `New wholesale inquiry — ${company || name}`;

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:620px">` +
    `<h2 style="margin:0 0 4px;font-size:18px;color:#0C1E30">New wholesale inquiry</h2>` +
    `<p style="margin:0 0 18px;color:#5A6472;font-size:13px">Submitted through brightechdistribution.com</p>` +
    `<table style="border-collapse:collapse;width:100%">` +
    row('Name', data.name) + row('Company', data.company) + row('Email', data.email) +
    row('Phone', data.phone) + row('Business type', data.channel) + row('Category', data.category) +
    `</table>` +
    (data.message
      ? `<div style="margin-top:18px"><div style="color:#5A6472;font-size:13px;margin-bottom:6px">Message</div>` +
        `<div style="background:#F2F7FC;border-radius:8px;padding:12px 14px;color:#0C1E30;font-size:14px;white-space:pre-wrap">${esc(data.message)}</div></div>`
      : '') +
    (replyTo ? `<p style="margin-top:22px"><a href="mailto:${esc(replyTo)}" style="color:#1268C2">Reply to ${esc(name)}</a></p>` : '') +
    `</div>`;

  const b64html = Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const message = [
    `From: BrighTech Website <${user}>`,
    `To: ${to.join(', ')}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${/^[\x20-\x7E]*$/.test(subject) ? subject : '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?='}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64html,
  ].join('\r\n');

  try {
    const { transcript, accepted, rejected } = await smtpSend({
      host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com',
      port: Number(process.env.ZOHO_SMTP_PORT || 465),
      user, pass, from: user, to, message,
    });
    console.log('notification sent to', accepted.join(', '));
    if (rejected.length) console.error('RECIPIENT REJECTED (fix MAIL_TO):', rejected.join(', '));
    console.log(transcript);
    return { statusCode: 200, body: 'sent' };
  } catch (e) {
    console.error('SMTP FAILED (submission is safe in Netlify Forms):', e.message);
    return { statusCode: 200, body: 'send failed; submission stored' };
  }
};
