# Vertex International Recruitment Platform

A modern, full-stack recruitment platform built for international job placements.

## Tech Stack
- **Frontend:** Next.js 14, React, TypeScript, TailwindCSS v4
- **Backend:** Next.js API Routes
- **Database:** PostgreSQL with Prisma ORM (v6)
- **Authentication:** Custom JWT-based auth + bcrypt hashing
- **Email:** Nodemailer (SMTP)
- **Validation:** Zod

## Local Setup Instructions

1. **Clone & Install**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy `.env.example` to `.env` and fill in your actual values:
   ```bash
   cp .env.example .env
   ```
   **Important:** Set your `DATABASE_URL` to a valid PostgreSQL connection string.

3. **Database Setup**
   Push the Prisma schema to your database to create the necessary tables:
   ```bash
   npx prisma db push
   ```
   *(Optional)* Seed some data or view the database:
   ```bash
   npx prisma studio
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

## Project Architecture
- `src/app/*`: Next.js App Router pages and layouts.
- `src/app/api/*`: Backend REST API routes.
- `src/components/*`: Reusable React components (Navbar, Footer).
- `src/lib/*`: Core utilities (Prisma client, JWT, Auth, Email, Rate limiting, File upload).
- `prisma/schema.prisma`: Database schema definition.

## Deployment

**Frontend (Vercel)**
- Push the code to GitHub.
- Connect the repository to Vercel.
- Add all environment variables (including `DATABASE_URL`) to Vercel's Edge Environment settings.

**Database (Railway / Supabase / Neon)**
- Use any cloud PostgreSQL provider.
- Paste the connection string into the `DATABASE_URL` environment variable.

## Notes
- **File Uploads:** Uploads are stored locally in `public/uploads/` by default. For production (e.g., Vercel), you must change this to use AWS S3, Cloudinary, or Vercel Blob, as Vercel's filesystem is read-only and ephemeral.
