/** The bars that move while dictating.
 *
 *  Animated entirely on the phone's animation thread (native driver): the
 *  app's own thread only nudges one value as the voice gets louder or
 *  quieter. The earlier version re-animated 24 bars from the app's thread
 *  12 times a second, which on a budget Android kept that thread at 100% —
 *  so taps (Stop included) waited, and everything after recording crawled. */

import { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { theme } from '../lib/theme'

const BAR_COUNT = 24
const BAR_HEIGHT = 48

/** A level (0 silent … 1 loud) the screen sets with level.setValue(). */
export function useLevel(): Animated.Value {
  return useRef(new Animated.Value(0)).current
}

export function Waveform({ level, active }: { level: Animated.Value; active: boolean }) {
  const phase = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(phase, {
      toValue: 1, duration: active ? 900 : 2400, easing: Easing.linear, useNativeDriver: true,
    }))
    phase.setValue(0)
    loop.start()
    return () => loop.stop()
  }, [active])

  // Each bar's height: a floor, plus the voice level shaped so the middle
  // bars are tallest, rippling with the phase so it reads as live.
  const bars = useMemo(() => Array.from({ length: BAR_COUNT }, (_, i) => {
    const centre = 1 - (Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2)) * 0.45
    const offset = (i * 0.37) % 1
    const ripple = phase.interpolate({
      inputRange: [0, 0.25, 0.5, 0.75, 1],
      outputRange: [0, 1, 2, 3, 4].map(k => 0.7 + 0.3 * Math.abs(Math.sin((k / 4 + offset) * Math.PI * 2))),
    })
    const scale = Animated.add(0.07, Animated.multiply(Animated.multiply(level, centre), ripple))
    return scale
  }), [level, phase])

  return (
    <View style={S.container}>
      {bars.map((scale, i) => (
        <Animated.View
          key={i}
          style={[S.bar, { backgroundColor: active ? theme.colors.marigold : theme.colors.line, transform: [{ scaleY: scale }] }]}
        />
      ))}
    </View>
  )
}

const S = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, gap: 3, paddingHorizontal: 8 },
  bar: { width: 3, height: BAR_HEIGHT, borderRadius: 2 },
})
