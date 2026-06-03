---
name: r3f-reactive-polling
description: Poll for React Three Fiber value changes and trigger React re-renders when needed.
---

# Reactive Polling

Poll for changes to any value and trigger React re-renders when it changes.

## Technique

Create a `useReactive` hook that uses `useFrame` to periodically check a selector function. When the value changes, update React state to trigger a re-render. In React Three Fiber 8, throttle manually with accumulated delta.

## Key Concepts

- Selector function returns the value to watch
- Compare with previous value to detect changes
- Only update state when value actually changes
- Throttle polling manually with an elapsed-time ref for R3F 8 compatibility
- Use sparingly for values that don't change frequently

## Usage

```tsx
const useReactive = <T,>(selector: () => T, fps = 30): T => {
  const [reactiveValue, setReactiveValue] = useState<T>(selector())
  const previousValueRef = useRef(reactiveValue)
  const elapsedRef = useRef(0)

  useFrame((_, delta) => {
    elapsedRef.current += delta
    if (elapsedRef.current < 1 / fps) return
    elapsedRef.current = 0

    const newValue = selector()
    if (previousValueRef.current !== newValue) {
      previousValueRef.current = newValue
      setReactiveValue(newValue)
    }
  })

  return reactiveValue
}

// Usage
const isAboveZero = useReactive(() => position.y > 0)
```

---

This skill is part of [verekia](https://x.com/verekia)'s [**r3f-gamedev**](https://github.com/verekia/r3f-gamedev).
