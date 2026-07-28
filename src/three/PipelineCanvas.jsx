// src/three/PipelineCanvas.jsx
import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'
import DealCard from './DealCard'
import { layout, THEMES } from './pipelineTheme'

export default function PipelineCanvas({ deals, themeName = 'neon', calm = false, onSelect }) {
  const theme = THEMES[themeName] || THEMES.neon
  const cards = useMemo(() => layout(deals), [deals])

  return (
    <Canvas
      shadows
      dpr={[1, 2]}                       // caps retina cost on phones
      camera={{ position: [0, 2.2, 12], fov: 45 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => gl.setClearColor(theme.bg)}
    >
      <fog attach="fog" args={theme.fog} />

      <ambientLight intensity={theme.ambient} />
      <directionalLight
        position={[5, 9, 6]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
      />
      <pointLight position={[-7, 3, 4]} intensity={38} color={theme.key} distance={22} />
      <pointLight position={[7, -2, 5]} intensity={30} color={theme.rim} distance={22} />

      <Suspense fallback={null}>
        <group position={[0, 0.4, 0]}>
          {cards.map(({ deal, color, position }) => (
            <DealCard
              key={deal.id}
              deal={deal}
              color={color}
              position={position}
              theme={theme}
              calm={calm}
              onSelect={onSelect}
            />
          ))}
        </group>

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.4, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color={theme.board} roughness={0.9} metalness={0.1} />
        </mesh>

        <Grid
          position={[0, -3.39, 0]}
          args={[40, 40]}
          cellSize={0.6}
          cellColor={theme.key}
          sectionSize={3}
          sectionColor={theme.rim}
          fadeDistance={26}
          fadeStrength={1.6}
          infiniteGrid
        />

        <ContactShadows position={[0, -3.36, 0]} opacity={0.5} scale={26} blur={2.6} far={9} />
      </Suspense>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={7}
        maxDistance={18}
        // The lock: 0.5 is the horizon, so the camera can never drop under the
        // board and flip the dashboard upside down.
        minPolarAngle={Math.PI * 0.16}
        maxPolarAngle={Math.PI * 0.48}
        minAzimuthAngle={-Math.PI / 4.5}
        maxAzimuthAngle={Math.PI / 4.5}
      />
    </Canvas>
  )
}
