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
import { useState, useRef, useEffect } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CaptureScreen() {
  // permission is the current permission status
  // requestPermission is the function to ask for permission
  const [permission, requestPermission] = useCameraPermissions();

  const tabBarHeight = useBottomTabBarHeight();

  // Array of photos taken — starts empty
  const [photos, setPhotos] = useState<string[]>([]);

  // Which camera — front or back
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  // Flash on or off
  const [flash, setFlash] = useState<'off' | 'on'>('off');

  // Reference to the camera — lets us call takePhoto()
  const cameraRef = useRef<CameraView>(null);

  // ── PERMISSION NOT YET DECIDED ──────────────────────
  // Still loading permission status — show nothing yet
  if (!permission) {
    return <View style={styles.container} />;
  }

  // ── PERMISSION DENIED ───────────────────────────────
  // Engineer said no to camera — show explanation
  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionIcon}>📷</Text>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          SiteIQ needs camera access to photograph inspection zones.
          Please allow camera access to continue.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionButtonText}>
            Allow Camera Access
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── TAKE A PHOTO ────────────────────────────────────
  const takePhoto = async () => {
    if (!cameraRef.current) return;

    try {
      // takePictureAsync takes the photo
      // quality 0.8 means 80% quality — good balance of size and clarity
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
      });

      if (photo) {
        // Add the new photo URI to our photos array
        // ...photos spreads the existing photos, then adds the new one
        setPhotos(current => [...current, photo.uri]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  // ── DELETE A PHOTO ──────────────────────────────────
  const deletePhoto = (uri: string) => {
    Alert.alert(
      'Delete Photo',
      'Are you sure you want to delete this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setPhotos(current => current.filter(p => p !== uri));
          },
        },
      ]
    );
  };

  // ── TOGGLE FLASH ────────────────────────────────────
  const toggleFlash = () => {
    setFlash(current => current === 'off' ? 'on' : 'off');
  };

  // ── TOGGLE CAMERA FACING ────────────────────────────
  const toggleFacing = () => {
    setFacing(current => current === 'back' ? 'front' : 'back');
  };

  // ── MAIN CAMERA UI ──────────────────────────────────
  return (
    <View style={styles.container}>

      {/* Header */}
<View style={styles.header}>
  <Text style={styles.headerTitle}>Capture</Text>
  <TouchableOpacity
    style={styles.voiceButton}
    onPress={() => router.push('/recorder')}
  >
    <Text style={styles.voiceButtonText}>🎤 Voice</Text>
  </TouchableOpacity>
</View>

      {/* Camera view */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
      />

      {/* Camera controls */}
      <View style={styles.controls}>

        {/* Flash button */}
        <TouchableOpacity
          style={styles.controlButton}
          onPress={toggleFlash}
        >
          <Text style={styles.controlIcon}>
            {flash === 'on' ? '⚡' : '🔦'}
          </Text>
          <Text style={styles.controlLabel}>
            {flash === 'on' ? 'Flash On' : 'Flash Off'}
          </Text>
        </TouchableOpacity>

        {/* Capture button */}
        <TouchableOpacity
          style={styles.captureButton}
          onPress={takePhoto}
          activeOpacity={0.7}
        >
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>

        {/* Flip camera button */}
        <TouchableOpacity
          style={styles.controlButton}
          onPress={toggleFacing}
        >
          <Text style={styles.controlIcon}>🔄</Text>
          <Text style={styles.controlLabel}>Flip</Text>
        </TouchableOpacity>

      </View>

      {/* Photo thumbnail strip */}
      {photos.length > 0 && (
        <View style={[styles.thumbnailContainer, { paddingBottom: tabBarHeight + 8 }]}>
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
                <Image
                  source={{ uri: item }}
                  style={styles.thumbnail}
                />
              </TouchableOpacity>
            )}
          />
          <Text style={styles.thumbnailHint}>
            Long press a photo to delete
          </Text>
          <TouchableOpacity
      style={styles.submitObsButton}
      onPress={() => router.push('/observation')}
    >
      <Text style={styles.submitObsText}>
        Review & Submit Observation →
      </Text>
    </TouchableOpacity>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  photoCount: {
    fontSize: 14,
    color: '#8899AA',
  },
  camera: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 1.0,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingVertical: 20,
    backgroundColor: '#0A1628',
    zIndex: 1,
  },
  controlButton: {
    alignItems: 'center',
    gap: 4,
    width: 70,
  },
  controlIcon: {
    fontSize: 24,
  },
  controlLabel: {
    fontSize: 11,
    color: '#8899AA',
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
  },
  thumbnailContainer: {
  backgroundColor: '#112240',
  paddingTop: 12,
  paddingBottom: 120,
  borderTopWidth: 1,
  borderTopColor: '#1C2E44',
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 2,
  },
  thumbnailList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 8,
    marginRight: 8,
  },
  thumbnailHint: {
    fontSize: 11,
    color: '#4A5568',
    textAlign: 'center',
    marginTop: 6,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#0A1628',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  permissionIcon: {
    fontSize: 56,
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 15,
    color: '#8899AA',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  voiceButton: {
  backgroundColor: '#112240',
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderWidth: 1,
  borderColor: '#1C2E44',
},
voiceButtonText: {
  fontSize: 13,
  color: '#FFFFFF',
  fontWeight: '500',
},
submitObsButton: {
  backgroundColor: '#059669',
  marginHorizontal: 16,
  marginTop: 8,
  marginBottom: 16,
  borderRadius: 8,
  padding: 12,
  alignItems: 'center',
},
submitObsText: {
  color: '#FFFFFF',
  fontSize: 14,
  fontWeight: '600',
},
});