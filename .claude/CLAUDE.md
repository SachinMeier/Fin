# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Principles


This is an Extremely minimal, simple project and keeping the code and documentation minimal and focused on the task at hand is vital.

It is meant to be a local tool for personal use and not meant to be a public facing application. Thus, scaling and performance are not a concern. Do not over engineer the solutions, do not worry about bandwidth or scalability. Keep the code simple, readable, and extendable.

**NEVER** worry about backwards compatibility — not in the database, not in the code, not in the endpoints. This is a personal tool with a single user. Just change things directly.

## ⚠️ MANDATORY: TypeScript Style Guide ⚠️

**ALL agents MUST read and follow the comprehensive TypeScript style guide before writing ANY code:**

📖 **[TYPESCRIPT_STYLE_GUIDE.md](../TYPESCRIPT_STYLE_GUIDE.md)**

This guide contains authoritative rules for:
- Naming conventions and file organization
- Type safety patterns (discriminated unions, type guards, branded types)
- Error handling strategies (Result pattern, proper null handling)
- Async/await patterns and performance optimization
- Testing best practices
- tsconfig.json and ESLint configuration

**Non-compliance with this guide is unacceptable.** When in doubt, consult the style guide.

---

## Critical Rules

### Pyramid Principle (Plans & Responses)

**ALWAYS** structure plans and responses pyramid-style: start with a one-sentence summary at the highest level of abstraction, then progressively add detail. The reader should grasp the big picture from the first few lines without reading further.

### Code Rules

- **NEVER** use `!` non-null assertion operator
- **NEVER** use `as any` type casting
- **ALWAYS** validate external data with Schema at boundaries
- **ALWAYS** use `Effect.log` instead of `console.log`
- **ALWAYS** handle errors in Effect's error channel (no throwing in pure functions)
- **ALWAYS** prefix sync functions that throw with `unsafe`
- **NO** abbreviated import aliases (use full names: `PageHeader` not `PH`)
- **NO** double imports from same module (use namespace import only)
- **TEST** using `it.effect(...)` for Effect-based tests (never plain `it(...)`)

### Database Rules

- **NEVER** auto-populate new database fields/schema with seed data unless explicitly asked

## TypeScript Configuration

- **Strict mode enabled** - All type checks enforced
- **Project references** - Uses TypeScript project references for fast incremental builds
- **Path aliases**: `@domain/*`, `@api/*`, `@repos/*`, `@drivers/*`, etc.

Check `shared/fpna/tsconfig.json` for the full configuration.

## Skill Activation

Before implementing ANY task, check if relevant skills apply:

- Writing Backend Code → `effect-patterns` skill
- Debug Problem → `systematic-debug` skill

---

## Design Context

### Users
Personal finance tracking for a single user (you). Used locally to import bank statement CSVs, review transactions, and maintain an organized record of spending. Context: reviewing finances at home, likely wanting clarity without stress.

### Brand Personality
**Calm, Clear, Personal** — A quiet tool that stays out of the way. No marketing speak, no gamification. Just your data, organized.

### Aesthetic Direction
- **Visual tone**: Soft & Modern — rounded corners, gentle shadows, contemporary feel without being trendy
- **Theme**: Light and dark modes, respecting system preference
- **Color palette**: Neutral foundation (grays, off-whites, soft blacks) with minimal accent use
- **Typography**: Clean sans-serif, generous whitespace, comfortable reading sizes
- **Anti-references**: Flashy fintech apps, gamified savings tools, corporate banking interfaces

### Design Principles

1. **Reduce anxiety, not add to it** — Financial data can stress people out. The interface should feel calming, organized, and under control. Never alarm or overwhelm.

2. **Content over chrome** — The transactions are the point. UI elements should recede; data should be immediately scannable and clear.

3. **Quiet confidence** — No excessive feedback, animations, or confirmations. Trust the user. A successful import doesn't need confetti.

4. **Obvious over clever** — Every action should be self-evident. No hidden menus, no ambiguous icons. If someone hasn't used the tool in months, they should still know exactly what to do.

5. **Just enough** — Match the project's code philosophy: minimal, simple, no over-engineering. One good way to do something, not three.
