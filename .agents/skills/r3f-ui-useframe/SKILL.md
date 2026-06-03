---
name: r3f-ui-useframe
description: Sync UI elements with the React Three Fiber render loop without causing unnecessary React re-renders.
---

# UI useFrame

Sync UI elements with the render loop without causing unnecessary React re-renders.

## Technique

In this project, React Three Fiber is currently on v8, so `useFrame` should run inside the Canvas tree. For DOM HUDs outside the Canvas, prefer normal React state from the simulation. When a DOM value truly needs render-loop cadence, put a tiny bridge component inside the Canvas that writes to refs or an external store.

## Key Concepts

- R3F 8 `useFrame` belongs inside `<Canvas>`
- Use refs to manipulate DOM elements directly for performance
- Throttle manually with an elapsed-time ref since DOM manipulation is expensive
- Useful for HUDs, debug info, and UI that doesn't need to be in 3D space

## Usage

```tsx
const UiBridge = ({
  positionRef,
  valueRef,
}: {
  positionRef: React.RefObject<{ x: number; y: number }>
  valueRef: React.RefObject<HTMLDivElement>
}) => {
  const elapsedRef = useRef(0)

  useFrame((_, delta) => {
    elapsedRef.current += delta
    if (elapsedRef.current < 1 / 10) return
    elapsedRef.current = 0

    if (positionRef.current && valueRef.current) {
      valueRef.current.innerText =
        `${positionRef.current.x.toFixed(2)}, ${positionRef.current.y.toFixed(2)}`
    }
  })

  return null
}

const Ui = () => {
  const ref = useRef<HTMLDivElement>(null)
  const positionRef = useRef({ x: 0, y: 0 })

  return (
    <>
      <Canvas>
        <Scene />
        <UiBridge positionRef={positionRef} valueRef={ref} />
      </Canvas>
      <div ref={ref} className="fixed top-4 right-4" />
    </>
  )
}

```

---

This skill is part of [verekia](https://x.com/verekia)'s [**r3f-gamedev**](https://github.com/verekia/r3f-gamedev).
