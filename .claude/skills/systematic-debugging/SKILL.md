---
name: systematic-debugging
description: Four-phase debugging methodology with root cause analysis. Use when investigating bugs, fixing test failures, or troubleshooting unexpected behavior. Emphasizes NO FIXES WITHOUT ROOT CAUSE FIRST.
---

# Systematic Debugging

## Core Principle

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

Never apply symptom-focused patches that mask underlying problems. Understand WHY something fails before attempting to fix it. Apply "5 Why" methodology to arrive at root cause.

## The Four-Phase Framework

### Phase 1: Root Cause Investigation

Before touching any code:

1. **Read error messages thoroughly** - Every word matters
2. **Reproduce the issue consistently** - If you can't reproduce it, you can't verify a fix
3. **Examine recent changes** - What changed before this started failing?
4. **Gather diagnostic evidence** - Logs, stack traces, state dumps
5. **Trace data flow** - Follow the call chain to find where bad values originate

**Root Cause Tracing Technique:**

```
1. Observe the symptom - Where does the error manifest?
2. Find immediate cause - Which code directly produces the error?
3. Ask "What called this?" - Map the call chain upward
4. Keep tracing up - Follow invalid data backward through the stack
5. Find original trigger - Where did the problem actually start?
```

**Key principle:** Never fix problems solely where errors appear—always trace to the original trigger. Apply "5 Why" methodology to arrive at root cause.

### Phase 2: Pattern Analysis

1. **Locate working examples** - Find similar code that works correctly
2. **Compare implementations completely** - Don't just skim
3. **Identify differences** - What's different between working and broken?
4. **Understand dependencies** - What does this code depend on?

### Phase 3: Hypothesis and Testing

Apply the scientific method:

1. **Formulate ONE clear hypothesis** - "The error occurs because X"
2. **Design minimal test** - Change ONE variable at a time
3. **Predict the outcome** - What should happen if hypothesis is correct?
4. **Run the test** - Execute and observe
5. **Verify results** - Did it behave as predicted?
6. **Iterate or proceed** - Refine hypothesis if wrong, implement if right

### Phase 4: Implementation

1. **Create failing test case** - Captures the bug behavior
2. **Implement single fix** - Address root cause, not symptoms
3. **Verify test passes** - Confirms fix works
4. **Run full test suite** - Ensure no regressions
5. **If fix fails, STOP** - Re-evaluate hypothesis

**Critical rule:** If THREE or more fixes fail consecutively, STOP. This signals architectural problems requiring discussion, not more patches.

## Red Flags - Process Violations

Stop immediately if you catch yourself thinking:

- "Quick fix for now, investigate later"
- "One more fix attempt" (after multiple failures)
- "This should work" (without understanding why)
- "Let me just try..." (without hypothesis)
- "It works on my machine" (without investigating difference)

## Warning Signs of Deeper Problems

**Consecutive fixes revealing new problems in different areas** indicates architectural issues:

- Stop patching
- Document what you've found
- Discuss with team before proceeding
- Consider if the design needs rethinking

## Common Debugging Scenarios

### Test Failures

```
1. Read the FULL error message and stack trace
2. Identify which assertion failed and why
3. Check test setup - is the test environment correct?
4. Check test data - are mocks/fixtures correct?
5. Trace to the source of unexpected value
```

### Runtime Errors

```
1. Capture the full stack trace
2. Identify the line that throws
3. Check what values are undefined/null
4. Trace backward to find where bad value originated
5. Add validation at the source
```

### "It worked before"

```
1. Use git bisect to find the breaking commit
2. Compare the change with previous working version
3. Identify what assumption changed
4. Fix at the source of the assumption violation
```

### Intermittent Failures

```
1. Look for race conditions
2. Check for shared mutable state
3. Examine async operation ordering
4. Look for timing dependencies
5. Add deterministic waits or proper synchronization
```

## Debugging Checklist

Before claiming a bug is fixed:

- [ ] Root cause identified and documented
- [ ] Hypothesis formed and tested
- [ ] Fix addresses root cause, not symptoms
- [ ] Failing test created that reproduces bug
- [ ] Test now passes with fix
- [ ] Full test suite passes
- [ ] No "quick fix" rationalization used
- [ ] Fix is minimal and focused

## Success Metrics

Systematic debugging achieves ~95% first-time fix rate vs ~40% with ad-hoc approaches.

Signs you're doing it right:

- Fixes don't create new bugs
- You can explain WHY the bug occurred
- Similar bugs don't recur
- Code is better after the fix, not just "working"

