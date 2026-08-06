import { HandLandmarker, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_PATH = '/mediapipe/wasm';
const MODELS_PATH = '/mediapipe/models';

let _filesetResolver = null;
let _handLandmarker = null;
let _faceLandmarker = null;

async function getFilesetResolver() {
  if (!_filesetResolver) {
    _filesetResolver = await FilesetResolver.forVisionTasks(WASM_PATH);
  }
  return _filesetResolver;
}

/**
 * Returns a singleton HandLandmarker, initializing it on first call.
 * @param {'IMAGE'|'VIDEO'|'LIVE_STREAM'} runningMode
 */
export async function getHandLandmarker(runningMode = 'VIDEO') {
  if (_handLandmarker) return _handLandmarker;
  const vision = await getFilesetResolver();
  _handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `${MODELS_PATH}/hand_landmarker.task`,
      delegate: 'GPU',
    },
    runningMode,
    numHands: 2,
  });
  return _handLandmarker;
}

/**
 * Returns a singleton FaceLandmarker, initializing it on first call.
 * @param {'IMAGE'|'VIDEO'|'LIVE_STREAM'} runningMode
 */
export async function getFaceLandmarker(runningMode = 'VIDEO') {
  if (_faceLandmarker) return _faceLandmarker;
  const vision = await getFilesetResolver();
  _faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `${MODELS_PATH}/face_landmarker.task`,
      delegate: 'GPU',
    },
    runningMode,
    outputFaceBlendshapes: true,
    numFaces: 1,
  });
  return _faceLandmarker;
}

/**
 * Pre-warms both landmarkers so the first inference call is fast.
 */
export async function initMediaPipe(runningMode = 'VIDEO') {
  await Promise.all([
    getHandLandmarker(runningMode),
    getFaceLandmarker(runningMode),
  ]);
}
