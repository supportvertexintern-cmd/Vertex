# Vertex International Recruitment Platform

A modern, full-stack recruitment platform built for international job placements.

## Tech Stack
- **Frontend:** Next.js 14, React, TypeScript, TailwindCSS v4
- **Backend:** FastAPI (`vertex_be`); the Next.js API routes check the session and pass requests on
- **Database:** PostgreSQL, owned by FastAPI (SQLAlchemy models, Alembic migrations)
- **Authentication:** Custom JWT-based auth + bcrypt hashing
- **Email:** Nodemailer (SMTP)
- **Validation:** Zod

## Local Setup Instructions

1. **Clone & Install**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file with the required values (get them from a maintainer;
   it is gitignored and must never be committed — see `docs/secrets.md`).

3. **Database Setup**
   The website has no database of its own: it calls FastAPI. Run the backend
   (`vertex_be`), whose Alembic migrations create the tables and whose
   `scripts/seed/` load the reference data.

4. **Run Development Server**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

## Project Architecture
- `src/app/*`: Next.js App Router pages and layouts.
- `src/app/api/*`: Backend REST API routes.
- `src/components/*`: Reusable React components (Navbar, Footer).
- `src/lib/*`: Core utilities (the FastAPI client, JWT, Auth, Rate limiting, File upload).

## Deployment

**Frontend (Vercel)**
- Push the code to GitHub.
- Connect the repository to Vercel.
- Add all environment variables (including `DATABASE_URL`) to Vercel's Edge Environment settings.

**Database (PostgreSQL)**
- The schema comes from the backend's Alembic migrations; see `vertex_be/deploy/README.md`.
- Paste the connection string into the `DATABASE_URL` environment variable. Never commit it (see `docs/secrets.md`).

## Notes
- **File Uploads:** Uploads are stored locally in `public/uploads/` by default. For production (e.g., Vercel), you must change this to use AWS S3, Cloudinary, or Vercel Blob, as Vercel's filesystem is read-only and ephemeral.
