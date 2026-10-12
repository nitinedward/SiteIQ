/** A drawing's or sketch's small image (lib/thumbs), with a plain
 *  placeholder when there's none or it can't load (offline, not kept). */

import { useState } from 'react'
import { Image, View, type ImageStyle, type StyleProp } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { thumbFor } from '../lib/thumbs'
import { theme } from '../lib/theme'

export function DrawingThumb({ previewUrl, style }: { previewUrl?: string | null; style: StyleProp<ImageStyle> }) {
  const [failed, setFailed] = useState(false)
  const uri = thumbFor(previewUrl)
  if (!uri || failed) {
    return (
      <View style={[style as any, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }]}>
        <Ionicons name="document-outline" size={22} color={theme.colors.line} />
      </View>
    )
  }
  return <Image source={{ uri }} style={[{ backgroundColor: '#FFFFFF' }, style]} resizeMode="cover" onError={() => setFailed(true)} />
}
