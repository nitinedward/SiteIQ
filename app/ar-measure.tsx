import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ViroARSceneNavigator } from '@reactvision/react-viro';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import { setPendingMeasurement } from '../lib/pendingMeasurement';
import MeasureARScene, { type MeasureBridge } from '../components/MeasureARScene';

const T = theme.colors;

export default function ARMeasureScreen() {
  const [pointCount, setPointCount] = useState(0);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [trackingReady, setTrackingReady] = useState(false);
  const bridgeRef = useRef<MeasureBridge>({ reset: () => {}, placePoint: () => {} });

  const handlePointCount = useCallback((n: number) => setPointCount(n), []);
  const handleDistance = useCallback((m: number | null) => setDistanceM(m), []);
  const handleTrackingReady = useCallback((ready: boolean) => setTrackingReady(ready), []);
  const registerBridge = useCallback((b: MeasureBridge) => { bridgeRef.current = b; }, []);

  // Created once so the AR camera session isn't restarted by unrelated re-renders.
  const sceneFn = useRef(() => (
    <MeasureARScene
      onPointCount={handlePointCount}
      onDistance={handleDistance}
      onTrackingReady={handleTrackingReady}
      registerBridge={registerBridge}
    />
  )).current;

  const useMeasurement = () => {
    if (distanceM == null) return;
    const mm = distanceM * 1000;
    if (mm < 1000) setPendingMeasurement(String(Math.round(mm)), 'mm');
    else setPendingMeasurement(distanceM.toFixed(2), 'm');
    router.back();
  };

  const hint = !trackingReady
    ? 'Move your phone slowly to find a surface...'
    : pointCount === 0
    ? 'Line up the crosshair with your start point, then tap +'
    : pointCount === 1
    ? 'Line up the crosshair with your end point, then tap +'
    : distanceM != null
    ? `${(distanceM * 1000).toFixed(0)} mm`
    : 'Measuring...';

  return (
    <View style={S.container}>
      <ViroARSceneNavigator autofocus initialScene={{ scene: sceneFn }} style={{ flex: 1 }} />

      <View style={S.hud} pointerEvents="box-none">
        <TouchableOpacity style={S.closeBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={S.crosshair} pointerEvents="none">
          <View style={S.crosshairDot} />
        </View>

        <View style={S.hintBar}>
          <Text style={S.hintText}>{hint}</Text>
        </View>

        <View style={S.bottomBar}>
          {pointCount > 0 && (
            <TouchableOpacity style={S.resetBtn} onPress={() => bridgeRef.current.reset()}>
              <Text style={S.resetBtnText}>Reset</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[S.captureBtn, !trackingReady && { opacity: 0.4 }]}
            disabled={!trackingReady}
            onPress={() => bridgeRef.current.placePoint()}>
            <Ionicons name="add" size={30} color="#FFFFFF" />
          </TouchableOpacity>
          {distanceM != null ? (
            <TouchableOpacity style={S.useBtn} onPress={useMeasurement}>
              <Text style={S.useBtnText}>Use This</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 84 }} />
          )}
        </View>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#000000' },
  hud:         { ...StyleSheet.absoluteFillObject },
  closeBtn:    { position: 'absolute', top: 60, left: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  crosshair:   { position: 'absolute', top: '50%', left: '50%', width: 28, height: 28, marginLeft: -14, marginTop: -14, borderRadius: 14, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  crosshairDot:{ width: 4, height: 4, borderRadius: 2, backgroundColor: T.marigold },
  hintBar:     { position: 'absolute', top: 110, left: 20, right: 20, alignItems: 'center' },
  hintText:    { backgroundColor: 'rgba(0,0,0,0.55)', color: '#FFFFFF', fontSize: 14, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, overflow: 'hidden' },
  bottomBar:   { position: 'absolute', bottom: 48, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resetBtn:    { width: 84, paddingVertical: 12, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center' },
  resetBtnText:{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  captureBtn:  { width: 68, height: 68, borderRadius: 34, backgroundColor: T.marigold, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)' },
  useBtn:      { width: 84, paddingVertical: 12, borderRadius: 999, backgroundColor: T.sage, alignItems: 'center' },
  useBtnText:  { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
