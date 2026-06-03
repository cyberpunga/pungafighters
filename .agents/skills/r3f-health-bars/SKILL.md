---
name: r3f-health-bars
description: Display React Three Fiber health bars above characters using Drei Html and CSS styling.
---

# Health Bars

Display health bars above characters using CSS styling.

## Technique

Use Drei's `Html` component to render styled health bars in 3D space. Update the health bar width by manipulating the DOM element's `transform: scaleX()` via a ref in `useFrame`. In projects on React Three Fiber 8, throttle manually with accumulated delta instead of passing an `{ fps }` options object to `useFrame`.

## Key Concepts

- `Html` from `@react-three/drei` with `center` and `distanceFactor` props
- Use refs to directly manipulate DOM styles for performance
- For R3F 8, keep a local accumulator/ref and update DOM only when enough time has elapsed
- `scaleX` transform for smooth width changes with CSS transitions
- Style with CSS (gradients, borders, skew transforms)

## Usage

```tsx
const healthRef = useRef<HTMLDivElement>(null)

const elapsedRef = useRef(0)

useFrame((_, delta) => {
  elapsedRef.current += delta
  if (elapsedRef.current < 1 / 15) return
  elapsedRef.current = 0
  healthRef.current.style.transform = `scaleX(${healthPercent})`
})

<Html center position-y={1.5} distanceFactor={5}>
  <div className="bg-red-500">
    <div ref={healthRef} className="bg-green-500 origin-left transition-transform" />
  </div>
</Html>
```

---

This skill is part of [verekia](https://x.com/verekia)'s [**r3f-gamedev**](https://github.com/verekia/r3f-gamedev).
