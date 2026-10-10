// Sends mail through the Gmail API using an OAuth refresh token (gmail.send scope).
async function accessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Gmail sign-in failed: ' + (d.error_description || d.error));
  return d.access_token;
}

export async function sendMail({ to, subject, text }) {
  const from = `${process.env.GMAIL_SENDER_NAME || 'Task List'} <${process.env.GMAIL_SENDER}>`;
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await accessToken()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }),
  });
  if (!r.ok) throw new Error('Gmail send failed (' + r.status + '): ' + (await r.text()).slice(0, 200));
}
