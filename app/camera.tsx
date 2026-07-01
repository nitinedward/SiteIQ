import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  Dimensions,
  Alert,
} from 'react-native';
import { useState, useRef } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { C, FONT, RADIUS } from '../lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CameraScreen() {
  const { zone_id, zone_label, drawing_id } = useLocalSearchParams();
  const [permission, requestPermission] = useCameraPermissions();
  const [photos, setPhotos] = useState<string[]>([]);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const cameraRef = useRef<CameraView>(null);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionIcon}>Camera</Text>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          SiteIQ needs camera access to photograph inspection zones.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionButtonText}>Allow Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
      });
      if (photo) {
        setPhotos(current => [...current, photo.uri]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const deletePhoto = (uri: string) => {
    Alert.alert('Delete Photo', 'Delete this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => setPhotos(current => current.filter(p => p !== uri)),
      },
    ]);
  };

  return (
    <View style={styles.container}>

      {/* Header with back button */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backArrow}>{'<'}</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {zone_label || 'Capture'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.voiceButton}
          onPress={() => router.push('/recorder')}
        >
          <Text style={styles.voiceButtonText}>Voice</Text>
        </TouchableOpacity>
      </View>

      {/* Camera */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
      />

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => setFlash(f => f === 'off' ? 'on' : 'off')}
        >
          <Text style={styles.controlIcon}>
            {flash === 'on' ? 'ON' : 'OFF'}
          </Text>
          <Text style={styles.controlLabel}>
            {flash === 'on' ? 'Flash On' : 'Flash Off'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.captureButton}
          onPress={takePhoto}
          activeOpacity={0.7}
        >
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
        >
          <Text style={styles.controlIcon}>Flip</Text>
          <Text style={styles.controlLabel}>Flip</Text>
        </TouchableOpacity>
      </View>

      {/* Photo strip — does NOT cover capture button */}
      {photos.length > 0 && (
        <View style={styles.thumbnailContainer}>
          <View style={styles.thumbnailRow}>
            <FlatList
              data={photos}
              horizontal
              keyExtractor={(item) => item}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbnailList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onLongPress={() => deletePhoto(item)}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri: item }} style={styles.thumbnail} />
                </TouchableOpacity>
              )}
            />
            <Text style={styles.photoCount}>{photos.length} photos</Text>
          </View>
          <Text style={styles.thumbnailHint}>Long press to delete</Text>

          <TouchableOpacity
            style={styles.submitButton}
            onPress={() => router.push({
              pathname: '/observation',
              params: { zone_id, zone_label, drawing_id },
            })}
          >
            <Text style={styles.submitButtonText}>
              {'Review & Submit Observation >'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: C.bgPage },
  header:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, backgroundColor: C.bgCard, borderBottomWidth: 1, borderBottomColor: C.border },
  backButton:          { flexDirection: 'row', alignItems: 'center', gap: 6, width: 70 },
  backArrow:           { fontSize: 20, color: C.blue },
  backText:            { fontSize: 16, color: C.blue, fontWeight: '500' },
  headerCenter:        { flex: 1, alignItems: 'center' },
  headerTitle:         { fontSize: 14, fontWeight: '500', color: C.textPrimary, textAlign: 'center' },
  voiceButton:         { backgroundColor: C.blueLight, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.blue, width: 70, alignItems: 'center' },
  voiceButtonText:     { fontSize: 12, color: C.blue, fontWeight: '500' },
  camera:              { width: SCREEN_WIDTH, flex: 1 },
  controls:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 40, paddingVertical: 20, backgroundColor: C.bgCard, borderTopWidth: 1, borderTopColor: C.border },
  controlButton:       { alignItems: 'center', gap: 4, width: 70 },
  controlIcon:         { fontSize: 24 },
  controlLabel:        { fontSize: 11, color: C.textSecondary },
  captureButton:       { width: 72, height: 72, borderRadius: 36, backgroundColor: 'transparent', borderWidth: 3, borderColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  captureButtonInner:  { width: 58, height: 58, borderRadius: 29, backgroundColor: C.blue },
  thumbnailContainer:  { backgroundColor: C.bgCard, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: C.border },
  thumbnailRow:        { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  thumbnailList:       { gap: 8, flex: 1 },
  thumbnail:           { width: 56, height: 56, borderRadius: 6, marginRight: 6 },
  photoCount:          { fontSize: 13, color: C.textSecondary, marginLeft: 8 },
  thumbnailHint:       { fontSize: 11, color: C.textMuted, marginBottom: 8 },
  submitButton:        { backgroundColor: C.success, borderRadius: RADIUS.sm, padding: 13, alignItems: 'center' },
  submitButtonText:    { color: C.textInverse, fontSize: 14, fontWeight: '600' },
  permissionContainer: { flex: 1, backgroundColor: C.bgPage, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permissionIcon:      { fontSize: 56, marginBottom: 20 },
  permissionTitle:     { fontSize: 22, fontWeight: '700', color: C.textPrimary, marginBottom: 12, textAlign: 'center' },
  permissionText:      { fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  permissionButton:    { backgroundColor: C.blue, borderRadius: RADIUS.md, paddingVertical: 14, paddingHorizontal: 32 },
  permissionButtonText:{ color: C.textInverse, fontSize: 16, fontWeight: '600',
  },
});