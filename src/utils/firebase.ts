import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, off, get, Database } from 'firebase/database';
import { AppState } from '../types';

// Firebase Web設定（クライアント公開用。保護はDBルールで行う）
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyB2feQ8oMZEqd6gBopb8cdRi2-mE_2Jbt0',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'repologo-race-manager.firebaseapp.com',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL ?? 'https://repologo-race-manager-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'repologo-race-manager',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'repologo-race-manager.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '48155593760',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:48155593760:web:eb7d132f303fd73e118045',
};

// Firebase初期化
let app: ReturnType<typeof initializeApp> | null = null;
let database: Database | null = null;

export const initFirebase = (): Database | null => {
  try {
    // 設定が無効な場合は初期化しない
    if (!isFirebaseConfigValid()) {
      console.warn('Firebase設定が無効です。環境変数を確認してください。');
      return null;
    }
    
    if (!app) {
      app = initializeApp(firebaseConfig);
      database = getDatabase(app);
      console.log('Firebase初期化成功:', firebaseConfig.projectId);
    }
    return database;
  } catch (error) {
    console.error('Firebase初期化エラー:', error);
    return null;
  }
};

// データベース参照を取得
const getStateRef = (roomId: string = 'default') => {
  if (!database) {
    database = initFirebase();
  }
  if (!database) return null;
  return ref(database, `rooms/${roomId}/state`);
};

// 初期データを読み込む
export const loadInitialState = async (
  roomId: string = 'default'
): Promise<AppState | null> => {
  const stateRef = getStateRef(roomId);
  if (!stateRef) {
    return null;
  }

  try {
    const snapshot = await get(stateRef);
    if (snapshot && snapshot.exists()) {
      const data = snapshot.val() as AppState;
      console.log('初期データを読み込みました:', roomId, data);
      return data;
    }
    return null;
  } catch (error) {
    console.error('初期データ読み込みエラー:', error);
    return null;
  }
};

// リアルタイム同期：他のクライアントの変更を監視
export const subscribeToRealtimeUpdates = (
  callback: (state: AppState) => void,
  roomId: string = 'default'
): (() => void) => {
  const stateRef = getStateRef(roomId);
  if (!stateRef) {
    console.warn('Firebaseが初期化されていません。ローカルのみで動作します。');
    return () => {}; // 空の関数を返す（クリーンアップなし）
  }

  // 変更を監視
  onValue(stateRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      console.log('リモート更新を受信:', roomId);
      callback(data);
    }
  }, (error) => {
    console.error('リアルタイム更新エラー:', error);
  });

  console.log('リアルタイム同期開始:', roomId);

  // クリーンアップ関数を返す
  return () => {
    if (stateRef) {
      off(stateRef);
      console.log('リアルタイム同期終了:', roomId);
    }
  };
};

// データをFirebaseに保存（他のクライアントに即座に反映）
export const saveStateToFirebase = async (
  state: AppState,
  roomId: string = 'default'
): Promise<void> => {
  const stateRef = getStateRef(roomId);
  if (!stateRef) {
    console.warn('Firebaseが初期化されていません。保存されませんでした。');
    return;
  }

  try {
    await set(stateRef, state);
    console.log('Firebaseに保存成功:', roomId);
  } catch (error) {
    console.error('Firebase保存エラー:', error);
    throw error; // エラーを再スローして呼び出し元で処理できるように
  }
};

// Firebase設定が有効かどうかをチェック（デフォルト値ではないか）
export const isFirebaseConfigValid = (): boolean => {
  const config = firebaseConfig;
  return !!(
    config.apiKey &&
    config.apiKey.startsWith('AIza') &&
    config.databaseURL &&
    config.databaseURL.includes('firebasedatabase.app') &&
    config.projectId === 'repologo-race-manager'
  );
};

// Firebaseが利用可能かどうかをチェック
export const isFirebaseAvailable = (): boolean => {
  if (!isFirebaseConfigValid()) {
    return false;
  }
  return database !== null;
};

