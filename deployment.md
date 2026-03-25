# Deployment Guide: Vercel Frontend + Render Backend + Existing Neon Database

This is the simplest deployment path for your current setup:

- Frontend: `client/` on Vercel
- Backend: `server/` on Render
- Database: existing Neon PostgreSQL database
- Data: already seeded in Neon, so no production seed step is required

You do not need `render.yaml` for this flow. You can deploy the backend directly from the Render dashboard.

## 1. Before You Start

Make sure you already have:

1. The code pushed to GitHub
2. A Vercel account
3. A Render account
4. Your Neon `DATABASE_URL`
5. Your Gemini API key

## 2. Backend Deployment on Render

### Create the service

1. Log in to Render
2. Click `New +`
3. Choose `Web Service`
4. Connect your GitHub repository
5. Select this project repository

### Configure the backend service

Use these settings:

1. Name: `sap-o2c-server` or any name you like
2. Root Directory: `server`
3. Environment: `Node`
4. Region: choose the closest one to your users
5. Branch: your deploy branch, usually `main`

### Build and start commands

Use these exact commands:

Build Command:

```bash
npm install && npm run db:generate && npm run db:migrate:deploy && npm run build
```

Start Command:

```bash
npm start
```

### Environment variables for Render

Add these environment variables in the Render dashboard:

1. `DATABASE_URL`
   Use your existing Neon connection string.
2. `GEMINI_API_KEY`
   Use your Gemini API key.
3. `GEMINI_MODEL`
   Set this to:

```text
gemini-2.5-flash
```

4. `GEMINI_OPENAI_BASE_URL`
   Set this to:

```text
https://generativelanguage.googleapis.com/v1beta/openai/
```

5. `NODE_ENV`
   Set this to:

```text
production
```

6. `DATA_PATH`
   Set this to:

```text
./data
```

7. `FRONTEND_ORIGIN`
   For now you can use a temporary placeholder:

```text
https://placeholder.vercel.app
```

You will replace this after the frontend is deployed.

### Why `db:migrate:deploy` is still included

Even though your Neon database already exists and is already seeded, keeping:

```bash
npm run db:migrate:deploy
```

in the build command is still the safer choice. If the schema is already current, Prisma will simply apply nothing. If a migration is pending, this keeps the deployed backend consistent with the code.

### Verify the backend

After Render deploys successfully:

1. Open your backend URL
2. Visit:

```text
https://your-render-service.onrender.com/api/health
```

3. Then check:

```text
https://your-render-service.onrender.com/api/graph
```

If both work, the backend is ready.

## 3. Frontend Deployment on Vercel

### Create the Vercel project

1. Log in to Vercel
2. Click `Add New...`
3. Choose `Project`
4. Import the same GitHub repository
5. Set the Root Directory to:

```text
client
```

### Build settings

If Vercel asks for settings, use:

1. Framework Preset: `Vite`
2. Root Directory: `client`
3. Build Command: `npm run build`
4. Output Directory: `dist`

### Frontend environment variable

Add this environment variable in Vercel:

1. `VITE_API_URL`

Value:

```text
https://your-render-service.onrender.com
```

Important:

- Do not add `/api`
- Do not add a trailing slash

The client already appends `/api/...` internally.

## 4. Update Backend CORS After Vercel Deploys

Once Vercel gives you the production frontend URL:

1. Copy the Vercel URL
2. Go back to Render
3. Open your backend service
4. Update `FRONTEND_ORIGIN`
5. Set it to your real Vercel URL, for example:

```text
https://your-project.vercel.app
```

6. Save and redeploy the backend

This is necessary because your backend currently allows one explicit frontend origin.

## 5. Final End-to-End Test

After both deployments are live:

1. Open the Vercel frontend
2. Confirm the graph loads
3. If first-load edges are missing, use the refresh button once
4. Open a graph node and confirm metadata appears
5. Ask a query such as:

```text
Show billing documents for customer 320000083
```

6. Confirm:
   - the response appears
   - SQL appears
   - highlighted nodes appear
   - no CORS error appears in the browser

## 6. Recommended Deployment Order

Use this order:

1. Push latest code to GitHub
2. Deploy backend on Render
3. Set Render environment variables
4. Verify `/api/health`
5. Verify `/api/graph`
6. Deploy frontend on Vercel
7. Set `VITE_API_URL`
8. Copy the Vercel production URL
9. Update Render `FRONTEND_ORIGIN`
10. Redeploy backend
11. Run the final end-to-end smoke test

## 7. What You Can Skip Because Neon Already Exists

You do not need to:

1. Create a new database on Render
2. Run the seed script in production
3. Use `render.yaml`

## 8. Common Problems

### Frontend opens but API calls fail

Check:

1. `VITE_API_URL` in Vercel
2. `FRONTEND_ORIGIN` in Render
3. Backend `/api/health` works directly

### Backend deploys but Prisma fails

Check:

1. `DATABASE_URL` is the correct Neon connection string
2. Neon allows external connections from Render
3. The database schema already exists or migrations can run

### Chat fails but graph works

Check:

1. `GEMINI_API_KEY`
2. Render logs
3. Rate-limit errors from Gemini

### Graph is empty

Since your Neon database is already seeded, this usually means one of these:

1. The backend is pointing to the wrong database
2. `DATABASE_URL` is incorrect
3. The server started before migrations/schema were in sync

## 9. Optional Cleanup Later

Once deployment is stable, you can simplify the repo further by:

1. Removing `render.yaml` if you know you will only deploy manually from the Render dashboard
2. Merging the deployment docs into the README
3. Adding a custom domain for Vercel and Render
