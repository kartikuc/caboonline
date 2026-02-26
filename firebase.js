// ─── FIREBASE / NETWORK LAYER ─────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, update, onValue, push, remove, off
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDvuECKAQvX4WY9UwBYHXrkGcivcBKwd8c",
  authDomain: "cabo-1611d.firebaseapp.com",
  databaseURL: "https://cabo-1611d-default-rtdb.firebaseio.com",
  projectId: "cabo-1611d",
  storageBucket: "cabo-1611d.firebasestorage.app",
  messagingSenderId: "507007893312",
  appId: "1:507007893312:web:139152ef2e57c7235584a5"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

export { ref, set, get, update, onValue, push, remove, off };

export function gameRef(roomCode) { return ref(db, `rooms/${roomCode}/game`); }
export function playersRef(roomCode) { return ref(db, `rooms/${roomCode}/players`); }
export function chatRef(roomCode) { return ref(db, `rooms/${roomCode}/chat`); }
export function stateRef(roomCode) { return ref(db, `rooms/${roomCode}/state`); }
export function hostRef(roomCode) { return ref(db, `rooms/${roomCode}/host`); }

export async function updateGame(roomCode, updates) {
  return update(ref(db, `rooms/${roomCode}/game`), updates);
}

export async function broadcastEvent(roomCode, eventData) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return update(ref(db, `rooms/${roomCode}/game`), { event: { ...eventData, id } });
}
