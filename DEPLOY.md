# Deploying Sixer Arena to Render

This repo ships a [`render.yaml`](render.yaml) blueprint that provisions everything
in one go: a **Postgres** database, the **backend API**, the **consumer app**, and
the **owner console**.

## 1. Push the code to GitHub

From this folder:

```bash
git add -A
git commit -m "Sixer Arena — ready to deploy"

# Create an empty repo on github.com first (no README), then:
git remote add origin https://github.com/<your-username>/sixer-arena.git
git branch -M main
git push -u origin main
```

## 2. Deploy the blueprint on Render

1. Go to <https://dashboard.render.com> → **New +** → **Blueprint**.
2. Connect your GitHub and pick the `sixer-arena` repo.
3. Render reads `render.yaml` and shows 4 resources (db + 3 services). Click **Apply**.
4. Wait for the first build (~3–5 min). The backend runs DB migrations automatically.

You'll get three URLs:

| Resource | URL |
|---|---|
| Consumer app | `https://sixer-consumer.onrender.com` |
| Owner console | `https://sixer-owner.onrender.com` |
| Backend API | `https://sixer-backend.onrender.com` |

The front-ends are auto-wired to the backend via Render's `fromService` — no URLs to
copy by hand.

## 3. Seed the demo venue (one time)

The database starts empty, so seed the cricket turf + demo data once:

- Render Dashboard → **sixer-backend** → **Shell**, then run:

```bash
pnpm --filter @sixer/backend seed
```

> ⚠️ Only run this once. The seed **resets** all data every time it runs.

Demo logins after seeding:
- **Owner console** — phone `9000000001`, OTP `0000`
- **Consumer** — phone `9876543210` (OTP `0000`), or the **Email** tab (dev mode shows the code on screen)

## 4. Go live for real (optional)

Set these in the Render dashboard → **sixer-backend** → **Environment**, then redeploy:

- **Email OTP** — `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (Gmail app password). Without
  these, email login runs in dev mode (code shown in the app).
- **Razorpay** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
  Without these, checkout uses the deterministic mock. Point the Razorpay webhook at
  `https://sixer-backend.onrender.com/webhooks/razorpay`.

## Notes

- **Free tier cold starts:** the backend sleeps after ~15 min idle and takes ~50s to
  wake on the next request. Upgrade the backend instance to avoid this.
- **CORS** is already open (`origin: true`), so the static sites can call the API
  cross-origin.
- **Custom domains** can be added per-service in the Render dashboard.
