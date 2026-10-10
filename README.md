# Task list (Vercel + Neon + Gmail API)

Admin registers people (name, email, mobile). Each person gets an invite email with a link to set a password, then signs in and sees only the tasks assigned to them. Task visibility is enforced in the API query (`api/tasks.js`), not in the browser.

## 1. Database (Neon)
1. Create a Neon project. Open the SQL editor and run `schema.sql`.
2. Copy the connection string into `DATABASE_URL`.

## 2. Gmail API (sending the invites)
1. Google Cloud Console: create a project and enable the **Gmail API**.
2. OAuth consent screen: set it up, then **publish it to "In production"**. In "Testing" mode Google expires refresh tokens after 7 days and sending will stop working.
3. Credentials: create an **OAuth client ID** of type *Web application* with the redirect URI `https://developers.google.com/oauthplayground`.
4. Open https://developers.google.com/oauthplayground, click the gear icon, tick **Use your own OAuth credentials**, and paste the client ID and secret.
5. In Step 1 enter the scope `https://www.googleapis.com/auth/gmail.send`, authorise with the Gmail account that should send the invites, then in Step 2 click **Exchange authorization code for tokens**.
6. Copy the **refresh token** into `GMAIL_REFRESH_TOKEN`. Put the client ID and secret into `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`, and the sending address into `GMAIL_SENDER`.

Do not share these values in chat or commit them to git. A regular Gmail account can send roughly 500 emails a day.

## 3. Deploy on Vercel
1. Push this folder to a Git repository and import it in Vercel (or run `vercel` in the folder).
2. Add every variable from `.env.example` under Settings > Environment Variables, then redeploy.
3. Open the site and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. That creates the administrator account.
4. Use **Team members > Add person**. The invite email is sent right away. If sending fails, the person is still saved and you can click **Resend invite**.

## Notes
- Invite links are single-use and expire after 7 days. Only a hash of the token is stored.
- Passwords are hashed with scrypt. Sessions are signed, HttpOnly cookies that last 14 days.
- Not included yet: password reset, login rate limiting, and an audit log.
