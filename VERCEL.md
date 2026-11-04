# Deploying FootMart to Vercel

## 1. Create a persistent Postgres database

Create a Neon Postgres project or add a Postgres database through the Vercel Marketplace. Copy its connection string (use the provider's pooled connection string if offered) and add it to the Vercel project as `DATABASE_URL`.

The app creates the account and address tables when it starts. Existing local SQLite accounts are not automatically copied to Postgres.

## 2. Add Vercel environment variables

Configure these for each Vercel environment where you want the features enabled:

- `DATABASE_URL`: the Postgres connection string.
- `FOOTMART_SECRET_KEY`: a long, random, persistent secret. Generate one locally with:

  ```powershell
  .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"
  ```

- `GOOGLE_CLIENT_ID`: the OAuth client ID from Google Cloud.
- `GOOGLE_CLIENT_SECRET`: the OAuth client secret from Google Cloud.
- `GOOGLE_REDIRECT_URI`: the exact public callback URL, for example `https://your-domain.example/account/google/callback`.

Do not commit these values or add them to frontend code. Use the same `FOOTMART_SECRET_KEY` for Production and Preview deployments if their login sessions need to remain valid between deployments.

## 3. Configure the Google OAuth client

Create a **Web application** OAuth client in Google Cloud. Add the exact value of `GOOGLE_REDIRECT_URI` to **Authorized redirect URIs**. For Preview deployments, either add each preview callback URI or use a separate OAuth client and environment variables for Preview.

## 4. Deploy

Import the repository into Vercel and deploy it. The app uses Postgres whenever `DATABASE_URL` is present and refuses to use local SQLite on Vercel, where the filesystem is not persistent. Without Google credentials the password-based account flow remains available and the Google button explains that setup is required.

For local development, leave `DATABASE_URL` unset to use the local SQLite database. Set `FOOTMART_SECRET_KEY` locally if you need sessions to remain valid after restarting the app.