---

## Effect-TS Debugging Tips

### 1. Logging and Tracing

```typescript
// Add detailed logging to Effect pipelines
const myEffect = Effect.gen(function* () {
  yield* Effect.log("Starting operation")

  const result = yield* someOperation.pipe(
    Effect.tap((value) => Effect.log(`Got value: ${JSON.stringify(value)}`)),
    Effect.tapError((error) => Effect.log(`Error occurred: ${error}`))
  )

  yield* Effect.log("Operation complete")
  return result
})

// Enable tracing for debugging
const traced = myEffect.pipe(
  Effect.withSpan("myOperation", {
    attributes: { key: "value" },
  })
)
```

### 2. Inspecting Effect Execution

```typescript
// Use Effect.runPromise for async debugging
const debug = async () => {
  try {
    const result = await Effect.runPromise(
      myEffect.pipe(Effect.provide(TestLayer))
    )
    console.log("Result:", result)
  } catch (error) {
    console.error("Failed:", error)
  }
}

// Use Effect.runSync for synchronous debugging (blocks thread)
const debugSync = () => {
  const result = Effect.runSync(myEffect.pipe(Effect.provide(TestLayer)))
  console.log("Result:", result)
}
```

### 3. Testing Effect Services

```typescript
import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { GameService, GameServiceLive } from "../GameService"

describe("GameService", () => {
  const TestLayer = GameServiceLive

  it.effect("should create a game", () =>
    Effect.gen(function* () {
      const gameService = yield* GameService
      const gameId = yield* gameService.createGame()

      expect(gameId).toBeDefined()
      expect(gameId.length).toBe(6)

      const game = yield* gameService.getGame(gameId)
      expect(game.phase).toBe("lobby")
    }).pipe(Effect.provide(TestLayer))
  )

  it.effect("should fail when game not found", () =>
    Effect.gen(function* () {
      const gameService = yield* GameService
      const result = yield* gameService.getGame("NOTFND").pipe(
        Effect.either
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("GameNotFoundError")
      }
    }).pipe(Effect.provide(TestLayer))
  )
})
```

---

## Common Effect-TS Pitfalls

### 1. Forgetting to Provide Layers

```typescript
// WRONG: Missing layer provision
const program = Effect.gen(function* () {
  const gameService = yield* GameService
  // ...
})

// Attempting to run without providing the layer
Effect.runPromise(program) // Error: Service not found

// CORRECT: Provide the required layer
Effect.runPromise(program.pipe(Effect.provide(GameServiceLive)))
```

### 2. Non-null Assertions (Forbidden)

```typescript
// WRONG: Using non-null assertion
const player = players.get(playerId)!  // Never do this

// CORRECT: Use Option or explicit null checks
const maybePlayer = players.get(playerId)
if (maybePlayer === undefined) {
  return yield* Effect.fail(new PlayerNotFoundError({ playerId }))
}
// Now maybePlayer is safely typed as Player

// ALSO CORRECT: Use HashMap with Option
import { HashMap, Option } from "effect"
const maybePlayer = HashMap.get(players, playerId)
if (Option.isNone(maybePlayer)) {
  return yield* Effect.fail(new PlayerNotFoundError({ playerId }))
}
const player = maybePlayer.value
```

### 3. Type Casting (Forbidden)

```typescript
// WRONG: Using `as any`
const data = JSON.parse(message) as any

// CORRECT: Use Schema validation
import { Schema } from "@effect/schema"

const MessageSchema = Schema.Struct({
  type: Schema.String,
  payload: Schema.Unknown,
})

const decoded = yield* Schema.decodeUnknown(MessageSchema)(JSON.parse(message)).pipe(
  Effect.mapError((error) => new ProtocolError({ message: String(error) }))
)
```

### 4. Throwing in Pure Functions

```typescript
// WRONG: Throwing in pure function
const divide = (a: number, b: number): number => {
  if (b === 0) throw new Error("Division by zero")
  return a / b
}

// CORRECT: Return Effect with error channel
const divide = (a: number, b: number): Effect.Effect<number, DivisionError> =>
  b === 0
    ? Effect.fail(new DivisionError({ dividend: a }))
    : Effect.succeed(a / b)

// ALSO CORRECT: Prefix sync throwing functions with `unsafe`
const unsafeDivide = (a: number, b: number): number => {
  if (b === 0) throw new Error("Division by zero")
  return a / b
}
```
