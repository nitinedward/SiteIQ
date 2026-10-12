/** A sideways row of drawing (or sketch) cards to choose from, right on the
 *  inspection screen: tap a card to select it, tap again to deselect. The
 *  magnifier shows the whole sheet first. */

import { useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Modal, Dimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { DrawingThumb } from './DrawingThumb'
import { fullImageFor, thumbFor } from '../lib/thumbs'
import { theme } from '../lib/theme'

const T = theme.colors
const R = theme.radius
const CARD_W = 148

export type PickItem = {
  id: string
  /** "S1.01", or "Sketch". */
  heading: string
  title: string
  /** "Rev A", "Rev A · superseded", "CAN-003 Rev A · page 2"… */
  meta: string
  previewUrl: string | null
  /** A superseded revision: drawn dashed. */
  older?: boolean
}

export function PickRow({ items, selected, onToggle, trailing }: {
  items: PickItem[]
  selected: string[]
  onToggle: (id: string) => void
  /** An extra tile at the end of the row (e.g. "Show older revisions"). */
  trailing?: React.ReactNode
}) {
  const [zoomed, setZoomed] = useState<PickItem | null>(null)
  const zoomedOn = !!zoomed && selected.includes(zoomed.id)

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.row} contentContainerStyle={S.rowContent}>
        {items.map(item => {
          const on = selected.includes(item.id)
          return (
            <View key={item.id} style={{ width: CARD_W }}>
              <TouchableOpacity
                style={[S.card, on && S.cardOn, item.older && S.cardOlder]}
                onPress={() => onToggle(item.id)}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${item.heading} ${item.title}`}
              >
                <DrawingThumb previewUrl={item.previewUrl} style={S.thumb} />
                <View style={S.body}>
                  <Text style={S.heading} numberOfLines={1}>{item.heading}</Text>
                  <Text style={S.title} numberOfLines={2}>{item.title}</Text>
                  <Text style={S.meta} numberOfLines={1}>{item.meta}</Text>
                </View>
              </TouchableOpacity>
              <View style={[S.tick, on && S.tickOn]} pointerEvents="none">
                {on && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
              </View>
              <TouchableOpacity style={S.zoom} onPress={() => setZoomed(item)} accessibilityLabel={`Look at ${item.heading}`} hitSlop={6}>
                <Ionicons name="search" size={15} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )
        })}
        {trailing}
      </ScrollView>

      {/* The whole sheet, to check before choosing. */}
      <Modal visible={!!zoomed} animationType="fade" onRequestClose={() => setZoomed(null)}>
        <View style={S.zoomScreen}>
          <View style={S.zoomHeader}>
            <TouchableOpacity style={S.zoomClose} onPress={() => setZoomed(null)} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={S.zoomHeading} numberOfLines={1}>{zoomed?.heading}</Text>
              <Text style={S.zoomTitle} numberOfLines={1}>{zoomed?.title}</Text>
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={S.zoomBody} maximumZoomScale={5} minimumZoomScale={1} centerContent>
            {zoomed && (fullImageFor(zoomed.previewUrl) ?? thumbFor(zoomed.previewUrl)) ? (
              <Image
                source={{ uri: (fullImageFor(zoomed.previewUrl) ?? thumbFor(zoomed.previewUrl))! }}
                style={S.zoomImage}
                resizeMode="contain"
              />
            ) : (
              <Text style={S.zoomNone}>No image for this one.</Text>
            )}
          </ScrollView>
          <View style={S.zoomFooter}>
            <TouchableOpacity
              style={S.zoomAction}
              onPress={() => { if (zoomed && !zoomedOn) onToggle(zoomed.id); setZoomed(null) }}
              activeOpacity={0.85}
            >
              <Text style={S.zoomActionText}>{zoomedOn ? 'Selected · close' : 'Select this one'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  )
}

/** A plain tile at the end of a row ("Show older revisions"). */
export function RowTile({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={S.tile} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={22} color={T.indigo} />
      <Text style={S.tileText}>{label}</Text>
    </TouchableOpacity>
  )
}

const S = StyleSheet.create({
  row:        { marginHorizontal: -16 },
  rowContent: { paddingHorizontal: 16, gap: 10, paddingBottom: 2 },
  card:       { backgroundColor: T.surface, borderRadius: R.md, borderWidth: 2, borderColor: T.line, overflow: 'hidden' },
  cardOn:     { borderColor: T.indigo, backgroundColor: T.indigoSoft },
  cardOlder:  { borderStyle: 'dashed' },
  thumb:      { width: '100%', height: 96, borderBottomWidth: 1, borderBottomColor: T.line },
  body:       { paddingHorizontal: 9, paddingTop: 7, paddingBottom: 9 },
  heading:    { fontSize: 13, fontWeight: '800', color: T.indigoDeep },
  title:      { fontSize: 12, color: T.ink, lineHeight: 16, minHeight: 32 },
  meta:       { fontSize: 11, color: T.mid, marginTop: 2 },
  tick:       { position: 'absolute', top: 7, right: 7, width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#C9CDD4', alignItems: 'center', justifyContent: 'center' },
  tickOn:     { backgroundColor: T.indigo, borderColor: T.indigo },
  zoom:       { position: 'absolute', left: 7, top: 60, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(42,46,55,0.78)', alignItems: 'center', justifyContent: 'center' },
  tile:       { width: 110, borderRadius: R.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: T.indigo, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8 },
  tileText:   { fontSize: 12, fontWeight: '700', color: T.indigo, textAlign: 'center' },

  zoomScreen:  { flex: 1, backgroundColor: '#1E222A' },
  zoomHeader:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12 },
  zoomClose:   { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  zoomHeading: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  zoomTitle:   { fontSize: 12, color: '#C9CDD4' },
  zoomBody:    { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  zoomImage:   { width: Dimensions.get('window').width - 16, height: Dimensions.get('window').height * 0.6, backgroundColor: '#FFFFFF', borderRadius: 6 },
  zoomNone:    { color: '#C9CDD4', fontSize: 14 },
  zoomFooter:  { padding: 16, paddingBottom: 36 },
  zoomAction:  { backgroundColor: T.marigold, borderRadius: R.pill, paddingVertical: 16, alignItems: 'center' },
  zoomActionText: { fontSize: 16, fontWeight: '800', color: T.indigoDeep },
})
