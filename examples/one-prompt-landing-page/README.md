# Example: One-prompt Landing Page

## Prompt

> "Build a Next.js landing page with dark mode, responsive hero section, features grid, and a working contact form. Use Tailwind CSS."

## Expected Output

- Next.js 14+ app directory project
- Tailwind CSS configured
- Dark mode toggle
- Responsive hero + features + contact sections
- Working contact form (client-side validation)

## Actual Output

See [RUN_REPORT.md](./RUN_REPORT.md) for the full agent run log.

## What Worked

- [x] Project scaffold generated
- [x] Tailwind config correct
- [x] Responsive layout
- [x] Dark mode toggle functional

## Known Limitations

- Contact form is client-side only (no backend endpoint)
- Images use placeholders
- SEO meta tags are basic

## Run It

```bash
cd output/
npm install
npm run dev
```
