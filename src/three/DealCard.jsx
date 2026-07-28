// src/three/DealCard.jsx
import { useEffect, useRef, useState } from 'react'
import { RoundedBox, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { MathUtils } from 'three'
import { PIPELINE_FONT } from './pipelineTheme'

const W = 2.15, H = 1.3, D = 0.16

export default function DealCard({ deal, color, position, theme, calm, onSelect }) {
  const group = useRef()
  const mat = useRef()
  const [hovered, setHovered] = useState(false)
  const [baseX, baseY, baseZ] = position

  // The cursor is global state — put it back if this card unmounts while hovered.
  useEffect(() => () => { document.body.style.cursor = 'auto' }, [])

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return

    // damp() folds in frame time, so motion matches at 60Hz and 120Hz.
    const k = 6
    const drift = calm ? 0 : Math.sin(state.clock.elapsedTime * 0.8 + baseX * 1.7) * 0.05

    g.position.y = MathUtils.damp(g.position.y, baseY + drift + (hovered ? 0.4 : 0), k, delta)
    g.position.z = MathUtils.damp(g.position.z, baseZ + (hovered ? 0.55 : 0), k, delta)

    // state.pointer is the canvas-normalised -1..1 cursor.
    const tiltX = hovered && !calm ? -state.pointer.y * 0.22 : 0
    const tiltY = hovered && !calm ? state.pointer.x * 0.30 : 0
    g.rotation.x = MathUtils.damp(g.rotation.x, tiltX, k, delta)
    g.rotation.y = MathUtils.damp(g.rotation.y, tiltY, k, delta)

    g.scale.setScalar(MathUtils.damp(g.scale.x, hovered ? 1.05 : 1, k, delta))

    if (mat.current) {
      mat.current.emissiveIntensity =
        MathUtils.damp(mat.current.emissiveIntensity, hovered ? 1.7 : 0.3, k, delta)
    }
  })

  // stopPropagation stops cards behind this one lighting up through it.
  const over = e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }
  const out = e => { e.stopPropagation(); setHovered(false); document.body.style.cursor = 'auto' }

  return (
    <group
      ref={group}
      position={position}
      onPointerOver={over}
      onPointerOut={out}
      onClick={e => { e.stopPropagation(); onSelect?.(deal) }}
    >
      <RoundedBox args={[W, H, D]} radius={0.13} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial
          ref={mat}
          color={theme.board}
          emissive={color}
          emissiveIntensity={0.3}
          roughness={0.35}
          metalness={0.55}
        />
      </RoundedBox>

      <mesh position={[-W / 2 + 0.11, 0, D / 2 + 0.005]}>
        <planeGeometry args={[0.06, H - 0.34]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>

      <Text
        font={PIPELINE_FONT}
        position={[-W / 2 + 0.26, 0.32, D / 2 + 0.01]}
        anchorX="left" anchorY="middle"
        fontSize={0.16} maxWidth={W - 0.45} color={theme.text}
      >
        {deal.client}
      </Text>
      <Text
        font={PIPELINE_FONT}
        position={[-W / 2 + 0.26, 0.05, D / 2 + 0.01]}
        anchorX="left" anchorY="middle"
        fontSize={0.11} maxWidth={W - 0.45} color={theme.sub}
      >
        {deal.policyNumber}
      </Text>
      <Text
        font={PIPELINE_FONT}
        position={[-W / 2 + 0.26, -0.3, D / 2 + 0.01]}
        anchorX="left" anchorY="middle"
        fontSize={0.19} color={color}
      >
        {deal.amount}
      </Text>
    </group>
  )
}
