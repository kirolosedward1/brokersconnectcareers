import { useEffect } from 'react';
import { View } from 'react-native';
import { directionMeasured, directionUnmeasured, MEASURE_TIMEOUT_MS } from '~/lib/direction';

/**
 * Two one-point boxes in a row two points wide, never seen, never read out:
 * the first sits on the right when the screen was laid out right to left
 * (src/lib/direction.ts). Drawn before anything else, under the splash screen.
 */
export function DirectionProbe() {
  useEffect(() => {
    const timer = setTimeout(directionUnmeasured, MEASURE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      testID="direction-probe"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, width: 2, height: 1, flexDirection: 'row', opacity: 0 }}
    >
      <View
        testID="direction-probe-first"
        style={{ width: 1, height: 1 }}
        onLayout={(event) => void directionMeasured(event.nativeEvent.layout.x)}
      />
      <View style={{ width: 1, height: 1 }} />
    </View>
  );
}
