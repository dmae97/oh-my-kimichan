# DESIGN.md

## Overview

Project visual identity and design system for oh-my-kimi.
Inspired by Kimichan — our purple-eyed, hoodie-wearing mascot.

## Brand Concept

- **Mood**: Playful, cozy, chibi-anime aesthetic
- **Vibe**: "Onii-chan~ hai, naniga suki? Chocomint yori mo anata~ 💜"
- **Character**: Kimichan — black hoodie, purple eyes, mint-green accents

## Colors

### Primary Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--kimichan-purple` | #7B5BF5 | Eyes, logo, primary accent |
| `--kimichan-pink` | #EC4899 | Hearts, cheeks, secondary accent |
| `--kimichan-mint` | #14B8A6 | Chocomint theme, success states |
| `--kimichan-dark` | #241C32 | Hoodie, dark backgrounds |
| `--kimichan-cream` | #F3E8FF | Light backgrounds, bright text |
| `--kimichan-skin` | #F9D3C5 | Warm highlights, soft accents |

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--primary` | #7B5BF5 | Main brand color |
| `--accent` | #EC4899 | Secondary emphasis |
| `--success` | #14B8A6 | Mint green for success |
| `--warning` | #F59E0B | Warm amber for warnings |
| `--danger` | #EF4444 | Soft red for errors |
| `--info` | #60A5FA | Sky blue for info |
| `--bg-dark` | #241C32 | Dark mode background |
| `--bg-light` | #FAFAFC | Light mode background |
| `--text-primary` | #1E1B2E | Primary text on light |
| `--text-muted` | #9CA3AF | Secondary/muted text |

## Typography

- **Primary**: Inter, system-ui, sans-serif
- **Display**: Inter with heavier weights (700-900)
- **Mono**: JetBrains Mono, Fira Code (for CLI/code)

## Rules

- Use tokens before inventing new values.
- Keep components compact and status-aware.
- Purple (#7B5BF5) is the hero color — use it for primary actions.
- Mint (#14B8A6) represents "chocomint" — reserve for success/positive states.
- Pink (#EC4899) is for fun/love/hearts — use sparingly for delight.
- Dark (#241C32) is our "hoodie black" — use for dark mode, not pure black.
