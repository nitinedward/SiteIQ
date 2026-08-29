import { useEffect, useRef, useState } from 'react';
import { Dimensions } from 'react-native';
import {
  ViroARScene, ViroSphere, ViroText, ViroMaterials, ViroTrackingStateConstants,
} from '@reactvision/react-viro';

const { width: SW, height: SH } = Dimensions.get('window');
const CENTER_X = SW / 2;
const CENTER_Y = SH / 2;

ViroMaterials.createMaterials({
  arMeasurePoint: { diffuseColor: '#F5A524' },
});

type Point3 = [number, number, number];

function distance3(a: Point3, b: Point3) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export type MeasureBridge = {
  reset: () => void;
  placePoint: () => void;
};

type Props = {
  onPointCount: (n: number) => void;
  onDistance: (m: number | null) => void;
  onTrackingReady: (ready: boolean) => void;
  registerBridge: (bridge: MeasureBridge) => void;
};

// Owns all AR-domain state locally so it stays correct regardless of how
// often the outer screen re-renders — results are surfaced upward only
// through the stable registerBridge callback / on*() props.
export default function MeasureARScene({ onPointCount, onDistance, onTrackingReady, registerBridge }: Props) {
  const sceneRef = useRef<any>(null);
  const [points, setPoints] = useState<Point3[]>([]);
  const liveHitRef = useRef<Point3 | null>(null);

  useEffect(() => {
    registerBridge({
      reset: () => { setPoints([]); onPointCount(0); onDistance(null); },
      placePoint: () => {
        const hit = liveHitRef.current;
        if (!hit) return;
        setPoints(curr => {
          const next: Point3[] = curr.length >= 2 ? [hit] : [...curr, hit];
          onPointCount(next.length);
          onDistance(next.length === 2 ? distance3(next[0], next[1]) : null);
          return next;
        });
      },
    });
  }, []);

  useEffect(() => {
    // Poll a screen-center hit test rather than tracking raw touch
    // coordinates — avoids known 2D-tap-to-AR-ray offset issues and
    // matches how crosshair-based AR ruler apps (incl. iOS Measure) work.
    const id = setInterval(async () => {
      if (!sceneRef.current) return;
      try {
        const results = await sceneRef.current.performARHitTestWithPoint(CENTER_X, CENTER_Y);
        if (results && results.length > 0) {
          liveHitRef.current = results[0].transform.position;
        }
      } catch {}
    }, 150);
    return () => clearInterval(id);
  }, []);

  return (
    <ViroARScene
      ref={sceneRef}
      onTrackingUpdated={(state) => onTrackingReady(state === ViroTrackingStateConstants.TRACKING_NORMAL)}
    >
      {points.map((p, i) => (
        <ViroSphere key={i} position={p} radius={0.008} widthSegmentCount={12} heightSegmentCount={12} materials={['arMeasurePoint']} />
      ))}
      {points.length === 2 && (
        <ViroText
          text={`${(distance3(points[0], points[1]) * 1000).toFixed(0)} mm`}
          position={[
            (points[0][0] + points[1][0]) / 2,
            (points[0][1] + points[1][1]) / 2 + 0.03,
            (points[0][2] + points[1][2]) / 2,
          ]}
          scale={[0.05, 0.05, 0.05]}
          color="#FFFFFF"
          transformBehaviors={['billboard']}
          style={{ fontSize: 30 }}
        />
      )}
    </ViroARScene>
  );
}
